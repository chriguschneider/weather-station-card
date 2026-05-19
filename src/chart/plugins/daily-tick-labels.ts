// Replaces Chart.js's tick labels for all three forecast modes.
// Chart.js still reserves the axis height (the tick callback returns
// empty strings — see chart/draw.ts), and this plugin paints the
// actual labels on top:
//
//   - daily:  weekday + 2-digit date, centred per column. Doubled-today
//             framing collapses station-today + forecast-today into a
//             single boundary label.
//   - today / hourly: 24-hour time per column (left-aligned). Date
//             label only on the leftmost-visible column and on
//             midnight columns; midnight columns also draw a bold
//             day-boundary line from the chart bottom up to the date
//             row.
//
// The afterDraw hook itself is intentionally short (#57 cog-46
// refactor): it dispatches to one of two branch helpers based on
// `forecast.type`. Each branch helper holds its own loop and is
// independently grep-able.

import { getDateTimeFormat } from '../../utils/intl-cache.js';
import type { ChartLike, ChartPlugin, CssStyleLike, PluginCardConfig, PluginRenderData } from './_shared.js';

export interface DailyTickLabelsPluginOpts {
  config: PluginCardConfig;
  language: string;
  data: PluginRenderData;
  textColor: string;
  style: CssStyleLike;
  stationCount: number;
  doubledToday: boolean;
  sunshineLabelBand?: number;
}

/** Per-tick value cache. The plugin redraws on every scroll event in
 *  'hourly' mode (so the leftmost-visible date label tracks the
 *  viewport). Without this cache we'd construct 168 Date objects and
 *  make 168+ Intl calls each frame — Intl is 10-50× slower than
 *  primitive ops, so that's the dominant cost in the redraw. */
interface TickInfo {
  hour: number;
  minutes: number;
  isMidnight: boolean;
  time24: string;
  dateShort: string;
  date2Digit: string;
  weekday: string;
  dKey: number;
}

/** Bag of resources shared across the daily / hourly branch helpers
 *  inside `createDailyTickLabelsPlugin`. Captured once per plugin
 *  instantiation so the per-frame redraws are pure rendering work. */
interface RenderContext {
  config: PluginCardConfig;
  textColor: string;
  style: CssStyleLike;
  stationCount: number;
  doubledToday: boolean;
  sunshineLabelBand: number;
  showDateRow: boolean;
  getTickInfo(dataIdx: number): TickInfo | null;
}

/** Walk the visible ticks to find the first one whose pixel position
 *  is inside the scroll viewport. 'hourly' mode renders inside a
 *  horizontally-scrolling wrapper; the leftmost VISIBLE tick (not the
 *  leftmost data point) carries the date label. */
function findLeftmostVisibleTick(chart: ChartLike, scrollLeft: number): number {
  const xScale = chart.scales.x!;
  for (let i = 0; i < xScale.ticks.length; i++) {
    if (xScale.getPixelForTick(i) >= scrollLeft) return i;
  }
  return 0;
}

/** Today / hourly branch. Renders 24-hour time per column, left-
 *  aligned, with a stacked date label (BOLD, primary text colour) on
 *  the leftmost-visible column and on every midnight column. Midnight
 *  columns additionally draw a thick day-boundary stroke. */
