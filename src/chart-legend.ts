// Chart legend entries for `show_sources` (ADR-0031).
//
// The chart encodes its data split only by style: station history as a
// solid line, forecast as a dashed line (FORECAST_DASH in
// chart/draw.ts), sunshine and precipitation as bars. With
// `show_sources` on, the popup names those encodings and where each one
// comes from. Pure so it is testable without a chart.

export type LegendSwatch = 'line' | 'dash' | 'bar';

export interface LegendItem {
  swatch: LegendSwatch;
  // One colour per swatch segment; empty means the neutral text colour.
  colors: string[];
  text: string;
  title?: string;
}

export interface SunshineParts {
  // Today's measured column: the station's sensor or Open-Meteo.
  station: 'sensor' | 'openmeteo' | null;
  // Forecast columns: the weather entity, Open-Meteo, or both when the
  // entity covers only some of them.
  forecast: 'entity' | 'openmeteo' | 'mixed' | null;
}

export interface ChartLegendInput {
  showStation: boolean;
  showForecast: boolean;
  // Past block fed by Open-Meteo instead of the recorder (ADR-0015).
  pastFromOpenMeteo: boolean;
  showSunshine: boolean;
  // Where each part of the sunshine bar comes from, decided like the
  // card fills the bars (ADR-0028); null = that part is not drawn.
  sunshineParts: SunshineParts;
  showTempLow: boolean;
  colors: { high: string; low: string; precip: string; sunshine: string };
  text: {
    high: string;
    low: string;
    precip: string;
    sunshine: string;
    measured: string;
    forecast: string;
    // Qualifiers in the sunshine entry: "Station (measured)".
    measuredNote: string;
    forecastNote: string;
    stationSource: string;
    forecastSource: string;
    openMeteo: string;
    sunshineTitleOpenMeteo: string;
  };
}

type LegendText = ChartLegendInput['text'];

function temperatureEntry(input: ChartLegendInput): LegendItem {
  const { colors, text } = input;
  return {
    swatch: 'line',
    colors: input.showTempLow ? [colors.high, colors.low] : [colors.high],
    text: input.showTempLow ? `${text.high} / ${text.low}` : text.high,
  };
}

function stationEntry(input: ChartLegendInput): LegendItem {
  const { text } = input;
  const source = input.pastFromOpenMeteo ? text.openMeteo : text.stationSource;
  return { swatch: 'line', colors: [], text: `${text.measured}: ${source}` };
}

function forecastEntry(text: LegendText): LegendItem {
  return { swatch: 'dash', colors: [], text: `${text.forecast}: ${text.forecastSource}` };
}

function measuredSunshineSource(station: 'sensor' | 'openmeteo', text: LegendText): string {
  return station === 'sensor' ? text.stationSource : text.openMeteo;
}

function forecastSunshineSource(forecast: 'entity' | 'openmeteo' | 'mixed', text: LegendText): string {
  if (forecast === 'entity') return text.forecastSource;
  if (forecast === 'openmeteo') return text.openMeteo;
  return `${text.forecastSource} + ${text.openMeteo}`;
}

function sunshineDetail(measuredSrc: string | null, forecastSrc: string | null, text: LegendText): string {
  if (measuredSrc !== null && measuredSrc === forecastSrc) return measuredSrc;
  const parts: string[] = [];
  if (measuredSrc !== null) parts.push(`${measuredSrc} (${text.measuredNote})`);
  if (forecastSrc !== null) parts.push(`${forecastSrc} (${text.forecastNote})`);
  return parts.join(' · ');
}

function sunshineEntry(input: ChartLegendInput): LegendItem {
  const { colors, text } = input;
  const { station, forecast } = input.sunshineParts;
  const detail = sunshineDetail(
    station ? measuredSunshineSource(station, text) : null,
    forecast ? forecastSunshineSource(forecast, text) : null,
    text,
  );
  const usesOpenMeteo = station === 'openmeteo' || forecast === 'openmeteo' || forecast === 'mixed';
  return {
    swatch: 'bar',
    colors: [colors.sunshine],
    text: detail ? `${text.sunshine}: ${detail}` : text.sunshine,
    ...(usesOpenMeteo ? { title: text.sunshineTitleOpenMeteo } : {}),
  };
}

export function buildChartLegend(input: ChartLegendInput): LegendItem[] {
  const items: LegendItem[] = [temperatureEntry(input)];
  if (input.showStation) items.push(stationEntry(input));
  if (input.showForecast) items.push(forecastEntry(input.text));
  items.push({ swatch: 'bar', colors: [input.colors.precip], text: input.text.precip });
  if (input.showSunshine) items.push(sunshineEntry(input));
  return items;
}
