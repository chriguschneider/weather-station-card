// Chart orchestration: pure inputs in, a configured chart out (uPlot,
// ADR-0012). The card finds the container, destroys the previous chart
// and stores the returned handle; nothing here reads or writes the card.
//
// It normalizes the config, reads the theme tokens, resolves the
// precip floor, sunshine fractions and per-bar colours, assembles
// datasets[] and plugins[], and calls buildChart() in chart/draw.ts. A
// failure is rethrown as ChartBuildError tagged 'compute' or 'init'.

import { effectiveVisibleBars, normalizeForecastMode } from '../forecast-utils.js';
import { isDarkColor, lightenColor, resolveTemp2Color } from '../format-utils.js';
import { resolveCssVar } from '../utils/resolve-css-var.js';
import { getThemeTokens } from '../utils/theme-tokens.js';
import { sunshineFractions } from '../sunshine-source.js';
import { buildChart, precipCeiling, type UplotChart } from './draw.js';
import { coerceNumeric, coerceNumericSeries } from './sanitize.js';
import { CANONICAL_UNIT, fromCanonical } from '../utils/units.js';
import type { DisplayUnits } from '../display-units.js';
import { PROBABILITY_EXTRA_BOTTOM_PAD } from './plugins/precip-label.js';
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
import type { Calendar } from '../utils/time-zone.js';

/** Per-render data bag — what the card's `computeForecastData()` returns.
 *  All arrays are positional. `tempLowAvailable` lets the caller hide
 *  the second line dataset entirely when the upstream forecast had no
 *  `templow` field (hourly mode). */
export interface ForecastChartData extends PluginRenderData {
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
    show_precip_probability?: boolean;
    sunshine_color?: string;
    precipitation_color?: string;
    precip_bar_size?: number;
    style?: string;
    chart_text_color?: string;
    temperature1_color?: string;
    temperature2_color?: string;
    disable_animation?: boolean;
    round_temp?: boolean;
  };
  use_12hour_format?: boolean;
}

/** Everything one chart build reads. */
export interface ChartInputs {
  /** The `#forecastChart` container; the chart mounts inside it. */
  target: HTMLElement;
  config: OrchestratorConfig;
  language: string;
  calendar: Calendar;
  data: ForecastChartData;
  stationCount: number;
  forecastCount: number;
  /** The card's display units (ADR-0035, point 4); `data` arrives in
   *  canonical units and is drawn in these. */
  displayUnits: DisplayUnits;
  ll(key: string): string | Record<string, string>;
  /** Element whose computed style supplies the theme tokens. */
  themeHost: HTMLElement;
  /** Card-editor live preview: no animation. */
  inPreview: boolean;
}

/** A chart build failed; `phase` says whether while shaping the data
 *  ('compute') or constructing the chart ('init'). */
export class ChartBuildError extends Error {
  constructor(readonly phase: 'compute' | 'init', readonly original: unknown) {
    super(String((original as { message?: unknown } | null)?.message ?? original));
    this.name = 'ChartBuildError';
  }
}

/** True when the station/forecast boundary represents the SAME calendar
 *  day, i.e. station's last entry and forecast's first entry are both
 *  "today". Gates the daily-doubled-today framing — see the
 *  `doubledToday` site in `buildForecastChart`. Exported for unit testing
 *  the post-midnight regression (#162 follow-up). */
export function boundaryIsSameDay(
  dateTime: ReadonlyArray<string | undefined>,
  stationCount: number,
  calendar: Calendar,
): boolean {
  if (stationCount <= 0 || stationCount >= dateTime.length) return false;
  const a = dateTime[stationCount - 1];
  const b = dateTime[stationCount];
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return false;
  return calendar.isSameDay(da, db);
}

/** Picks the lightened bar colour for forecast columns (every column in
 *  forecast-only mode); shared by precip and sunshine. */
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

/** The chart's series in the display units: the one place the chart
 *  converts. Entries are canonical (°C, mm). Rounding follows the
 *  conversion, so 21.4 °C is 71 °F, not 70. The same-unit branches skip
 *  every conversion, so a metric setup draws its values untouched. */
