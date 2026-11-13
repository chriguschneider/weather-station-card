// Zero-degree popup (#330): tapping a zero-degree row opens an overlay
// with the forecast curve of the 0 °C isotherm, so the user sees where
// the snow line goes after its 48-h minimum.
//
// Data: the `forecast` attribute of `sensors.zero_degree_level_48h` —
// a list of `{ datetime: ISO 8601, level: number }`, ascending, in the
// sensor's unit (contract from
// https://github.com/chriguschneider/hass-meteoswiss-weather/issues/225).
// Any sensor with that attribute works; fewer than two valid points
// means no popup and the row keeps opening more-info.
//
// The overlay is plain DOM appended to the card's shadow root, outside
// ha-card: `.card` carries `container-type: inline-size`, and that
// containment would turn `position: fixed` into card-relative. No
// `ha-dialog` either — it is HA-internal, lazy-loaded and changes shape
// between HA versions.

import uPlot from 'uplot';
import { getDateTimeFormat, getNumberFormat } from './utils/intl-cache.js';
import type { Calendar } from './utils/time-zone.js';
import { resolveCssVarIn } from './utils/resolve-css-var.js';
import { PopupShell, el } from './popup-shell.js';

import { isSignificantChange, metresPerUnit, siteLineLevel, type ZeroDegreePoint } from './zero-degree-trend.js';

export type { ZeroDegreePoint };

/** Valid, sorted, deduplicated points of the `forecast` attribute, or
 *  null when fewer than two survive. Rows with an unparseable datetime
 *  or a non-finite level are dropped; on a duplicate timestamp the
 *  first row wins. */
export function parseZeroDegreeCurve(attr: unknown): ZeroDegreePoint[] | null {
  if (!Array.isArray(attr)) return null;
  const byTime = new Map<number, number>();
  for (const row of attr) {
    if (!row || typeof row !== 'object') continue;
    const { datetime, level } = row as { datetime?: unknown; level?: unknown };
    if (typeof datetime !== 'string') continue;
    const t = Date.parse(datetime);
    if (!Number.isFinite(t)) continue;
    if (typeof level !== 'number' || !Number.isFinite(level)) continue;
    if (!byTime.has(t)) byTime.set(t, level);
  }
  if (byTime.size < 2) return null;
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, lvl]) => ({ t, level: lvl }));
}

/** Lowest point; the earliest one on a tie. */
export function findCurveMinimum(curve: readonly ZeroDegreePoint[]): ZeroDegreePoint | null {
  let min: ZeroDegreePoint | null = null;
  for (const p of curve) {
    if (!min || p.level < min.level) min = p;
  }
  return min;
}

/** Highest point; the earliest one on a tie. */
export function findCurveMaximum(curve: readonly ZeroDegreePoint[]): ZeroDegreePoint | null {
  let max: ZeroDegreePoint | null = null;
  for (const p of curve) {
    if (!max || p.level > max.level) max = p;
  }
  return max;
}

/** The curve's extremes worth a marker: the lowest always, the highest
 *  only when it lies at least the trend's significance threshold above
 *  the current level (the curve's first point). */
export function markedExtremes(
  curve: readonly ZeroDegreePoint[],
  unit: string | undefined,
): { min: ZeroDegreePoint | null; max: ZeroDegreePoint | null } {
  const min = findCurveMinimum(curve);
  const max = findCurveMaximum(curve);
  const now = curve[0]?.level;
  const showMax = !!max && now !== undefined && max.level > now
    && isSignificantChange(max.level, now, metresPerUnit(unit));
  return { min, max: showMax ? max : null };
}

/** `precipitation_color` may be a `var(--token, fallback)` string; canvas
 *  cannot parse that, so resolve it against the card host like the other
 *  theme variables. Plain colours pass through. */
export function resolvePopupColor(value: string | undefined, style: CSSStyleDeclaration, fallback: string): string {
  return resolveCssVarIn(value, fallback, style);
}