function drawHourlyTimeLabels(chart: ChartLike, ctx: RenderContext): void {
  const xScale = chart.scales.x!;
  const c = chart.ctx;
  const fontSize = parseInt(String(ctx.config.forecast.labels_font_size)) || 11;
  const lineH = Math.ceil(fontSize * 1.3);
  const weekdayColor = ctx.config.forecast.chart_datetime_color || ctx.textColor;
  c.save();
  c.textAlign = 'left';
  c.textBaseline = 'bottom';
  const colW = xScale.width / xScale.ticks.length;

  // For 'hourly' the chart can scroll horizontally inside an outer
  // wrapper; the canvas is wider than the viewport. To mark the
  // LEFTMOST VISIBLE tick (not the leftmost data point, which may
  // be scrolled off-screen), find the first tick whose pixel
  // position exceeds the wrapper's scrollLeft. 'today' has no
  // scroll, so the leftmost visible == i === 0.
  let leftmostVisibleIdx = 0;
  let scrollLeft = 0;
  const isScrollable = ctx.config.forecast.type === 'hourly';
  if (isScrollable) {
    const canvas = (chart as { canvas?: HTMLElement | null }).canvas ?? null;
    const wrapper = canvas ? canvas.closest('.forecast-scroll.scrolling') : null;
    scrollLeft = wrapper ? (wrapper as HTMLElement).scrollLeft : 0;
    leftmostVisibleIdx = findLeftmostVisibleTick(chart, scrollLeft);
  }

  // Layout from top to bottom: date → time → sunshine "Xh" box
  // (drawn by the sibling sunshine plugin). The sunshineLabelBand
  // shifts everything up so the boxes don't overlap.
  const dateBaseY = xScale.bottom - 2 - ctx.sunshineLabelBand;
  const labelGap = 4;

  let prevDKey: number | null = null;
  for (let i = 0; i < xScale.ticks.length; i++) {
    const x = xScale.getPixelForTick(i);
    const colLeft = x - colW / 2;
    const labelX = colLeft + labelGap;
    // chart.js auto-skips overlapping ticks at hourly: the visible
    // tick array's `tick.value` is the underlying data INDEX, while
    // `i` is just the position within the visible subset.
    const tick = xScale.ticks[i];
    const dataIdx = (tick && typeof tick.value === 'number') ? tick.value : i;
    const info = ctx.getTickInfo(dataIdx);
    if (!info) continue;

    // Day boundary detected either by an exact midnight tick OR by the
    // calendar date (dKey) changing across consecutive columns. The
    // dKey-change branch covers 3h-aggregated 'today' mode where no
    // column anchors at exactly 00:00 (the midnight hour is pooled
    // inside the 22:00 block; the next column anchors at 01:00 of the
    // new day).
    const dayChanged = prevDKey !== null && info.dKey !== prevDKey;
    const isDayBoundary = info.isMidnight || dayChanged;

    if (isDayBoundary) {
      // Bold day-boundary marker: thick vertical line from chart bottom
      // up to the TOP of the date text, anchored at the column's LEFT
      // edge.
      c.save();
      c.strokeStyle = weekdayColor;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(colLeft, chart.chartArea.bottom);
      c.lineTo(colLeft, dateBaseY - lineH - fontSize);
      c.stroke();
      c.restore();
    }

    const showDate = i === leftmostVisibleIdx || isDayBoundary;
    if (showDate) {
      // Sticky placement for the leftmost-visible date in scrollable
      // hourly mode: when the column's left edge is scrolled off-screen
      // (colLeft < scrollLeft), the date label would land outside the
      // viewport. Clamp to scrollLeft so the date sits at the viewport's
      // left edge — what the user expects from a "currently showing"
      // date marker. Day-boundary labels stay at colLeft so they line
      // up with the bold midnight stroke.
      const stickyLeft = isScrollable && i === leftmostVisibleIdx && !isDayBoundary;
      const dateLabelX = stickyLeft
        ? Math.max(labelX, scrollLeft + labelGap)
        : labelX;
      c.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
      c.fillStyle = weekdayColor;
      c.fillText(info.dateShort, dateLabelX, dateBaseY - lineH);
    }
    c.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    c.fillStyle = weekdayColor;
    c.fillText(info.time24, labelX, dateBaseY);
    prevDKey = info.dKey;
  }
  c.restore();
}

/** Daily branch. Renders weekday + 2-digit date, centred per column.
 *  Doubled-today framing (both blocks active) collapses
 *  station-today + forecast-today into a single boundary label. */
