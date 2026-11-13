// Chart orchestration: pure inputs in, a configured chart out (uPlot,
// ADR-0012). The card finds the container, destroys the previous chart
// and stores the returned handle; nothing here reads or writes the card.
//
// Responsibilities:
//   - normalize the config (forecast.type fallback for typo'd YAML)
//   - read live theme tokens from the theme host
//   - resolve the precip-axis floor, station/forecast gap framing, sunshine
//     fraction data, dataset segment-options (transparent boundary
//     at daily combination, dashed at hourly combination), per-bar
//     colour palettes
//   - assemble dataset[]: tempHigh, tempLow (hidden when hourly),
//     precip, optional sunshine
//   - assemble plugins[]: separator, dailyTickLabels, precipLabel,
//     optional sunshineLabel (gated on daily + show_sunshine)
//   - call buildChart() in chart/draw.ts for the actual instance
//
// A failure is rethrown as ChartBuildError tagged with the phase it
// happened in ('compute' or 'init') for the card's error banner.

import { effectiveVisibleBars, normalizeForecastMode } from '../forecast-utils.js';
import { isDarkColor, lightenColor, resolveTemp2Color } from '../format-utils.js';
import { resolveCssVar } from '../utils/resolve-css-var.js';
import { getThemeTokens } from '../utils/theme-tokens.js';
import { sunshineFractions } from '../sunshine-source.js';
import { buildChart, precipCeiling, type UplotChart } from './draw.js';
import { coerceNumericSeries } from './sanitize.js';
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
  };
  units?: { precipitation?: string };
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
  /** HA's unit system (`hass.config.unit_system`). */
  unitSystem: { temperature: string; length: string };
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

/** Mode/unit-static floor for the precipitation y-axis ceiling.
 *  Hourly/today 4 mm (metric) / 1 in; daily 20 mm / 1 in. Resolved
 *  here (the wiring layer interprets config/units) and handed to
 *  buildChart, which derives the actual ceiling from the data — at
 *  build time AND on every in-place update(), so intensifying rain
 *  rescales the bars without waiting for a full rebuild. */
export function precipAxisFloor(isHourlyish: boolean, lengthUnit: string): number {
  return isHourlyish
    ? (lengthUnit === 'km' ? 4 : 1)
    : (lengthUnit === 'km' ? 20 : 1);
}

/** Precipitation y-axis ceiling.
 *
 *  The fixed per-mode value acts as a FLOOR, not a hard cap: it keeps a
 *  light-drizzle day from blowing the axis up so a 0.3 mm bar looks like
 *  a downpour. But the ceiling rises to the tallest actual bucket when
 *  that exceeds the floor, so heavy precipitation scales proportionally
 *  instead of clipping flat at the top.
 *
 *  Why a floor at all: 'today' sums precip into 3-hour buckets
 *  (aggregateThreeHour), so a wet afternoon easily clears the old fixed
 *  4 mm cap — two heavy buckets (e.g. 10 mm and 4.7 mm) both pinned to
 *  full height and read as equally tall, which is exactly the bug this
 *  fixes. Daily totals likewise overrun the 20 mm floor on a stormy day.
 *
 *  The live chart derives this same ceiling itself via precipCeiling
 *  in chart/draw.ts (fed with precipAxisFloor above) so the update()
 *  path can rescale without the orchestrator. This composite stays as
 *  the canonical statement of the rule and the unit-test surface. */
