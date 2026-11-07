// Chart legend entries for `show_sources` (ADR-0031).
//
// The chart encodes its data split only by style: station history as a
// solid line, forecast as a dashed line (FORECAST_DASH in
// chart/draw.ts), sunshine and precipitation as bars. With
// `show_sources` on, a row under the chart names those encodings and
// where each one comes from. Pure so it is testable without a chart.

export type LegendSwatch = 'line' | 'dash' | 'bar';

export interface LegendItem {
  swatch: LegendSwatch;
  // One colour per swatch segment; empty means the neutral text colour.
  colors: string[];
  text: string;
  title?: string;
}

export interface ChartLegendInput {
  showStation: boolean;
  showForecast: boolean;
  // Past block fed by Open-Meteo instead of the recorder (ADR-0015).
  pastFromOpenMeteo: boolean;
  showSunshine: boolean;
  // Open-Meteo fills sunshine the weather entity / station lacks (ADR-0028).
  sunshineFromOpenMeteo: boolean;
  showTempLow: boolean;
  colors: { high: string; low: string; precip: string; sunshine: string };
  text: {
    high: string;
    low: string;
    precip: string;
    sunshine: string;
    measured: string;
    forecast: string;
    stationSource: string;
    forecastSource: string;
    openMeteo: string;
    sunshineTitleOpenMeteo: string;
  };
}

export function buildChartLegend(input: ChartLegendInput): LegendItem[] {
  const { colors, text } = input;
  const items: LegendItem[] = [];

  items.push({
    swatch: 'line',
    colors: input.showTempLow ? [colors.high, colors.low] : [colors.high],
    text: input.showTempLow ? `${text.high} / ${text.low}` : text.high,
  });

  if (input.showStation) {
    items.push({
      swatch: 'line',
      colors: [],
      text: `${text.measured}: ${input.pastFromOpenMeteo ? text.openMeteo : text.stationSource}`,
    });
  }

  if (input.showForecast) {
    items.push({ swatch: 'dash', colors: [], text: `${text.forecast}: ${text.forecastSource}` });
  }

  items.push({ swatch: 'bar', colors: [colors.precip], text: text.precip });

  if (input.showSunshine) {
    items.push({
      swatch: 'bar',
      colors: [colors.sunshine],
      text: `${text.sunshine}: ${input.sunshineFromOpenMeteo ? text.openMeteo : text.forecastSource}`,
      ...(input.sunshineFromOpenMeteo ? { title: text.sunshineTitleOpenMeteo } : {}),
    });
  }

  return items;
}