/** Y range snapped to whole hundreds with at least 100 of headroom on
 *  both sides, so the minimum label never sits on the plot edge. Never
 *  dips below zero for an all-positive curve. */
export function paddedLevelRange(min: number, max: number): [number, number] {
  let lo = Math.floor(min / 100) * 100 - 100;
  const hi = Math.ceil(max / 100) * 100 + 100;
  if (min >= 0 && lo < 0) lo = 0;
  return [lo, hi];
}

/** Midnights in the card's zone (ADR-0030) strictly after `t0` and
 *  up to `t1`. */
export function dayStartsBetween(t0: number, t1: number, calendar: Calendar): number[] {
  const out: number[] = [];
  let d = calendar.addDays(calendar.startOfDay(t0), 1).getTime();
  while (d <= t1) {
    out.push(d);
    d = calendar.addDays(d, 1).getTime();
  }
  return out;
}

export interface ZeroDegreeFormatOpts {
  language: string;
  unit: string | undefined;
  hour12?: boolean;
  /** The card's calendar; days and clock times follow its zone. */
  calendar: Calendar;
  /** Level formatter supplied by the card so the popup reads like the
   *  row beside it (HA number format). Absent: plain Intl in `language`. */
  formatValue?(level: number, withUnit: boolean): string;
}

export function formatLevel(level: number, opts: ZeroDegreeFormatOpts, withUnit = true): string {
  if (opts.formatValue) return opts.formatValue(level, withUnit);
  const n = getNumberFormat(opts.language, { maximumFractionDigits: 0 }).format(level);
  return withUnit && opts.unit ? `${n} ${opts.unit}` : n;
}

/** Lowest point within `hours` of the curve start (the row's 48 h figure). */
export function findWindowMinimum(curve: readonly ZeroDegreePoint[], hours: number): ZeroDegreePoint | null {
  if (!curve.length) return null;
  const end = curve[0].t + hours * 3_600_000;
  return findCurveMinimum(curve.filter((p) => p.t <= end));
}

/** Weekday + clock, the next-rain tooltip's style ("Thu 05:00"). */
export function formatWeekdayTime(t: number, { language, hour12, calendar }: ZeroDegreeFormatOpts): string {
  return getDateTimeFormat(language, {
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12, timeZone: calendar.timeZone,
  }).format(new Date(t));
}

/** "Wed 21 Oct 07:00 – Sat 24 Oct 21:00" in the HA locale. */
export function formatCurveRange(t0: number, t1: number, { language, hour12, calendar }: ZeroDegreeFormatOpts): string {
  const fmt = getDateTimeFormat(language, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: 'numeric', hour12, timeZone: calendar.timeZone,
  });
  return `${fmt.format(new Date(t0))} – ${fmt.format(new Date(t1))}`;
}

/** "Lowest 1'447 m Sat 08:00", plus " · 48 h: 1'586 m Thu 05:00" when the
 *  48 h minimum is a different hour than the curve's. */
export function formatLowest(
  min: ZeroDegreePoint,
  lowestLabel: string,
  opts: ZeroDegreeFormatOpts,
  min48h?: ZeroDegreePoint | null,
): string {
  const at = (p: ZeroDegreePoint) => `${formatLevel(p.level, opts)} ${formatWeekdayTime(p.t, opts)}`;
  const base = `${lowestLabel} ${at(min)}`;
  return min48h && min48h.t !== min.t ? `${base} · 48 h: ${at(min48h)}` : base;
}

export interface ZeroDegreeChartColors {
  line: string;
  text: string;
  muted: string;
}

/** Horizontal line at the level where the snow line reaches the site. */
export interface ZeroDegreeSiteLine {
  /** Curve level, in the curve's unit. */
  level: number;
  /** "Köniz 581 m". */
  label: string;
  color: string;
}

export interface ZeroDegreeChartOpts extends ZeroDegreeFormatOpts {
  siteLine?: ZeroDegreeSiteLine;
  width: number;
  height: number;
  colors: ZeroDegreeChartColors;
  /** Cursor readout; idx null when the cursor leaves the plot. */
  onCursor?(point: ZeroDegreePoint | null): void;
}

