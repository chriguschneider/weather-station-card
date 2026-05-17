// Chart orchestration: takes the card's `forecasts` + config and
// produces a configured chart instance (uPlot under the hood since
// slice 2 of the 2026-05 perf stack — see ADR-0012).
//
// Responsibilities:
//   - normalize the config (forecast.type fallback for typo'd YAML)
//   - locate the chart container in card.renderRoot, RAF-retry if Lit
//     hasn't committed it yet
//   - destroy any previous chart instance so we don't leak handles
//   - read live theme tokens from getComputedStyle(document.body)
//   - compute precip max, station/forecast gap framing, sunshine
//     fraction data, dataset segment-options (transparent boundary
//     at daily combination, dashed at hourly combination), per-bar
//     colour palettes
//   - assemble dataset[]: tempHigh, tempLow (hidden when hourly),
//     precip, optional sunshine
//   - assemble plugins[]: separator, dailyTickLabels, precipLabel,
//     optional sunshineLabel (gated on daily + show_sunshine)
//   - call buildChart() in chart/draw.ts for the actual instance
//
// Coupling to the card instance is captured by the `CardLike` interface
// below — the union of card fields and methods this function reads or
// writes. Keeping it as a structural interface (rather than importing
// the LitElement class) avoids a circular type dependency between
// main.ts and this module.

import { normalizeForecastMode } from '../forecast-utils.js';
import { lightenColor } from '../format-utils.js';
import { resolveCssVar } from '../utils/resolve-css-var.js';
import { sunshineFractions } from '../sunshine-source.js';
import { buildChart, type UplotChart } from './draw.js';
import {
  createSeparatorPlugin,
  createDailyTickLabelsPlugin,
  createPrecipLabelPlugin,
  createSunshineLabelPlugin,
  createTempLabelsPlugin,
  type ChartPlugin,
  type CssStyleLike,
  type PluginCardConfig,
  type PluginRenderData,
} from './plugins.js';

/** Per-render data bag — what `card.computeForecastData()` returns.
 *  All arrays are positional. `tempLowAvailable` lets the caller hide
 *  the second line dataset entirely when the upstream forecast had no
 *  `templow` field (hourly mode). */
interface ForecastChartData extends PluginRenderData {
  tempHigh: ReadonlyArray<number | null | undefined>;
  tempLow: ReadonlyArray<number | null | undefined>;
  tempLowAvailable: boolean;
  precip: ReadonlyArray<number | null | undefined>;
  dateTime: ReadonlyArray<string | undefined>;
  sunshine?: ReadonlyArray<number | null | undefined> | null;
  dayLength?: ReadonlyArray<number | null | undefined> | null;
}

/** Subset of the card config the orchestrator reads. */
interface OrchestratorConfig extends PluginCardConfig {
  forecast: PluginCardConfig['forecast'] & {
    show_sunshine?: boolean;
    sunshine_color?: string;
    precipitation_color?: string;
    precip_bar_size?: number;
    style?: string;
    chart_text_color?: string;
    temperature1_color?: string;
    temperature2_color?: string;
    disable_animation?: boolean;
  };
  use_12hour_format?: boolean;
}

/** Structural interface for the card instance the orchestrator
 *  cooperates with. `forecastChart` is read AND written; `_chartPhase`
 *  is set at the boundaries of the long-running phases. */
export interface CardLike {
  forecasts: ReadonlyArray<unknown> | null;
  forecastChart: UplotChart | null;
  renderRoot: ParentNode;
  _hass: { config: { unit_system: { temperature: string; length: string } } };
  _stationCount?: number;
  _forecastCount?: number;
  _chartPhase: string | null;
  // True when the card is mounted inside the card-config dialog's
  // live preview. Forces chart animation duration to 0 regardless of
  // the user's forecast.disable_animation setting.
  _isInPreview?: boolean;
  computeForecastData(): ForecastChartData;
  ll(key: string): string | Record<string, string>;
  drawChart(): void;
}