export function toDisplayData<T extends ForecastChartData>(
  data: T,
  displayUnits: Pick<DisplayUnits, 'temperature' | 'precipitation'>,
  roundTemp: boolean,
): T {
  const tempUnit = displayUnits.temperature;
  // Math.round(null) is 0, which would turn "no data" into a fake 0°.
  const temp = (cell: number | null | undefined): number | null | undefined => {
    if (cell === null || cell === undefined) return cell;
    if (typeof cell !== 'number' || !Number.isFinite(cell)) return null;
    const v = tempUnit === CANONICAL_UNIT.temperature ? cell : fromCanonical('temperature', cell, tempUnit);
    if (v === null) return null;
    return roundTemp ? Math.round(v) : v;
  };
  const precipUnit = displayUnits.precipitation;
  const precip = precipUnit === CANONICAL_UNIT.precipitation
    ? data.precip
    : (data.precip || []).map((cell) => {
      const n = coerceNumeric(cell);
      return n === null ? null : fromCanonical('precipitation', n, precipUnit);
    });
  return {
    ...data,
    tempHigh: (data.tempHigh || []).map(temp),
    tempLow: (data.tempLow || []).map(temp),
    precip,
  };
}

/** Mode/unit-static floor for the precipitation y-axis ceiling: hourly
 *  and today 4 mm, daily 20 mm, converted into the display unit; inches
 *  keep a 1 in floor in both modes. buildChart derives the actual ceiling
 *  from it and the data. */
export function precipAxisFloor(isHourlyish: boolean, precipUnit: string): number {
  // eslint-disable-next-line no-restricted-syntax -- the 1 in axis floor is a rule for inches alone
  if (precipUnit === 'in') return 1;
  const mm = isHourlyish ? 4 : 20;
  return fromCanonical('precipitation', mm, precipUnit) ?? mm;
}

/** Test surface for the ceiling rule: max(per-mode floor, tallest bucket).
 *  The live chart derives the same value via precipCeiling in draw.ts. */
export function computePrecipMax(
  isHourlyish: boolean,
  precipUnit: string,
  precip: ReadonlyArray<number | null | undefined> = [],
): number {
  return precipCeiling(precipAxisFloor(isHourlyish, precipUnit), precip);
}

interface BuildDatasetsArgs {
  ll: ChartInputs['ll'];
  config: any;
  data: any;
  temp1Color: string;
  temp2Color: string;
  precipPerBarColor: string[];
  showSunshine: boolean;
  sunshineFractionData: Array<number | null>;
  sunshinePerBarColor: string[];
}

/** Build the chart's datasets array. Two temperature lines + one precip
 *  bar always; an optional sunshine bar. style2's per-point temperature
 *  value labels are drawn by createTempLabelsPlugin, not here. */
function buildDatasets(args: BuildDatasetsArgs): Array<Record<string, unknown>> {
  const {
    ll, config, data,
    temp1Color, temp2Color, precipPerBarColor,
    showSunshine, sunshineFractionData, sunshinePerBarColor,
  } = args;

  // Coerce to (number | null)[]: a malformed cell ("unavailable", NaN)
  // would poison the axis scale or draw a phantom point at 0; null gives
  // a clean gap.
  const tempHighSeries = coerceNumericSeries(data.tempHigh);
  const tempLowSeries = coerceNumericSeries(data.tempLow);
  const precipSeries = coerceNumericSeries(data.precip);

  const datasets: Array<Record<string, unknown>> = [
    {
      label: ll('tempHi'),
      type: 'line',
      data: tempHighSeries,
      yAxisID: 'TempAxis',
      borderColor: temp1Color,
      backgroundColor: temp1Color,
    },
    {
      label: ll('tempLo'),
      type: 'line',
      data: tempLowSeries,
      yAxisID: 'TempAxis',
      borderColor: temp2Color,
      backgroundColor: temp2Color,
      hidden: !data.tempLowAvailable,
    },
    {
      label: ll('precip'),
      type: 'bar',
      data: precipSeries,
      yAxisID: 'PrecipAxis',
      borderColor: precipPerBarColor,
      backgroundColor: precipPerBarColor,
      barPercentage: (config.forecast.precip_bar_size as number) / 100,
      categoryPercentage: 1.0,
    },
  ];

  if (showSunshine) {
    datasets.push({
      label: ll('sunshine'),
      type: 'bar',
      data: sunshineFractionData,
      yAxisID: 'SunshineAxis',
      borderColor: sunshinePerBarColor,
      backgroundColor: sunshinePerBarColor,
      barPercentage: 1.0,
      categoryPercentage: 1.0,
    });
  }

  return datasets;
}