export interface ZeroDegreeChart {
  destroy(): void;
  setSize(width: number, height: number): void;
}

export type ZeroDegreeChartFactory = (
  target: HTMLElement,
  curve: readonly ZeroDegreePoint[],
  opts: ZeroDegreeChartOpts,
) => ZeroDegreeChart;

const CHART_HEIGHT = 220;

/** Day separators, the "now" line at the first point and the minimum
 *  marker, painted after uPlot drew the series. Canvas pixels. */
function overlayPlugin(
  curve: readonly ZeroDegreePoint[],
  min: ZeroDegreePoint | null,
  max: ZeroDegreePoint | null,
  opts: ZeroDegreeChartOpts,
): uPlot.Plugin {
  const midnights = dayStartsBetween(curve[0].t, curve[curve.length - 1].t, opts.calendar);
  return {
    hooks: {
      draw: (u) => {
        const c = u.ctx;
        const pr = uPlot.pxRatio;
        const { top, height } = u.bbox;
        c.save();
        c.strokeStyle = opts.colors.muted;
        c.lineWidth = pr;
        c.setLineDash([4 * pr, 4 * pr]);
        for (const m of midnights) {
          const x = Math.round(u.valToPos(m, 'x', true));
          c.beginPath();
          c.moveTo(x, top);
          c.lineTo(x, top + height);
          c.stroke();
        }
        c.setLineDash([]);
        const nowX = Math.round(u.valToPos(curve[0].t, 'x', true));
        c.strokeStyle = opts.colors.text;
        c.beginPath();
        c.moveTo(nowX, top);
        c.lineTo(nowX, top + height);
        c.stroke();
        c.font = `${12 * pr}px sans-serif`;
        c.textAlign = 'left';
        const left = u.bbox.left;
        const right = left + u.bbox.width;
        const site = opts.siteLine;
        if (site) {
          const y = Math.round(u.valToPos(site.level, 'y', true));
          c.strokeStyle = site.color;
          c.fillStyle = site.color;
          c.lineWidth = 1.5 * pr;
          c.setLineDash([6 * pr, 4 * pr]);
          c.beginPath();
          c.moveTo(left, y);
          c.lineTo(right, y);
          c.stroke();
          c.setLineDash([]);
          c.textBaseline = 'bottom';
          const w = c.measureText(site.label).width;
          c.fillText(site.label, Math.max(right - w - 4 * pr, left), y - 3 * pr);
        }
        const mark = (p: ZeroDegreePoint, above: boolean) => {
          const x = u.valToPos(p.t, 'x', true);
          const y = u.valToPos(p.level, 'y', true);
          c.fillStyle = opts.colors.line;
          c.beginPath();
          c.arc(x, y, 4 * pr, 0, 2 * Math.PI);
          c.fill();
          c.fillStyle = opts.colors.text;
          c.textBaseline = above ? 'bottom' : 'top';
          // Keep the label inside the plot when the point sits at an edge.
          const label = formatLevel(p.level, opts);
          const w = c.measureText(label).width;
          c.fillText(label, Math.min(Math.max(x - w / 2, left), right - w), above ? y - 7 * pr : y + 7 * pr);
        };
        if (min) mark(min, false);
        if (max) mark(max, true);
        c.restore();
      },
    },
  };
}

