// Temperature value labels ("16°") above (tempHigh) and below (tempLow)
// each line point when `forecast.style === 'style2'`. Today's column is
// bold. Colour: `chart_text_color` if set, else the per-line colour.

import type { ChartLike, ChartPlugin, PluginCardConfig, PluginRenderData } from './_shared.js';
import { startOfTodayMs } from '../../forecast-utils.js';
import type { Calendar } from '../../utils/time-zone.js';

export interface TempLabelsPluginOpts {
  config: PluginCardConfig & { forecast: PluginCardConfig['forecast'] & { style?: string } };
  data: PluginRenderData & {
    tempHigh: ReadonlyArray<number | null | undefined>;
    tempLow: ReadonlyArray<number | null | undefined>;
  };
  calendar: Calendar;
  tempHighColor: string;
  tempLowColor: string;
  chartTextColor?: string;
  /** Card background colour for the 3-px text halo behind every value,
   *  which keeps labels readable over the sunshine / precip bars.
   *  Omit to render without halo. */
  haloColor?: string;
  /** When false, labels keep one decimal place regardless of the source's
   *  own precision so daily/today/hourly read consistently (e.g. "28.0°"
   *  next to "16.2°"); when true the value is already integer-rounded
   *  upstream and renders as a whole number. */
  roundTemp: boolean;
}

export function createTempLabelsPlugin(opts: TempLabelsPluginOpts): ChartPlugin {
  const { config, data, calendar, tempHighColor, tempLowColor, chartTextColor, haloColor, roundTemp } = opts;
  const decimals = roundTemp ? 0 : 1;
  const baseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  // One size above the axis labels so it reads against the line.
  const fontSize = baseSize + 1;
  const fontFamily = 'Helvetica, Arial, sans-serif';

  const todayMs = startOfTodayMs(calendar);

  function isTodayAt(i: number): boolean {
    const dt = data.dateTime?.[i];
    if (!dt) return false;
    return calendar.startOfDay(new Date(dt)).getTime() === todayMs;
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
    // No clamping or flipping: the TempAxis range is padded in
    // chart/draw.ts (bottom/top reserve) so the label always fits.
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = chartTextColor || color;
    if (haloColor) {
      c.strokeStyle = haloColor;
      c.lineWidth = 3;
      c.lineJoin = 'round';
    }
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) continue;
      const x = xScale.getPixelForTick(i);
      // Viewport culling.
      if (x < chart.chartArea.left - 40 || x > chart.chartArea.right + 40) continue;
      const y = tempScale.getPixelForValue(v) + offsetY;
      const text = `${v.toFixed(decimals)}°`;
      c.font = `${isTodayAt(i) ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
      // Halo first, glyph on top.
      if (haloColor) c.strokeText(text, x, y);
      c.fillText(text, x, y);
    }
    c.restore();
  }

  return {
    id: 'tempLabels',
    afterDraw(chart: ChartLike): void {
      if (config.forecast.style !== 'style2') return;
      // Font size plus a 4 px gap clears the point marker.
      const off = fontSize + 4;
      drawValueColumn(chart, data.tempHigh, tempHighColor, -off, 'TempAxis');
      drawValueColumn(chart, data.tempLow, tempLowColor, off, 'TempAxis');
    },
  };
}
