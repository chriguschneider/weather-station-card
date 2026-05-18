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
    // No clamping or flipping — the y-axis scale is pre-padded by
    // ~33 % at the bottom and ~22 % at the top (in draw.ts) so the
    // line always renders with enough chart space around it for the
    // label to fit on its preferred side of the dot. Works the
    // same for negative temperatures because the padding is
    // proportional to the data range, not absolute.
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = chartTextColor || color;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) continue;
      const x = xScale.getPixelForTick(i);
      const y = tempScale.getPixelForValue(v) + offsetY;
      c.font = `${isTodayAt(i) ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
      c.fillText(`${v}°`, x, y);
    }
    c.restore();
  }

  return {
    id: 'tempLabels',
    afterDraw(chart: ChartLike): void {
      if (config.forecast.style !== 'style2') return;
      // Offset = font size + dot radius (4) so the text BOTTOM
      // edge sits above the dot top instead of overlapping it.
      // Matches the Chart.js baseline's "X°" with clear gap to
      // the orange/blue dot below it.
      const off = fontSize + 4;
      drawValueColumn(chart, data.tempHigh, tempHighColor, -off, 'TempAxis');
      drawValueColumn(chart, data.tempLow, tempLowColor, off, 'TempAxis');
    },
  };
}