export const buildZeroDegreeChart: ZeroDegreeChartFactory = (target, curve, opts) => {
  const { min, max } = markedExtremes(curve, opts.unit);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of curve) {
    if (p.level < lo) lo = p.level;
    if (p.level > hi) hi = p.level;
  }
  if (opts.siteLine) {
    lo = Math.min(lo, opts.siteLine.level);
    hi = Math.max(hi, opts.siteLine.level);
  }
  const yRange = paddedLevelRange(lo, hi);
  const t0 = curve[0].t;
  const t1 = curve[curve.length - 1].t;
  const midnights = dayStartsBetween(t0, t1, opts.calendar);
  const weekdayFmt = getDateTimeFormat(opts.language, { weekday: 'short', timeZone: opts.calendar.timeZone });
  const axisFont = '11px sans-serif';
  const data: uPlot.AlignedData = [curve.map((p) => p.t), curve.map((p) => p.level)];
  const u = new uPlot({
    width: opts.width,
    height: opts.height,
    legend: { show: false },
    cursor: {
      y: false,
      drag: { x: false, y: false, setScale: false },
      points: { size: 8, fill: opts.colors.line },
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    // Epoch ms on a plain numeric scale: uPlot's own time axis formats in
    // the browser zone, the card follows its own calendar (ADR-0030).
    scales: {
      x: { time: false, range: [t0, t1] },
      y: { range: yRange },
    },
    series: [
      {},
      { stroke: opts.colors.line, width: 2, points: { show: false } },
    ],
    axes: [
      {
        stroke: opts.colors.text,
        font: axisFont,
        grid: { show: false },
        ticks: { show: false },
        splits: () => midnights,
        values: (_u, splits) => splits.map((s) => weekdayFmt.format(new Date(s))),
      },
      {
        stroke: opts.colors.text,
        font: axisFont,
        size: 56,
        grid: { stroke: opts.colors.muted, width: 0.5 },
        ticks: { show: false },
        values: (_u, splits) => splits.map((s) => formatLevel(s, opts, false)),
      },
    ],
    hooks: {
      setCursor: [(self) => {
        if (!opts.onCursor) return;
        const idx = self.cursor.idx;
        opts.onCursor(idx == null ? null : curve[idx] ?? null);
      }],
    },
    plugins: [overlayPlugin(curve, min, max, opts)],
  }, data, target);
  return {
    destroy: () => u.destroy(),
    setSize: (width, height) => u.setSize({ width, height }),
  };
};

// Shell rules (backdrop, panel, header, close) live in popup-shell.ts.
const STYLES = `
  .wsc-zd-heading { display: block; font-size: 18px; }
  .wsc-zd-range {
    display: block;
    font-size: 13px;
    color: var(--secondary-text-color, #727272);
  }
  .wsc-zd-history {
    font: inherit;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 4px;
    color: var(--primary-color, #03a9f4);
    padding: 4px 6px;
  }
  .wsc-zd-history:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
  .wsc-zd-chart { position: relative; width: 100%; height: ${CHART_HEIGHT}px; direction: ltr; }
  .wsc-zd-chart .u-wrap, .wsc-zd-chart .uplot { position: relative; }
  .wsc-zd-chart .u-over, .wsc-zd-chart .u-under, .wsc-zd-chart .u-axis { position: absolute; }
  .wsc-zd-chart .u-cursor-x {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    border-right: 1px dashed var(--secondary-text-color, #727272);
    pointer-events: none;
  }
  .wsc-zd-chart .u-cursor-pt { position: absolute; top: 0; left: 0; border-radius: 50%; pointer-events: none; }
  .wsc-zd-chart canvas { display: block; width: 100%; height: 100%; }
  .wsc-zd-readout {
    min-height: 1.4em;
    font-size: 13px;
    color: var(--secondary-text-color, #727272);
  }
  .wsc-zd-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 14px;
  }
`;

export interface ZeroDegreePopupStrings {
  title: string;
  lowest: string;
  history: string;
  close: string;
}

export interface ZeroDegreePopupOpts extends ZeroDegreeFormatOpts {
  /** Where the overlay mounts — the card's shadow root. */
  root: ShadowRoot | HTMLElement;
  /** Element the theme variables are read from (the card host). */
  themeHost: Element;
  curve: readonly ZeroDegreePoint[];
  /** Site elevation (m) and name label; absent: no site line. */
  site?: { elevation: number; label: string; precipitationColor?: string };
  strings: ZeroDegreePopupStrings;
  /** Focus goes back here on close. */
  returnFocus?: HTMLElement | null;
  /** History button; absent hides it. */
  onHistory?(): void;
  createChart?: ZeroDegreeChartFactory;
}

