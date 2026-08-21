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
// Coupling to the card instance is captured by the `CardLike` interface
// below — the union of card fields and methods this function reads or
// writes. Keeping it as a structural interface (rather than importing
// the LitElement class) avoids a circular type dependency between
// main.ts and this module.

import { effectiveVisibleBars, normalizeForecastMode } from '../forecast-utils.js';
import { isDarkColor, lightenColor } from '../format-utils.js';
import { resolveCssVar } from '../utils/resolve-css-var.js';
import { getThemeTokens } from '../utils/theme-tokens.js';
import { sunshineFractions } from '../sunshine-source.js';
import { buildChart, precipCeiling, type UplotChart } from './draw.js';
import { coerceNumericSeries } from './sanitize.js';
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
  units?: { precipitation?: string };
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
}

/** Build the chart's datasets array. Two temperature lines + one precip
 *  bar always; an optional sunshine bar. style2's per-point temperature
 *  value labels are drawn by createTempLabelsPlugin, not here. */
function buildDatasets(args: BuildDatasetsArgs): Array<Record<string, unknown>> {
  const {
    card, config, data, tempSegmentOpts,
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
      label: card.ll('tempHi'),
      type: 'line',
      data: tempHighSeries,
      yAxisID: 'TempAxis',
      borderColor: temp1Color,
      backgroundColor: temp1Color,
      segment: tempSegmentOpts,
    },
    {
      label: card.ll('tempLo'),
      type: 'line',
      data: tempLowSeries,
      yAxisID: 'TempAxis',
      borderColor: temp2Color,
      backgroundColor: temp2Color,
      segment: tempSegmentOpts,
      hidden: !data.tempLowAvailable,
    },
    {
      label: card.ll('precip'),
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
      label: card.ll('sunshine'),
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
    config, language, data,
    stationCount, forecastCount, style, dividerColor,
    textColor, backgroundColor, chartTextColor,
    isHourly, doubledToday, sunshineLabelBand,
    precipUnit, precipSourceBase, precipTargetBase, precipPerBarColor, precipColor,
    showSunshineLabels, sunshineColor, sunshinePerBarColor,
    temp1Color, temp2Color,
  } = args;

  const dailyTickLabelsPlugin = createDailyTickLabelsPlugin({
    config, language, data, textColor, style, stationCount, doubledToday,
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
    config, data,
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
  const data = card.computeForecastData();

  // Theme tokens (background / primary-text / divider / secondary-text)
  // are stable within a theme session. The cache memoises them across
  // calls and invalidates on theme switch via a MutationObserver on
  // <html>. The plugin `style` proxy serves the four known tokens
  // from the cache; any other CSS var falls back to a live read
  // (no plugin currently needs that path, but it keeps the
  // `CssStyleLike` contract honest).
  const tokens = getThemeTokens(document.body);
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
          if (!liveStyleCached) liveStyleCached = getComputedStyle(document.body);
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

  const stationCountForGap = card._stationCount || 0;
  const forecastCountForGap = card._forecastCount || 0;
  const hasBothBlocks = stationCountForGap > 0 && forecastCountForGap > 0;
  const { tempSegmentOpts } = buildSegmentHelpers({
    stationCountForGap, forecastCountForGap, hasBothBlocks, isHourlyish,
  });

  // Resolve any CSS-var-wrapped colour defaults against the live theme
  // tokens; pass-through for plain rgb/hex/hsl strings users set in YAML.
  const temp1Color = resolveCssVar(config.forecast.temperature1_color, 'rgba(255, 152, 0, 1.0)');
  // Low-temp line: the single steel-blue default read washed-out on
  // white and fell to ~2.5:1 contrast on dark backgrounds (community
  // post 15, "blue"). Only the DEFAULT is theme-aware — a user-set
  // colour (anything other than the legacy default literal) passes
  // through unchanged. Dark detection via the resolved card
  // background's luma (HA exposes no dark-mode flag to cards).
  const isDarkTheme = isDarkColor(backgroundColor);
  const TEMP2_LEGACY_DEFAULT = 'rgba(68, 115, 158, 1.0)';
  const temp2ThemedDefault = isDarkTheme
    ? 'rgba(130, 175, 220, 1.0)'
    : 'rgba(38, 90, 140, 1.0)';
  const temp2Configured = config.forecast.temperature2_color;
  const temp2Color = (!temp2Configured || temp2Configured === TEMP2_LEGACY_DEFAULT)
    ? temp2ThemedDefault
    : resolveCssVar(temp2Configured, temp2ThemedDefault);
  const precipColor = resolveCssVar(config.forecast.precipitation_color, 'rgba(132, 209, 253, 1.0)');
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
  const sunshineColor = resolveCssVar(sunshineConfigured, SUNSHINE_LEGACY_DEFAULT);
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
    card, config, data, tempSegmentOpts,
    temp1Color, temp2Color,
    precipPerBarColor,
    showSunshine, sunshineFractionData, sunshinePerBarColor,
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
    precipUnit, precipSourceBase, precipTargetBase, precipPerBarColor, precipColor,
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
    inPreview: card._isInPreview === true,
  });
  card._chartPhase = null;
  return undefined;
}
