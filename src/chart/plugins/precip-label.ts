// Precipitation-label plugin: renders the per-column precip value
// with the number at the regular `labels_font_size` and the unit at
// ~50 % so "mm" / "in" doesn't dominate narrow bars. Replaces the
// chart's own datalabel for the precip dataset (display:false on that
// dataset's datalabels block) and reproduces the boxed look
// (chart-bg fill, bar-coloured 1.5 px border).
//
// With `data.precipProb` present (forecast.show_precip_probability,
// #288) a forecast column's box grows to two lines: the amount and
// the chance side by side in the number size, separated by a muted
// slash, with each unit centred under its own number —
//
//     4.2 / 85
//     mm     %
//
// Side-by-side rather than stacked because the box only grows ~7 px
// instead of ~12 px, and units-below rather than inline because the
// inline form ("4.2 mm / 85 %") measures ~60 px, wider than a column
// on a phone (8 columns ≈ 45 px). Measured at 11 px / 6 px Helvetica:
// 41–44 px wide, so the box still fits the narrowest column.
//
// Why a custom plugin and not chartjs-plugin-datalabels?
// chartjs-datalabels can render multiline text but applies one font
// to the whole label. We need *different* font sizes for the number
// and the unit on the same line, so the unit doesn't crowd narrow
// bars. That's outside that plugin's API surface — hence this small,
// contained plugin alongside chartjs-datalabels (which still drives
// the temperature labels above and below the line). Two mechanisms
// is a deliberate trade-off: full unification would mean
// reimplementing every chartjs-datalabels feature for temperature too.

import type { ChartBarLike, ChartLike, ChartPlugin, PluginCardConfig, PluginRenderData } from './_shared.js';
import { convertPrecipLength } from '../../utils/unit-converters.js';

/** A dry column (no amount) still gets a chance-only box from this
 *  percentage up. Below it a "5 / %" box on a sunny day is noise;
 *  from here on the chance is something the reader wants to see. */
export const PROBABILITY_ONLY_MIN = 30;

/** Extra bottom padding the two-line box needs below the baseline,
 *  on top of draw.ts's 14 px for the one-line box. Half the box
 *  (≈ 11 px at the default 11 px font) hangs below the PrecipAxis
 *  0-line; the one-line box only hangs ≈ 8 px. */
export const PROBABILITY_EXTRA_BOTTOM_PAD = 4;

export interface PrecipLabelPluginOpts {
  config: PluginCardConfig;
  data: PluginRenderData;
  precipUnit: string;
  /** Length base the chart's precip VALUES are in ('mm' | 'in'). */
  precipSourceBase: string;
  /** Length base to DISPLAY values in ('mm' | 'in'). */
  precipTargetBase: string;
  precipPerBarColor: ReadonlyArray<string>;
  precipColor: string;
  textColor: string;
  backgroundColor: string;
  chartTextColor?: string;
}

/** Everything a box draw needs besides its text — resolved once per
 *  draw pass, per-column colour patched in. */
interface BoxStyle {
  baseSize: number;
  smallSize: number;
  padX: number;
  padY: number;
  fontFamily: string;
  backgroundColor: string;
  strokeColor: string;
  fillColor: string;
}

type Ctx = ChartLike['ctx'];

/** Column centre in canvas px, or null when the column is off-screen.
 *  Centre on the COLUMN, not on the bar — when sunshine is enabled,
 *  draw.ts groups precip into the left half of the column and the
 *  label still sits under the whole column. Falls back to bar.x if the
 *  x-scale isn't ready. Viewport culling (virtualized canvas):
 *  off-screen columns skip the measureText + box drawing entirely. */
function columnCentre(chart: ChartLike, bar: ChartBarLike, i: number): number | null {
  const xScale = chart.scales.x;
  const cx = xScale && typeof xScale.getPixelForTick === 'function'
    ? xScale.getPixelForTick(i)
    : bar.x;
  if (cx < chart.chartArea.left - 80 || cx > chart.chartArea.right + 80) return null;
  return cx;
}

/** Convert the per-bar amount into the display unit. Bar heights stay
 *  in the source unit (handled by the axis); only this label text is
 *  converted. Inches need two decimals (values are ~25× smaller); mm
 *  keeps the legacy whole-number-above-9 rule. */
function formatAmount(rawValue: number, sourceBase: string, targetBase: string): string {
  const value = convertPrecipLength(rawValue, sourceBase, targetBase);
  if (targetBase === 'in') return value.toFixed(2);
  return value > 9 ? `${Math.round(value)}` : value.toFixed(1);
}

