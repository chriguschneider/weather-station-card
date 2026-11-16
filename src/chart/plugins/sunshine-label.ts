// Per-column sunshine-hours "Xh" label in the bottom strip of the
// x-axis area (outside the plot region, so it is not clipped). Reads
// `data.sunshine`; columns that are null or zero get no label.

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

/** Compact `Xh` token. Above 9 h: whole hours. Otherwise one decimal,
 *  with a trailing .0 stripped ("8.0h" → "8h"). */
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
    afterDraw(chart: ChartLike): void {
      const xScale = chart.scales.x;
      if (!xScale?.ticks) return;
      const c = chart.ctx;
      const baseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
      const fontFamily = 'Helvetica, Arial, sans-serif';
      // Centred in the bottom strip of the x-axis box that `buildAxes`
      // (chart/draw.ts) reserves via `bandHeight`.
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
        // Viewport culling.
        if (x < chart.chartArea.left - 60 || x > chart.chartArea.right + 60) continue;
        const text = formatSunshineHours(value);
        c.font = `${baseSize}px ${fontFamily}`;
        const textW = c.measureText(text).width;
        const boxW = textW + 2 * padX;
        const boxH = lineH + 2 * padY;
        const boxLeft = x - boxW / 2;
        const boxTop = labelY - boxH / 2;

        // Same boxed look as the precip label; the per-column border
        // colour mirrors the bar (forecast columns are lighter).
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