/** Args bag — `forecastItems` and `weather` are kept in the contract
 *  for future callers and to mirror the destructure shape used in
 *  main.ts. */
export interface DrawChartArgs {
  config: OrchestratorConfig;
  language: string;
  weather?: unknown;
  forecastItems?: unknown;
}

interface SegmentCtx {
  p0DataIndex: number;
  p1DataIndex: number;
}

/** True when the station/forecast boundary represents the SAME calendar
 *  day, i.e. station's last entry and forecast's first entry are both
 *  "today". Used to gate the daily-doubled-today framing — see the
 *  `doubledToday` site in `drawChartUnsafe`. Exported for unit testing
 *  the post-midnight regression (#162 follow-up). */
export function boundaryIsSameDay(
  dateTime: ReadonlyArray<string | undefined>,
  stationCount: number,
): boolean {
  if (stationCount <= 0 || stationCount >= dateTime.length) return false;
  const a = dateTime[stationCount - 1];
  const b = dateTime[stationCount];
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return false;
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return da.getTime() === db.getTime();
}

interface DataLabelsCtx {
  dataset: { data: ReadonlyArray<unknown> };
  dataIndex: number;
}

/** Picks the lightened bar colour for forecast columns (or for forecast-only
 *  mode where every column is a forecast). The two ternary arms used to be
 *  inlined per dataset; extracting kills the nested-ternary smell and shares
 *  the rule between precip and sunshine. */
function pickPerBarColor(
  i: number,
  hasBothBlocks: boolean,
  stationCountForGap: number,
  normal: string,
  light: string,
): string {
  if (hasBothBlocks && i >= stationCountForGap) return light;
  if (!hasBothBlocks && stationCountForGap === 0) return light;
  return normal;
}

interface SegmentHelpersArgs {
  stationCountForGap: number;
  forecastCountForGap: number;
  hasBothBlocks: boolean;
  isHourlyish: boolean;
}

interface SegmentHelpers {
  tempSegmentOpts: {
    borderColor: (segCtx: SegmentCtx) => string | undefined;
    borderDash: (segCtx: SegmentCtx) => number[] | undefined;
  };
}

/** Precipitation y-axis ceiling. Hourly bars rarely exceed a few mm/h,
 *  daily totals up to ~20 mm. Imperial units use a fixed 1 inch ceiling
 *  for both. */
function computePrecipMax(isHourlyish: boolean, lengthUnit: string): number {
  if (isHourlyish) return lengthUnit === 'km' ? 4 : 1;
  return lengthUnit === 'km' ? 20 : 1;
}

/** uPlot has no equivalent of Chart.js's global defaults — series
 *  colours and per-axis styling are passed directly into each
 *  instance. Theme tokens are still read at draw time (textColor /
 *  dividerColor) and forwarded into draw.ts via the opts bag. */
function applyChartDefaults(_textColor: string, _dividerColor: string): void {
  // intentional no-op (kept as a named function so the call-site
  // ordering documentation stays readable)
}

/** Boundary handling between station and forecast blocks differs by mode:
 *
 *  - Daily combination: "today" appears as a doubled column (station-today
 *    on the left, forecast-today on the right). The segment between those
 *    two columns is suppressed (transparent) — measured vs. predicted of
 *    the SAME day shouldn't visually flow into each other.
 *
 *  - Hourly combination: there's no doubled hour. Station and forecast
 *    meet at "now" with one bar each side. The boundary segment is drawn
 *    DASHED — same visual cue we use for the rest of the forecast block,
 *    but applied to the transition itself, so the user reads the line as
 *    "measured up to now → predicted from now on" without a confusing
 *    transparent gap. */
