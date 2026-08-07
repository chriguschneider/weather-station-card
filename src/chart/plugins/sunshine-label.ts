// Sunshine-hours label plugin: renders the per-column "Xh" label
// just below the weekday/date row in the x-axis area. Standalone
// from chartjs-plugin-datalabels (which we already use for
// temperature) so the label can sit OUTSIDE the data area — between
// xScale.bottom and chartArea.top — without being clipped by the
// plot region.
//
// Reads from `data.sunshine` (hours, may be null). Skips columns
// where the value is null or zero (the bar is empty there too).
//
// `Xh` rendered as the integer hours followed by 'h' at the same
// font size as the precip number/unit pair, but as a single token
// so it stays compact even on narrow columns.

import type { ChartLike, ChartPlugin, PluginCardConfig, PluginRenderData } from './_shared.js';

export interface SunshineLabelPluginOpts {
  config: PluginCardConfig;
  data: PluginRenderData;
  textColor: string;
  backgroundColor: string;
  chartTextColor?: string;
  sunshineColor: string;
  sunshinePerBarColor: ReadonlyArray<string>;
  bandHeight?: number;
}

/** Pretty-print sunshine hours as a compact `Xh` token.
 *  ≥ 9.5 h: round to integer (decimals are noise at that magnitude,
 *           and "13.0h" is uglier than "13h" in a narrow column).
 *  < 9.5 h: one decimal, but strip a trailing .0 so "8.0h" → "8h". */
function formatSunshineHours(value: number): string {
  if (value > 9) return `${Math.round(value)}h`;
  const rounded = Math.round(value * 10) / 10;
  return rounded % 1 === 0
    ? `${Math.round(rounded)}h`
    : `${rounded.toFixed(1)}h`;
}

export function createSunshineLabelPlugin({
  config,
  data,
  textColor,
  backgroundColor,
  chartTextColor,
  sunshineColor,
  sunshinePerBarColor,
  bandHeight,
}: SunshineLabelPluginOpts): ChartPlugin {
  return {
    id: 'sunshineLabel',
    // afterDraw (not afterDatasetsDraw) so this runs *after* the
    // dailyTickLabelsPlugin's afterDraw — that plugin fills the
    // entire x-axis area with backgroundColor to mask Chart.js's
    // default tick labels, which would otherwise clobber our "Xh"
    // labels here.
    afterDraw(chart: ChartLike): void {
      const xScale = chart.scales.x;
      if (!xScale?.ticks) return;
      const c = chart.ctx;
      const baseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
      const fontFamily = 'Helvetica, Arial, sans-serif';
      // Draw inside the bottom strip of the x-axis box that draw.js's
      // afterFit reserved for us. Vertically centred in that strip;
      // horizontally on the column tick.
      const reservedH = Number.isFinite(bandHeight) && (bandHeight as number) > 0
        ? bandHeight as number
        : Math.max(14, baseSize + 4);
      const labelY = xScale.bottom - reservedH / 2;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const padX = 3;
      const padY = 1;
      const lineH = baseSize;
      for (let i = 0; i < xScale.ticks.length; i++) {
        const value = data.sunshine ? data.sunshine[i] : null;
        if (value == null || value <= 0) continue;
        const x = xScale.getPixelForTick(i);
        // Viewport culling (virtualized canvas).
        if (x < chart.chartArea.left - 60 || x > chart.chartArea.right + 60) continue;
        const text = formatSunshineHours(value);
        c.font = `${baseSize}px ${fontFamily}`;
        const textW = c.measureText(text).width;
        const boxW = textW + 2 * padX;
        const boxH = lineH + 2 * padY;
        const boxLeft = x - boxW / 2;
        const boxTop = labelY - boxH / 2;

        // Same boxed look as the precipitation label: chart-bg fill
        // with the accent-colour border (sunshineColor here,
        // precipColor in precipLabelPlugin). Per-column colour
        // mirrors the bar so forecast columns get the lightened
        // (45 %-alpha) tone, matching how precipLabelPlugin handles
        // its own forecast colouring.
        const stroke = (Array.isArray(sunshinePerBarColor) && sunshinePerBarColor[i])
          || sunshineColor || textColor;
        c.fillStyle = backgroundColor;
        c.strokeStyle = stroke;
        c.lineWidth = 1.5;
        c.fillRect(boxLeft, boxTop, boxW, boxH);
        c.strokeRect(boxLeft, boxTop, boxW, boxH);

        c.fillStyle = chartTextColor || textColor;
        c.fillText(text, x, labelY);
      }
      c.restore();
    },
  };
}