export function computePrecipMax(
  isHourlyish: boolean,
  lengthUnit: string,
  precip: ReadonlyArray<number | null | undefined> = [],
): number {
  return precipCeiling(precipAxisFloor(isHourlyish, lengthUnit), precip);
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
  ll: ChartInputs['ll'];
  config: any;
  data: any;
  tempSegmentOpts: { borderColor: unknown; borderDash: unknown };
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
    ll, config, data, tempSegmentOpts,
    temp1Color, temp2Color, precipPerBarColor,
    showSunshine, sunshineFractionData, sunshinePerBarColor,
  } = args;

  // Coerce every plotted series to (number | null)[] before it reaches
  // the chart. A malformed cell — a temperature that arrived as the
  // string "unavailable", a NaN from an upstream divide-by-zero —
  // would otherwise poison the whole axis scale (uPlot derives min/max
  // across the array) or draw a phantom point at a coerced 0. coerce →
  // null makes Chart/uPlot draw a clean gap instead.
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
      segment: tempSegmentOpts,
    },
    {
      label: ll('tempLo'),
      type: 'line',
      data: tempLowSeries,
      yAxisID: 'TempAxis',
      borderColor: temp2Color,
      backgroundColor: temp2Color,
      segment: tempSegmentOpts,
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

// deno-lint-ignore no-explicit-any
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
  precipSourceBase: string;
  precipTargetBase: string;
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
    precipUnit, precipSourceBase, precipTargetBase, precipPerBarColor, precipColor,
    showSunshineLabels, sunshineColor, sunshinePerBarColor,
    temp1Color, temp2Color,
  } = args;

  const dailyTickLabelsPlugin = createDailyTickLabelsPlugin({
    config, language, calendar, data, textColor, style, stationCount, doubledToday,
    sunshineLabelBand,
  });
  const precipLabelPlugin = createPrecipLabelPlugin({
    config, data, precipUnit, precipSourceBase, precipTargetBase,
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

  // Per-point temperature value labels (style2 only). Plugin no-ops
  // when forecast.style isn't 'style2'.
  plugins.push(createTempLabelsPlugin({
    config, data, calendar,
    tempHighColor: temp1Color,
    tempLowColor: temp2Color,
    chartTextColor,
    // 3-px background-colour halo behind every value — keeps labels
    // readable on top of the full-strength sunshine bars (community
    // post 15 "purple"; variant decision N1 + halo).
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
  const { target: chartTarget, language, calendar, data, ll, themeHost } = inputs;
  // All downstream references read `config` — by binding it to the
  // normalized result we get one consistent view of the mode (and
  // forecast.type fallback to 'daily' for typo'd YAML) across the
  // chart code path.
  const { config } = normalizeForecastMode(inputs.config);
  const tempUnit = inputs.unitSystem.temperature;
  const lengthUnit = inputs.unitSystem.length;
  const llUnits = ll('units') as Record<string, string>;
  // Chart precip values arrive in HA's system length unit (mm for
  // metric, in for imperial). An explicit `units.precipitation` overrides
  // the DISPLAY unit (label + per-bar value); without it the chart keeps
  // the system unit so existing dashboards are unchanged. The bar HEIGHTS
  // stay in the source unit (a relative visual) — only the label text is
  // converted, in the precip-label plugin.
  const precipSourceBase = lengthUnit === 'km' ? 'mm' : 'in';
  const cfgPrecip = config.units?.precipitation;
  const precipTargetBase = (cfgPrecip === 'mm' || cfgPrecip === 'in') ? cfgPrecip : precipSourceBase;
  const precipUnit = llUnits[precipTargetBase] ?? precipTargetBase;

  // Theme tokens (background / primary-text / divider / secondary-text)
  // are stable within a theme session. The cache memoises them across
  // calls and invalidates on theme switch via a MutationObserver on
  // <html>. The plugin `style` proxy serves the four known tokens
  // from the cache; any other CSS var falls back to a live read
  // (no plugin currently needs that path, but it keeps the
  // `CssStyleLike` contract honest).
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

  // 'today' is hourly granularity (per-hour bars), same precip scale
  // as 'hourly'. 'daily' aggregates over the full day, scale is wider.
  const isHourlyish = config.forecast.type === 'hourly' || config.forecast.type === 'today';
  const precipFloor = precipAxisFloor(isHourlyish, lengthUnit);

  applyChartDefaults(textColor, dividerColor);

  const stationCountForGap = inputs.stationCount;
  const forecastCountForGap = inputs.forecastCount;
  const hasBothBlocks = stationCountForGap > 0 && forecastCountForGap > 0;
  const { tempSegmentOpts } = buildSegmentHelpers({
    stationCountForGap, forecastCountForGap, hasBothBlocks, isHourlyish,
  });

  // Resolve any CSS-var-wrapped colour defaults against the live theme
  // tokens; pass-through for plain rgb/hex/hsl strings users set in YAML.
  const temp1Color = resolveCssVar(config.forecast.temperature1_color, 'rgba(255, 152, 0, 1.0)', themeHost);
  // Low-temp line: the single steel-blue default read washed-out on
  // white and fell to ~2.5:1 contrast on dark backgrounds (community
  // post 15, "blue"). Only the DEFAULT is theme-aware — a user-set
  // colour (anything other than the legacy default literal) passes
  // through unchanged. Dark detection via the resolved card
  // background's luma (HA exposes no dark-mode flag to cards).
  const isDarkTheme = isDarkColor(backgroundColor);
  const temp2Color = resolveTemp2Color(config.forecast.temperature2_color, backgroundColor, themeHost);
  const precipColor = resolveCssVar(config.forecast.precipitation_color, 'rgba(132, 209, 253, 1.0)', themeHost);
  const precipColorLight = lightenColor(precipColor) as string;
  const precipPerBarColor: string[] = (data.precip || []).map(
    (_v, i) => pickPerBarColor(i, hasBothBlocks, stationCountForGap, precipColor, precipColorLight),
  );

  // Sunshine row toggle. Works in both daily and hourly modes — the
  // OpenMeteoSource fetches `daily=…` and (when in hourly mode)
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
  const SUNSHINE_LEGACY_DEFAULT = 'rgba(255, 215, 0, 1.0)';
  const sunshineConfigured = config.forecast.sunshine_color;
  const sunshineColor = resolveCssVar(sunshineConfigured, SUNSHINE_LEGACY_DEFAULT, themeHost);
  // Forecast-side sunshine in DARK themes: the default gold at
  // lightenColor's 0.45 alpha blends with the near-black card into a
  // murky olive. Variant decision "W58": warmer honey gold
  // rgba(255,193,7) at 0.58 — the tone shift cancels the green cast,
  // the strength keeps the bars present without matching the measured
  // side. Light themes and user-set colours keep the classic
  // lightenColor treatment.
  const sunshineColorLight = (isDarkTheme
    && (!sunshineConfigured || sunshineConfigured === SUNSHINE_LEGACY_DEFAULT))
    ? 'rgba(255, 193, 7, 0.58)'
    : lightenColor(sunshineColor) as string;
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
    ll, config, data, tempSegmentOpts,
    temp1Color, temp2Color,
    precipPerBarColor,
    showSunshine, sunshineFractionData, sunshinePerBarColor,
  });

  const stationCount = inputs.stationCount;
  const forecastCount = inputs.forecastCount;
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
    && boundaryIsSameDay(data.dateTime, stationCount, calendar);
  // When sunshine is on, draw.ts grows the x-axis box by sunshineLabelBand
  // pixels via afterFit. dailyTickLabelsPlugin then shifts weekday + date
  // up by that amount so the new bottom strip is free for the sunshine
  // box. When sunshine is off, sunshineLabelBand stays 0 and chart
  // layout is unchanged.
  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const sunshineLabelBand = showSunshineLabels ? Math.max(16, labelsBaseSize + 6) : 0;

  const plugins = buildPlugins({
    config, language, calendar, data,
    stationCount, forecastCount, style, dividerColor,
    textColor, backgroundColor, chartTextColor: chart_text_color,
    isHourly, doubledToday, sunshineLabelBand,
    precipUnit, precipSourceBase, precipTargetBase, precipPerBarColor, precipColor,
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
    // Config interpretation happens HERE (the wiring layer) — draw.ts
    // only consumes the resolved number. 'today' is pinned to 8 bars.
    visibleBars: effectiveVisibleBars(config as { forecast?: { type?: string; number_of_forecasts?: number | string } }),
    inPreview: inputs.inPreview,
    // The two-line precip box (chance of rain, #288) hangs further
    // below the baseline than the one-line box.
    extraBottomPad: config.forecast.show_precip_probability === true
      ? PROBABILITY_EXTRA_BOTTOM_PAD
      : 0,
  });
}