function drawDailyDateWeekdayLabels(chart: ChartLike, ctx: RenderContext): void {
  const xScale = chart.scales.x!;
  const c = chart.ctx;
  const fontSize = parseInt(String(ctx.config.forecast.labels_font_size)) || 11;
  const lineH = Math.ceil(fontSize * 1.3);
  const weekdayColor = ctx.config.forecast.chart_datetime_color || ctx.textColor;
  const dateColor = ctx.style.getPropertyValue('--secondary-text-color') || weekdayColor;

  const todayMs = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); })();
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'bottom';
  const dateBaseY = xScale.bottom - 2 - ctx.sunshineLabelBand;
  const weekdayY = ctx.showDateRow ? dateBaseY - lineH : dateBaseY;

  for (let i = 0; i < xScale.ticks.length; i++) {
    const info = ctx.getTickInfo(i);
    if (!info) continue;

    // Today is a doubled column when both blocks are active. Skip
    // the station-today label (i = stationCount - 1) and draw a
    // single centred label at the boundary in the forecast-today
    // pass.
    if (ctx.doubledToday && i === ctx.stationCount - 1) continue;
    const x = xScale.getPixelForTick(i);
    const labelX = (ctx.doubledToday && i === ctx.stationCount)
      ? (xScale.getPixelForTick(i - 1) + x) / 2
      : x;
    const isToday = info.dKey === todayMs;

    c.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    if (ctx.showDateRow) {
      c.fillStyle = dateColor;
      c.fillText(info.date2Digit, labelX, dateBaseY);
    }
    c.font = `${isToday ? 'bold ' : ''}${fontSize}px Helvetica, Arial, sans-serif`;
    c.fillStyle = weekdayColor;
    c.fillText(info.weekday, labelX, weekdayY);
  }
  c.restore();
}

export function createDailyTickLabelsPlugin({
  config,
  language,
  data,
  textColor,
  style,
  stationCount,
  doubledToday,
  sunshineLabelBand = 0,
}: DailyTickLabelsPluginOpts): ChartPlugin {
  const showDateRow = config.forecast.show_date !== false;

  // Pulled from the process-wide intl-cache so re-instantiating the
  // plugin (mode toggle, theme change) re-uses the same Intl
  // instances that other parts of the card already paid to build.
  // Intl.DateTimeFormat construction is ~0.5-2 ms per call;
  // toLocale*-based alternatives recreate it under the hood per
  // call, so explicit caching is ~3× faster than the toLocale*
  // shortcut.
  const timeFmt = getDateTimeFormat(language, {
    hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const dateShortFmt = getDateTimeFormat(language, {
    day: 'numeric', month: 'short',
  });
  const date2DigitFmt = getDateTimeFormat(language, {
    day: '2-digit', month: '2-digit',
  });
  const weekdayFmt = getDateTimeFormat(language, { weekday: 'short' });

  const tickCache = new Map<number, TickInfo>();
  function getTickInfo(dataIdx: number): TickInfo | null {
    const cached = tickCache.get(dataIdx);
    if (cached) return cached;
    const datetime = data.dateTime ? data.dateTime[dataIdx] : undefined;
    if (!datetime) return null;
    const d = new Date(datetime);
    const hour = d.getHours();
    const minutes = d.getMinutes();
    const dKeyDate = new Date(d); dKeyDate.setHours(0, 0, 0, 0);
    const info: TickInfo = {
      hour,
      minutes,
      isMidnight: hour === 0 && minutes === 0,
      time24: timeFmt.format(d),
      dateShort: dateShortFmt.format(d),
      date2Digit: date2DigitFmt.format(d),
      weekday: weekdayFmt.format(d).toUpperCase(),
      dKey: dKeyDate.getTime(),
    };
    tickCache.set(dataIdx, info);
    return info;
  }

  const renderCtx: RenderContext = {
    config, textColor, style, stationCount, doubledToday,
    sunshineLabelBand, showDateRow, getTickInfo,
  };

  return {
    id: 'dailyTickLabels',
    afterDraw(chart: ChartLike): void {
      const xScale = chart.scales.x;
      if (!xScale?.ticks) return;
      // Branch dispatch — each path owns its own loop, save/restore,
      // and column geometry. Keeps the cognitive complexity of the
      // afterDraw hook itself small (under SonarCloud's 15-cog
      // threshold) and makes each rendering mode independently
      // reviewable.
      if (config.forecast.type === 'today' || config.forecast.type === 'hourly') {
        drawHourlyTimeLabels(chart, renderCtx);
      } else {
        drawDailyDateWeekdayLabels(chart, renderCtx);
      }
    },
  };
}