/** Integer 0..100 or null — the plugin never prints "NaN" or "120". */
function resolveProbability(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

function drawBox(c: Ctx, left: number, top: number, w: number, h: number, st: BoxStyle): void {
  c.fillStyle = st.backgroundColor;
  c.strokeStyle = st.strokeColor;
  c.lineWidth = 1.5;
  c.fillRect(left, top, w, h);
  c.strokeRect(left, top, w, h);
}

/** One-line box: "4.2 mm" — the pre-#288 look, unchanged. */
function drawOneLineBox(c: Ctx, cx: number, baselineY: number, number: string, unit: string, st: BoxStyle): void {
  const gap = 2;
  c.font = `${st.baseSize}px ${st.fontFamily}`;
  const numberW = c.measureText(number).width;
  c.font = `${st.smallSize}px ${st.fontFamily}`;
  const unitW = c.measureText(unit).width;
  const lineW = numberW + gap + unitW;

  const boxW = lineW + 2 * st.padX;
  const boxH = st.baseSize + 2 * st.padY;
  const boxLeft = cx - boxW / 2;
  const boxTop = baselineY - boxH / 2;
  drawBox(c, boxLeft, boxTop, boxW, boxH, st);

  c.fillStyle = st.fillColor;
  c.textAlign = 'left';
  const lineCenterY = boxTop + st.padY + st.baseSize / 2;
  const numberX = cx - lineW / 2;
  c.font = `${st.baseSize}px ${st.fontFamily}`;
  c.fillText(number, numberX, lineCenterY);
  c.font = `${st.smallSize}px ${st.fontFamily}`;
  c.fillText(unit, numberX + numberW + gap, lineCenterY);
}

/** Two-line box: "4.2 / 85" over "mm  %", or "85" over "%" on a dry
 *  column (`number` null). The slash is drawn at the number size but
 *  muted so it separates without carrying weight. */
function drawTwoLineBox(
  c: Ctx, cx: number, baselineY: number,
  number: string | null, unit: string, probText: string, st: BoxStyle,
): void {
  const slash = '/';
  const slashGap = 2;
  c.font = `${st.baseSize}px ${st.fontFamily}`;
  const numberW = number ? c.measureText(number).width : 0;
  const slashW = number ? c.measureText(slash).width : 0;
  const probW = c.measureText(probText).width;
  const lineW = (number ? numberW + slashGap + slashW + slashGap : 0) + probW;

  const boxW = lineW + 2 * st.padX;
  // +1: a hairline of air between the number row and the unit row.
  const boxH = st.baseSize + st.smallSize + 2 * st.padY + 1;
  const boxLeft = cx - boxW / 2;
  const boxTop = baselineY - boxH / 2;
  drawBox(c, boxLeft, boxTop, boxW, boxH, st);

  const line1Y = boxTop + st.padY + st.baseSize / 2;
  const line2Y = boxTop + st.padY + st.baseSize + 1 + st.smallSize / 2;
  const lineLeft = cx - lineW / 2;
  const probX = number ? lineLeft + numberW + slashGap + slashW + slashGap : lineLeft;

  c.fillStyle = st.fillColor;
  c.textAlign = 'left';
  c.font = `${st.baseSize}px ${st.fontFamily}`;
  if (number) c.fillText(number, lineLeft, line1Y);
  c.fillText(probText, probX, line1Y);
  if (number) {
    c.globalAlpha = 0.55;
    c.fillText(slash, lineLeft + numberW + slashGap, line1Y);
    c.globalAlpha = 1;
  }

  c.textAlign = 'center';
  c.font = `${st.smallSize}px ${st.fontFamily}`;
  if (number) c.fillText(unit, lineLeft + numberW / 2, line2Y);
  c.fillText('%', probX + probW / 2, line2Y);
}

export function createPrecipLabelPlugin({
  config,
  data,
  precipUnit,
  precipSourceBase,
  precipTargetBase,
  precipPerBarColor,
  precipColor,
  textColor,
  backgroundColor,
  chartTextColor,
}: PrecipLabelPluginOpts): ChartPlugin {
  return {
    id: 'precipLabel',
    afterDatasetsDraw(chart: ChartLike): void {
      const meta = chart.getDatasetMeta(2); // tempHigh, tempLow, precip
      if (!meta?.data) return;
      const c = chart.ctx;
      const baseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
      const style: BoxStyle = {
        baseSize,
        smallSize: Math.max(6, Math.round(baseSize * 0.5)),
        padX: 3,
        padY: 2,
        fontFamily: 'Helvetica, Arial, sans-serif',
        backgroundColor,
        strokeColor: precipColor,
        fillColor: chartTextColor || textColor,
      };
      // All labels share a fixed Y line just above the precipitation
      // axis baseline, so they sit in a row at the chart bottom
      // regardless of bar height (matches the original datalabels look).
      const precipAxis = chart.scales.PrecipAxis;
      const baselineY = precipAxis?.getPixelForValue
        ? precipAxis.getPixelForValue(0)
        : chart.chartArea.bottom;
      c.save();
      c.textBaseline = 'middle';
      meta.data.forEach((bar: ChartBarLike, i: number) => {
        const rawValue = data.precip ? data.precip[i] : null;
        const hasAmount = rawValue != null && rawValue > 0;
        const prob = resolveProbability(data.precipProb ? data.precipProb[i] : null);
        const showProb = prob != null && (hasAmount || prob >= PROBABILITY_ONLY_MIN);
        if (!hasAmount && !showProb) return;
        const cx = columnCentre(chart, bar, i);
        if (cx == null) return;

        const number = hasAmount ? formatAmount(rawValue, precipSourceBase, precipTargetBase) : null;
        const st: BoxStyle = {
          ...style,
          strokeColor: bar.options?.borderColor
            ? bar.options.borderColor
            : (precipPerBarColor[i] || precipColor),
        };
        if (showProb) drawTwoLineBox(c, cx, baselineY, number, precipUnit, String(prob), st);
        else drawOneLineBox(c, cx, baselineY, number as string, precipUnit, st);
      });
      c.restore();
    },
  };
}