function buildSegmentHelpers(args: SegmentHelpersArgs): SegmentHelpers {
  const { stationCountForGap, forecastCountForGap, hasBothBlocks, isHourlyish } = args;
  const gapStartIdx = stationCountForGap - 1;
  const isHourlyCombo = hasBothBlocks && isHourlyish;
  const isBoundarySegment = (segCtx: SegmentCtx): boolean =>
    segCtx.p0DataIndex === gapStartIdx && segCtx.p1DataIndex === gapStartIdx + 1;
  const segmentSkip = (segCtx: SegmentCtx): string | undefined => {
    if (!hasBothBlocks) return undefined;
    if (!isHourlyCombo && isBoundarySegment(segCtx)) return 'transparent';
    return undefined;
  };
  const segmentDash = (segCtx: SegmentCtx): number[] | undefined => {
    if (segCtx.p0DataIndex >= stationCountForGap && forecastCountForGap > 0) {
      return [6, 4];
    }
    if (isHourlyCombo && isBoundarySegment(segCtx)) return [6, 4];
    return undefined;
  };
  return { tempSegmentOpts: { borderColor: segmentSkip, borderDash: segmentDash } };
}

// deno-lint-ignore no-explicit-any
interface BuildDatasetsArgs {
  card: CardLike;
  config: any;
  data: any;
  tempSegmentOpts: { borderColor: unknown; borderDash: unknown };
  temp1Color: string;
  temp2Color: string;
  precipPerBarColor: string[];
  showSunshine: boolean;
  sunshineFractionData: Array<number | null>;
  sunshinePerBarColor: string[];
  chartTextColor: string | undefined;
}

/** Build the chart's datasets array. Two temperature lines + one precip
 *  bar always; an optional sunshine bar; style2 layers per-bar
 *  datalabels with today-bold font on top of the temperature lines. */
function buildDatasets(args: BuildDatasetsArgs): Array<Record<string, unknown>> {
  const {
    card, config, data, tempSegmentOpts,
    temp1Color, temp2Color, precipPerBarColor,
    showSunshine, sunshineFractionData, sunshinePerBarColor,
    chartTextColor,
  } = args;

  const datasets: Array<Record<string, unknown>> = [
    {
      label: card.ll('tempHi'),
      type: 'line',
      data: data.tempHigh,
      yAxisID: 'TempAxis',
      borderColor: temp1Color,
      backgroundColor: temp1Color,
      segment: tempSegmentOpts,
    },
    {
      label: card.ll('tempLo'),
      type: 'line',
      data: data.tempLow,
      yAxisID: 'TempAxis',
      borderColor: temp2Color,
      backgroundColor: temp2Color,
      segment: tempSegmentOpts,
      hidden: !data.tempLowAvailable,
    },
    {
      label: card.ll('precip'),
      type: 'bar',
      data: data.precip,
      yAxisID: 'PrecipAxis',
      borderColor: precipPerBarColor,
      backgroundColor: precipPerBarColor,
      barPercentage: (config.forecast.precip_bar_size as number) / 100,
      categoryPercentage: 1.0,
      datalabels: {
        display: () => false,
        textAlign: 'center',
        textBaseline: 'middle',
        align: 'top',
        anchor: 'start',
        offset: -10,
      },
    },
  ];

  if (showSunshine) {
    datasets.push({
      label: card.ll('sunshine'),
      type: 'bar',
      data: sunshineFractionData,
      yAxisID: 'SunshineAxis',
      borderColor: sunshinePerBarColor,
      backgroundColor: sunshinePerBarColor,
      barPercentage: 1.0,
      categoryPercentage: 1.0,
      datalabels: { display: () => false },
    });
  }

  if (config.forecast.style === 'style2') {
    applyStyle2DataLabels(datasets, data, config, chartTextColor, temp1Color, temp2Color);
  }

  return datasets;
}

/** style2 overlays today-bold per-bar datalabels on the two temperature
 *  lines so the user reads each day's high/low directly from the line. */
