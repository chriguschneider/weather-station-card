// Temperature value labels — renders "16°" "4°" etc. above (tempHigh)
// and below (tempLow) each line point when `forecast.style === 'style2'`.
// Replaces the chartjs-plugin-datalabels per-temp-line configuration
// from the pre-uPlot era (see orchestrator.applyStyle2DataLabels for
// the original Chart.js block).
//
// Today's column gets bold font; everything else stays normal weight.
// Colour: chart_text_color override if set, otherwise per-line colour
// (temp1Color for high, temp2Color for low).

import type { ChartLike, ChartPlugin, PluginCardConfig, PluginRenderData } from './_shared.js';

export interface TempLabelsPluginOpts {
  config: PluginCardConfig & { forecast: PluginCardConfig['forecast'] & { style?: string } };
  data: PluginRenderData & {
    tempHigh: ReadonlyArray<number | null | undefined>;
    tempLow: ReadonlyArray<number | null | undefined>;
  };
  tempHighColor: string;
  tempLowColor: string;
  chartTextColor?: string;
}

export function createTempLabelsPlugin(opts: TempLabelsPluginOpts): ChartPlugin {
  const { config, data, tempHighColor, tempLowColor, chartTextColor } = opts;
  const baseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  // style2 label is one size larger than the base axis-label size
  // (matches the +1 in applyStyle2DataLabels) so it reads cleanly
  // against the spline line behind it.
  const fontSize = baseSize + 1;
  const fontFamily = 'Helvetica, Arial, sans-serif';

  // Today's pixel-day key; used to pick bold vs normal per column.
  const todayMs = (() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t.getTime();
  })();

  function isTodayAt(i: number): boolean {
    const dt = data.dateTime?.[i];
    if (!dt) return false;
    const d = new Date(dt);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === todayMs;
  }

  function drawValueColumn(
    chart: ChartLike,
    values: ReadonlyArray<number | null | undefined>,
    color: string,
    offsetY: number,
    axisKey: 'TempAxis',
  ): void {
    const xScale = chart.scales.x;
    const tempScale = chart.scales[axisKey];
    if (!xScale || !tempScale?.getPixelForValue) return;
    const c = chart.ctx;
    // Clamp the label y inside the chart drawing area so the digit
    // doesn't crash into the weekday/date band above (high temps)
    // or the precip-label boxes / bottom padding (low temps).
    const minY = chart.chartArea.top + fontSize / 2 + 1;
    const maxY = chart.chartArea.bottom - fontSize / 2 - 1;
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = chartTextColor || color;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) continue;
      const x = xScale.getPixelForTick(i);
      const rawY = tempScale.getPixelForValue(v) + offsetY;
      const y = Math.min(maxY, Math.max(minY, rawY));
      c.font = `${isTodayAt(i) ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
      c.fillText(`${v}°`, x, y);
    }
    c.restore();
  }

  return {
    id: 'tempLabels',
    afterDraw(chart: ChartLike): void {
      if (config.forecast.style !== 'style2') return;
      // tempHigh sits ABOVE the line: negative y-offset
      // tempLow sits BELOW the line: positive y-offset
      // Offset = half text height + small gap so the digit's baseline
      // clears the spline (1.5 px wide). Sitting close to the line
      // matches the Chart.js baseline; larger offsets crash labels
      // into the date band at the top of the chart.
      const off = Math.ceil(fontSize / 2) + 2;
      drawValueColumn(chart, data.tempHigh, tempHighColor, -off, 'TempAxis');
      drawValueColumn(chart, data.tempLow, tempLowColor, off, 'TempAxis');
    },
  };
}