function cssVar(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** One instance per card. `open` while open rebuilds from the new
 *  options; `close` is idempotent and the card's teardown calls it. */
export class ZeroDegreePopup {
  private readonly _shell = new PopupShell('wsc-zd');
  private _chart: ZeroDegreeChart | null = null;
  private _onResize: (() => void) | null = null;

  get isOpen(): boolean {
    return this._shell.isOpen;
  }

  open(opts: ZeroDegreePopupOpts): void {
    const { curve, strings } = opts;
    const title = el('div', 'wsc-zd-title');
    title.append(
      el('span', 'wsc-zd-heading', strings.title),
      el('span', 'wsc-zd-range', formatCurveRange(curve[0].t, curve[curve.length - 1].t, opts)),
    );

    const chartTarget = el('div', 'wsc-zd-chart');
    const readout = el('div', 'wsc-zd-readout');
    const footer = el('div', 'wsc-zd-footer');
    const min = findCurveMinimum(curve);
    footer.append(el('span', 'wsc-zd-lowest', min ? formatLowest(min, strings.lowest, opts, findWindowMinimum(curve, 48)) : ''));
    const focusables: HTMLElement[] = [];
    if (opts.onHistory) {
      const onHistory = opts.onHistory;
      const historyBtn = el('button', 'wsc-zd-history', strings.history);
      historyBtn.type = 'button';
      historyBtn.addEventListener('click', () => onHistory());
      footer.append(historyBtn);
      focusables.push(historyBtn);
    }

    const { panel } = this._shell.open({
      root: opts.root,
      heading: title,
      closeLabel: strings.close,
      body: [chartTarget, readout, footer],
      focusables,
      css: STYLES,
      returnFocus: opts.returnFocus,
      onClose: () => this._teardownChart(),
    });

    const theme = getComputedStyle(opts.themeHost);
    const muted = cssVar(theme, '--secondary-text-color') || '#727272';
    const chartOpts: ZeroDegreeChartOpts = {
      language: opts.language,
      unit: opts.unit,
      hour12: opts.hour12,
      calendar: opts.calendar,
      formatValue: opts.formatValue,
      siteLine: opts.site && Number.isFinite(opts.site.elevation)
        ? {
            level: siteLineLevel(opts.site.elevation, metresPerUnit(opts.unit)),
            label: opts.site.label,
            color: resolvePopupColor(opts.site.precipitationColor, theme, 'rgba(132, 209, 253, 1.0)'),
          }
        : undefined,
      width: chartTarget.clientWidth || panel.clientWidth || 488,
      height: CHART_HEIGHT,
      colors: {
        line: cssVar(theme, '--accent-color') || cssVar(theme, '--primary-color') || '#03a9f4',
        text: cssVar(theme, '--primary-text-color') || '#212121',
        muted,
      },
      onCursor: (p) => {
        readout.textContent = p ? `${formatWeekdayTime(p.t, opts)} · ${formatLevel(p.level, opts)}` : '';
      },
    };
    try {
      this._chart = (opts.createChart ?? buildZeroDegreeChart)(chartTarget, curve, chartOpts);
    } catch (err) {
      // The footer still names the minimum; a canvas failure must not
      // strand an open overlay without its close button.
      console.error('[weather-station-card] zero-degree chart failed', err);
      this._chart = null;
    }
    if (typeof window !== 'undefined') {
      this._onResize = () => {
        const w = chartTarget.clientWidth;
        if (w > 0) this._chart?.setSize(w, CHART_HEIGHT);
      };
      window.addEventListener('resize', this._onResize);
    }
  }

  /** Tear the overlay and its chart down. `restoreFocus` false is the
   *  rebuild path of `open`, where focus moves into the new overlay. */
  close(restoreFocus = true): void {
    this._shell.close(restoreFocus);
  }

  private _teardownChart(): void {
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this._chart) {
      try { this._chart.destroy(); } catch { /* already gone */ }
      this._chart = null;
    }
  }
}