function applyStyle2DataLabels(
  datasets: Array<Record<string, unknown>>,
  // deno-lint-ignore no-explicit-any
  data: any,
  // deno-lint-ignore no-explicit-any
  config: any,
  chartTextColor: string | undefined,
  temp1Color: string,
  temp2Color: string,
): void {
  const todayBoldFont = (context: DataLabelsCtx) => {
    const dt = data.dateTime[context.dataIndex];
    const k = dt ? new Date(dt) : null;
    if (k) k.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const isToday = k?.getTime() === t.getTime();
    return {
      size: parseInt(String(config.forecast.labels_font_size)) + 1,
      lineHeight: 0.7,
      weight: isToday ? 'bold' : 'normal',
    };
  };
  const labelFor = (color: string, align: 'top' | 'bottom') => ({
    display: () => true,
    formatter: (_v: unknown, context: DataLabelsCtx) => context.dataset.data[context.dataIndex] + '°',
    align,
    anchor: 'center',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    color: chartTextColor || color,
    font: todayBoldFont,
  });
  datasets[0].datalabels = labelFor(temp1Color, 'top');
  datasets[1].datalabels = labelFor(temp2Color, 'bottom');
}

// deno-lint-ignore no-explicit-any
interface BuildPluginsArgs {
  config: any;
  language: string;
  data: any;
  stationCount: number;
  forecastCount: number;
  style: CssStyleLike;
  dividerColor: string;
  textColor: string;
  backgroundColor: string;
  chartTextColor: string | undefined;
  isHourly: boolean;
  doubledToday: boolean;
  sunshineLabelBand: number;
  precipUnit: string;
  precipPerBarColor: string[];
  precipColor: string;
  showSunshineLabels: boolean;
  sunshineColor: string;
  sunshinePerBarColor: string[];
  temp1Color: string;
  temp2Color: string;
}

/** Compose the chart's plugin list. 'today' and 'hourly' skip the
 *  station/forecast separator (the dashed temperature segment already
 *  marks the transition); only 'daily' uses it. Sunshine labels are
 *  appended only when the sunshine row is visible. */
function buildPlugins(args: BuildPluginsArgs): ChartPlugin[] {
  const {
    config, language, data,
    stationCount, forecastCount, style, dividerColor,
    textColor, backgroundColor, chartTextColor,
    isHourly, doubledToday, sunshineLabelBand,
    precipUnit, precipPerBarColor, precipColor,
    showSunshineLabels, sunshineColor, sunshinePerBarColor,
    temp1Color, temp2Color,
  } = args;

  const dailyTickLabelsPlugin = createDailyTickLabelsPlugin({
    config, language, data, textColor, style, stationCount, doubledToday,
    sunshineLabelBand,
  });
  const precipLabelPlugin = createPrecipLabelPlugin({
    config, data, precipUnit, precipPerBarColor, precipColor, textColor, backgroundColor,
    chartTextColor,
  });

  const fcType = config.forecast.type;
  const skipSeparator = fcType === 'today' || fcType === 'hourly';
  const plugins: ChartPlugin[] = skipSeparator
    ? [dailyTickLabelsPlugin, precipLabelPlugin]
    : [
      createSeparatorPlugin({
        stationCount, forecastCount, style, dividerColor,
        mode: isHourly ? 'hourly' : 'daily',
      }),
      dailyTickLabelsPlugin,
      precipLabelPlugin,
    ];

  if (showSunshineLabels) {
    plugins.push(createSunshineLabelPlugin({
      config, data, textColor, backgroundColor,
      chartTextColor,
      sunshineColor, sunshinePerBarColor,
      bandHeight: sunshineLabelBand,
    }));
  }

  // Per-point temperature value labels (style2 only). Plugin no-ops
  // when forecast.style isn't 'style2'.
  plugins.push(createTempLabelsPlugin({
    config, data,
    tempHighColor: temp1Color,
    tempLowColor: temp2Color,
    chartTextColor,
  }));

  return plugins;
}

