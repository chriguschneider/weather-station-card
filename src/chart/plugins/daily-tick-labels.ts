// X-axis tick labels for all three forecast modes. The uPlot axis only
// reserves the strip (`buildAxes` in chart/draw.ts); this plugin paints:
//
//   - daily: weekday + 2-digit date, centred per column.
//   - today / hourly: 24-hour time per column, left-aligned. A date
//     label on day-boundary columns (and the first column of a
//     non-scrolling 'today'); midnight columns also draw a bold
//     day-boundary line up to the date row.

import { getDateTimeFormat } from '../../utils/intl-cache.js';
import type { ChartLike, ChartPlugin, CssStyleLike, PluginCardConfig, PluginRenderData } from './_shared.js';
import { startOfTodayMs } from '../../forecast-utils.js';
import type { Calendar } from '../../utils/time-zone.js';

export interface DailyTickLabelsPluginOpts {
  config: PluginCardConfig;
  language: string;
  calendar: Calendar;
  data: PluginRenderData;
  textColor: string;
  style: CssStyleLike;
  stationCount: number;
  doubledToday: boolean;
  sunshineLabelBand?: number;
}

/** Per-tick values, cached so a redraw does no Date construction or
 *  Intl formatting. */
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

/** Resources shared by the daily and hourly branch helpers, captured
 *  once per plugin instance. */
interface RenderContext {
  config: PluginCardConfig;
  calendar: Calendar;
  textColor: string;
  style: CssStyleLike;
  stationCount: number;
  doubledToday: boolean;
  sunshineLabelBand: number;
  showDateRow: boolean;
  getTickInfo(dataIdx: number): TickInfo | null;
}

/** Today / hourly branch: 24-hour time per column with a bold date
 *  label on day-boundary columns (and the first column of a
 *  non-scrolling 'today'). The output does not depend on the scroll
 *  position. Off-viewport columns are culled (virtualized canvas). */
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
  const isScrollable = ctx.config.forecast.type === 'hourly';
  const cullMin = chart.chartArea.left - 2 * colW;
  const cullMax = chart.chartArea.right + 2 * colW;

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
    const tick = xScale.ticks[i];
    const dataIdx = (tick && typeof tick.value === 'number') ? tick.value : i;
    const info = ctx.getTickInfo(dataIdx);
    if (!info) continue;

    // A day boundary is a midnight tick OR a change of calendar date
    // (dKey): 3h-aggregated 'today' has no column at exactly 00:00.
    // prevDKey is tracked for culled columns too, so detection survives
    // the viewport window.
    const dayChanged = prevDKey !== null && info.dKey !== prevDKey;
    const isDayBoundary = info.isMidnight || dayChanged;
    prevDKey = info.dKey;

    // Viewport culling (after the bookkeeping above, which feeds
    // boundary detection).
    if (x < cullMin || x > cullMax) continue;

    if (isDayBoundary) {
      c.save();
      c.strokeStyle = weekdayColor;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(colLeft, chart.chartArea.bottom);
      c.lineTo(colLeft, dateBaseY - lineH - fontSize);
      c.stroke();
      c.restore();
    }

    const showDate = (!isScrollable && i === 0) || isDayBoundary;
    if (showDate) {
      c.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
      c.fillStyle = weekdayColor;
      c.fillText(info.dateShort, labelX, dateBaseY - lineH);
    }
    c.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    c.fillStyle = weekdayColor;
    c.fillText(info.time24, labelX, dateBaseY);
  }
  c.restore();
}

/** Daily branch: weekday + 2-digit date, centred per column. With a
 *  doubled today (both blocks active) the station-today and
 *  forecast-today columns share one label at their boundary. */
function drawDailyDateWeekdayLabels(chart: ChartLike, ctx: RenderContext): void {
  const xScale = chart.scales.x!;
  const c = chart.ctx;
  const fontSize = parseInt(String(ctx.config.forecast.labels_font_size)) || 11;
  const lineH = Math.ceil(fontSize * 1.3);
  const weekdayColor = ctx.config.forecast.chart_datetime_color || ctx.textColor;
  const dateColor = ctx.style.getPropertyValue('--secondary-text-color') || weekdayColor;

  const todayMs = startOfTodayMs(ctx.calendar);
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'bottom';
  const dateBaseY = xScale.bottom - 2 - ctx.sunshineLabelBand;
  const weekdayY = ctx.showDateRow ? dateBaseY - lineH : dateBaseY;
  const colWDaily = xScale.ticks.length ? xScale.width / xScale.ticks.length : 0;
  const cullMin = chart.chartArea.left - 2 * colWDaily;
  const cullMax = chart.chartArea.right + 2 * colWDaily;

  for (let i = 0; i < xScale.ticks.length; i++) {
    const info = ctx.getTickInfo(i);
    if (!info) continue;

    // Skip the station-today label; the forecast-today pass draws the
    // shared one.
    if (ctx.doubledToday && i === ctx.stationCount - 1) continue;
    const x = xScale.getPixelForTick(i);
    if (x < cullMin || x > cullMax) continue;
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
  calendar,
  data,
  textColor,
  style,
  stationCount,
  doubledToday,
  sunshineLabelBand = 0,
}: DailyTickLabelsPluginOpts): ChartPlugin {
  const showDateRow = config.forecast.show_date !== false;

  // Shared Intl cache: re-instantiating the plugin reuses the
  // formatters instead of constructing new ones.
  const timeFmt = getDateTimeFormat(language, {
    hour12: false, hour: '2-digit', minute: '2-digit', timeZone: calendar.timeZone,
  });
  const dateShortFmt = getDateTimeFormat(language, {
    day: 'numeric', month: 'short', timeZone: calendar.timeZone,
  });
  const date2DigitFmt = getDateTimeFormat(language, {
    day: '2-digit', month: '2-digit', timeZone: calendar.timeZone,
  });
  const weekdayFmt = getDateTimeFormat(language, { weekday: 'short', timeZone: calendar.timeZone });

  const tickCache = new Map<number, TickInfo>();
  function getTickInfo(dataIdx: number): TickInfo | null {
    const cached = tickCache.get(dataIdx);
    if (cached) return cached;
    const datetime = data.dateTime ? data.dateTime[dataIdx] : undefined;
    if (!datetime) return null;
    const d = new Date(datetime);
    const { hour, minute: minutes } = calendar.zonedParts(d);
    const dKeyDate = calendar.startOfDay(d);
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
    config, calendar, textColor, style, stationCount, doubledToday,
    sunshineLabelBand, showDateRow, getTickInfo,
  };

  return {
    id: 'dailyTickLabels',
    afterDraw(chart: ChartLike): void {
      const xScale = chart.scales.x;
      if (!xScale?.ticks) return;
      if (config.forecast.type === 'today' || config.forecast.type === 'hourly') {
        drawHourlyTimeLabels(chart, renderCtx);
      } else {
        drawDailyDateWeekdayLabels(chart, renderCtx);
      }
    },
  };
}
