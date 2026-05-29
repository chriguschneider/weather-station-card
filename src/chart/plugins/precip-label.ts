// Precipitation-label plugin: renders the per-column precip value
// with the number at the regular `labels_font_size` and the unit at
// ~50 % so "mm" / "in" doesn't dominate narrow bars. Replaces the
// chart's own datalabel for the precip dataset (display:false on that
// dataset's datalabels block) and reproduces the boxed look
// (chart-bg fill, bar-coloured 1.5 px border).
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
      const smallSize = Math.max(6, Math.round(baseSize * 0.5));
      const padX = 3;
      const padY = 2;
      const gap = 2;
      const fontFamily = 'Helvetica, Arial, sans-serif';
      // All labels share a fixed Y line just above the precipitation
      // axis baseline, so they sit in a row at the chart bottom
      // regardless of bar height (matches the original datalabels look).
      const precipAxis = chart.scales.PrecipAxis;
      const baselineY = precipAxis?.getPixelForValue
        ? precipAxis.getPixelForValue(0)
        : chart.chartArea.bottom;
      c.save();
      c.textBaseline = 'middle';
      // Centre the box on the COLUMN, not on the bar — when sunshine
      // is enabled, chart.js auto-groups precip into the left half
      // of the column and we still want the mm label visually
      // centred under the whole column. Falls back to bar.x if the
      // x-scale isn't ready.
      const xScale = chart.scales.x;
      meta.data.forEach((bar: ChartBarLike, i: number) => {
        const rawValue = data.precip ? data.precip[i] : null;
        if (rawValue == null || rawValue <= 0) return;
        // Convert the per-bar amount into the display unit. Bar heights
        // stay in the source unit (handled by the axis); only this label
        // text is converted. Inches need two decimals (values are ~25×
        // smaller); mm keeps the legacy whole-number-above-9 rule.
        const value = convertPrecipLength(rawValue, precipSourceBase, precipTargetBase);
        let number: string;
        if (precipTargetBase === 'in') number = value.toFixed(2);
        else number = value > 9 ? `${Math.round(value)}` : value.toFixed(1);

        c.font = `${baseSize}px ${fontFamily}`;
        const numberW = c.measureText(number).width;
        c.font = `${smallSize}px ${fontFamily}`;
        const unitW = c.measureText(precipUnit).width;
        const lineW = numberW + gap + unitW;

        const lineH = baseSize;
        const boxW = lineW + 2 * padX;
        const boxH = lineH + 2 * padY;
        const cx = xScale && typeof xScale.getPixelForTick === 'function'
          ? xScale.getPixelForTick(i)
          : bar.x;
        const boxLeft = cx - boxW / 2;
        const boxTop = baselineY - boxH / 2;

        c.fillStyle = backgroundColor;
        c.strokeStyle = bar.options?.borderColor
          ? bar.options.borderColor
          : (precipPerBarColor[i] || precipColor);
        c.lineWidth = 1.5;
        c.fillRect(boxLeft, boxTop, boxW, boxH);
        c.strokeRect(boxLeft, boxTop, boxW, boxH);

        c.fillStyle = chartTextColor || textColor;
        c.textAlign = 'left';
        const lineCenterY = boxTop + padY + lineH / 2;
        const numberX = cx - lineW / 2;
        c.font = `${baseSize}px ${fontFamily}`;
        c.fillText(number, numberX, lineCenterY);
        c.font = `${smallSize}px ${fontFamily}`;
        c.fillText(precipUnit, numberX + numberW + gap, lineCenterY);
      });
      c.restore();
    },
  };
}