export function drawChartUnsafe(card: CardLike, args: DrawChartArgs | null): unknown[] | undefined {
  const { config: rawConfig, language, weather, forecastItems } = args ?? (card as unknown as DrawChartArgs);
  // Silence "unused" lint — `weather` is part of the destructure-from-`card`
  // contract and may be needed by future callers (and was in the prior
  // signature). Discarding here keeps the destructure shape stable.
  void weather;
  void forecastItems;
  if (!card.forecasts?.length) {
    return [];
  }
  // All downstream references read `config` — by binding it to the
  // normalized result we get one consistent view of the mode (and
  // forecast.type fallback to 'daily' for typo'd YAML) across the
  // chart code path.
  const { config } = normalizeForecastMode(rawConfig);

  const chartTarget = card.renderRoot?.querySelector<HTMLElement>('#forecastChart');
  if (!chartTarget) {
    // Target isn't in the DOM yet. With the loading-placeholder flow
    // in main.ts, drawChart is called synchronously inside
    // _refreshForecasts before Lit's microtask commits the new
    // template — the chart-container only appears on the NEXT render.
    // requestAnimationFrame retries on the next browser tick, by
    // which point Lit has committed and the target is mountable.
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => card.drawChart());
    }
    return undefined;
  }

  if (card.forecastChart) {
    card.forecastChart.destroy();
  }
  card._chartPhase = 'compute';
  const tempUnit = card._hass.config.unit_system.temperature;
  const lengthUnit = card._hass.config.unit_system.length;
  const llUnits = card.ll('units') as Record<string, string>;
  const precipUnit = lengthUnit === 'km' ? llUnits['mm'] : llUnits['in'];
  const data = card.computeForecastData();

  const style = getComputedStyle(document.body);
  const backgroundColor = style.getPropertyValue('--card-background-color');
  const textColor = style.getPropertyValue('--primary-text-color');
  const dividerColor = style.getPropertyValue('--divider-color');

  // 'today' is hourly granularity (per-hour bars), same precip scale
  // as 'hourly'. 'daily' aggregates over the full day, scale is wider.
  const isHourlyish = config.forecast.type === 'hourly' || config.forecast.type === 'today';
  const precipMax = computePrecipMax(isHourlyish, lengthUnit);

  applyChartDefaults(textColor, dividerColor);

  const stationCountForGap = card._stationCount || 0;
  const forecastCountForGap = card._forecastCount || 0;
  const hasBothBlocks = stationCountForGap > 0 && forecastCountForGap > 0;
  const { tempSegmentOpts } = buildSegmentHelpers({
    stationCountForGap, forecastCountForGap, hasBothBlocks, isHourlyish,
  });

  // Resolve any CSS-var-wrapped colour defaults against the live theme
  // tokens; pass-through for plain rgb/hex/hsl strings users set in YAML.
  const temp1Color = resolveCssVar(config.forecast.temperature1_color, 'rgba(255, 152, 0, 1.0)');
  const temp2Color = resolveCssVar(config.forecast.temperature2_color, 'rgba(68, 115, 158, 1.0)');
  const precipColor = resolveCssVar(config.forecast.precipitation_color, 'rgba(132, 209, 253, 1.0)');
  const precipColorLight = lightenColor(precipColor) as string;
  const precipPerBarColor: string[] = (data.precip || []).map(
    (_v, i) => pickPerBarColor(i, hasBothBlocks, stationCountForGap, precipColor, precipColorLight),
  );

  // Sunshine row toggle. Works in both daily and hourly modes — the
  // OpenMeteoSunshineSource fetches `daily=…` and (when in hourly mode)
  // also `hourly=…` from Open-Meteo in a single call, and
  // attachSunshine matches each entry's datetime against the right
  // array. The chart adds a second bar dataset; Chart.js auto-groups
  // precip + sunshine side-by-side per column (precip left half,
  // sunshine right half).
  const showSunshine = config.forecast.show_sunshine === true;
  // Per-column "Xh" / "0.5h" labels: shown for daily and 'today'
  // (8 wide columns), suppressed for 'hourly' where 168 narrow
  // columns over a 7-day window would crowd labels (the bar height
  // alone encodes the value at that density).
  const showSunshineLabels = showSunshine && config.forecast.type !== 'hourly';
  const sunshineColor = resolveCssVar(config.forecast.sunshine_color, 'rgba(255, 215, 0, 1.0)');
  const sunshineColorLight = lightenColor(sunshineColor) as string;
  const sunshinePerBarColor: string[] = (data.sunshine ?? []).map(
    (_v, i) => pickPerBarColor(i, hasBothBlocks, stationCountForGap, sunshineColor, sunshineColorLight),
  );
  // Convert raw hours into 0..1 fractions of day length. Null values
  // pass through so the bar slot stays empty for missing data.
  const sunshineFractionData = sunshineFractions(
    data.sunshine ?? [],
    data.dayLength,
  );

  const chart_text_color = (config.forecast.chart_text_color === 'auto')
    ? textColor
    : config.forecast.chart_text_color;

  const datasets = buildDatasets({
    card, config, data, tempSegmentOpts,
    temp1Color, temp2Color,
    precipPerBarColor,
    showSunshine, sunshineFractionData, sunshinePerBarColor,
    chartTextColor: chart_text_color,
  });

  const stationCount = card._stationCount || 0;
  const forecastCount = card._forecastCount || 0;
  const isHourly = isHourlyish;
  // doubled-today only makes sense at daily — at hourly / today station
  // and forecast meet at "now" with a single separator line.
  //
  // Just past midnight the station block can end at YESTERDAY (the
  // recorder hasn't aggregated today yet → `dropEmptyStationToday`
  // removes the empty trailing bucket) while the forecast block leads
  // with today. The two boundary columns then represent different
  // days, so the label-collapse / transparent-gridline logic must NOT
  // fire — otherwise the THU label vanishes and FRI sits at the
  // THU/FRI midpoint. Gate on the actual boundary date matching.
  const doubledToday = !isHourly
    && stationCount > 0
    && forecastCount > 0
    && boundaryIsSameDay(data.dateTime, stationCount);
  // When sunshine is on, draw.ts grows the x-axis box by sunshineLabelBand
  // pixels via afterFit. dailyTickLabelsPlugin then shifts weekday + date
  // up by that amount so the new bottom strip is free for the sunshine
  // box. When sunshine is off, sunshineLabelBand stays 0 and chart
  // layout is unchanged.
  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const sunshineLabelBand = showSunshineLabels ? Math.max(16, labelsBaseSize + 6) : 0;

  const plugins = buildPlugins({
    config, language, data,
    stationCount, forecastCount, style, dividerColor,
    textColor, backgroundColor, chartTextColor: chart_text_color,
    isHourly, doubledToday, sunshineLabelBand,
    precipUnit, precipPerBarColor, precipColor,
    showSunshineLabels, sunshineColor, sunshinePerBarColor,
    temp1Color, temp2Color,
  });

  card._chartPhase = 'init';
  const chartHeightPx = Number((config as { forecast: { chart_height?: number } }).forecast.chart_height) || 200;
  card.forecastChart = buildChart(chartTarget, {
    datasets: datasets as unknown as Parameters<typeof buildChart>[1]['datasets'],
    plugins,
    chartHeight: chartHeightPx,
    data,
    config,
    textColor,
    backgroundColor,
    dividerColor,
    chartTextColor: chart_text_color,
    precipMax,
    precipUnit,
    tempUnit,
    doubledToday,
    stationCount,
    style,
    sunshineLabelBand,
    inPreview: card._isInPreview === true,
  });
  card._chartPhase = null;
  return undefined;
}