interface BuildPluginsArgs {
  config: any;
  language: string;
  calendar: Calendar;
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
  precipUnitId: string;
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
    config, language, calendar, data,
    stationCount, forecastCount, style, dividerColor,
    textColor, backgroundColor, chartTextColor,
    isHourly, doubledToday, sunshineLabelBand,
    precipUnit, precipUnitId, precipPerBarColor, precipColor,
    showSunshineLabels, sunshineColor, sunshinePerBarColor,
    temp1Color, temp2Color,
  } = args;

  const dailyTickLabelsPlugin = createDailyTickLabelsPlugin({
    config, language, calendar, data, textColor, style, stationCount, doubledToday,
    sunshineLabelBand,
  });
  const precipLabelPlugin = createPrecipLabelPlugin({
    config, data, precipUnit, precipUnitId,
    precipPerBarColor, precipColor, textColor, backgroundColor,
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

  plugins.push(createTempLabelsPlugin({
    config, data, calendar,
    tempHighColor: temp1Color,
    tempLowColor: temp2Color,
    chartTextColor,
    // Background-coloured halo keeps labels readable over full-strength
    // sunshine bars.
    haloColor: backgroundColor,
    roundTemp: config.forecast.round_temp === true,
  }));

  return plugins;
}

/** Build the forecast chart into `inputs.target` and return its handle.
 *  The caller owns the previous chart (destroy it first) and the result. */
export function buildForecastChart(inputs: ChartInputs): UplotChart {
  const phase: { current: 'compute' | 'init' } = { current: 'compute' };
  try {
    return composeChart(inputs, phase);
  } catch (err) {
    throw new ChartBuildError(phase.current, err);
  }
}

function composeChart(inputs: ChartInputs, phase: { current: 'compute' | 'init' }): UplotChart {
  const { target: chartTarget, language, calendar, ll, themeHost, displayUnits } = inputs;
  // Normalized config: forecast.type falls back to 'daily' for typo'd YAML.
  const { config } = normalizeForecastMode(inputs.config);
  // Everything below draws this data: line, bars, axes and labels share
  // one unit.
  const data = toDisplayData(inputs.data, displayUnits, config.forecast.round_temp === true);
  const tempUnit = displayUnits.temperature;
  const llUnits = ll('units') as Record<string, string>;
  const precipUnit = llUnits[displayUnits.precipitation] ?? displayUnits.precipitation;

  // The `style` proxy serves the four known theme tokens from the cache;
  // any other CSS var falls back to a live read.
  const tokens = getThemeTokens(themeHost);
  const backgroundColor = tokens.backgroundColor;
  const textColor = tokens.textColor;
  const dividerColor = tokens.dividerColor;
  let liveStyleCached: CSSStyleDeclaration | null = null;
  const style: CssStyleLike = {
    getPropertyValue: (name: string): string => {
      switch (name) {
        case '--card-background-color': return tokens.backgroundColor;
        case '--primary-text-color': return tokens.textColor;
        case '--divider-color': return tokens.dividerColor;
        case '--secondary-text-color': return tokens.secondaryTextColor;
        default: {
          if (!liveStyleCached) liveStyleCached = getComputedStyle(themeHost);
          return liveStyleCached.getPropertyValue(name);
        }
      }
    },
  };

  // 'today' shares the hourly precip scale; 'daily' needs a wider one.
  const isHourlyish = config.forecast.type === 'hourly' || config.forecast.type === 'today';
  const precipFloor = precipAxisFloor(isHourlyish, displayUnits.precipitation);

  const stationCountForGap = inputs.stationCount;
  const forecastCountForGap = inputs.forecastCount;
  const hasBothBlocks = stationCountForGap > 0 && forecastCountForGap > 0;

  const temp1Color = resolveCssVar(config.forecast.temperature1_color, 'rgba(255, 152, 0, 1.0)', themeHost);
  // Only the DEFAULT low-temp colour is theme-aware; a user-set colour
  // passes through. Dark detection uses the card background's luma (HA
  // exposes no dark-mode flag to cards).
  const isDarkTheme = isDarkColor(backgroundColor);
  const temp2Color = resolveTemp2Color(config.forecast.temperature2_color, backgroundColor, themeHost);
  const precipColor = resolveCssVar(config.forecast.precipitation_color, 'rgba(132, 209, 253, 1.0)', themeHost);
  const precipColorLight = lightenColor(precipColor) as string;
  const precipPerBarColor: string[] = (data.precip || []).map(
    (_v, i) => pickPerBarColor(i, hasBothBlocks, stationCountForGap, precipColor, precipColorLight),
  );

  const showSunshine = config.forecast.show_sunshine === true;
  // Hourly has too many narrow columns for labels; the bar height alone
  // carries the value there.
  const showSunshineLabels = showSunshine && config.forecast.type !== 'hourly';
  const SUNSHINE_LEGACY_DEFAULT = 'rgba(255, 215, 0, 1.0)';
  const sunshineConfigured = config.forecast.sunshine_color;
  const sunshineColor = resolveCssVar(sunshineConfigured, SUNSHINE_LEGACY_DEFAULT, themeHost);
  // Dark themes: the default gold at lightenColor's alpha blends into a
  // murky olive, so use a warmer honey gold. Light themes and user-set
  // colours use lightenColor.
  const sunshineColorLight = (isDarkTheme
    && (!sunshineConfigured || sunshineConfigured === SUNSHINE_LEGACY_DEFAULT))
    ? 'rgba(255, 193, 7, 0.58)'
    : lightenColor(sunshineColor) as string;
  const sunshinePerBarColor: string[] = (data.sunshine ?? []).map(
    (_v, i) => pickPerBarColor(i, hasBothBlocks, stationCountForGap, sunshineColor, sunshineColorLight),
  );
  const sunshineFractionData = sunshineFractions(
    data.sunshine ?? [],
    data.dayLength,
  );

  const chart_text_color = (config.forecast.chart_text_color === 'auto')
    ? textColor
    : config.forecast.chart_text_color;

  const datasets = buildDatasets({
    ll, config, data,
    temp1Color, temp2Color,
    precipPerBarColor,
    showSunshine, sunshineFractionData, sunshinePerBarColor,
  });

  const stationCount = inputs.stationCount;
  const forecastCount = inputs.forecastCount;
  const isHourly = isHourlyish;
  // Daily only. Just past midnight the station block can end at
  // YESTERDAY (`dropEmptyStationToday` removed the empty bucket) while the
  // forecast leads with today; the boundary columns are then different
  // days, so the label-collapse logic must not fire. Gate on the actual
  // boundary dates matching.
  const doubledToday = !isHourly
    && stationCount > 0
    && forecastCount > 0
    && boundaryIsSameDay(data.dateTime, stationCount, calendar);
  // buildAxes adds this band to the x-axis size; the daily-tick-labels
  // plugin shifts weekday + date up by it, freeing the strip for the
  // sunshine box. 0 when sunshine labels are off.
  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const sunshineLabelBand = showSunshineLabels ? Math.max(16, labelsBaseSize + 6) : 0;

  const plugins = buildPlugins({
    config, language, calendar, data,
    stationCount, forecastCount, style, dividerColor,
    textColor, backgroundColor, chartTextColor: chart_text_color,
    isHourly, doubledToday, sunshineLabelBand,
    precipUnit, precipUnitId: displayUnits.precipitation, precipPerBarColor, precipColor,
    showSunshineLabels, sunshineColor, sunshinePerBarColor,
    temp1Color, temp2Color,
  });

  phase.current = 'init';
  const chartHeightPx = Number((config as { forecast: { chart_height?: number } }).forecast.chart_height) || 200;
  return buildChart(chartTarget, {
    datasets: datasets as unknown as Parameters<typeof buildChart>[1]['datasets'],
    plugins,
    chartHeight: chartHeightPx,
    data,
    config,
    textColor,
    backgroundColor,
    dividerColor,
    chartTextColor: chart_text_color,
    precipFloor,
    precipUnit,
    tempUnit,
    doubledToday,
    stationCount,
    isHourly,
    style,
    sunshineLabelBand,
    visibleBars: effectiveVisibleBars(config as { forecast?: { type?: string; number_of_forecasts?: number | string } }),
    inPreview: inputs.inPreview,
    // The two-line precip box (#288) hangs lower than the one-line box.
    extraBottomPad: config.forecast.show_precip_probability === true
      ? PROBABILITY_EXTRA_BOTTOM_PAD
      : 0,
  });
}
