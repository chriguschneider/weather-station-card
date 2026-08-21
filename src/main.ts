// main.ts — integration boundary file. LitElement + Home Assistant +
// uPlot wiring (via chart/orchestrator), type-checked under
// `tsc --strict`. HA-shaped fields
// use the `HassMain` extension of the data-source `HassLike` type below
// — the full HomeAssistant type would pull in too many UI deps.
// Anything where the HA frontend type-shape isn't documented
// (synthesised `weather`, editor-callback payloads) is `any`-typed,
// with eslint-disable lines limited to those exact slots.
//
// Why the opt-out on stricter typing: this class touches ~30 instance
// fields (forecasts, weather, current sensor readings, scroll-ux
// teardowns, animation controllers, …), most of which were declared
// implicitly via runtime assignment in `set hass` / `setConfig`.
// Strict-typing them all means porting half a dozen HA frontend type
// imports we don't currently depend on, mocking them where the types
// are missing, and threading `HassLike` through the entire render path
// — without adding value to the goal of "the codebase compiles under TS
// and downstream contributors get types when they import from us".
//
// The boundary modules main.ts pulls in (data-source, chart/*,
// sunshine-source, openmeteo-source, scroll-ux, action-handler,
// editor/*) ARE all strictly typed — anyone importing from this card
// gets typed exports.

import locale, { ensureLocaleLoaded } from './locale.js';
import {
  cardinalDirectionsIcon,
  weatherIcons,
  MIN_HA_VERSION,
  isHaVersionBelow,
} from './const.js';
import { DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS } from './defaults.js';
import { validateConfig } from './config-validation.js';
import {LitElement, html, svg} from 'lit';
import {MDI_PATHS} from './icons/mdi-paths.js';
import {guard} from 'lit/directives/guard.js';
import {
  MeasuredDataSource,
  ForecastDataSource,
  fetchPressure3hDelta,
  type HassLike,
  type PressureDeltaCache,
} from './data-source.js';
import {
  getPressureTrend,
  getPressureTrendIcon,
} from './pressure-trend.js';
import {
  getDewPointComfort,
  getDewPointComfortIcon,
} from './dew-point-comfort.js';
import { classifySunStrength, formatLux } from './sun-strength.js';
import { classifyDay, clearSkyLuxAt } from './condition-classifier.js';
import { computeInitialScrollLeft } from './format-utils.js';
import {
  hourlyTempSeries,
  normalizeForecastMode,
  startOfTodayMs,
  filterMidnightStaleForecast,
  aggregateThreeHourCalendar,
  trimLeadingEmptyBlocks,
  trimTrailingEmptyBlocks,
  trimToWholeDayStart,
  trimToWholeDayEnd,
  effectiveVisibleBars,
  computeTodayPagerScrollLeft,
  nextForecastType,
  stationFetchKey,
  forecastFetchKey,
  forecastsEqual,
} from './forecast-utils.js';
import { overlayFromOpenMeteo, sunshineFractions } from './sunshine-source.js';
import { OpenMeteoSource } from './openmeteo-source.js';
import { safeQuery } from './utils/safe-query.js';
import { parseNumericSafe } from './utils/numeric.js';
import { setupScrollUx } from './scroll-ux.js';
import { setupActionHandler } from './action-handler.js';
import { TeardownRegistry } from './teardown-registry.js';
import {
  appendSample,
  pruneOlderThan,
  computeRate,
  loadBuffer,
  saveBuffer,
  precipIcon,
  DEFAULT_MAX_AGE_MS,
  type Sample,
} from './precip-rate.js';
import {
  convertWindSpeed,
  convertPressure,
  formatSunshineHours,
  toMetersPerSecond,
  toCelsius,
  toMillimeters,
  isPrecipRateUnit,
  precipBaseUnit,
  formatPrecipDisplay,
  luxScaleFor,
} from './utils/unit-converters.js';
import { drawChartUnsafe } from './chart/orchestrator.js';
import { seriesCacheKey, loadSeriesCache, saveSeriesCache } from './utils/series-cache.js';
import {
  UNAVAILABLE_GRACE_MS,
  updateMissingSince,
  overdueMissing,
  nextExpiryDelay,
  type MissingSinceMap,
} from './utils/availability-grace.js';
import { sanitizeForecastEntries } from './chart/sanitize.js';
import { renderChartSkeleton } from './chart/skeleton.js';
import { cardStyles } from './chart/styles.js';
import { getDateTimeFormat, getNumberFormat } from './utils/intl-cache.js';
import { moonIllumination, nextMoonEvent, litMoonPath } from './moon.js';
// Chart library: uPlot. Imported transitively via ./chart/draw.js —
// there is no global registration step (uPlot has no plugin registry;
// per-instance hooks/plugins are passed directly to the constructor).

/** Card-side extension of `HassLike`. main.ts reads two fields the
 *  data-sources don't (`language`, `selectedLanguage`) — they pick
 *  the locale for `Intl` formatters in the live-condition / clock
 *  paths. */
interface HassMain extends HassLike {
  language?: string;
  selectedLanguage?: string;
  // HA frontend exposes the running Home Assistant version here; read
  // only by the `debug: true` diagnostics panel. HassLike narrows
  // `config` to lat/lon, so widen it for the main-card boundary.
  config?: HassLike['config'] & { version?: string };
}

/** Sub-shapes used inside `set hass`: a single HA entity state from
 *  `hass.states[eid]`. Defined here rather than in HassLike so the
 *  data-source layer doesn't need it. */
interface HassEntityState {
  state: string;
  attributes?: Record<string, unknown>;
}

/** Augment the global Window so `window.customCards` (HA's card-list
 *  registry) is typed wherever main.ts touches it. */
declare global {
  interface Window {
    // deno-lint-ignore no-explicit-any
    customCards?: any[];
  }
}

// In-bundle icon sprite (ADR-0018), built ONCE at module load. MDI_PATHS
// is a static import, so the symbol list can never change at runtime —
// rebuilding the template array per render() pass was pure waste.
const ICON_SPRITE_TEMPLATE = html`<svg class="wsc-sprite" aria-hidden="true">${
  Object.entries(MDI_PATHS).map(([name, path]) =>
    svg`<symbol id="wsc-i-${name}" viewBox="0 0 24 24"><path d="${path}"></path></symbol>`)
}</svg>`;

// Field-declaration block for the WeatherStationCard class. HA-shaped
// fields are typed as `any` (or HassMain where threaded) — the full
// HomeAssistant type pulls in HA frontend deps we don't otherwise
// need. Reactive Lit properties are declared as plain fields here
// and referenced in `static get properties()` below; Lit's runtime
// decoration syncs the two without further gymnastics.
class WeatherStationCard extends LitElement {
  // --- Reactive properties (referenced in static get properties()) ---
  // Hass is stored as `_hass` per HA's pattern; the public `hass` is
  // a setter that stamps `_hass` and also derives sensor-state values.
  /** Home Assistant state object. Card-side `HassMain` extends the
   *  data-source `HassLike` with the extra locale fields the live-
   *  condition / clock formatters read. */
  _hass: HassMain | null = null;
  // deno-lint-ignore no-explicit-any
  config: any = null;
  language: string = 'en';
  // deno-lint-ignore no-explicit-any
  sun: any = null;
  // deno-lint-ignore no-explicit-any
  weather: any = null;
  // deno-lint-ignore no-explicit-any
  temperature: any;
  // deno-lint-ignore no-explicit-any
  humidity: any;
  // deno-lint-ignore no-explicit-any
  pressure: any;
  // deno-lint-ignore no-explicit-any
  windSpeed: any;
  // deno-lint-ignore no-explicit-any
  windDirection: any;
  // deno-lint-ignore no-explicit-any
  forecastChart: any = null;
  // deno-lint-ignore no-explicit-any
  forecastItems: any;
  // deno-lint-ignore no-explicit-any
  forecasts: any[] | null = null;

  // --- Sensor state (read from `set hass`) ---
  // deno-lint-ignore no-explicit-any
  uv_index: any;
  // deno-lint-ignore no-explicit-any
  dew_point: any;
  // deno-lint-ignore no-explicit-any
  wind_gust_speed: any;
  // deno-lint-ignore no-explicit-any
  illuminance: any;
  // deno-lint-ignore no-explicit-any
  precipitation: any;
  // deno-lint-ignore no-explicit-any
  precipitation_unit: string | undefined;
  // Sliding-anchor buffer for deriving a mm/h rate from a cumulative
  // rain counter when the configured precipitation sensor reports a
  // total instead of a rate (unit not ending in /h). Persisted to
  // localStorage per entity so a hard-reload doesn't restart the 2-15
  // min warm-up. `_precipBufferEntity` tracks which entity the current
  // buffer was hydrated for — a config change to a different sensor
  // re-seeds from that sensor's own slot.
  _precipBuffer: Sample[] = [];
  _precipBufferEntity: string | undefined;
  // Wall-clock recompute timer. Scheduled lazily on first activation
  // of the cumulative path so configs without a cumulative-precip
  // sensor never burn a timer. Cleared from the TeardownRegistry
  // closure on disconnect, matching the `_clockTimer` pattern.
  _precipRecomputeTimer: ReturnType<typeof setInterval> | null = null;
  // deno-lint-ignore no-explicit-any
  sunshine_duration: any;
  // deno-lint-ignore no-explicit-any
  sunshine_duration_unit: string | undefined;
  unitSpeed: string | undefined;
  unitPressure: string | undefined;
  unitPrecip: string | undefined;
  // Source units captured during phase 1 (sensor extraction) so phase 2
  // can build the synthesized weather stand-in without re-deriving them.
  _sourceWindUnit: string = 'm/s';
  _sourcePressureUnit: string = 'hPa';
  _sourceTempUnit: string = '°C';
  // Precip source base unit ('mm' | 'in'), stripped of any /h suffix.
  // The derived-rate path and the wall-clock tick read it to label and
  // convert the rate without re-reading the sensor attribute.
  _sourcePrecipUnit: string = 'mm';

  // --- Caching / live-condition memo ---
  _liveConditionKey: string | undefined;
  _liveCondition: string | undefined;

  // --- Entity-delta gate (ADR-0017) ---
  // eid → hass.states[eid] reference at the end of the last full
  // `set hass` pass. HA state objects are immutable, so reference
  // equality across hass objects means "this entity did not change"
  // and the three phases can be skipped wholesale. null forces the
  // next tick down the full path (after setConfig or a data-source
  // teardown).
  _watchedStatesSnapshot: Record<string, unknown> | null = null;

  // --- Data-source state ---
  _dataSource: MeasuredDataSource | null = null;
  _dataUnsubscribe: (() => void) | null = null;
  _forecastSource: ForecastDataSource | null = null;
  _forecastUnsubscribe: (() => void) | null = null;
  // deno-lint-ignore no-explicit-any
  _stationData: any[] = [];
  // deno-lint-ignore no-explicit-any
  _forecastData: any[] = [];
  _stationError: string | null = null;
  _forecastError: string | null = null;
  _stationCount: number = 0;
  _forecastCount: number = 0;
  /** OVERDUE unavailable sensors — missing longer than the grace
   *  period (issue #213). Surfaced as a compact warning hint, not the
   *  red error banner. Reactive. */
  _missingSensors: string[] = [];
  /** IN-GRACE unavailable sensors — recently gone, typically an HA
   *  restart. Live panel dims and shows a subtle "waiting" hint;
   *  values fall back to the last known good state. Reactive. */
  _staleSensors: string[] = [];
  /** entityId → first-seen-unavailable timestamp (availability-grace). */
  _missingSince: MissingSinceMap = {};
  /** entityId → last parseable state, feeding the unavailable-fallback
   *  in _extractSensorReadings. In-memory only — resets on reload. */
  _lastGoodStates: Record<string, string> = {};
  _graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Advisory config-schema warnings from `validateConfig` (Slice 2) —
   *  unknown YAML keys / wrong-typed values. Surfaced through
   *  `renderErrorBanner()`; never blocks the render. */
  _configWarnings: string[] = [];
  /** Last forecast.type that the chart block was actually rendered
   *  with (i.e. data was ready). Compared in render() + `updated()`
   *  to decide which animation class to apply on the block. */
  _lastForecastType: string | undefined = undefined;
  /** Flips true after the chart block has been rendered into the DOM
   *  with data the first time, AND the start animation has had time
   *  to play out (see _chartMountAnimationTimer). The start animation
   *  (ws-chart-fadein, slide-up) only plays before this flag flips;
   *  subsequent mounts (e.g. after a daily↔hourly cache-miss tore the
   *  block down) get the view-change cross-fade instead, so the user
   *  doesn't see the start animation replayed on every toggle. */
  _chartMountAnimationPlayed: boolean = false;
  /** Pending timer that flips _chartMountAnimationPlayed once the
   *  start animation has finished. Stored so the scheduling guard
   *  doesn't run twice and so disconnectedCallback can clear it. */
  _chartMountAnimationTimer: number | null = null;
  // Tracks whether each configured data source has produced at least
  // one value (either via subscribe callback or by restoring a cached
  // payload on setConfig). Read in _refreshForecasts to hold off the
  // very first chart render until BOTH expected sources are ready —
  // otherwise the chart renders once with only the fast source's data
  // (typically forecast, via HA's cached weather entity) and then
  // again once the slower one lands (typically station, via a
  // recorder query). With doubled-today layout, the second render
  // adds the station-today column to a chart that was previously
  // forecast-only, narrowing every existing column. Visible as bars
  // starting wide and then snapping to a tighter spacing.
  _stationDataReady: boolean = false;
  _forecastDataReady: boolean = false;
  _initialChartBuilt: boolean = false;
  // Set by _refreshForecastsUnsafe whenever `this.forecasts` was rebuilt
  // from source data. measureCard's skip-path (chart alive, same column
  // count) consumes it via updateChart() so a same-shape data refresh
  // still reaches the canvas. This replaces the former updated()-hook
  // on `weather`, which pushed a full setData+redraw on EVERY sensor
  // tick (temperature 0.1° change → full canvas repaint) even though
  // the chart reads only `forecasts` — see the perf pass 2026-08.
  _forecastsDirty: boolean = false;
  // Lazy-cache for #10 mode-toggle.
  // deno-lint-ignore no-explicit-any
  _stationCache: Record<string, any[]> = {};
  // deno-lint-ignore no-explicit-any
  _forecastCache: Record<string, any[]> = {};
  // Open-Meteo source — backs the sunshine overlay and (ADR-0015) the
  // no-station past block. Lazy-created by `_ensureOpenMeteoSource`.
  // deno-lint-ignore no-explicit-any
  _openMeteoSource: any = null;

  // 3-h pressure tendency (hPa-normalized), populated by the station
  // refresh callback. `null` until the first fetch resolves or when
  // history is insufficient — render falls back to legacy gauge icon.
  _pressureDelta3h: number | null = null;
  _pressureDeltaCache: PressureDeltaCache = { bucketMs: null, value: null };

  // --- Chart / scroll lifecycle ---
  _chartError: unknown = null;
  _chartPhase: string | null = null;
  // Set when a `_refreshForecasts` pass throws on malformed source
  // data. Surfaced through `renderErrorBanner()`; cleared by the next
  // clean `_refreshForecasts`.
  _refreshError: string | null = null;
  // Set when a synchronous render section (`renderMain`,
  // `renderAttributes`, the forecast block) throws. Render-pass-scoped:
  // cleared at the top of every render() so a section that heals stops
  // reporting, and re-set this pass only if a section still throws.
  // Both fields feed renderErrorBanner() so the card degrades to the
  // banner instead of Lit aborting render() into a blank/white card.
  _sectionError: string | null = null;
  // Set when setConfig sees an incomplete config (a block is enabled
  // but its required key is missing). NOT thrown — a thrown setConfig
  // kills the whole card and breaks a freshly-added card before its
  // editor can load. Surfaced through renderErrorBanner() so the card
  // stays alive and the visual editor remains usable.
  _configError: string | null = null;
  // True when this card instance is mounted inside the card-config
  // dialog's live preview (hui-card-preview / hui-dialog-edit-card /
  // hui-card-element-editor ancestor). Detected once in
  // connectedCallback. The chart pipeline forces animation duration to
  // 0 in that case so every editor click renders instantly instead of
  // tweening for 500 ms — independent of the user's
  // forecast.disable_animation setting, which only governs the live
  // dashboard render path.
  _isInPreview: boolean = false;
  // deno-lint-ignore no-explicit-any
  resizeObserver: any = null;
  resizeInitialized: boolean = false;
  _resizeRaf: number | null = null;
  // The ha-card element the ResizeObserver is currently observing.
  // Tracked because Lit can SWAP the <ha-card> element when the render
  // branch changes (see updated()'s action-handler note) — the observer
  // must follow the live element or it silently watches a detached one.
  _resizeObservedCard: Element | null = null;
  // deno-lint-ignore no-explicit-any
  _initialScrollObserver: any = null;
  _initialScrollApplied: boolean = false;
  _pendingScrollFrame: number | null = null;
  _lastScrollGeneration: string | undefined;
  _scrollUxTeardown: (() => void) | null = null;
  // Two-phase forecast render (ADR-0016). The condition-icons and wind
  // rows are wide DOM (one element per column); at hourly that's ~168
  // each and they — not the chart canvas — dominate cold-mount (~140 ms
  // of a ~235 ms hourly mount). We render placeholder-height rows on the
  // first paint of a new chart generation, then fill the real rows in a
  // post-paint idle callback. `_forecastRowsReadyGen` holds the
  // generation key (forecast.type + column count) whose rows are fully
  // rendered; while it differs from the current key the rows defer.
  _forecastRowsReadyGen: string = '';
  _forecastRowsRevealHandle: number | null = null;
  _actionHandlerTeardown: (() => void) | null = null;
  _clockTimer: ReturnType<typeof setInterval> | null = null;
  // Cross-module shared flag (scroll-ux ↔ action-handler): a swipe /
  // drag sets this so a trailing tap doesn't fire the card-level
  // tap_action. Owned by scroll-ux but lives on the card so the
  // action-handler can read it.
  _dragMoved: boolean = false;
  // deno-lint-ignore no-explicit-any
  _teardownRegistry: any;

// HA calls getConfigElement when the user clicks the visual editor.
// Awaiting the dynamic import is supported (HA awaits the return
// value), and tells rollup to split the editor into its own chunk —
// users who only view the card never pay the editor's parse cost.
static async getConfigElement() {
  await import('./weather-station-card-editor.js');
  return document.createElement("weather-station-card-editor");
}

// HA calls assertConfig before showing the visual editor. Throwing here
// makes HA fall back to the YAML editor instead of trying to render an
// editor that can't represent the current config — better escape hatch
// than letting setConfig throw and breaking the whole card.
// Surface only structural problems the editor can't represent; the
// runtime mode-aware checks live in setConfig.
// deno-lint-ignore no-explicit-any
static assertConfig(config: any): void {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object.');
  }
  if (config.condition_mapping !== undefined &&
      (typeof config.condition_mapping !== 'object' || Array.isArray(config.condition_mapping))) {
    throw new Error('`condition_mapping` must be an object of threshold overrides.');
  }
  if (config.sensors && typeof config.sensors === 'object') {
    for (const [key, eid] of Object.entries(config.sensors)) {
      if (typeof eid === 'string' && eid && !eid.startsWith('sensor.')) {
        throw new Error(`sensors.${key} must be a sensor.* entity (got ${eid}).`);
      }
    }
  }
  if (config.weather_entity &&
      typeof config.weather_entity === 'string' &&
      !config.weather_entity.startsWith('weather.')) {
    throw new Error('`weather_entity` must be a weather.* entity.');
  }
}

static getStubConfig(hass: HassMain | null, _unusedEntities: string[], allEntities: string[]) {
  // Auto-detect station sensors. Where multiple entities match, rank by
  // friendly-name signals (outdoor / garden / weather-station beats
  // indoor / kitchen) and area, with most-recent activity as the
  // tie-breaker. Falls through to first-match if no candidate scores.
  const rankCandidate = (eid: string): number => {
    const st = hass?.states?.[eid];
    if (!st) return -1;
    let score = 0;
    const name = ((st.attributes?.friendly_name as string) || '').toLowerCase();
    if (/\b(outdoor|outside|garden|weather|draussen|aussen|pool)\b/.test(name)) score += 10;
    if (/\b(indoor|inside|drinnen|kitchen|living|bedroom|fridge)\b/.test(name)) score -= 5;
    const areaId = ((st.attributes?.area_id as string) || '').toLowerCase();
    if (/garden|outdoor|outside/.test(areaId)) score += 5;
    const lastChanged = (st as { last_changed?: string }).last_changed;
    if (lastChanged && Date.now() - new Date(lastChanged).getTime() < 3_600_000) score += 1;
    return score;
  };
  const pickRanked = (candidates: string[]): string | undefined => {
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    return candidates
      .map((eid) => ({ eid, score: rankCandidate(eid) }))
      .sort((a, b) => b.score - a.score)[0].eid;
  };
  const findByClass = (cls: string): string | undefined => {
    const all = allEntities || [];
    const matches = all.filter((eid: string) => {
      if (!eid.startsWith('sensor.')) return false;
      return hass?.states?.[eid]?.attributes?.device_class === cls;
    });
    return pickRanked(matches);
  };
  const findByPattern = (re: RegExp): string | undefined => {
    const all = allEntities || [];
    const matches = all.filter((eid: string) => eid.startsWith('sensor.') && re.test(eid));
    return pickRanked(matches);
  };

  // A freshly-added card lands with a fuller, closer-to-finished
  // layout than bare DEFAULTS — the live panel, current condition, the
  // full attributes row, clock + date, and a 5-day past/forecast
  // window. The picker preview also renders this stub before any
  // recorder data exists; the live now-panel (driven by hass.states,
  // no recorder dependency) gives the picker an immediate, honest
  // visual. Sensors and the weather entity are auto-detected — never
  // hard-coded, they are instance-specific. Keys at their DEFAULTS
  // value are covered by the spread; only the deltas are listed.
  const weatherEntity = (allEntities || []).find(
    (eid: string) => eid.startsWith('weather.'),
  ) || '';
  return {
    ...DEFAULTS,
    show_main: true,
    show_current_condition: true,
    show_attributes: true,
    show_time: true,
    show_date: true,
    show_pressure: true,
    show_sun: true,
    show_dew_point: true,
    show_wind_gust_speed: true,
    show_illuminance: true,
    days: 5,
    forecast_days: 5,
    weather_entity: weatherEntity,
    forecast: {
      ...DEFAULTS_FORECAST,
      show_sunshine: true,
    },
    sensors: {
      temperature: findByClass('temperature') || '',
      humidity: findByClass('humidity') || '',
      // Solar-irradiance sensors (W/m²) work in the same slot — the
      // card converts them to lux internally.
      illuminance: findByClass('illuminance') || findByClass('irradiance') || '',
      // Prefer a daily-reset sensor (e.g. utility_meter cycle: daily) so the
      // statistics max-per-day equals the day's rainfall. A cumulative
      // (lifetime) sensor would yield the running total, not daily mm.
      precipitation: findByPattern(/precipitation_today/)
        || findByPattern(/precipitation_daily/)
        || findByPattern(/precipitation/)
        || '',
      pressure: findByClass('atmospheric_pressure') || findByClass('pressure') || '',
      wind_speed: findByClass('wind_speed') || '',
      gust_speed: findByPattern(/gust/) || '',
      wind_direction: findByPattern(/(direction|bearing|wind.?dir)/) || '',
      uv_index: findByPattern(/uv/) || '',
      dew_point: findByPattern(/dew/) || '',
    },
  };
}

  static get properties() {
    return {
      // Deliberately NON-reactive: HA replaces the hass object 2–5×/s
      // on ANY entity change in the instance, and a reactive `_hass`
      // would schedule a full Lit render pass per tick. Everything the
      // templates read live sits in the value-compared reactive props
      // below, so a tick only renders when a displayed value actually
      // changed. See ADR-0017.
      _hass: { attribute: false, hasChanged: () => false },
      config: {},
      language: {},
      sun: {type: Object},
      weather: {type: Object},
      temperature: {type: Object},
      humidity: {type: Object},
      pressure: {type: Object},
      windSpeed: {type: Object},
      windDirection: {type: Number},
      forecastChart: {type: Object},
      forecastItems: {type: Number},
      forecasts: { type: Array },
      // renderAttributes reads these straight off `this`. They must be
      // reactive in their own right now that _hass ticks no longer
      // re-render the card (ADR-0017). All hold strings / undefined,
      // so Lit's default !== check is a value comparison — assigning
      // an unchanged reading schedules nothing.
      uv_index: { attribute: false },
      dew_point: { attribute: false },
      wind_gust_speed: { attribute: false },
      illuminance: { attribute: false },
      precipitation: { attribute: false },
      precipitation_unit: { attribute: false },
      sunshine_duration: { attribute: false },
      sunshine_duration_unit: { attribute: false },
      unitSpeed: { attribute: false },
      unitPressure: { attribute: false },
      unitPrecip: { attribute: false },
      // Reassigned only when the joined list actually differs (see
      // _syncDataSources) — a fresh array every pass would defeat the
      // reference check and re-render on every full hass pass.
      _missingSensors: { attribute: false },
      _staleSensors: { attribute: false },
    };
  }

// HA passes the card's user-edited YAML as a fresh object on every
// `setConfig`. The shape is fully user-controlled so we type it as
// `any` and let `cardConfig` apply defaults and structural normalisation.
// deno-lint-ignore no-explicit-any
setConfig(config: any) {
  const cardConfig = {
    ...DEFAULTS,
    ...config,
    forecast: {
      ...DEFAULTS_FORECAST,
      ...(config.forecast || {}),
    },
    units: {
      ...DEFAULTS_UNITS,
      ...(config.units || {}),
    },
    sensors: {
      ...(config.sensors || {}),
    },
  };

  cardConfig.units.speed = config.speed ? config.speed : cardConfig.units.speed;

  // Live-condition memoization (set hass) keys partly off `condition_mapping`;
  // wipe the cached entry so the next hass tick reclassifies with the new
  // mapping instead of returning a stale label.
  this._liveConditionKey = undefined;
  this._liveCondition = undefined;
  // The watched-entity set derives from sensors/weather_entity — a new
  // config may watch different entities, so the next hass tick must
  // run the full path and rebuild the snapshot (ADR-0017).
  this._watchedStatesSnapshot = null;

  this.config = cardConfig;

  // Advisory config-schema check (Slice 2). Unknown keys and wrong-typed
  // values are silently swallowed by the DEFAULTS spread above — this
  // surfaces them as a banner instead. Advisory only: it NEVER throws,
  // the card still renders with defaults. Genuine structural errors are
  // still caught by the mode-aware throws below and `assertConfig`.
  this._configWarnings = validateConfig(config);

  // Mode-aware completeness check. Each enabled block has a required
  // key: show_station → sensors.temperature, show_forecast →
  // weather_entity. A missing one used to throw here — but a thrown
  // setConfig kills the whole card, and a freshly-added card whose
  // getStubConfig auto-detect found no temperature sensor would be dead
  // before its editor could load. Record it as a non-fatal error
  // instead: renderErrorBanner() surfaces it, the card still renders
  // what it can, and the visual editor stays usable so the user can
  // pick the missing entity.
  const configErrors: string[] = [];
  // The temperature-sensor requirement is waived when the Open-Meteo
  // no-station fallback is active (ADR-0015): the past block is filled
  // from Open-Meteo, so there is no missing-data problem to warn about.
  if (
    cardConfig.show_station
    && !cardConfig.sensors?.temperature
    && !this._openMeteoStationFallbackActive(cardConfig)
  ) {
    configErrors.push(
      'Station mode needs a temperature sensor — set `sensors.temperature` in the card config.',
    );
  }
  if (cardConfig.show_forecast && !cardConfig.weather_entity) {
    configErrors.push(
      'Forecast mode needs a weather entity — set `weather_entity` in the card config.',
    );
  }
  this._configError = configErrors.length ? configErrors.join(' ') : null;
}

// Reactivity entry-point — HA fires this 2–5x/second whenever any
// entity in `hass.states` updates. Three phases:
//   1. _extractSensorReadings — sensor → this.<reading> + unit detection
//   2. _classifyLiveCondition — derive "now" condition + synthesize weather obj
//   3. _syncDataSources       — subscribe/unsubscribe + missing-sensor scan
// Splitting the work keeps each phase under a screenful and lets the
// memoization in phase 2 be reasoned about in isolation from the
// subscription churn in phase 3.
set hass(hass: HassMain) {
  this._hass = hass;
  const lang = this.config.locale || hass.selectedLanguage || hass.language || 'en';
  if (lang !== this.language) {
    this.language = lang;
    // English ships eagerly as the fallback; every other language is
    // in its own rollup chunk, lazy-loaded on first hass-set. Once
    // the chunk lands the locale registry is populated and we ask
    // Lit to re-render so the correct strings replace the en
    // fallback. The await is a microtask if the chunk is already in
    // the browser cache.
    if (lang !== 'en' && lang.split('-')[0] !== 'en') {
      void ensureLocaleLoaded(lang).then(() => this.requestUpdate());
    }
  }

  // Entity-delta gate (ADR-0017): when none of the entities this card
  // watches changed since the last full pass, skip all three phases.
  // The data sources still get the fresh hass handle — they need it
  // for their next WS call — but no reading extraction, classification
  // or subscription churn runs, and (since nothing reactive is
  // assigned) no Lit update is scheduled.
  if (this._watchedStatesUnchanged(hass)) {
    this._dataSource?.setHass(hass);
    this._forecastSource?.setHass(hass);
    return;
  }

  this.sun = (hass.states && 'sun.sun' in hass.states) ? hass.states['sun.sun'] : null;

  this._extractSensorReadings(hass);
  this._classifyLiveCondition(hass);
  this._syncDataSources(hass);
  this._watchedStatesSnapshot = this._captureWatchedStates(hass);
}

// All entity ids this card reads live values from: every configured
// sensor, the weather entity, and sun.sun (day/night + sunrise row).
// Anything NOT in this list never feeds the live panel — its state
// changes are irrelevant to this card and safe to ignore.
// The computed moon line needs no entity here: sun.sun's attribute
// tick (elevation, ~1/min) already re-renders the card, which keeps
// the moon % and next-event time fresh without a card-level timer.
_watchedEntityIds(): string[] {
  const ids: string[] = [];
  const sensors = this.config?.sensors || {};
  for (const eid of Object.values(sensors)) {
    if (typeof eid === 'string' && eid) ids.push(eid);
  }
  if (this.config?.weather_entity) ids.push(this.config.weather_entity);
  ids.push('sun.sun');
  return ids;
}

_captureWatchedStates(hass: HassMain): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const eid of this._watchedEntityIds()) {
    snapshot[eid] = hass.states?.[eid];
  }
  return snapshot;
}

_watchedStatesUnchanged(hass: HassMain): boolean {
  const snapshot = this._watchedStatesSnapshot;
  if (!snapshot) return false;
  // First full pass must have completed — _syncDataSources seeds
  // `forecasts` with at least an empty merge.
  if (!this.forecasts) return false;
  // Never skip data-source (re)creation: _invalidateStaleSources tears
  // a source down and re-enters via `this.hass = this._hass` with the
  // SAME hass object — phase 3 must run then to rebuild the source.
  // (The teardowns also null the snapshot; this guard is the backstop
  // for any future path that drops a source without doing that.)
  const wantMeasured = this.config?.show_station !== false
    && !this._openMeteoStationFallbackActive(this.config);
  const wantForecast = this.config?.show_forecast === true && !!this.config.weather_entity;
  if (wantMeasured !== !!this._dataSource || wantForecast !== !!this._forecastSource) return false;
  // HA state objects are immutable — an entity that didn't change
  // keeps its object reference across hass objects, so reference
  // equality is an exact "unchanged" test (the same check
  // hasConfigOrEntityChanged in custom-card-helpers relies on).
  for (const eid of Object.keys(snapshot)) {
    if (hass.states?.[eid] !== snapshot[eid]) return false;
  }
  return true;
}

// Phase 1: read sensor entity states, detect source units, populate
// the per-reading instance fields, and apply the weather_entity
// attribute fallback for forecast-only mode.
_extractSensorReadings(hass: HassMain): void {
  const sensors = this.config.sensors || {};
  const stateOf = (eid: string | undefined): HassEntityState | null =>
    (eid && hass.states?.[eid]) ? hass.states[eid] : null;
  // `unavailable`/`unknown` states fall back to the last known good
  // value (issue #213): during an HA restart the panel keeps showing
  // the pre-restart readings (dimmed via .wsc-stale) instead of NaN /
  // raw "unavailable" text. The fallback map is in-memory only — on a
  // fresh page load with no last-good value the row renders empty.
  const valueOf = (eid: string | undefined): string | undefined => {
    const s = stateOf(eid);
    if (!s) return undefined;
    if (s.state === 'unavailable' || s.state === 'unknown') {
      return eid ? this._lastGoodStates[eid] : undefined;
    }
    if (eid) this._lastGoodStates[eid] = s.state;
    return s.state;
  };
  const attrOf = (eid: string | undefined, attr: string): unknown => {
    const s = stateOf(eid);
    return s?.attributes?.[attr];
  };

  // Source units come from the actual sensor entities; target units come
  // from config (or default to source). Keeping them separate is what
  // _convertWindSpeed / pressure conversion compare against — feeding the
  // target into both ends silently skips the conversion and the displayed
  // numbers stay in source units under a target-unit label.
  const sourceWindUnit = attrOf(sensors.wind_speed, 'unit_of_measurement')
    || attrOf(sensors.gust_speed, 'unit_of_measurement')
    || 'm/s';
  const sourcePressureUnit = attrOf(sensors.pressure, 'unit_of_measurement') || 'hPa';
  const sourceTempUnit = attrOf(sensors.temperature, 'unit_of_measurement') || '°C';
  const sourcePrecipBase = precipBaseUnit(
    attrOf(sensors.precipitation, 'unit_of_measurement') as string | undefined,
  );

  this.unitSpeed = this.config.units.speed || sourceWindUnit;
  this.unitPressure = this.config.units.pressure || sourcePressureUnit;
  // Default the precip display unit to the sensor's own base unit, so an
  // inch sensor reads in/h with no YAML; an explicit units.precipitation
  // overrides. Mirrors the source-default behaviour of unitSpeed.
  this.unitPrecip = this.config.units.precipitation || sourcePrecipBase;
  // Stash the source units so phase 2 can build the weather stand-in
  // without re-deriving them from the sensor attributes.
  this._sourceWindUnit = sourceWindUnit as string;
  this._sourcePressureUnit = sourcePressureUnit as string;
  this._sourceTempUnit = sourceTempUnit as string;
  this._sourcePrecipUnit = sourcePrecipBase;

  // Forecast-only fallback: in pure forecast mode users typically don't
  // wire station sensors, but HA's weather.* entity already exposes
  // standard current attributes (temperature, humidity, pressure,
  // wind_speed, wind_bearing, wind_gust_speed; uv_index / dew_point
  // when the integration provides them). Read the live entity state
  // once and let any missing sensor fall back to it. illuminance,
  // precipitation rate, and sunshine_duration have no weather-entity
  // counterpart and stay sensor-only.
  const wxEntity = this.config.weather_entity ? hass.states?.[this.config.weather_entity] : null;
  const wxAttrs = wxEntity?.attributes ?? {};
  const fromWxIfMissing = (sensorValue: string | undefined, key: string): string | undefined => {
    if (sensorValue !== undefined && sensorValue !== '') return sensorValue;
    const v = wxAttrs[key];
    if (v === undefined || v === null) return undefined;
    return String(v);
  };

  this.temperature = fromWxIfMissing(valueOf(sensors.temperature), 'temperature');
  this.humidity = fromWxIfMissing(valueOf(sensors.humidity), 'humidity');
  this.pressure = fromWxIfMissing(valueOf(sensors.pressure), 'pressure');
  this.uv_index = fromWxIfMissing(valueOf(sensors.uv_index), 'uv_index');
  this.windSpeed = fromWxIfMissing(valueOf(sensors.wind_speed), 'wind_speed');
  this.dew_point = fromWxIfMissing(valueOf(sensors.dew_point), 'dew_point');
  this.wind_gust_speed = fromWxIfMissing(valueOf(sensors.gust_speed), 'wind_gust_speed');
  // Irradiance sensors (W/m², community post 15 point 5) convert to
  // lux at extraction so EVERY downstream consumer — sun-strength row,
  // live classifier, formatLux display — sees the pipeline's native
  // unit. Plain lux sensors pass through unchanged (scale 1).
  {
    const rawIll = valueOf(sensors.illuminance);
    const illAttrs = sensors.illuminance ? hass.states?.[sensors.illuminance]?.attributes : undefined;
    const scale = luxScaleFor(illAttrs?.unit_of_measurement, illAttrs?.device_class);
    const num = rawIll !== undefined ? parseFloat(String(rawIll)) : NaN;
    this.illuminance = (scale !== 1 && Number.isFinite(num))
      ? String(Math.round(num * scale))
      : rawIll;
  }
  this.precipitation = valueOf(sensors.precipitation);
  const rawPrecipUnit = (attrOf(sensors.precipitation, 'unit_of_measurement') as string | undefined) || undefined;
  this.precipitation_unit = rawPrecipUnit;
  // Two precip shapes, both gated on whether the row is actually
  // rendered (show_precipitation). When the row is hidden the
  // derivation alone would still cost a buffer-prune + localStorage
  // write + a 30-second recompute interval per set hass, so skipping
  // it entirely matters; the raw state is written above either way, so
  // re-enabling hot-loads from the existing localStorage buffer.
  //
  //   - Native rate sensor (unit ends in /h): convert the live value to
  //     the configured display unit (mm ↔ in) and relabel.
  //   - Cumulative counter (everything else): derive a rate from the
  //     sliding-anchor buffer; the derivation handles display
  //     conversion internally.
  if (this.config.show_precipitation !== false) {
    if (isPrecipRateUnit(rawPrecipUnit)) {
      const num = parseNumericSafe(this.precipitation);
      if (num != null) {
        const { value, unit } = formatPrecipDisplay(num, rawPrecipUnit, this.unitPrecip);
        this.precipitation = value;
        this.precipitation_unit = unit;
      }
    } else {
      this._maybeDerivePrecipRate(hass);
    }
  }
  this.sunshine_duration = valueOf(sensors.sunshine_duration);
  this.sunshine_duration_unit = (attrOf(sensors.sunshine_duration, 'unit_of_measurement') as string | undefined) || undefined;

  if (sensors.wind_direction && hass.states?.[sensors.wind_direction]) {
    this.windDirection = parseFloat(hass.states[sensors.wind_direction]!.state);
  } else if (wxAttrs.wind_bearing != null) {
    this.windDirection = parseFloat(String(wxAttrs.wind_bearing));
  } else {
    this.windDirection = undefined;
  }
}

// When the configured precipitation sensor is a cumulative counter
// (unit not ending in /h, e.g. Ecowitt `*_precipitation` reporting
// total mm), derive a live mm/h rate from a sliding-anchor buffer of
// recent samples and override `this.precipitation` + `_unit` so the
// _climateRow_precip cell renders `🌧 X.X mm/h` instead of the
// meaningless cumulative total. Rate sensors (unit ends in /h) are
// untouched — the v1.9 pass-through path remains the gate.
//
// Three slices layered:
//   1. In-memory mini-buffer + adaptive sliding-anchor compute.
//   2. localStorage hydration / persistence + `🌧 ⋯ mm/h` placeholder.
//   3. Wall-clock recompute tick (this method schedules it lazily) +
//      counter-reset detection inside `computeRate` / `findUsableSlice`.
//
// Per-tick design: append the fresh sample, persist, recompute. The
// recompute helper is shared with the 30-s wall-clock interval so a
// dry period (no `set hass` for our sensor) still ages entries out
// and snaps the displayed rate to 0 mm/h once the buffer empties.
_maybeDerivePrecipRate(hass: HassMain): void {
  const unit = this.precipitation_unit ?? '';
  if (/\/(h|hr|hour)$/i.test(unit)) return;

  const sensors = this.config.sensors || {};
  const precipEid: string | undefined = sensors.precipitation;
  if (!precipEid) return;
  const state = hass.states?.[precipEid];
  if (!state) return;

  const v = parseNumericSafe(state.state);
  if (v == null) return;
  const lastUpdated = (state as { last_updated?: string }).last_updated;
  const t = lastUpdated ? Date.parse(lastUpdated) : Date.now();
  if (!Number.isFinite(t)) return;

  // Hydrate once per entity (and re-hydrate if the user repointed
  // the card at a different sensor via the editor). loadBuffer drops
  // over-age entries inline, so the buffer starts pre-pruned.
  if (this._precipBufferEntity !== precipEid) {
    this._precipBuffer = loadBuffer(precipEid);
    this._precipBufferEntity = precipEid;
  }

  const beforeAppend = this._precipBuffer;
  this._precipBuffer = appendSample(this._precipBuffer, { t, v });
  // appendSample returns the SAME reference when the sample is a
  // duplicate (same t+v) — only a genuinely new sample needs to reach
  // localStorage. Without this gate every full hass pass paid a
  // synchronous JSON.stringify + setItem.
  this._recomputePrecipDisplay(precipEid, this._precipBuffer !== beforeAppend);
  this._schedulePrecipRecomputeTick();
}

// Re-derive the displayed rate from the in-memory buffer alone, with
// no new sample read from hass. Shared between the `set hass`-driven
// path and the wall-clock interval — the interval is what makes the
// rate decay during dry periods, because `computeRate` uses `now` as
// the Δt denominator (the rate falls as wall-clock advances without
// new ticks).
//
// Idempotent: walks prune → save → computeRate → format → assign.
// Returns true when the displayed value changed (so the interval
// caller can `requestUpdate()` only when the DOM would actually differ).
_recomputePrecipDisplay(entityId: string, bufferDirty: boolean = false): boolean {
  const beforePrune = this._precipBuffer;
  this._precipBuffer = pruneOlderThan(this._precipBuffer, DEFAULT_MAX_AGE_MS);
  // Persist only when the buffer content changed (new sample appended
  // by the caller, or samples aged out here). localStorage.setItem is
  // synchronous and this runs on the hass path AND the 30-s interval —
  // a no-change write is pure blocking I/O.
  if (bufferDirty || this._precipBuffer !== beforePrune) {
    saveBuffer(entityId, this._precipBuffer);
  }

  // The buffer holds raw sensor values, so the rate is in the source
  // base unit per hour (in/h for an inch counter). Convert + label it
  // for the configured display unit; precision is unit-aware.
  const { rate } = computeRate(this._precipBuffer, Date.now());
  const { value, unit } = formatPrecipDisplay(
    rate, `${this._sourcePrecipUnit}/h`, this.unitPrecip,
  );
  const changed = this.precipitation !== value || this.precipitation_unit !== unit;
  this.precipitation = value;
  this.precipitation_unit = unit;
  return changed;
}

// Schedule the 30-s wall-clock recompute on first activation of the
// cumulative path. Reads `this._precipBufferEntity` at fire time so
// a sensor repoint (via editor) follows along without re-arming.
// Teardown is via the TeardownRegistry closure registered in
// `_registerLifecycleTeardowns`.
_schedulePrecipRecomputeTick(): void {
  if (this._precipRecomputeTimer) return;
  this._precipRecomputeTimer = setInterval(() => {
    const eid = this._precipBufferEntity;
    if (!eid) return;
    if (this._recomputePrecipDisplay(eid)) this.requestUpdate();
  }, 30_000);
}

// Phase 2: classify the live "now" condition with minute-level
// memoization, then synthesize a weather-entity stand-in for the
// render layer. Same classifier as for daily forecast columns, just
// fed with instantaneous values + an instantaneous clear-sky reference.
// Precipitation only contributes when the sensor reports a rate (unit
// ends in /h) — cumulative counters can't be turned into a current
// rate without extra history and would otherwise spuriously trigger
// 'rainy' on a dry day.
_classifyLiveCondition(hass: HassMain): void {
  const inputs = this._resolveLiveClassifierInputs(hass);
  const currentCondition = this._pickLiveCondition(inputs);
  const candidate = this._synthesizeWeatherEntity(currentCondition);
  // Keep the previous object identity when nothing changed: `weather`
  // is reference-compared by Lit, and updated() runs a full uPlot
  // redraw via updateChart() whenever it flips. A fresh object per
  // pass would mean a canvas redraw per pass (ADR-0017).
  if (!this._weatherSynthesisEquals(this.weather, candidate)) {
    this.weather = candidate;
  }
}

// Field-wise equality of two synthesized weather stand-ins. Both come
// out of _synthesizeWeatherEntity, so the attribute key set is fixed
// and all values are scalars — comparing the candidate's keys covers
// the full shape.
// deno-lint-ignore no-explicit-any
_weatherSynthesisEquals(a: any, b: any): boolean {
  if (!a || !b) return false;
  if (a.state !== b.state) return false;
  const prevAttrs = a.attributes ?? {};
  const nextAttrs = b.attributes ?? {};
  for (const key of Object.keys(nextAttrs)) {
    if (prevAttrs[key] !== nextAttrs[key]) return false;
  }
  return true;
}

// Pull the numeric inputs the live-condition classifier needs out of
// hass.states. Detects whether the precipitation sensor reports a rate
// (unit ends in /h) — cumulative counters can't be turned into an
// instantaneous rate without history and would otherwise trigger
// 'rainy' spuriously on a dry day.
// deno-lint-ignore no-explicit-any
_resolveLiveClassifierInputs(hass: HassMain): any {
  const sensors = this.config.sensors || {};
  const wxEntity = this.config.weather_entity ? hass.states?.[this.config.weather_entity] : null;
  const precipState = sensors.precipitation ? hass.states?.[sensors.precipitation] : null;
  const illuminanceState = sensors.illuminance ? hass.states?.[sensors.illuminance] : null;
  const dewState = sensors.dew_point ? hass.states?.[sensors.dew_point] : null;
  const precipUnitRaw = precipState?.attributes?.unit_of_measurement;
  const precipUnit = typeof precipUnitRaw === 'string' ? precipUnitRaw : '';
  const precipIsRate = /\/(h|hr|hour)$/i.test(precipUnit);
  const dewUnitRaw = dewState?.attributes?.unit_of_measurement;

  return {
    sensors,
    wxState: wxEntity?.state,
    nowTemp: parseNumericSafe(this.temperature),
    // Irradiance sensors scale into lux for the clear-sky ratio.
    luxNow: (() => {
      const raw = parseNumericSafe(illuminanceState?.state);
      if (raw == null) return raw;
      return raw * luxScaleFor(
        illuminanceState?.attributes?.unit_of_measurement,
        illuminanceState?.attributes?.device_class,
      );
    })(),
    precipRateNow: precipIsRate ? parseNumericSafe(precipState?.state) : null,
    // Source units so the classifier can normalise to its canonical
    // °C / mm before comparing against thresholds. Dew point falls back
    // to the temperature unit (same station, same scale in practice).
    tempUnit: this._sourceTempUnit,
    dewUnit: typeof dewUnitRaw === 'string' ? dewUnitRaw : this._sourceTempUnit,
    precipUnit,
    lat: hass.config?.latitude,
    lon: hass.config?.longitude,
  };
}

// Memoize: classifyDay walks an ~80-line decision tree and clearSkyLuxAt
// does ~4 trig ops + cos. Across the 2–5 hass ticks per second that
// arrive when many entities update at once, the inputs rarely change —
// sensors update at a far slower cadence than HA's WebSocket fan-out.
// Cache key buckets the time at minute precision so clearskyNow drift
// doesn't break the cache (lux moves ~50 lx/minute under a clear sky,
// immaterial to the cloud-ratio threshold). Cache invalidates on
// setConfig (condition_mapping changes) — see setConfig.
// deno-lint-ignore no-explicit-any
_pickLiveCondition(inputs: any): string | undefined {
  const { sensors, wxState, nowTemp, luxNow, precipRateNow, tempUnit, dewUnit, precipUnit, lat, lon } = inputs;
  const minuteKey = Math.floor(Date.now() / 60_000);
  const conditionKey =
    nowTemp + '|' + luxNow + '|' + precipRateNow + '|' +
    this.humidity + '|' + this.windSpeed + '|' + this.wind_gust_speed + '|' +
    this.dew_point + '|' + minuteKey;
  if (this._liveConditionKey === conditionKey) return this._liveCondition;

  // No station temperature sensor — defer to the weather entity's own
  // state for the live condition. Forecast-only mode lands here.
  if (!sensors.temperature && wxState) {
    this._liveConditionKey = conditionKey;
    this._liveCondition = wxState;
    return wxState;
  }

  const clearskyNow = lat != null && lon != null
    ? clearSkyLuxAt(lat, lon, new Date())
    : 110000;
  // precip_total here is precipRateNow — an instantaneous rate (mm/h)
  // when the sensor reports a /h unit. Use period: 'hour' so the
  // precipitation thresholds match the rate semantics, not 24 h totals.
  // classifyDay is unit-blind — its thresholds are °C / mm / m/s. The
  // live sensor values are raw in their native units (km/h, °F, in/h for
  // many users), so normalise each before comparing against thresholds.
  const nowTempC = toCelsius(nowTemp, tempUnit);
  const condition = classifyDay({
    temp_max: nowTempC,
    temp_min: nowTempC,
    humidity: parseNumericSafe(this.humidity),
    lux_max: luxNow,
    precip_total: toMillimeters(precipRateNow, precipUnit),
    wind_mean: toMetersPerSecond(parseNumericSafe(this.windSpeed), this._sourceWindUnit),
    gust_max: toMetersPerSecond(parseNumericSafe(this.wind_gust_speed), this._sourceWindUnit),
    dew_point_mean: toCelsius(parseNumericSafe(this.dew_point), dewUnit),
    clearsky_lux: clearskyNow,
  }, this.config.condition_mapping || {}, 'hour');
  this._liveConditionKey = conditionKey;
  this._liveCondition = condition;
  return condition;
}

// Synthesized stand-in for the original weather entity. The *_unit
// fields here represent the SOURCE units (what the data layer actually
// emits); the conversion code compares them against this.unitSpeed /
// unitPressure to decide whether to convert.
// deno-lint-ignore no-explicit-any
_synthesizeWeatherEntity(currentCondition: string | undefined): any {
  return {
    state: currentCondition,
    attributes: {
      wind_speed_unit: this._sourceWindUnit,
      pressure_unit: this._sourcePressureUnit,
      temperature_unit: this._sourceTempUnit,
      temperature: this.temperature,
      humidity: this.humidity,
      pressure: this.pressure,
      uv_index: this.uv_index,
      wind_speed: this.windSpeed,
      wind_bearing: this.windDirection,
      dew_point: this.dew_point,
      wind_gust_speed: this.wind_gust_speed,
      supported_features: 0,
    },
  };
}

// Phase 3: subscribe/unsubscribe data sources to match current mode
// flags, and rescan for missing/unavailable sensor entities.
// Symmetrical to disconnectedCallback's teardown side.
//
// Both subscribe callbacks are invoked from HA's WebSocket listener
// (ForecastDataSource) or our own polling timer (MeasuredDataSource).
// A throw out of the callback would propagate into those code paths
// and could detach the listener — wrap each body in try/catch so the
// chart can recover via _chartError instead.
_syncDataSources(hass: HassMain): void {
  this._stationData = this._stationData || [];
  this._forecastData = this._forecastData || [];

  const wantStation = this.config.show_station !== false;
  const wantForecast = this.config.show_forecast === true && !!this.config.weather_entity;
  // When the Open-Meteo fallback feeds the station block (no sensors +
  // weather entity + opt-in, ADR-0015), the recorder-backed
  // MeasuredDataSource is NOT created — `_ensureOpenMeteoSource` owns
  // `_stationData` instead. Creating both would let the recorder's
  // empty result overwrite the Open-Meteo past block on every poll.
  const wantMeasured = wantStation && !this._openMeteoStationFallbackActive(this.config);

  if (wantMeasured) {
    if (!this._dataSource) {
      // Stale-while-revalidate (perf pass 2026-08): hydrate the station
      // block from the last persisted payload for this fetch signature
      // so the first paint shows real data instead of the skeleton
      // while the recorder roundtrip (0.5–3 s on a Pi) is in flight.
      // The live result overwrites it; identical payloads are absorbed
      // by the forecastsEqual gate below.
      if (!this._stationDataReady) {
        const cached = loadSeriesCache(this._stationSeriesKey());
        if (cached?.length) {
          this._stationData = cached;
          this._stationDataReady = true;
        }
      }
      this._dataSource = new MeasuredDataSource(hass, this.config);
      this._dataUnsubscribe = this._dataSource.subscribe((event) => {
        try {
          const newData = event.forecast || [];
          const newError = event.error || null;
          // Skip the re-render path when HA's WS layer fan-outs an
          // identical payload — common when a sibling card on
          // the same dashboard resubscribes against the same recorder
          // bucket and HA broadcasts the cached state to every
          // subscriber. The error string flips equally rarely so an
          // identical-data + identical-error event is a true no-op.
          if (forecastsEqual(this._stationData, newData) && this._stationError === newError) {
            return;
          }
          this._stationData = newData;
          this._stationDataReady = true;
          this._stationCache[stationFetchKey(this.config)] = this._stationData;
          if (newData.length) saveSeriesCache(this._stationSeriesKey(), newData);
          this._stationError = newError;
          // Refresh the 3-h pressure tendency on the same cadence as the
          // station fetch (POLL_INTERVAL_MS, currently hourly). The
          // cache key inside `fetchPressure3hDelta` is the
          // start-of-current-hour timestamp, so renders within the same
          // hour reuse one roundtrip. Fire-and-forget: errors degrade
          // silently to the legacy gauge icon.
          void this._refreshPressureDelta();
          this._refreshForecasts();
        } catch (err) {
          console.error('[weather-station-card] station callback failed', err);
        }
      });
    } else {
      this._dataSource.setHass(hass);
    }
  } else if (this._dataSource) {
    this._teardownStation();
    this._stationError = null;
  }

  if (wantForecast) {
    if (!this._forecastSource) {
      // Same stale-while-revalidate hydration as the station side.
      if (!this._forecastDataReady) {
        const cached = loadSeriesCache(this._forecastSeriesKey());
        if (cached?.length) {
          this._forecastData = cached;
          this._forecastDataReady = true;
        }
      }
      this._forecastSource = new ForecastDataSource(hass, this.config);
      this._forecastUnsubscribe = this._forecastSource.subscribe((event) => {
        try {
          const newData = event.forecast || [];
          const newError = event.error || null;
          // Same fan-out suppression as the station path above.
          // weather/subscribe_forecast in HA fan-outs the entity's
          // current forecast to every active subscriber whenever
          // any one of them (re)subscribes — without this guard, a
          // mode-toggle on Card A would visibly redraw Card B's
          // chart on the same dashboard.
          if (forecastsEqual(this._forecastData, newData) && this._forecastError === newError) {
            return;
          }
          this._forecastData = newData;
          this._forecastDataReady = true;
          this._forecastCache[forecastFetchKey(this.config)] = this._forecastData;
          if (newData.length) saveSeriesCache(this._forecastSeriesKey(), newData);
          this._forecastError = newError;
          this._refreshForecasts();
        } catch (err) {
          console.error('[weather-station-card] forecast callback failed', err);
        }
      });
    } else {
      this._forecastSource.setHass(hass);
    }
  } else if (this._forecastSource) {
    this._teardownForecast();
    this._forecastError = null;
  }

  // Initial merge so forecasts is at least an empty array (not undefined).
  if (!this.forecasts) this._refreshForecasts();

  this._scanSensorAvailability(hass);
}

// Availability scan with a grace period (issue #213). An HA restart
// flips every sensor to `unavailable` for a minute or two — that used
// to paint the red error banner instantly, one line per sensor. Now:
//   - IN GRACE (missing < 5 min, or HA reports it is still starting):
//     `_staleSensors` — live panel dims, last known values keep
//     showing, a subtle "waiting" hint appears.
//   - OVERDUE (missing ≥ 5 min while HA runs): `_missingSensors` — a
//     compact warning hint (NOT the red banner; that stays reserved
//     for config/fetch/render errors).
// Both fields are reactive; assignment is skipped when the content is
// unchanged so a no-op scan stays render-inert (ADR-0017).
_scanSensorAvailability(hass: HassMain): void {
  const sensors = this.config?.sensors || {};
  const missingNow: Array<{ key: string; eid: string }> = [];
  for (const [key, eid] of Object.entries(sensors)) {
    if (!eid || typeof eid !== 'string') continue;
    const s = hass.states?.[eid];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') {
      missingNow.push({ key, eid });
    }
  }
  const now = Date.now();
  this._missingSince = updateMissingSince(
    this._missingSince, missingNow.map((m) => m.eid), now);

  // While HA itself reports a non-running core (restart in progress),
  // nothing is "overdue" — the sensors are expected back shortly.
  const coreState = (hass as unknown as { config?: { state?: string } }).config?.state;
  const haStarting = typeof coreState === 'string' && coreState !== 'RUNNING';
  const overdueSet = haStarting
    ? new Set<string>()
    : new Set(overdueMissing(this._missingSince, UNAVAILABLE_GRACE_MS, now));

  const label = (m: { key: string; eid: string }): string => `${m.key} (${m.eid})`;
  const overdue = missingNow.filter((m) => overdueSet.has(m.eid)).map(label);
  const inGrace = missingNow.filter((m) => !overdueSet.has(m.eid)).map(label);
  if (overdue.join('|') !== this._missingSensors.join('|')) {
    this._missingSensors = overdue;
  }
  if (inGrace.join('|') !== this._staleSensors.join('|')) {
    this._staleSensors = inGrace;
  }

  // In-grace entries must surface as overdue even if HA goes silent
  // (no further hass ticks): arm a one-shot re-scan for the earliest
  // expiry. Cleared on disconnect via the teardown registry.
  if (this._graceTimer) {
    clearTimeout(this._graceTimer);
    this._graceTimer = null;
  }
  const delay = haStarting ? 30_000 : nextExpiryDelay(this._missingSince, UNAVAILABLE_GRACE_MS, now);
  if (delay !== null && missingNow.length) {
    this._graceTimer = setTimeout(() => {
      this._graceTimer = null;
      if (this._hass) this._scanSensorAvailability(this._hass);
    }, delay + 1000);
  }
}

// Persistent-cache keys (perf pass 2026-08). Everything that changes
// the fetched payload is part of the key: the recorder period / the
// subscribe forecast_type, the window size, and the sensor→entity
// MAPPING (role included — swapping two entities between roles, e.g.
// temperature ↔ dew_point, changes what each series means and must
// land on a different slot). A config edit that changes any of these
// gets a fresh key, so hydration can never show data fetched for
// another signature.
_stationSeriesKey(): string {
  const sensors = this.config?.sensors || {};
  const roleEids = Object.entries(sensors)
    .filter((kv): kv is [string, string] => typeof kv[1] === 'string' && kv[1] !== '')
    .map(([role, eid]) => `${role}=${eid}`)
    .sort((a, b) => a.localeCompare(b));
  return seriesCacheKey('station', [
    stationFetchKey(this.config),
    parseInt(String(this.config?.days), 10) || 7,
    ...roleEids,
  ]);
}

_forecastSeriesKey(): string {
  return seriesCacheKey('forecast', [
    forecastFetchKey(this.config),
    String(this.config?.weather_entity || ''),
  ]);
}

// Pull the 3-h pressure delta from the recorder and stash it on the
// instance. `fetchPressure3hDelta` deduplicates within the same hour via
// `_pressureDeltaCache`, so re-renders triggered by mode toggles don't
// re-fetch. A trailing requestUpdate() ensures the row re-renders when
// the delta lands AFTER the station callback already triggered one.
async _refreshPressureDelta(): Promise<void> {
  const pressureId = this.config?.sensors?.pressure;
  if (!pressureId || this.config?.show_pressure === false) {
    this._pressureDelta3h = null;
    return;
  }
  try {
    const delta = await fetchPressure3hDelta(
      this._hass as HassLike | null,
      pressureId,
      this._pressureDeltaCache,
    );
    if (delta !== this._pressureDelta3h) {
      this._pressureDelta3h = delta;
      this.requestUpdate();
    }
  } catch (err) {
    console.debug('[weather-station-card] pressure delta refresh failed', err);
  }
}

  constructor() {
    super();
    this.resizeObserver = null;
    this.resizeInitialized = false;
    this._teardownRegistry = new TeardownRegistry();
    // Lazy-cache: when forecast.type changes, save the current
    // data under the OLD fetch-key and restore the NEW key from cache
    // for an instant render. Fresh data lands on the resubscribe
    // callback and overwrites the cached entry.
    //   _stationCache  → keyed by recorder period: 'day' | 'hour'
    //   _forecastCache → keyed by subscribe forecast_type: 'daily' | 'hourly'
    // 'today' shares 'hour' / 'hourly' with the dedicated hourly mode
    // because both fetch the same buckets — the difference is purely
    // render-time aggregation. Toggling hourly↔today therefore needs
    // no teardown at all.
    this._stationCache = {};
    this._forecastCache = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._isInPreview = this._detectInPreview();
    if (!this.resizeInitialized) {
      this.delayedAttachResizeObserver();
    }
    this._registerLifecycleTeardowns();
  }

  // Walk shadow-DOM hosts to find the card-config dialog wrappers HA
  // mounts the live preview inside. Tag-name detection is fragile to
  // HA frontend renames; failure mode is benign (animation stays on,
  // i.e. today's behaviour). Cheap to compute once at connect time.
  _detectInPreview(): boolean {
    let host = (this.getRootNode() as ShadowRoot | undefined)?.host;
    let safetyDepth = 0;
    while (host && safetyDepth++ < 32) {
      const tag = host.localName;
      if (
        tag === 'hui-card-preview' ||
        tag === 'hui-dialog-edit-card' ||
        tag === 'hui-card-element-editor'
      ) {
        return true;
      }
      host = (host.getRootNode() as ShadowRoot | undefined)?.host;
    }
    return false;
  }

  // Wire every disconnect-time cleanup site through the single
  // TeardownRegistry. Closures dereference `this._foo` at drain time,
  // so resources that get replaced during the card's lifetime
  // (e.g. _clockTimer rebuilt on settings change) are still torn down
  // correctly. Registration is gated on registry.size to keep
  // reconnect-after-disconnect idempotent.
  _registerLifecycleTeardowns() {
    if (this._teardownRegistry.size > 0) return;
    const r = this._teardownRegistry;
    r.add(() => this.detachResizeObserver());
    r.add(() => this._teardownStation());
    r.add(() => this._teardownForecast());
    r.add(() => this._teardownInitialScrollObserver());
    r.add(() => {
      if (this._openMeteoSource) {
        this._openMeteoSource.abort();
        this._openMeteoSource = null;
      }
    });
    r.add(() => {
      if (this._scrollUxTeardown) {
        this._scrollUxTeardown();
        this._scrollUxTeardown = null;
      }
    });
    r.add(() => {
      if (this._actionHandlerTeardown) {
        this._actionHandlerTeardown();
        this._actionHandlerTeardown = null;
      }
    });
    r.add(() => {
      if (this._clockTimer) {
        clearInterval(this._clockTimer);
        this._clockTimer = null;
      }
    });
    r.add(() => {
      if (this._graceTimer) {
        clearTimeout(this._graceTimer);
        this._graceTimer = null;
      }
    });
    // Visibility gate (perf pass 2026-08): pause the 1 Hz clock and
    // wake the hourly station poll when the tab/dashboard visibility
    // flips. Registered here so disconnect always detaches it.
    if (typeof document !== 'undefined') {
      const onVisibility = () => this._handleVisibilityChange();
      document.addEventListener('visibilitychange', onVisibility);
      r.add(() => document.removeEventListener('visibilitychange', onVisibility));
    }
    r.add(() => {
      if (this._precipRecomputeTimer) {
        clearInterval(this._precipRecomputeTimer);
        this._precipRecomputeTimer = null;
      }
    });
  }

  delayedAttachResizeObserver() {
    setTimeout(() => {
      this.attachResizeObserver();
      this.resizeInitialized = true;
    }, 0);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownRegistry.drain();
    // Cancel any pending two-phase row reveal (ADR-0016) so it can't
    // fire against a torn-down card.
    if (this._forecastRowsRevealHandle !== null) {
      cancelAnimationFrame(this._forecastRowsRevealHandle);
      this._forecastRowsRevealHandle = null;
    }
  }

  // Public entry point: a try/catch wrapper around the merge pipeline.
  // _refreshForecasts is called from setHass, the station/forecast
  // subscription callbacks, the ResizeObserver and the mode toggle.
  // Malformed source data (a forecast entry of the wrong shape, a NaN
  // datetime) must degrade to the error banner — never throw uncaught
  // (the setHass call site at line ~866 has no catch of its own) and
  // never leave `this.forecasts` undefined (which would blank the
  // chart block). Mirrors the drawChart → drawChartUnsafe split.
  _refreshForecasts() {
    try {
      this._refreshForecastsUnsafe();
      if (this._refreshError) {
        this._refreshError = null;
        this.requestUpdate();
      }
    } catch (err) {
      // Instrument before degrading — never silently swallow.
      console.error('[weather-station-card] forecast refresh failed', err);
      // Guarantee a defined, drawable forecasts array so the render
      // path and the chart fall back cleanly instead of crashing on
      // `undefined`.
      if (!Array.isArray(this.forecasts)) this.forecasts = [];
      const e = err as { message?: string } | null;
      this._refreshError = `Forecast data malformed: ${String(e?.message ?? err)}`;
      this.requestUpdate();
    }
  }

  _refreshForecastsUnsafe() {
    // normalizeForecastMode validates forecast.type (typo'd values fall
    // back to 'daily'). Station block is now coherent at hourly too —
    // MeasuredDataSource fetches with period:'hour' when the type is
    // hourly — so the previous show_station-override at hourly is gone.
    const { config: effectiveCfg } = normalizeForecastMode(this.config);
    // Ensure the Open-Meteo source up front. When it feeds the station
    // block (no sensors + weather entity + opt-in, ADR-0015) a warm
    // cache populates `_stationData` synchronously here, so the
    // `station` capture below sees it on the same render.
    this._ensureOpenMeteoSource(effectiveCfg);
    const todayStartMs = startOfTodayMs();
    const fcType = effectiveCfg.forecast.type;
    const isToday = fcType === 'today';

    const station = effectiveCfg.show_station !== false ? (this._stationData || []) : [];
    const rawForecast = this._sliceForecast(effectiveCfg, fcType, isToday, todayStartMs);
    // De-overlap forecast against station's last observed hour/day.
    // Providers emit forecast entries at different anchors: meteoswiss
    // starts at the NEXT full hour after "now", openmeteo-hourly
    // includes the CURRENT hour (which is already in station's last
    // bucket). Without trim, the chart shows duplicate adjacent columns
    // at the boundary (visible 13/13 or 15/15) AND the icon row below
    // ends up misaligned because the icons are emitted one-per-data-row
    // but the chart columns are one-per-unique-timestamp. Station is
    // observed truth, so trim forecast.
    const lastStationMs = station.length
      ? new Date((station[station.length - 1] as { datetime?: string }).datetime ?? '').getTime()
      : -Infinity;
    const forecast = Number.isFinite(lastStationMs)
      ? rawForecast.filter((e: { datetime?: string }) => {
          const t = new Date(e.datetime ?? '').getTime();
          return !Number.isFinite(t) || t > lastStationMs;
        })
      : rawForecast;
    // Earlier code dropped the trailing station-today entry when it
    // carried no recorded data yet (temperature + templow + precipitation
    // all null). That removed the FR-station column from ~00:00 to ~00:15
    // every day, breaking the doubled-today framing and stranding the
    // weekday labels. The column is now kept: HA's running aggregates
    // fill in over the first quarter-hour, partial values (e.g. 1 mm
    // precip since midnight) are visible immediately, and missing fields
    // render as gaps — same convention as an offline sensor on a
    // historical day.

    if (isToday) {
      this._buildTodayForecasts(station, forecast);
    } else {
      this._buildDailyOrHourlyForecasts(station, forecast, fcType, effectiveCfg);
    }
    // Data genuinely changed shape or content — flag it so measureCard's
    // skip-path pushes the fresh arrays into the live chart in place.
    this._forecastsDirty = true;
    this.requestUpdate();
    // measureCard() recomputes forecastItems from the new this.forecasts
    // length and then redraws. Going through it (instead of calling
    // drawChart() directly) prevents a stale forecastItems set by an
    // earlier ResizeObserver tick from cropping the merged array.
    //
    // Data callbacks can fire before Lit's first render has built the
    // shadow root. Skip the redraw in that window — firstUpdated() will
    // call measureCard() once the DOM is in place. The
    // wait-for-all-data-sources gate lives in drawChart so every
    // caller (firstUpdated, ResizeObserver, here) goes through it
    // uniformly.
    if (this.shadowRoot) this.measureCard();
  }

  _allExpectedDataReady(): boolean {
    const wantStation = this.config.show_station !== false;
    const wantForecast = this.config.show_forecast === true && !!this.config.weather_entity;
    if (wantStation && !this._stationDataReady) return false;
    if (wantForecast && !this._forecastDataReady) return false;
    return true;
  }

  // `days` / `forecast_days` define the data-loading window for both
  // daily and hourly modes; at hourly each day expands to 24 buckets.
  // 'today' (the day pager, 2026-08 rework) uses the SAME window as
  // hourly — the whole span is 3-h-aggregated and paged one day per
  // viewport, so the forecast side is no longer capped at end-of-today.
  // deno-lint-ignore no-explicit-any
  _sliceForecast(effectiveCfg: any, fcType: string, isToday: boolean, todayStartMs: number): any[] {
    if (effectiveCfg.show_forecast !== true || !effectiveCfg.weather_entity) return [];
    const isHourlyish = fcType === 'hourly' || isToday;
    const slotsPerUnit = isHourlyish ? 24 : 1;
    const cap = parseInt(effectiveCfg.forecast_days, 10);
    const dayLimit = cap > 0 ? cap : (parseInt(effectiveCfg.days, 10) || 7);
    const limit = dayLimit * slotsPerUnit;
    const sliced = filterMidnightStaleForecast(this._forecastData || [], todayStartMs)
      .slice(0, limit);
    // Hourly-ish modes end on a WHOLE calendar day ("nur volle Tage"):
    // the count cap lands mid-day (days × 24 h from now), which grew a
    // sliver segment on the day timeline — a "day" holding a single
    // trailing hour. Daily mode is day-granular already.
    return isHourlyish ? trimToWholeDayEnd(sliced) : sliced;
  }

  // 'today' flow (day pager, 2026-08 rework):
  //   1. Apply HOURLY sunshine to each entry (per-hour value).
  //   2. Calendar-aligned 3-hour aggregation over the MERGED series —
  //      blocks anchor at local 00/03/…/21 and the output is
  //      gap-filled to whole days (8 blocks per day, empty blocks all
  //      null). Every viewport page is exactly one calendar day.
  //   3. day_length = 3 per block (denominator for the sunshine
  //      fraction: sunshine_h / 3).
  //
  // Station/forecast split happens at block granularity AFTER the
  // merge: a boundary block containing both measured and forecast
  // hours counts as station (measured wins). The split drives the
  // solid/dashed line styling and the separator, same as before.
  // deno-lint-ignore no-explicit-any
  _buildTodayForecasts(station: any[], forecast: any[]): void {
    // De-overlap is done centrally in _refreshForecasts so the hourly
    // + daily flows benefit too. Forecast here is already strictly
    // after station's last hour.
    const merged = overlayFromOpenMeteo(
      [...station, ...forecast],
      this._hass,
      this._openMeteoSource,
      'hourly',
    );
    const allBlocks = aggregateThreeHourCalendar(merged);
    // Drop data-less leading blocks: whole empty days always (short
    // recorder history), and in FORECAST-ONLY mode the empty start of
    // the first day too — otherwise an evening mount shows a
    // near-blank current-day page with the forecast squeezed into the
    // last columns. Without a station side the pages anchor at the
    // first forecast block (rolling next-24-h windows); the
    // day-page-scroll helper falls back to the boundary-centred
    // position since no block sits at today's local midnight.
    const blocks = trimTrailingEmptyBlocks(
      trimLeadingEmptyBlocks(allBlocks, station.length === 0),
      forecast.length === 0,
    );
    for (const e of blocks) e.day_length = 3;

    // Anchor of the block containing the last STATION hour — every
    // block up to and including it is the measured side.
    let lastStationAnchorMs = -Infinity;
    if (station.length) {
      const lastDt = (station[station.length - 1] as { datetime?: string }).datetime;
      const d = lastDt ? new Date(lastDt) : null;
      if (d && Number.isFinite(d.getTime())) {
        d.setHours(Math.floor(d.getHours() / 3) * 3, 0, 0, 0);
        lastStationAnchorMs = d.getTime();
      }
    }
    let stationBlocks = 0;
    for (const b of blocks) {
      if (new Date(b.datetime).getTime() <= lastStationAnchorMs) stationBlocks++;
      else break;
    }
    this._stationCount = stationBlocks;
    this._forecastCount = blocks.length - stationBlocks;
    this.forecasts = blocks;
  }

  // Daily / hourly flow: overlay sunshine at the matching granularity.
  // F3 fallback: when neither sensor.sunshine_duration nor Open-Meteo
  // resolves a forecast value, the configured exponent
  // (default 1.7, tunable via condition_mapping.sunshine_cloud_exponent)
  // lets attachSunshine derive the value from forecast.cloud_coverage via
  // the Kasten formula. Setting the exponent to null disables F3 entirely.
  // deno-lint-ignore no-explicit-any
  _buildDailyOrHourlyForecasts(station: any[], forecast: any[], fcType: string, effectiveCfg: any): void {
    this._stationCount = station.length;
    this._forecastCount = forecast.length;
    const granularity = fcType === 'hourly' ? 'hourly' : 'daily';
    const cm = effectiveCfg.condition_mapping || {};
    const cloudExp = (cm.sunshine_cloud_exponent != null && Number.isFinite(cm.sunshine_cloud_exponent))
      ? Number(cm.sunshine_cloud_exponent)
      : 1.7;
    this.forecasts = overlayFromOpenMeteo(
      [...station, ...forecast],
      this._hass,
      this._openMeteoSource,
      granularity,
      granularity === 'daily' ? cloudExp : null,
    );
  }

  // Async sunshine-arrival path. Updates this.forecasts in place with
  // the freshly-fetched sunshine values and pushes them through the
  // existing chart via updateChart (no destroy + rebuild). Falls back to
  // _refreshForecasts when the chart hasn't been built yet or when the
  // forecast type is 'today' (whose 3-hour aggregation rebuilds the
  // whole forecasts array, not just the sunshine column).
  _overlaySunshineOnExisting(): void {
    if (!this.forecasts || !this.forecastChart) {
      this._refreshForecasts();
      return;
    }
    // deno-lint-ignore no-explicit-any
    const { config: effectiveCfg } = normalizeForecastMode(this.config) as { config: any };
    const fcType = effectiveCfg.forecast.type;
    if (fcType === 'today') {
      this._refreshForecasts();
      return;
    }
    const granularity = fcType === 'hourly' ? 'hourly' : 'daily';
    const cm = effectiveCfg.condition_mapping || {};
    const cloudExp = (cm.sunshine_cloud_exponent != null && Number.isFinite(cm.sunshine_cloud_exponent))
      ? Number(cm.sunshine_cloud_exponent)
      : 1.7;
    this.forecasts = overlayFromOpenMeteo(
      // deno-lint-ignore no-explicit-any
      [...this.forecasts] as any,
      this._hass,
      this._openMeteoSource,
      granularity,
      granularity === 'daily' ? cloudExp : null,
    );
    this.updateChart();
  }

  // True when the Open-Meteo source should drive the past/station chart
  // block instead of the recorder (ADR-0015). All must hold:
  //   - no station sensors configured (any one sensor → recorder wins,
  //     all-or-nothing — no per-channel top-up);
  //   - a weather_entity is set (it supplies the forecast half);
  //   - the station block is enabled (show_station);
  //   - the forecast.openmeteo_history opt-in is on.
  // Applies in all three chart resolutions (daily / hourly / today).
  // deno-lint-ignore no-explicit-any
  _openMeteoStationFallbackActive(cfg: any): boolean {
    if (!cfg || cfg.show_station === false) return false;
    if (cfg.forecast?.openmeteo_history !== true) return false;
    if (!cfg.weather_entity) return false;
    const sensors = cfg.sensors || {};
    const hasSensor = Object.values(sensors).some(
      (v) => typeof v === 'string' && v.trim() !== '',
    );
    return !hasSensor;
  }

  // The past-window slice of the Open-Meteo forecast, shaped like
  // MeasuredDataSource's output for the current chart mode:
  //   - daily: the last `days` daily entries up to and including today;
  //   - hourly: the last `days * 24` hourly entries up to the current
  //     hour;
  //   - today: the last 12 hourly entries (combination) or 24
  //     (station-only) — matching MeasuredDataSource's today windowing.
  // Future entries are filtered out — they belong to the weather
  // entity's forecast block, and keeping them here would make the
  // forecast-trim in _refreshForecastsUnsafe drop the real forecast.
  // deno-lint-ignore no-explicit-any
  _openMeteoStationWindow(): any[] {
    const src = this._openMeteoSource;
    if (!src) return [];
    const rawType = this.config?.forecast?.type;
    const type = (rawType === 'hourly' || rawType === 'today') ? rawType : 'daily';

    if (type === 'daily') {
      if (typeof src.getDailyStationForecast !== 'function') return [];
      const all = src.getDailyStationForecast() || [];
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowMs = tomorrow.getTime();
      const past = all.filter((e: { datetime?: string }) => {
        const t = new Date(e.datetime ?? '').getTime();
        return Number.isFinite(t) && t < tomorrowMs;
      });
      const days = parseInt(String(this.config?.days), 10) || 7;
      return past.slice(-days);
    }

    // hourly / today — slice the hourly entries up to the current hour.
    if (typeof src.getHourlyStationForecast !== 'function') return [];
    const all = src.getHourlyStationForecast() || [];
    const nowHour = new Date();
    nowHour.setMinutes(0, 0, 0);
    const nowHourMs = nowHour.getTime();
    const past = all.filter((e: { datetime?: string }) => {
      const t = new Date(e.datetime ?? '').getTime();
      return Number.isFinite(t) && t <= nowHourMs;
    });
    // 'today' (day pager) uses the same full hourly window as
    // 'hourly' — the render layer aggregates and pages it.
    // The OLDEST day is trimmed to a whole calendar day (mirror of the
    // forecast tail's whole-day rule) so the day timeline's first
    // segment is a full day; the "now" end stays untouched.
    const count = (parseInt(String(this.config?.days), 10) || 7) * 24;
    return trimToWholeDayStart(past.slice(-count));
  }

  // Lazy-init the Open-Meteo source and trigger a fetch when the cache
  // is stale (no-op if a fetch is already in flight). The source backs
  // two features off one call: the in-chart sunshine overlay
  // (forecast.show_sunshine) and — when the card has a weather entity
  // but no station sensors — the past/station block itself
  // (forecast.openmeteo_history, ADR-0015). It is created when either
  // is active, torn down when neither is.
  // deno-lint-ignore no-explicit-any
  _ensureOpenMeteoSource(effectiveCfg: any) {
    const feedsStation = this._openMeteoStationFallbackActive(this.config);
    const enabled = effectiveCfg?.forecast?.show_sunshine === true || feedsStation;
    if (!enabled) {
      if (this._openMeteoSource) {
        this._openMeteoSource.abort();
        this._openMeteoSource = null;
      }
      return;
    }
    const cfg = this._hass?.config;
    const lat = cfg && Number.isFinite(cfg.latitude) ? cfg.latitude : null;
    const lon = cfg && Number.isFinite(cfg.longitude) ? cfg.longitude : null;
    if (lat == null || lon == null) {
      // No HA location → no Open-Meteo fetch is possible. When the
      // source is the station block's only data provider, mark the
      // station "ready but empty" so the card settles into a
      // forecast-only render instead of waiting on the loading skeleton.
      if (feedsStation) {
        this._stationData = [];
        this._stationDataReady = true;
      }
      return;
    }

    // 'today' uses hourly Open-Meteo data (per-hour bars), same as
    // 'hourly' mode. Daily-only modes don't need the hourly fetch.
    const includeHourly = effectiveCfg.forecast.type === 'hourly'
      || effectiveCfg.forecast.type === 'today';

    const days = parseInt(effectiveCfg.days, 10) || 7;
    const fcDays = parseInt(effectiveCfg.forecast_days, 10) || days;
    // +1 covers today's column when the station block ends at today's
    // local midnight (the entry has datetime today 00:00).
    const pastDays = Math.min(92, days + 1);
    const forecastDays = Math.min(16, fcDays + 1);

    // Re-create when location, hourly-mode flag, or the fetch window
    // changes — each is baked into the request URL, so a change needs a
    // fresh fetch (a wider `days` must widen the past block).
    const same = this._openMeteoSource?.latitude === lat
      && this._openMeteoSource?.longitude === lon
      && this._openMeteoSource?.includeHourly === includeHourly
      && this._openMeteoSource?.pastDays === pastDays
      && this._openMeteoSource?.forecastDays === forecastDays;
    if (!same) {
      if (this._openMeteoSource) this._openMeteoSource.abort();
      this._openMeteoSource = new OpenMeteoSource({
        latitude: lat,
        longitude: lon,
        pastDays,
        forecastDays,
        includeHourly,
      });
      this._openMeteoSource.setListener((event: { ok: boolean; error?: string } | null) => {
        // When the source feeds the station block, every completed
        // fetch — success OR failure — resolves the station's loading
        // state: on success the past columns populate, on failure the
        // block stays empty but the card still renders. Re-evaluate the
        // predicate against the CURRENT config: it may have changed
        // since the source was created.
        if (this._openMeteoStationFallbackActive(this.config)) {
          this._stationData = this._openMeteoStationWindow();
          this._stationDataReady = true;
          this._refreshForecasts();
          return;
        }
        // Sunshine-only path. On a successful refresh, re-overlay
        // sunshine on the existing forecasts and push the new values
        // into the live chart via updateChart — NOT _refreshForecasts.
        // Going through the _refreshForecasts → measureCard → drawChart
        // path destroys and rebuilds the chart, which between the first
        // build (sunshine values still null) and the rebuild (sunshine
        // values populated) caused the bar ruler to recompute the
        // per-column slot allocation. The visible result was precip
        // bars rendering wide for a moment and then snapping to their
        // final half-column width once sunshine landed — read by the
        // user as a "the bars start twice as wide and then narrow"
        // artefact. Keeping the same chart instance and only mutating
        // dataset data sidesteps the ruler recompute entirely.
        if (event?.ok) this._overlaySunshineOnExisting();
      });
    }
    // Surface cached station data immediately — the source rehydrates
    // from localStorage in its constructor, so a warm cache fills the
    // past block on the very first render with no fetch wait.
    if (feedsStation) {
      const win = this._openMeteoStationWindow();
      if (win.length) {
        this._stationData = win;
        this._stationDataReady = true;
      }
    }
    // Fire-and-forget — the listener handles the redraw on completion.
    this._openMeteoSource.ensureFresh();
  }

  attachResizeObserver() {
    // Section-grid resizes fire many ResizeObserver ticks per frame.
    // measureCard → drawChart destroys + recreates the Chart.js instance,
    // and doing that synchronously dozens of times confuses both Chart.js
    // and HA's grid layout — the card briefly drops out of the render tree
    // and only reappears after a hard reload. Coalesce into one rAF tick.
    // Drop any prior instance (fast reconnects can schedule two
    // delayed attaches) so we never leak a connected observer.
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this.measureCard();
      });
    });
    this._observeResizeTarget();
  }

  // (Re-)point the ResizeObserver at the CURRENT <ha-card>. Two ways
  // the naive observe-once-at-attach approach goes silently dead:
  //   1. attachResizeObserver runs from a setTimeout(0) after
  //      connectedCallback — ha-card may not be rendered yet, so the
  //      observer ends up observing nothing, forever. No resize ever
  //      reaches measureCard, and the canvas gets CSS-stretched on a
  //      later width change (pixelated temperature line).
  //   2. Lit swaps the <ha-card> element when the render branch
  //      changes; the observer keeps watching the detached old one.
  // Called from attachResizeObserver AND from updated() after every
  // render — idempotent (no-op while the observed element is still the
  // live one), one querySelector per render.
  _observeResizeTarget() {
    if (!this.resizeObserver) return;
    const card = this.shadowRoot?.querySelector('ha-card');
    if (!card || card === this._resizeObservedCard) return;
    if (this._resizeObservedCard) {
      this.resizeObserver.unobserve(this._resizeObservedCard);
    }
    this.resizeObserver.observe(card);
    this._resizeObservedCard = card;
  }

  detachResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this._resizeObservedCard = null;
    // Allow connectedCallback to re-attach on a reconnect. Without the
    // reset, the first disconnect (teardown drain) killed the observer
    // for the rest of the element's life — after an HA view switch the
    // card never saw width changes again.
    this.resizeInitialized = false;
    if (this._resizeRaf) {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = null;
    }
  }

measureCard() {
  // Callers (firstUpdated, ResizeObserver, _refreshForecasts) all gate on
  // shadowRoot existence — the only thing left to guard is the ha-card
  // element itself, which can briefly be missing during teardown.
  const card = safeQuery(this.shadowRoot,'ha-card');
  if (!card) return;

  // forecastItems is the count of bars actually rendered. The card
  // treats forecast.number_of_forecasts as a *viewport size* (handled
  // in render via overflow-x scroll), not as a data-cropping cap — so
  // this always renders the full series. Width-based auto-fit only
  // kicks in when no data is loaded yet (initial render before the
  // data sources fire).
  const prevForecastItems = this.forecastItems;
  if (this.forecasts?.length) {
    this.forecastItems = this.forecasts.length;
  } else {
    const fontSize = this.config.forecast.labels_font_size;
    this.forecastItems = Math.round((card as HTMLElement).offsetWidth / (fontSize * 6));
  }
  // Skip the destroy-and-rebuild dance when the chart is already live
  // and the visible-bar count hasn't changed. ResizeObserver fires
  // repeatedly as HA's section-grid settles its layout; each tick
  // used to rebuild the chart instance with a slightly different
  // canvas size, and the bar ruler re-allocated per-column slot
  // widths each time — visible to the user as bars starting wide
  // then narrowing once HA's layout settled. The only reason to
  // drawChart() here is when forecastItems changed (different dataset
  // length needs a fresh chart) or no chart exists yet.
  //
  // BUT only skip when the existing chart is still LIVE in the DOM. On
  // an HA view switch the card is detached and re-attached; the forecast
  // block then re-renders through its loading→ready cycle, which Lit
  // rebuilds as a FRESH `#forecastChart` div. The old uPlot instance
  // survives on `this.forecastChart` but its canvas is now detached, so
  // skipping here would leave the new div empty (chart blank while the
  // condition-icon row still renders). Gate the skip on the chart root
  // still being connected; otherwise fall through and rebuild into the
  // fresh div.
  const chartAlive = this.forecastChart?.uplot?.root?.isConnected === true;
  if (chartAlive && this.forecastItems === prevForecastItems) {
    // Same-shape data refresh (hourly poll, forecast push): push the
    // new values into the existing chart in place. Only runs when
    // _refreshForecastsUnsafe actually rebuilt `forecasts` — a
    // ResizeObserver tick or sensor tick never sets the flag, so the
    // steady-state cost of those is zero canvas work (perf pass
    // 2026-08; replaces the removed updated()-on-`weather` redraw).
    if (this._forecastsDirty) {
      this._forecastsDirty = false;
      this.updateChart();
    }
    // uPlot does NOT auto-resize: Chart.js's responsive:true observer
    // (which this skip path used to rely on) died with the library swap
    // (ADR-0012). buildChart measures the container once; afterwards
    // `#forecastChart canvas { width:100% }` CSS-stretches the fixed
    // pixel buffer to whatever the container's CURRENT width is. So a
    // later width change (sidebar toggle, window resize, section-grid
    // settling) leaves a stretched bitmap — the user-visible symptom is
    // a pixelated/blurry temperature line, worst at hourly where the
    // canvas is widest. Snap the buffer to the new width without the
    // full destroy+rebuild; resize() re-measures the container and
    // calls uplot.setSize(), which redraws sharp.
    this._resizeChartIfWidthChanged();
    return;
  }
  this.drawChart();
}

_resizeChartIfWidthChanged() {
  const chart = this.forecastChart;
  const root = chart?.uplot?.root as HTMLElement | undefined;
  // Virtualized charts size against the scroll VIEWPORT (the wrapper),
  // classic charts against the full-width .chart-container — mirror
  // draw.ts's measureContainer so the comparison targets match.
  const container = (root?.closest('.forecast-scroll.scrolling')
    ?? root?.closest('.chart-container')) as HTMLElement | null;
  if (!chart || !container) return;
  // Same rounding as draw.ts's measureContainer so equal layouts
  // compare equal — otherwise sub-pixel drift would trigger a redraw
  // on every ResizeObserver tick.
  const width = Math.round(container.getBoundingClientRect().width);
  if (width > 0 && width !== chart.uplot.width) {
    try { chart.resize(); } catch { /* chart torn down mid-tick */ }
  }
}

// deno-lint-ignore no-explicit-any
ll(str: string): any {
  const selectedLocale: string = this.config.locale || this.language || 'en';

  // deno-lint-ignore no-explicit-any
  const localeAny = locale as Record<string, Record<string, any>>;
  if (localeAny[selectedLocale] === undefined) {
    return localeAny.en[str];
  }

  return localeAny[selectedLocale][str];
}

  // HA masonry-view layout uses getCardSize() to reserve space.
  // Each unit ≈ 50 px. The chart row is the dominant block; the
  // optional main panel adds 1–2 (with/without time); the attributes
  // row adds 1. Floor at 1 to keep the picker preview from collapsing.
  getCardSize() {
    let size = 0;
    if (this.config?.show_main) size += this.config.show_time ? 2 : 1;
    if (this.config?.show_attributes) size += 1;
    if (this.config?.show_station || this.config?.show_forecast) size += 3;
    return Math.max(size, 1);
  }

  getUnit(unit: string): string {
    const us = this._hass?.config && (this._hass.config as { unit_system?: Record<string, string> }).unit_system;
    return us?.[unit] || '';
  }

  getWeatherIcon(condition: string, _sun: string | undefined): string {
    const condKey = condition as keyof typeof weatherIcons;
    return weatherIcons[condKey];
  }

getWindDirIcon(deg: number | string): string {
  if (typeof deg === 'number') {
    return cardinalDirectionsIcon[Math.floor((deg + 22.5) / 45.0)];
  } else {
    let i = 9;
    switch (deg) {
      case "N":
        i = 0;
        break;
      case "NNE":
      case "NE":
        i = 1;
        break;
      case "ENE":
      case "E":
        i = 2;
        break;
      case "ESE":
      case "SE":
        i = 3;
        break;
      case "SSE":
      case "S":
        i = 4;
        break;
      case "SSW":
      case "SW":
        i = 5;
        break;
      case "WSW":
      case "W":
        i = 6;
        break;
      case "NW":
      case "NNW":
        i = 7;
        break;
      case "WNW":
        i = 8;
        break;
      // No default — initial value of `i` (9) is the unknown-direction fallback.
    }
    return cardinalDirectionsIcon[i];
  }
}

getWindDir(deg: number | string): string {
  if (typeof deg === 'number') {
    return this.ll('cardinalDirections')[Math.floor((deg + 11.25) / 22.5)];
  } else {
    return deg;
  }
}

calculateBeaufortScale(windSpeed: number) {
  const unitConversion = {
    'km/h': 1,
    'm/s': 3.6,
    'mph': 1.60934,
  };

  const wind_speed_unit = this.weather?.attributes
    ? this.weather.attributes.wind_speed_unit
    : null;
  const conversionFactor = unitConversion[wind_speed_unit as keyof typeof unitConversion] || unitConversion['m/s'];
  const windSpeedInKmPerHour = windSpeed * conversionFactor;

  if (windSpeedInKmPerHour < 1) return 0;
  else if (windSpeedInKmPerHour < 6) return 1;
  else if (windSpeedInKmPerHour < 12) return 2;
  else if (windSpeedInKmPerHour < 20) return 3;
  else if (windSpeedInKmPerHour < 29) return 4;
  else if (windSpeedInKmPerHour < 39) return 5;
  else if (windSpeedInKmPerHour < 50) return 6;
  else if (windSpeedInKmPerHour < 62) return 7;
  else if (windSpeedInKmPerHour < 75) return 8;
  else if (windSpeedInKmPerHour < 89) return 9;
  else if (windSpeedInKmPerHour < 103) return 10;
  else if (windSpeedInKmPerHour < 118) return 11;
  else return 12;
}

async firstUpdated(changedProperties: Map<PropertyKey, unknown>) {
  super.firstUpdated(changedProperties);
  this.measureCard();
  await new Promise(resolve => setTimeout(resolve, 0));
  this.drawChart();
}


async updated(changedProperties: Map<PropertyKey, unknown>) {
  // Apply initial scroll BEFORE the `await this.updateComplete` below.
  // Lit commits the rendered HTML to the DOM synchronously inside the
  // update() call that triggers this `updated()`, so by this line the
  // wrapper is in the DOM with its new class set. Running the scroll
  // positioning here means we set wrapper.scrollLeft in the same task
  // as the DOM commit, before the browser's next paint — eliminating
  // the one-frame window in which the chart was visible at scrollLeft=0
  // before the centered position was applied. The post-await call
  // below stays for cases where the chart hadn't been built yet on
  // this render (data still loading); a later render once data lands
  // will hit this line synchronously.
  this._maybeApplyInitialScroll(changedProperties);
  this._maybeRealignDayPager();
  this._maybeRetriggerViewChangeAnimation();
  await this.updateComplete;

  // Re-attempt action-handler binding after every render. Lit can swap
  // the <ha-card> element when the render branch changes (the
  // weather-undefined fallback uses a different template than the
  // populated branch); the per-element _wsActionHandlerBound flag
  // makes this idempotent on stable elements.
  // The card class has all the fields these helpers need; the
  // structural-mismatch errors come from the helpers' tighter
  // `forecasts: ForecastEntry[]` and config shapes. Cast through
  // `unknown` to keep tsc happy while preserving the runtime assumption.
  setupActionHandler(this as unknown as Parameters<typeof setupActionHandler>[0]);
  setupScrollUx(this as unknown as Parameters<typeof setupScrollUx>[0]);
  // Keep the ResizeObserver pinned to the live <ha-card> — same
  // element-swap reasoning as the action-handler re-bind above, plus
  // the first-render race (ha-card not yet rendered when the delayed
  // attach fires). See _observeResizeTarget.
  this._observeResizeTarget();

  if (changedProperties.has('config')) {
    const oldConfig = changedProperties.get('config');
    if (oldConfig) {
      this._invalidateStaleSources(oldConfig);

      // Pure render-only config changes (round_temp, colours, labels, …)
      // re-merge against existing forecasts; teardowns above will refill
      // anyway via the next `set hass` tick. forecast_days alone only
      // crops what we already have, so trigger refresh even with no data
      // currently merged.
      const forecastDaysChanged = this.config.forecast_days !== (oldConfig as { forecast_days?: unknown })?.forecast_days;
      if ((this.forecasts?.length) || forecastDaysChanged) {
        try { this._refreshForecasts(); } catch (e) { console.error('[weather-station-card] redraw failed', e); }
      }
    }
  }

  // NOTE (perf pass 2026-08): the former `changedProperties.has('weather')
  // → updateChart()` hook is gone. The chart reads only `this.forecasts`
  // — the synthesized weather object changes on every live sensor tick,
  // so the hook forced a full uPlot setData + canvas repaint per tick
  // without ever changing a pixel. Genuine data refreshes now reach the
  // chart via the `_forecastsDirty` flag in measureCard.
}

// Tear down whichever data source had a config dependency change. The next
// `set hass` tick rebuilds the source with the new config and emits a fresh
// merge via _refreshForecasts. Adding a new field that drives a source is
// a one-line edit to the keys table, not a new branch in updated().
//
// Mode-toggle lazy-cache: when only forecast.type changed and the
// underlying recorder/subscribe fetch-key is the same (e.g. hourly↔today
// share period='hour' and forecast_type='hourly'), no teardown is needed
// at all — the displayed data is already correct, only the render-time
// aggregation differs. When the fetch-key DOES change, the previous data
// is preserved in `_stationCache` / `_forecastCache` and restored from
// cache for the new mode if available — so a daily→hourly→daily cycle
// re-displays the daily data immediately while the new subscribe is
// in-flight, and again when the user goes back to hourly.
// deno-lint-ignore no-explicit-any
_invalidateStaleSources(oldConfig: any) {
  // deno-lint-ignore no-explicit-any
  const get = (obj: any, path: string) => path.split('.').reduce<any>(
    (o, k) => (o == null ? undefined : o[k]),
    obj,
  );
  const stale = (key: string) => JSON.stringify(get(this.config, key)) !== JSON.stringify(get(oldConfig, key));
  // forecast.type also drives MeasuredDataSource (hourly station
  // aggregates use period:'hour'), so toggling it can rebuild both
  // sources; lazy-cache below decides whether the rebuild is needed.
  // forecast.openmeteo_history toggles the no-station past block on/off
  // (ADR-0015) — a station-source rebuild, so it belongs here.
  const STATION_KEYS = ['sensors', 'days', 'show_station', 'forecast.type', 'forecast.openmeteo_history'];
  const FORECAST_KEYS = ['show_forecast', 'weather_entity', 'forecast.type'];

  const stationStale = STATION_KEYS.some(stale);
  const forecastStale = FORECAST_KEYS.some(stale);
  if (!stationStale && !forecastStale) return;

  const oldStationKey = stationFetchKey(oldConfig);
  const newStationKey = stationFetchKey(this.config);
  const oldForecastKey = forecastFetchKey(oldConfig);
  const newForecastKey = forecastFetchKey(this.config);

  // The only mode-toggle case that doesn't need a refetch: forecast.type
  // changed but the underlying fetch keys did NOT (hourly ↔ today). In
  // that case `stale` flagged forecast.type but the data we have is
  // still correct — just refresh the render.
  const onlyForecastTypeChanged =
    stale('forecast.type') &&
    !STATION_KEYS.filter((k) => k !== 'forecast.type').some(stale) &&
    !FORECAST_KEYS.filter((k) => k !== 'forecast.type').some(stale);
  if (onlyForecastTypeChanged && oldStationKey === newStationKey && oldForecastKey === newForecastKey) {
    return;
  }

  // Everything else needs at least one teardown. Try to surface cached
  // data for the new mode immediately so the chart doesn't go blank
  // while the resubscribe is in flight.
  if (stationStale) {
    this._teardownStation();
    if (oldStationKey !== newStationKey) {
      const cached = this._stationCache[newStationKey];
      if (cached?.length) {
        this._stationData = cached.slice();
        this._stationDataReady = true;
      }
    }
    // If the pressure sensor itself changed, the cached delta points at
    // a different entity and must be invalidated — the next station
    // callback will re-fetch.
    const oldPressureId = (oldConfig as { sensors?: { pressure?: string } } | undefined)?.sensors?.pressure;
    const newPressureId = this.config?.sensors?.pressure;
    if (oldPressureId !== newPressureId) {
      this._pressureDelta3h = null;
      this._pressureDeltaCache = { bucketMs: null, value: null };
    }
  }
  if (forecastStale) {
    this._teardownForecast();
    if (oldForecastKey !== newForecastKey) {
      const cached = this._forecastCache[newForecastKey];
      if (cached?.length) {
        this._forecastData = cached.slice();
        this._forecastDataReady = true;
      }
    }
  }

  // Re-run the data-source-creation path proactively. Without this the
  // chart waits for HA's next state push (1-3 s on a Pi) before
  // subscribing — defeating the lazy-cache UX.
  if (this._hass) this.hass = this._hass;
  this._refreshForecasts();
}

_teardownStation() {
  if (this._dataUnsubscribe) { this._dataUnsubscribe(); this._dataUnsubscribe = null; }
  this._dataSource = null;
  this._stationData = [];
  this._stationDataReady = false;
  // Force the next hass tick down the full path so phase 3 rebuilds
  // the source (ADR-0017 fast path would otherwise skip it).
  this._watchedStatesSnapshot = null;
}

_teardownForecast() {
  if (this._forecastUnsubscribe) { this._forecastUnsubscribe(); this._forecastUnsubscribe = null; }
  this._forecastSource = null;
  this._forecastDataReady = false;
  this._forecastData = [];
  this._watchedStatesSnapshot = null;
}

// deno-lint-ignore no-explicit-any
drawChart(args?: any): unknown[] | undefined {
  // Hold off the FIRST chart render until every expected data source
  // has produced at least one value. Forecast (HA's cached weather
  // entity) typically lands in tens of ms; station (recorder query)
  // can take a few hundred. Rendering between them produces a chart
  // with the forecast block only — e.g. 5 columns starting at today
  // — and the next render after station lands prepends the past-day
  // station columns, ending at e.g. 7-8 columns. Each existing column
  // narrows in proportion. The user reads this as bars / day sections
  // "starting twice as wide and snapping narrower". Once the initial
  // chart is built, the gate is permanently lifted; subsequent updates
  // proceed normally (in-place data updates via updateChart, full
  // rebuilds via drawChart for shape changes).
  if (!this._initialChartBuilt && !this._allExpectedDataReady()) {
    return undefined;
  }
  try {
    const result = drawChartUnsafe(this as unknown as Parameters<typeof drawChartUnsafe>[0], args);
    if (this.forecastChart) {
      this._initialChartBuilt = true;
      // A full rebuild consumed the freshest `forecasts` — no in-place
      // update needed on the next measureCard pass.
      this._forecastsDirty = false;
      // Two-phase render (ADR-0016): the chart just painted with
      // placeholder rows (when scrolling). Fill the real condition-icon /
      // wind rows in a post-paint idle callback so their per-column DOM
      // cost stays off the cold-mount critical path. No-op for
      // non-scrolling views (rows weren't deferred there).
      this._scheduleForecastRowsReveal();
      // Re-arm initial-scroll application on every fresh chart build.
      // _maybeApplyInitialScroll sets _initialScrollApplied=true once
      // the scroll has been applied; a subsequent rebuild (e.g.
      // daily↔hourly toggle) needs to re-apply because the new layout
      // moves the boundary pixel. Clearing the flag here makes the
      // next updated() cycle re-evaluate. Skip on no-op rebuilds
      // (forecastItems unchanged inside measureCard's gate) — those
      // never reach drawChart so this path runs only on real builds.
      this._initialScrollApplied = false;
      // Force the grow-from-below animation to be visible on every chart
      // build — initial mount AND mode-toggle rebuilds. Chart.js's
      // constructor-time animation runs through resize→attach→resize
      // lifecycle steps that, with the loading-placeholder flow
      // (drawChart fires from an rAF-after-Lit-commit), end up with the
      // first paint catching the bars already near their final height —
      // the animation IS running but completes before the user can
      // perceive it. Calling reset() + update() right after construction
      // snaps every bar back to its baseline and animates back over the
      // configured 800 ms. Running it on every rebuild keeps the grow
      // animation consistent across the daily/today/hourly cycle — the
      // lazy-cache otherwise makes only some transitions perceptible.
      // disable_animation and the editor live-preview still suppress it.
      // uPlot has no animation system, so the chart.js "reset+update
      // to replay the grow-from-baseline animation" path is a no-op.
      // The chart simply paints once at its final state. Per
      // alignment.md the animation is an accepted casualty of the
      // chart-library swap.
      if (this.config?.forecast?.disable_animation !== true && !this._isInPreview) {
        this.forecastChart.reset();
        this.forecastChart.update();
      }
      // Re-apply initial scroll after Lit has fully settled AND
      // Chart.js has resized its canvas to the new container width.
      //
      // drawChart runs inside _refreshForecasts during the current
      // updated() cycle. Setting this.forecasts there enqueues another
      // Lit update — the NEW .forecast-content width% (totalBars /
      // visibleBars × 100) only commits once that second performUpdate
      // runs. We loop on updateComplete to drain every pending Lit
      // update before measuring.
      //
      // BUT a fully-committed .forecast-content isn't enough: Chart.js
      // sized its canvas to fill the parent at construction time, and
      // its responsive ResizeObserver only fires AFTER paint when the
      // parent's new size is measured. So between Lit's commit and
      // Chart.js's resize, the canvas overflows the shrunken parent
      // and inflates wrapper.scrollWidth (e.g. daily after hourly
      // cycle: parent=583px, canvas=7689px → scrollWidth=7689px). The
      // browser then auto-clamps the old scrollLeft to that inflated
      // max, producing the brief "rechtsbündig" flash. Calling
      // chart.resize() synchronously snaps the canvas to the parent's
      // current size, so the subsequent apply() reads a consistent
      // wrapper.scrollWidth that matches totalBars/visibleBars.
      (async () => {
        let settled = await this.updateComplete;
        while (!settled) settled = await this.updateComplete;
        try { this.forecastChart?.resize(); } catch { /* chart torn down */ }
        this._maybeApplyInitialScroll(new Map());
      })();
    }
    if (this._chartError) {
      this._chartError = null;
      this.requestUpdate();
    }
    return result;
  } catch (e) {
    // The phase tag (set by chart/orchestrator's drawChartUnsafe before each sub-step)
    // tells us where we crashed — without it, the banner just says "render
    // failed" and we have to repro to find the spot. Falls back to "draw"
    // for failures that happen outside any tagged step.
    const phase = this._chartPhase || 'draw';
    console.error(`[weather-station-card] chart ${phase} failed`, e);
    if (this.forecastChart) {
      try { this.forecastChart.destroy(); } catch { /* already gone */ }
      this.forecastChart = null;
    }
    const err = e as { message?: string } | null;
    const msg = String(err?.message ? err.message : e);
    this._chartError = `${phase}: ${msg}`;
    this._chartPhase = null;
    this.requestUpdate();
    return undefined;
  }
}

computeForecastData({ config, forecastItems } = this) {
  // sanitizeForecastEntries drops null / non-object / datetime-less
  // entries before any positional .map() below — a single bad entry
  // would otherwise throw (`null.datetime`) and blank the chart.
  const sliced = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
  const forecast = sanitizeForecastEntries(sliced);
  const dateTime = forecast.map((d) => d.datetime);
  const fcType = config.forecast?.type;
  const { tempHigh, tempLow: rawTempLow } = hourlyTempSeries(forecast, {
    roundTemp: config.forecast.round_temp === true,
  });
  // Pure 'hourly' mode shows raw hourly entries — each hour has a single
  // temperature value, so a second low-temp line makes no semantic sense.
  // Some providers (openmeteo-hourly) emit a per-hour `templow` anyway
  // (often identical to `temperature`), which would draw a dashed line
  // directly on top of the high — visual noise. Force single-line by
  // discarding tempLow at the hourly mode boundary. Daily and 3h-aggregated
  // 'today' mode keep their real high/low pairs.
  const tempLow = fcType === 'hourly' ? null : rawTempLow;
  const precip = forecast.map((d) => d.precipitation);
  // Sunshine columns. Each entry has a normalized hours value (or null
  // when no source resolved) and a day_length the bar is scaled against.
  const sunshine = forecast.map((d) => d.sunshine ?? null);
  const dayLength = forecast.map((d) => d.day_length ?? null);

  return {
    forecast,
    dateTime,
    tempHigh,
    // tempLow is null when no entry has `templow` (hourly forecast). Coerce
    // to [] so the dataset builder downstream — which indexes by position —
    // doesn't choke. The single-line decision (hide dataset[1]) lives in
    // chart/orchestrator, gated on `tempLow === null` from hourlyTempSeries.
    tempLow: tempLow ?? [],
    // Track the high/low intent separately so the chart layer can decide
    // whether to render a second temperature line; null means hourly /
    // single-line, otherwise daily / two-line.
    tempLowAvailable: tempLow !== null,
    precip,
    sunshine,
    dayLength,
  };
}

updateChart({ forecasts, forecastChart } = this) {
  if (!forecasts?.length) {
    return;
  }

  const data = this.computeForecastData();

  if (forecastChart) {
    forecastChart.data.labels = data.dateTime;
    forecastChart.data.datasets[0].data = data.tempHigh;
    forecastChart.data.datasets[1].data = data.tempLow;
    forecastChart.data.datasets[2].data = data.precip;
    // Sunshine dataset is appended at index 3 only when the toggle is
    // on — gate the update so we don't write into a non-existent slot
    // for users who haven't enabled it.
    if (forecastChart.data.datasets[3]) {
      forecastChart.data.datasets[3].data = sunshineFractions(data.sunshine, data.dayLength);
    }
    // The value-printing label plugins (precip / temp / sunshine /
    // daily-tick) read their numbers from a render-data object captured
    // by reference at chart-build time, NOT from the datasets above.
    // Updating only the datasets redraws the bar heights and line
    // positions but leaves the printed numbers frozen — on always-on
    // tablets that only ever hit this in-place path (never a full
    // rebuild) the rain bar grows while the mm label stays stuck.
    // Refresh that shared object's fields in place so the plugins
    // re-print fresh values on the redraw triggered below.
    const rd = forecastChart.renderData;
    if (rd) {
      rd.dateTime = data.dateTime;
      rd.precip = data.precip;
      rd.tempHigh = data.tempHigh;
      rd.tempLow = data.tempLow;
      rd.sunshine = data.sunshine;
    }
    forecastChart.update();
  }
}

// Renders the daily ↔ hourly mode toggle as a small circular button
// overlaid on the chart at the precipitation-baseline level. Only
// visible when there's a station OR forecast block to switch
// (`forecast.type` drives both MeasuredDataSource period:hour|day
// and ForecastDataSource forecast_type — toggling is meaningful
// whenever any block renders, including station-only).
renderModeToggle() {
  const cfg = this.config || {};
  // Opt-out: hide the in-card view-switch button entirely so the card
  // stays pinned to the configured forecast.type. Default (unset / true)
  // keeps the button — existing cards are unchanged.
  if (cfg.forecast?.show_mode_toggle === false) return html``;
  const showsStation = cfg.show_station !== false;
  const showsForecast = cfg.show_forecast === true && !!cfg.weather_entity;
  if (!showsStation && !showsForecast) return html``;
  const type = cfg.forecast?.type;
  // 3-way cycle: daily → today → hourly → daily.
  // Icon shows the NEXT mode you'd land on, so users can predict the
  // click. "today" is signified by mdi:clock-time-eight-outline (the
  // hour-clock face); "hourly" by mdi:weather-sunset (the multi-hour
  // strip); "daily" by mdi:calendar-month-outline (the multi-day grid).
  let icon, label;
  if (type === 'today') {
    icon = 'mdi:weather-sunset';
    label = 'Switch to hourly (7-day) forecast';
  } else if (type === 'hourly') {
    icon = 'mdi:calendar-month-outline';
    label = 'Switch to daily forecast';
  } else {
    icon = 'mdi:clock-time-eight-outline';
    label = 'Switch to today (24-hour) forecast';
  }
  return html`
    <button type="button" class="mode-toggle" aria-label="${label}"
            title="${label}"
            @click=${this._onModeToggleClick}>
      <ha-icon icon=${icon} aria-hidden="true"></ha-icon>
    </button>
  `;
}

// Scroll timeline / minimap (2026-08): a slim track below the chart
// for the scrolling hourly-ish modes. One segment per calendar day
// (width proportional to that day's share of the columns), today's
// label bold, and a translucent thumb marking the currently visible
// section. The thumb is positioned imperatively from scroll-ux's
// rAF-coalesced scroll handler — Lit only renders the static track;
// pointer interaction (click/scrub to navigate) is bound in
// scroll-ux alongside the other scroll controls.
renderScrollTimeline() {
  const fc = (this.forecasts ?? []) as Array<{ datetime?: string }>;
  const total = fc.length;
  if (total < 2) return html``;

  interface TimelineSeg { start: number; count: number; ms: number }
  const segs: TimelineSeg[] = [];
  let curKey = '';
  for (let i = 0; i < total; i++) {
    const dt = fc[i]?.datetime;
    if (!dt) continue;
    const d = new Date(dt);
    if (!Number.isFinite(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== curKey) {
      curKey = key;
      const m = new Date(d);
      m.setHours(0, 0, 0, 0);
      segs.push({ start: i, count: 0, ms: m.getTime() });
    }
    segs[segs.length - 1].count++;
  }
  if (!segs.length) return html``;

  const todayMs = startOfTodayMs();
  const wdFmt = getDateTimeFormat(this.language, { weekday: 'short' });
  const dayFmt = getDateTimeFormat(this.language, { day: 'numeric' });
  const visible = effectiveVisibleBars(this.config);
  const thumbPct = visible > 0 ? Math.min(100, (visible / total) * 100) : 100;

  // The track is NOT aria-hidden: it carries real day labels, and an
  // interactive element hidden from assistive tech is a WCAG smell.
  // Keyboard users navigate via the chevron buttons instead; the
  // thumb is a pure decoration (empty div) and stays hidden.
  return html`
    <div class="scroll-timeline">
      ${segs.map((s) => html`
        <div class="tl-seg ${s.ms === todayMs ? 'tl-today' : ''}"
             style="left:${(s.start / total) * 100}%;width:${(s.count / total) * 100}%">
          <span class="tl-seg-label">${wdFmt.format(new Date(s.ms))} ${dayFmt.format(new Date(s.ms))}</span>
        </div>
      `)}
      <div class="tl-thumb" aria-hidden="true" style="left:0%;width:${thumbPct}%"></div>
    </div>
  `;
}

// Cycle through daily → today → hourly → daily via the same setConfig
// path the editor radio uses. _invalidateStaleSources picks up the
// forecast.type change and rebuilds both station and forecast data
// sources, so the new mode's data loads on demand. The mutation does
// NOT persist to the user's saved YAML — refresh resets to whatever
// they configured. For permanent changes, the editor's radio.
_onModeToggleClick(ev?: Event) {
  if (ev) ev.stopPropagation();
  const cfg = this.config || {};
  const fcfg = cfg.forecast || {};
  this.setConfig({ ...cfg, forecast: { ...fcfg, type: nextForecastType(fcfg.type) } });
}

// Generation key for the two-phase forecast-row render (ADR-0016).
// Changes when the forecast mode or the column count changes — i.e. on
// cold mount, mode toggle, or a data-shape change — so each fresh chart
// re-defers its rows. A routine same-shape data refresh keeps the same
// key, so the rows are NOT blanked on every hourly update.
_forecastRowsGenKey(): string {
  return `${this.config?.forecast?.type ?? 'daily'}|${this.forecasts?.length ?? 0}`;
}

// After the chart's first paint, fill in the real condition-icon / wind
// rows that were deferred. Double requestAnimationFrame: the FIRST frame
// paints the chart with placeholder rows (so the chart is on screen with
// the heavy per-column DOM excluded), and the reveal runs before the
// SECOND frame's paint — building the real rows once the chart is
// already visible. Setting _forecastRowsReadyGen to the current key
// flips the render branch from placeholder to real rows on that update.
//
// Why double-rAF and not requestIdleCallback: a single rAF callback runs
// BEFORE the next paint, which would build the rows before the chart is
// ever shown (no deferral). rIC defers correctly but its fire time is
// unbounded, which would let the e2e settle (two rAFs) screenshot empty
// rows. Double-rAF defers past exactly one paint and lands within the
// next frame — deterministic and inside the e2e settle window.
_scheduleForecastRowsReveal(): void {
  if (this._forecastRowsRevealHandle !== null) return;
  this._forecastRowsRevealHandle = requestAnimationFrame(() => {
    this._forecastRowsRevealHandle = requestAnimationFrame(() => {
      this._forecastRowsRevealHandle = null;
      this._forecastRowsReadyGen = this._forecastRowsGenKey();
      this.requestUpdate();
    });
  });
}

  render({config, _hass, weather} = this) {
    if (!config || !_hass) {
      return html``;
    }
    // Render-pass-scoped: cleared here so a section that recovered on
    // this pass stops reporting; _safeSection re-sets it below only if
    // a section still throws.
    this._sectionError = null;

    // A freshly-added / unconfigured card has neither a temperature
    // sensor nor a weather entity — nothing real to draw. Render a calm
    // onboarding placeholder instead of the full layout full of NaN
    // values plus a red error banner.
    const hasTemp = !!config.sensors?.temperature;
    const hasWeather = !!config.weather_entity;
    if (!hasTemp && !hasWeather) {
      return html`
        <style>
          .wsc-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 8px;
            padding: 32px 24px;
          }
          .wsc-empty ha-icon {
            --mdc-icon-size: 48px;
            color: var(--secondary-text-color, #727272);
            opacity: 0.7;
          }
          .wsc-empty-title {
            font-weight: 600;
            font-size: 15px;
            color: var(--primary-text-color, #212121);
          }
          .wsc-empty-hint {
            font-size: 13px;
            line-height: 1.4;
            color: var(--secondary-text-color, #727272);
            max-width: 260px;
          }
        </style>
        <ha-card header="${config.title}">
          <div class="wsc-empty">
            <ha-icon icon="mdi:weather-partly-cloudy"></ha-icon>
            <div class="wsc-empty-title">Weather Station Card</div>
            <div class="wsc-empty-hint">
              Open the card editor and choose your weather sensors to
              get started.
            </div>
          </div>
        </ha-card>
      `;
    }

    // Match the mm-unit sizing rule from precipLabelPlugin so the wind unit
    // ("km/h", "m/s", …) renders at the same compact size as the precip unit
    // alongside its number.
    const labelsBaseSize = parseInt(config?.forecast?.labels_font_size) || 11;
    const labelsSmallSize = Math.max(6, Math.round(labelsBaseSize * 0.5));
    if (!weather?.attributes) {
      return html`
        <style>
          .card {
            padding-top: ${config.title? '0px' : '16px'};
            padding-right: 16px;
            padding-bottom: 16px;
            padding-left: 16px;
          }
        </style>
        <ha-card header="${config.title}">
          <div class="card">
            Please, check your weather entity
          </div>
        </ha-card>
      `;
    }
    // forecast.number_of_forecasts is the visible viewport size in bars.
    // setConfig defaults this to 8 across both modes, so the same
    // mechanism handles daily (8 ≥ totalBars=7 → no scroll, fits all)
    // and hourly (8 < totalBars=168 → scrollable, viewport caps at
    // ~8 hours). 0 disables the viewport entirely (legacy "fit-all"
    // for users who explicitly set it).
    //
    // 'today' is a DAY PAGER (2026-08): the viewport always frames
    // exactly one calendar day (8 × 3-h blocks) and scrolls day-wise
    // through the whole aggregated span — effectiveVisibleBars pins
    // it to 8 regardless of number_of_forecasts.
    const visibleBars = effectiveVisibleBars(config);
    const totalBars = (this.forecasts ?? []).length;
    const scrolling = visibleBars > 0 && totalBars > visibleBars;
    const contentWidthPct = scrolling ? (totalBars / visibleBars) * 100 : 100;

    // Render every card section through _safeSection FIRST so that a
    // throw on malformed data (e.g. a partial sun entity, an
    // unexpected attribute shape) degrades that one section to empty
    // and records the cause — instead of Lit aborting the whole
    // render() and leaving a blank/white card. renderErrorBanner() is
    // computed LAST, after the section catches have had a chance to
    // set this._renderError, so the banner reflects this same pass.
    const mainSection = this._safeSection('live panel', () => this.renderMain());
    const attributesSection = this._safeSection('attributes', () => this.renderAttributes());
    const forecastSection = this._safeSection('forecast', () =>
      this._renderForecastBlock({ config, scrolling, contentWidthPct, visibleBars }),
    );
    const banner = this._safeSection('error banner', () => this.renderErrorBanner());
    const debugSection = config.debug === true
      ? this._safeSection('debug', () => this.renderDebugPanel())
      : '';

    return html`
      <style>${cardStyles({
        iconsSize: config.icons_size,
        currentTempSize: config.current_temp_size,
        timeSize: config.time_size,
        dayDateSize: config.day_date_size,
        chartHeight: config.forecast.chart_height,
        titlePresent: !!config.title,
        labelsSmallSize,
        labelsBaseSize,
      })}</style>

      <ha-card header="${config.title}">
        <div class="card">
          ${this.renderIconSpriteDefs()}
          ${banner}
          ${this._safeSection('availability note', () => this.renderAvailabilityNote())}
          <div class="${(this._staleSensors?.length || this._missingSensors?.length) ? 'wsc-stale' : ''}">
            ${mainSection}
            ${attributesSection}
          </div>
          ${forecastSection}
          ${debugSection}
        </div>
      </ha-card>
    `;
  }

  // Extracted from render() so the data-ready / loading branch can be
  // wrapped in a single _safeSection catch. Pure presentation — reads
  // instance state, returns a TemplateResult.
  // deno-lint-ignore no-explicit-any
  _renderForecastBlock({ config, scrolling, contentWidthPct, visibleBars }: any) {
    return this._allExpectedDataReady() ? (() => {
          // Pick the animation class for this render. Three cases:
          //   1. Block has never been rendered → 'first-mount' (slide-up + fade-in)
          //   2. Block was rendered before AND forecast.type just changed → 'view-changing' (opacity dip)
          //   3. Otherwise (data refresh, same type) → no animation class
          // Updated() upgrades the tracking state once the rendered
          // block lands in DOM. Inline `<div>` open below keeps the
          // existing nested structure unchanged so the rest of the
          // template is a 1:1 substitution.
          const fcType = config.forecast?.type;
          let animClass = '';
          if (!this._chartMountAnimationPlayed) {
            animClass = 'first-mount';
          } else if (this._lastForecastType !== fcType) {
            animClass = 'view-changing';
          }
          const disableClass = config.forecast?.disable_animation === true ? 'no-animation' : '';
          // Two-phase render (ADR-0016): when the chart scrolls (hourly,
          // combination daily) the per-column condition-icon / wind rows
          // are the cold-mount bottleneck — ~140 ms of a ~235 ms hourly
          // mount, vs ~94 ms for the chart alone. On the first paint of a
          // new chart generation render placeholder-height rows (so no
          // layout shift), then `_scheduleForecastRowsReveal` fills the
          // real rows in a post-paint idle callback. Non-scrolling views
          // (today, single-block daily) never defer — the rows are cheap
          // and already on screen.
          const rowsDeferred = scrolling
            && this._forecastRowsReadyGen !== this._forecastRowsGenKey();
          const conditionsEnabled = config.forecast.condition_icons !== false;
          const windEnabled = config.forecast.show_wind_forecast !== false
            && (config.forecast.show_wind_arrow !== false
              || config.forecast.show_wind_speed !== false);
          return html`
          <div class="forecast-scroll-block ${animClass} ${disableClass}">
            <div class="forecast-scroll ${scrolling ? 'scrolling' : ''}">
              <div class="forecast-content" style="width: ${contentWidthPct}%">
                <div class="chart-container">
                  <div id="forecastChart"></div>
                </div>
                ${rowsDeferred
                  ? html`
                    ${conditionsEnabled ? html`<div class="conditions" style="height: 26px"></div>` : ''}
                    ${windEnabled ? html`<div class="wind-details" style="height: 26px"></div>` : ''}
                  `
                  : html`
                    ${guard(
                      [this.forecasts, this.forecastItems, this.sun, config],
                      () => this.renderForecastConditionIcons(),
                    )}
                    ${guard(
                      [this.forecasts, this.forecastItems, this.unitSpeed, config],
                      () => this.renderWind(),
                    )}
                  `}
              </div>
            </div>
            ${this.renderModeToggle()}
            ${scrolling ? html`
              <button type="button" class="scroll-indicator scroll-indicator-left" aria-label="Scroll left" hidden>
                <ha-icon icon="mdi:chevron-left" aria-hidden="true"></ha-icon>
              </button>
              <button type="button" class="scroll-indicator scroll-indicator-right" aria-label="Scroll right" hidden>
                <ha-icon icon="mdi:chevron-right" aria-hidden="true"></ha-icon>
              </button>
              <button type="button" class="jump-to-now" aria-label="Jump to now" title="Jump to now" hidden>
                <ha-icon icon="mdi:crosshairs-gps" aria-hidden="true"></ha-icon>
              </button>
            ` : ''}
            ${scrolling && (fcType === 'hourly' || fcType === 'today')
              ? this.renderScrollTimeline()
              : ''}
          </div>
          `;
          })() : (() => {
          // Compute which rows the data-ready branch WILL render so
          // the loading state can reserve the same vertical space.
          // Otherwise the swap pushes everything below the card down
          // by ~50 px (conditions row + wind row).
          const conditionsEnabled = config.forecast.condition_icons !== false;
          const windEnabled = config.forecast.show_wind_forecast !== false
            && (config.forecast.show_wind_arrow !== false
              || config.forecast.show_wind_speed !== false);
          // Heights match the eventual rendered rows (ha-icon 24 px
          // + 2 px margin on .forecast-item for conditions; arrow +
          // single-line speed text + 2 px margin for wind). If the
          // wind text wraps to a second line on narrow columns the
          // skeleton under-reserves by ~10 px; over-reserving more
          // here would cause an upward shift in the common case.
          const condH = conditionsEnabled ? 26 : 0;
          const windH = windEnabled ? 26 : 0;
          return html`
          <div class="forecast-loading">
            <div class="chart-container">
              ${renderChartSkeleton({
                chartHeight: config.forecast.chart_height,
                visibleBars: visibleBars,
              })}
            </div>
            ${conditionsEnabled
              ? html`<div class="conditions" style="height: ${condH}px"></div>`
              : ''}
            ${windEnabled
              ? html`<div class="wind-details" style="height: ${windH}px"></div>`
              : ''}
          </div>
          `;
          })();
  }

  // Run a render section under a try/catch. On a throw, log with
  // context, record the cause into _sectionError (so renderErrorBanner
  // surfaces it on the SAME pass — the three section calls are
  // evaluated before the banner) and return an empty fragment. This is
  // graceful degradation, not masking: the failure is visible in the
  // banner and the console, only the one broken section collapses.
  _safeSection(label: string, fn: () => unknown): unknown {
    try {
      return fn();
    } catch (err) {
      console.error(`[weather-station-card] ${label} render failed`, err);
      const e = err as { message?: string } | null;
      this._sectionError = `Card section failed (${label}): ${String(e?.message ?? err)}`;
      return html``;
    }
  }

// Diagnostic panel — rendered only when `debug: true` is set in YAML.
// Surfaces the card's detected internal state so a misconfigured
// dashboard can be troubleshot without a debugger: resolved sensor
// entity IDs, the chosen render mode, each data source's subscription
// status, and the reason a chart column may be empty. Off by default;
// no editor row (YAML-only, deliberate restraint).
renderDebugPanel() {
  const cfg = this.config || {};
  const sensors = cfg.sensors || {};

  // Render mode — the same gates render() / the chart pipeline use.
  const wantStation = cfg.show_station !== false;
  const wantForecast = cfg.show_forecast === true && !!cfg.weather_entity;
  // True when the past block is backfilled from Open-Meteo rather than
  // the recorder (no station sensors + weather entity + opt-in, ADR-0015).
  const stationFromOpenMeteo = this._openMeteoStationFallbackActive(cfg);
  let renderMode = 'none (both blocks disabled)';
  if (wantStation && wantForecast) renderMode = 'combination (station + forecast)';
  else if (wantStation) renderMode = 'station-only';
  else if (wantForecast) renderMode = 'forecast-only';
  const forecastType = cfg.forecast?.type ?? 'daily';

  // Per-source status string. "subscribed" once a source object exists;
  // "error" carries the message; "no data yet" before the first event.
  const sourceStatus = (
    want: boolean,
    source: unknown,
    error: string | null,
    ready: boolean,
    count: number,
  ): string => {
    if (!want) return 'not requested (block disabled)';
    if (error) return `error — ${error}`;
    if (!source) return 'not subscribed';
    if (!ready) return 'subscribed, no data yet';
    return `subscribed, ${count} point(s)`;
  };

  const stationStatus = sourceStatus(
    wantStation,
    stationFromOpenMeteo ? this._openMeteoSource : this._dataSource,
    this._stationError,
    this._stationDataReady, this._stationData?.length ?? 0,
  );
  const forecastStatus = sourceStatus(
    wantForecast, this._forecastSource, this._forecastError,
    this._forecastDataReady, this._forecastData?.length ?? 0,
  );

  // Why a chart column might be empty — the most common support
  // question. Walk the known causes in priority order.
  const emptyReasons: string[] = [];
  if (wantStation && !stationFromOpenMeteo && !sensors.temperature) {
    emptyReasons.push('Station block on, but sensors.temperature is unset — past chart has no data.');
  }
  if (cfg.show_forecast === true && !cfg.weather_entity) {
    emptyReasons.push('show_forecast is true, but weather_entity is unset — forecast block cannot load.');
  }
  if (wantStation && this._stationDataReady && (this._stationData?.length ?? 0) === 0 && !this._stationError) {
    emptyReasons.push(stationFromOpenMeteo
      ? 'Open-Meteo returned no past data — check the browser network connection and the HA location.'
      : 'Station source returned 0 points — the recorder has no history for the configured window.');
  }
  if (wantForecast && this._forecastDataReady && (this._forecastData?.length ?? 0) === 0 && !this._forecastError) {
    emptyReasons.push('Forecast source returned 0 points — the weather entity published an empty forecast.');
  }
  if (this._missingSensors?.length) {
    emptyReasons.push(`Sensors unavailable in HA: ${this._missingSensors.join(', ')}.`);
  }

  // Resolved sensor entities — only the slots the user actually set.
  const sensorRows = Object.entries(sensors)
    .filter(([, eid]) => typeof eid === 'string' && eid)
    .map(([key, eid]) => {
      const exists = !!this._hass?.states?.[eid as string];
      return html`<div>
        <code>${key}</code>: <code>${eid}</code>
        ${exists ? '✓ in HA' : '✗ not found in HA'}
      </div>`;
    });

  const row = (label: string, value: unknown) => html`
    <div><strong>${label}:</strong> ${String(value)}</div>
  `;

  return html`
    <details class="ws-debug-panel" style="
      margin: 8px;
      padding: 6px 10px;
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.5;
      font-family: var(--code-font-family, monospace);
      color: var(--secondary-text-color, #888);
    ">
      <summary style="cursor: pointer; font-weight: bold;">
        weather-station-card diagnostics (debug: true)
      </summary>
      <div style="margin-top: 6px;">
        ${row('Card version', CARD_VERSION)}
        ${row('HA version', this._hass?.config?.version ?? 'unknown')}
        ${row('Render mode', renderMode)}
        ${row('Forecast type', forecastType)}
        ${row('Weather entity', cfg.weather_entity || '(unset)')}
        ${row('Station source', stationStatus)}
        ${row('Forecast source', forecastStatus)}
        ${row('All expected data ready', this._allExpectedDataReady())}
        ${row('Chart built', this._initialChartBuilt)}
        <div style="margin-top: 4px;"><strong>Resolved sensors:</strong></div>
        ${sensorRows.length ? sensorRows : html`<div>(none configured)</div>`}
        <div style="margin-top: 4px;"><strong>Empty-column diagnostics:</strong></div>
        ${emptyReasons.length
          ? emptyReasons.map((r) => html`<div>• ${r}</div>`)
          : html`<div>No empty-column issues detected.</div>`}
      </div>
    </details>
  `;
}

renderErrorBanner() {
  const errors = [];
  // Compatibility warning first: a too-old HA frontend may have changed
  // the APIs this card relies on, so flag it before the data-fetch
  // errors (which can be a downstream symptom of that). isHaVersionBelow
  // never false-fires on a current or unreadable version.
  if (isHaVersionBelow(this._hass?.config?.version, MIN_HA_VERSION)) {
    errors.push(`This card expects Home Assistant ${MIN_HA_VERSION} or newer.`);
  }
  if (this._configError) {
    errors.push(this._configError);
  }
  if (this._stationError) {
    errors.push(`Statistics fetch failed: ${this._stationError}`);
  }
  if (this._forecastError) {
    errors.push(`Forecast unavailable: ${this._forecastError}`);
  }
  if (this._chartError) {
    errors.push(`Chart render failed: ${this._chartError}`);
  }
  if (this._refreshError) {
    errors.push(this._refreshError);
  }
  if (this._sectionError) {
    errors.push(this._sectionError);
  }
  // NOTE (issue #213): unavailable sensors are deliberately NOT part
  // of this red banner anymore — a routine HA restart used to paint
  // one alarming line per sensor. They surface through the subtle
  // availability hint instead (renderAvailabilityNote), in-grace as a
  // neutral "waiting" line, overdue as a compact warning line.

  // Advisory config-schema warnings (Slice 2). Rendered in a separate,
  // amber band below the red error band — they don't stop the card
  // rendering, they just flag a YAML mistake the user can fix.
  const configWarnings = this._configWarnings ?? [];

  const errorBanner = errors.length
    ? html`
    <div style="background: var(--error-color, #b71c1c); color: var(--text-primary-color, #fff); padding: 8px 12px; margin: 8px; border-radius: 4px; font-size: 13px;">
      ${errors.map((e) => html`<div>${e}</div>`)}
    </div>
  `
    : html``;
  const warningBanner = configWarnings.length
    ? html`
    <div style="background: var(--warning-color, #ffa600); color: var(--text-primary-color, #fff); padding: 8px 12px; margin: 8px; border-radius: 4px; font-size: 13px;">
      <div style="font-weight: 600;">Card configuration</div>
      ${configWarnings.map((w) => html`<div>${w}</div>`)}
    </div>
  `
    : html``;
  return html`${errorBanner}${warningBanner}`;
}

// Subtle availability hint (issue #213) — replaces the former red
// banner line for unavailable sensors. One slim row, icon + short
// text; the full sensor list lives in the tooltip. In-grace (typical
// HA restart) renders neutral with a clock icon; overdue renders in
// the warning colour. Nothing renders when all sensors are live.
renderAvailabilityNote() {
  const overdue = this._missingSensors ?? [];
  const inGrace = this._staleSensors ?? [];
  if (!overdue.length && !inGrace.length) return html``;
  const isOverdue = overdue.length > 0;
  const all = [...overdue, ...inGrace];
  const text = isOverdue
    ? `${overdue.length} sensor${overdue.length === 1 ? '' : 's'} unavailable`
    : 'Waiting for sensor data…';
  const title = `${isOverdue ? 'Unavailable' : 'Recently unavailable (updating)'}: ${all.join(', ')}`;
  return html`
    <div class="wsc-availability ${isOverdue ? 'wsc-availability-overdue' : ''}"
         title=${title} aria-label=${title}>
      <ha-icon icon="${isOverdue ? 'mdi:alert-circle-outline' : 'mdi:progress-clock'}"></ha-icon>
      <span>${text}</span>
    </div>
  `;
}

renderMain({ config, sun, weather, temperature } = this) {
  if (config.show_main === false) {
    // The live block is gone — stop the 1 Hz clock too. Without this a
    // config edit that hides the block would leave the timer ticking
    // against DOM that no longer exists.
    this._syncClockTimer(false);
    return html``;
  }

  // Live-block sub-toggles default to ON (opt-out): if the parent
  // show_main is enabled, every sub-cell appears unless the user has
  // explicitly turned it off in YAML / editor. The clock's own options
  // (12h format, seconds) are read inside _updateClock at tick time.
  const showTime = config.show_time !== false;
  const showDay = config.show_day !== false;
  const showDate = config.show_date !== false;
  const showCurrentCondition = config.show_current_condition !== false;
  const showTemperature = config.show_temperature !== false;

  let roundedTemperature = parseFloat(temperature);
  if (!isNaN(roundedTemperature) && roundedTemperature % 1 !== 0) {
    roundedTemperature = Math.round(roundedTemperature * 10) / 10;
  }

  // The big condition glyph links to the weather entity — its
  // more-info dialog carries the forecast panel, the natural "tell me
  // more" for the current condition. Falls back to the temperature
  // sensor in station-only setups (same rule as the condition text).
  const iconHtml = this._entityLink(
    this.config?.weather_entity || this.config?.sensors?.temperature,
    html`<ha-icon icon="${this.getWeatherIcon(weather.state, sun.state)}"></ha-icon>`,
  );

  // Clock lifecycle moved out of the render pass (perf pass 2026-08):
  // the old code re-created the closure and tore down + re-armed the
  // 1 Hz interval on EVERY render. _syncClockTimer is idempotent —
  // it only touches the timer when the desired state actually changed
  // — and _updateClock reads its options from `this.config` at tick
  // time so a config edit needs no re-arm. Immediate update keeps the
  // clock text fresh on the render that mounts it.
  this._syncClockTimer(showTime);
  if (showTime) this._updateClock();

  return html`
    <div class="main">
      ${iconHtml}
      <div>
        <div>
          ${showTemperature ? this._entityLink(this._attrEntity('temperature'),
            html`${Number.isFinite(roundedTemperature) ? roundedTemperature : '—'}<span>${this.getUnit('temperature')}</span>`) : ''}
          ${showCurrentCondition ? html`
            <div class="current-condition">
              ${this._entityLink(
                this.config?.weather_entity || this.config?.sensors?.temperature,
                html`<span>${this.ll(weather.state)}</span>`,
              )}
            </div>
          ` : ''}
        </div>
        ${showTime ? html`
          <div class="current-time">
            <div id="digital-clock"></div>
            ${showDay ? html`<div class="date-text day"></div>` : ''}
            ${showDay && showDate ? html` ` : ''}
            ${showDate ? html`<div class="date-text date"></div>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// 1 Hz clock tick. Reads config at tick time (12h format, seconds,
// day/date visibility, language) so config edits apply on the next
// second with no timer re-arm. All three Intl formatters come from the
// process-wide cache — the tick is three .format calls + three
// textContent writes.
_updateClock(): void {
  const cfg = this.config || {};
  const currentDate = new Date();
  const timeOptions = {
    hour12: cfg.use_12hour_format,
    hour: 'numeric',
    minute: 'numeric',
    second: cfg.show_time_seconds === true ? 'numeric' : undefined,
  };
  const currentTime = getDateTimeFormat(this.language, timeOptions as Intl.DateTimeFormatOptions).format(currentDate);
  const mainDiv = this.shadowRoot?.querySelector('.main');
  if (!mainDiv) return;
  const clockElement = mainDiv.querySelector('#digital-clock');
  if (clockElement) clockElement.textContent = currentTime;
  if (cfg.show_day !== false) {
    const dayElement = mainDiv.querySelector('.date-text.day');
    if (dayElement) {
      dayElement.textContent = getDateTimeFormat(this.language, { weekday: 'long' }).format(currentDate).toUpperCase();
    }
  }
  if (cfg.show_date !== false) {
    const dateElement = mainDiv.querySelector('.date-text.date');
    if (dateElement) {
      dateElement.textContent = getDateTimeFormat(this.language, { month: 'long', day: 'numeric' }).format(currentDate);
    }
  }
}

// Idempotent timer management for the clock. The timer runs only while
// the clock is shown AND the document is visible — a wall tablet that
// switches to another dashboard (or a backgrounded browser tab) stops
// burning a wakeup per second. _handleVisibilityChange re-arms on
// return and repaints immediately so the user never sees a stale time.
_syncClockTimer(wantClock: boolean): void {
  const visible = typeof document === 'undefined' || !document.hidden;
  const shouldRun = wantClock && visible;
  if (shouldRun && !this._clockTimer) {
    this._clockTimer = setInterval(() => this._updateClock(), 1000);
  } else if (!shouldRun && this._clockTimer) {
    clearInterval(this._clockTimer);
    this._clockTimer = null;
  }
}

_handleVisibilityChange(): void {
  const wantClock = this.config?.show_main !== false && this.config?.show_time !== false;
  this._syncClockTimer(wantClock);
  if (typeof document !== 'undefined' && !document.hidden) {
    if (wantClock) this._updateClock();
    // Wake the station poller: a poll that came due while the tab was
    // hidden was skipped (see MeasuredDataSource) — run it now so the
    // returning user sees fresh data instead of waiting up to an hour.
    this._dataSource?.notifyVisible();
  }
}

// Thin wrappers around the pure unit-converter utilities. They thread
// `this.unitSpeed` / `this.unitPressure` (instance state) and
// `this.calculateBeaufortScale` (classifier method) into the pure
// functions in src/utils/unit-converters.ts so callers stay terse and
// the converters themselves get direct unit-test coverage.
// deno-lint-ignore no-explicit-any
_convertDisplayWindSpeed(windSpeed: any): any {
  return convertWindSpeed(
    windSpeed,
    this.weather.attributes.wind_speed_unit,
    this.unitSpeed,
    (v) => this.calculateBeaufortScale(v),
  );
}

// deno-lint-ignore no-explicit-any
_convertDisplayPressure(pressure: any): any {
  return convertPressure(
    pressure,
    this.weather.attributes.pressure_unit,
    this.unitPressure,
  );
}

// deno-lint-ignore no-explicit-any
_formatSunshineHours(sunshine_duration: any, sunshine_duration_unit: any): number | undefined {
  return formatSunshineHours(sunshine_duration, sunshine_duration_unit);
}

// Entity-link wrapper: clicking a live-panel value opens HA's
// more-info dialog for the sensor behind it — the same affordance
// HA's own entities card gives every row. `role="button"` doubles as
// the marker the card-level action handler uses to EXCLUDE the
// element from tap/hold/double-tap detection (see isCardControl in
// action-handler.ts), so a row click never also fires the card's
// tap_action. Values without a backing entity (sensor not configured
// AND no weather-entity fallback) render unwrapped — no dead cursor.
// deno-lint-ignore no-explicit-any
_entityLink(entityId: string | undefined, content: any): any {
  if (!entityId || !this._hass?.states?.[entityId]) return content;
  const open = (ev: Event) => {
    ev.stopPropagation();
    this._fire('hass-more-info', { entityId });
  };
  return html`<span class="wsc-entity-link" role="button" tabindex="0"
    @click=${open}
    @keydown=${(ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev); }
    }}>${content}</span>`;
}

// Entity id backing an attribute row: the configured sensor wins;
// rows whose value can fall back to the weather entity's current
// attributes (see _extractSensorReadings) link to the weather entity
// in that case, so the click still lands on the data's real source.
_attrEntity(sensorKey: string, weatherFallback: boolean = true): string | undefined {
  const eid = this.config?.sensors?.[sensorKey];
  if (typeof eid === 'string' && eid) return eid;
  if (weatherFallback && this.config?.weather_entity) return this.config.weather_entity;
  return undefined;
}

// Per-row template helpers. Each row is a single conditional render —
// clearer than 4-row nested ternaries and lets ESLint's
// no-nested-conditional rule apply at per-row granularity.

// deno-lint-ignore no-explicit-any
_climateRow_pressure(show: boolean, dPressure: any, deltaHpa: number | null) {
  if (!show || dPressure === undefined) return html``;
  const unitLabel = this.unitPressure ? this.ll('units')[this.unitPressure] : '';
  const trend = getPressureTrend(deltaHpa);
  const trendIcon = getPressureTrendIcon(trend);
  const iconName = trendIcon || 'gauge';
  // Icon-only encoding: adding a `(±X.X/3h)` suffix wrapped on narrow
  // attribute columns and broke the row layout. The directional arrow
  // alone is enough — the unit label keeps pressure-semantic anchor.
  // Tooltip / aria-label localises trend + 3-h delta + weather influence;
  // delta stays in hPa (the WMO classification unit) even when the user
  // displays mmHg / inHg.
  let ariaLabel = '';
  if (trend && deltaHpa != null && Number.isFinite(deltaHpa)) {
    const llKey = (k: string) =>
      (this.ll(k) || (locale.en as Record<string, unknown>)[k] || '') as string;
    const trendLabel = llKey(`pressure_trend_${trend}`);
    const influenceLabel = llKey(`pressure_influence_${trend}`);
    const template = llKey('pressure_tooltip_template');
    const deltaStr = (deltaHpa > 0 ? '+' : '') + deltaHpa.toFixed(1);
    ariaLabel = template
      .replace('{trend}', trendLabel)
      .replace('{delta}', deltaStr)
      .replace('{influence}', influenceLabel);
  }
  return html`${this._entityLink(this._attrEntity('pressure'),
    html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${dPressure} ${unitLabel}</span>`)}<br>`;
}
// Dew point and humidity share one line (v2.3): the dew point is the
// headline value, humidity is an opt-in second segment with its own
// icon and entity link. Humidity alone still renders when the dew
// point is hidden or unwired.
_climateRow_dewpoint(show: boolean, dew_point: unknown, showHumidity: boolean, humidity: unknown) {
  const dewVisible = show && dew_point !== undefined;
  const humVisible = showHumidity && humidity !== undefined;
  if (!dewVisible && !humVisible) return html``;
  const humSegment = humVisible
    ? this._entityLink(this._attrEntity('humidity'),
        html`<ha-icon icon="hass:water-percent"></ha-icon> ${humidity} %`)
    : html``;
  if (!dewVisible) return html`${humSegment}<br>`;
  const displayUnit = this.weather.attributes.temperature_unit;
  // Classifier wants pure °C; convert once when the source sensor is in
  // °F. Display values themselves stay in the user's unit.
  const toC = (v: number) =>
    this._sourceTempUnit === '°F' ? (v - 32) * 5 / 9 : v;
  const td_raw = parseFloat(String(dew_point));
  const tair_raw = parseFloat(String(this.temperature));
  const td_c = Number.isFinite(td_raw) ? toC(td_raw) : null;
  const tair_c = Number.isFinite(tair_raw) ? toC(tair_raw) : null;
  const band = getDewPointComfort(td_c, tair_c);
  const bandIcon = getDewPointComfortIcon(band);
  const iconName = bandIcon || 'thermometer-water';
  // Tooltip / aria-label localised via the band-keyed locale strings;
  // English keys are the fallback when the active locale is missing one.
  // Spread is shown in the user's display unit so the number on screen
  // matches the dew-point value the row renders.
  let ariaLabel = '';
  if (band && Number.isFinite(td_raw) && Number.isFinite(tair_raw)) {
    const spread = Math.max(0, tair_raw - td_raw);
    const bandLabel = (this.ll(`dew_point_band_${band}`)
      || (locale.en as Record<string, unknown>)[`dew_point_band_${band}`]
      || '') as string;
    const template = (this.ll('dew_point_tooltip_template')
      || (locale.en as Record<string, unknown>)['dew_point_tooltip_template']
      || '') as string;
    ariaLabel = template
      .replace('{td}', String(Math.round(td_raw)))
      .replace('{spread}', String(Math.round(spread)))
      .replace(/\{unit\}/g, String(displayUnit))
      .replace('{band}', bandLabel);
  }
  // Cap the displayed value at one decimal — same rule as the main
  // temperature. Dew points sourced from a weather entity's attribute
  // are often computed full-precision floats ("12.345678"), which
  // rendered raw until now (community thread report). A clean sensor
  // value passes through unchanged; non-numeric states render as-is.
  let displayDew: number = td_raw;
  if (Number.isFinite(displayDew) && displayDew % 1 !== 0) {
    displayDew = Math.round(displayDew * 10) / 10;
  }
  const dewText = Number.isFinite(displayDew) ? String(displayDew) : String(dew_point);
  const dewSegment = this._entityLink(this._attrEntity('dew_point'),
    html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${dewText} ${displayUnit}</span>`);
  return humVisible
    ? html`${dewSegment} ${humSegment}<br>`
    : html`${dewSegment}<br>`;
}
_climateRow_precip(show: boolean, hasValue: boolean, precipitation: unknown, precipitation_unit: unknown) {
  if (!show || !hasValue) return html``;
  const unitSuffix = precipitation_unit ? ' ' + precipitation_unit : '';
  // When the value is a rate (a native rate sensor or the cumulative→
  // rate derivation in precip-rate.ts, in either mm/h or in/h), map
  // intensity to a matching icon. precipIcon's thresholds are in mm/h,
  // so normalise an in/h rate first. Other units (probability `%`, raw
  // `mm`, …) keep the legacy rainy icon — their magnitude isn't a rate.
  const unitStr = precipitation_unit as string | undefined;
  const isRate = isPrecipRateUnit(unitStr);
  const rateMm = isRate ? toMillimeters(parseFloat(String(precipitation)), unitStr) : null;
  const icon = rateMm != null && Number.isFinite(rateMm) ? precipIcon(rateMm) : 'hass:weather-rainy';
  return html`${this._entityLink(this._attrEntity('precipitation', false),
    html`<ha-icon icon="${icon}"></ha-icon> ${precipitation}${unitSuffix}`)}<br>`;
}

_sunRow_sunStrength(
  showUv: boolean,
  showLux: boolean,
  uv_index: unknown,
  illuminance: unknown,
  lat: number | null,
  lon: number | null,
) {
  const uvWired = uv_index !== undefined && uv_index !== '';
  const luxWired = illuminance !== undefined && illuminance !== '';
  if (!showUv && !showLux) return html``;
  if (!uvWired && !luxWired) return html``;

  const uvNum = uvWired ? parseFloat(String(uv_index)) : NaN;
  const luxNum = luxWired ? parseFloat(String(illuminance)) : NaN;
  const out = classifySunStrength({
    uv: Number.isFinite(uvNum) ? uvNum : null,
    lux: Number.isFinite(luxNum) ? luxNum : null,
    lat,
    lon,
  });

  const showUvSegment = showUv && out.uv != null;
  const showLuxSegment = showLux && out.lux != null;
  if (!showUvSegment && !showLuxSegment) return html``;

  const llKey = (k: string) =>
    (this.ll(k) || (locale.en as Record<string, unknown>)[k] || '') as string;

  let title = '';
  if (out.mode === 'night') {
    title = llKey('sun_strength_night_reason');
  } else {
    const parts: string[] = [];
    if (out.bandLocaleKey && showUvSegment) {
      parts.push(`UV ${Math.round((out.uv ?? 0) * 10) / 10} (${llKey(out.bandLocaleKey)})`);
    }
    if (out.cloudPct != null && showLuxSegment) {
      parts.push(`${out.cloudPct}% of clear sky`);
    }
    if (out.protectionAdvised && showUvSegment) {
      parts.push(llKey('sun_strength_protection_advised'));
    }
    title = parts.join(' · ');
  }

  const uvDisplay = showUvSegment
    ? `UV ${Math.round((out.uv ?? 0) * 10) / 10}`
    : '';
  const luxDisplay = showLuxSegment ? formatLux(out.lux) : '';
  const valueText = [uvDisplay, luxDisplay].filter(Boolean).join(' / ');

  // Link priority mirrors the value's own precedence: the UV sensor
  // when the UV segment is shown, else the illuminance sensor, else
  // the weather entity the UV fallback came from.
  const strengthEntity = (showUvSegment && this.config?.sensors?.uv_index)
    || this.config?.sensors?.illuminance
    || this._attrEntity('uv_index');
  return html`<div title=${title} aria-label=${title}>${this._entityLink(strengthEntity,
    html`<ha-icon icon="hass:${out.iconShape}"></ha-icon> ${valueText}`)}</div>`;
}
_sunRow_sunshine(show: boolean, sunshineHours: number | undefined) {
  if (!show || sunshineHours === undefined) return html``;
  return html`<div>${this._entityLink(this._attrEntity('sunshine_duration', false),
    html`<ha-icon icon="hass:weather-sunny"></ha-icon> ${sunshineHours} h`)}</div>`;
}
// deno-lint-ignore no-explicit-any
_sunRow_sunPanel(show: boolean, sun: any, language: string) {
  if (!show || sun === undefined) return html``;
  return html`<div>${this._entityLink('sun.sun',
    this.renderSun({ sun, language } as unknown as this))}${this._renderMoonLine(language)}</div>`;
}

// deno-lint-ignore no-explicit-any
_windRow_direction(show: boolean, windDirection: any) {
  if (!show || windDirection === undefined) return html``;
  return html`${this._entityLink(this._attrEntity('wind_direction'),
    html`<ha-icon icon="hass:${this.getWindDirIcon(windDirection)}"></ha-icon> ${this.getWindDir(windDirection)}`)} <br>`;
}
// deno-lint-ignore no-explicit-any
_windRow_speed(show: boolean, dWindSpeed: any) {
  if (!show || dWindSpeed === undefined) return html``;
  const unitLabel = this.unitSpeed ? this.ll('units')[this.unitSpeed] : '';
  return html`${this._entityLink(this._attrEntity('wind_speed'),
    html`<ha-icon icon="hass:weather-windy"></ha-icon>
    ${dWindSpeed} ${unitLabel}`)} <br>`;
}
// deno-lint-ignore no-explicit-any
_windRow_gust(show: boolean, wind_gust_speed: any) {
  if (!show || wind_gust_speed === undefined) return html``;
  const unitLabel = this.unitSpeed ? this.ll('units')[this.unitSpeed] : '';
  return html`${this._entityLink(this._attrEntity('gust_speed'),
    html`<ha-icon icon="hass:weather-windy-variant"></ha-icon>
    ${this._convertWindSpeed(parseFloat(wind_gust_speed))} ${unitLabel}`)}`;
}

// Climate group: pressure / dew-point (+ opt-in humidity on the same
// line) / precipitation. Returns nothing-html when every row's toggle
// is off or backing value is empty.
// deno-lint-ignore no-explicit-any
_renderClimateGroup({ showHumidity, humidity, showPressure, dPressure, pressureDelta3h, showDewpoint, dew_point, showPrecipitation, precipitation, precipitation_unit, hasPrecipValue }: any) {
  const anyVisible = (showHumidity && humidity !== undefined) || (showPressure && dPressure !== undefined) || (showDewpoint && dew_point !== undefined) || (showPrecipitation && hasPrecipValue);
  if (!anyVisible) return html``;
  return html`
    <div>
      ${this._climateRow_pressure(showPressure, dPressure, pressureDelta3h)}
      ${this._climateRow_dewpoint(showDewpoint, dew_point, showHumidity, humidity)}
      ${this._climateRow_precip(showPrecipitation, hasPrecipValue, precipitation, precipitation_unit)}
    </div>
  `;
}

// Sun / UV / illuminance / sunshine-duration group.
// deno-lint-ignore no-explicit-any
_renderSunGroup({ showSun, sun, showUvIndex, uv_index, showIlluminance, illuminance, showSunshineDuration, sunshineHours, language, lat, lon }: any) {
  const anyVisible = (showSun && sun !== undefined) || (showUvIndex && uv_index !== undefined && uv_index !== '') || (showIlluminance && illuminance !== undefined && illuminance !== '') || (showSunshineDuration && sunshineHours !== undefined);
  if (!anyVisible) return html``;
  return html`
    <div>
      ${this._sunRow_sunStrength(showUvIndex, showIlluminance, uv_index, illuminance, lat, lon)}
      ${this._sunRow_sunshine(showSunshineDuration, sunshineHours)}
      ${this._sunRow_sunPanel(showSun, sun, language)}
    </div>
  `;
}

// Wind group: direction / speed / gust speed.
// deno-lint-ignore no-explicit-any
_renderWindGroup({ showWindDirection, windDirection, showWindSpeed, dWindSpeed, showWindgustspeed, wind_gust_speed }: any) {
  const anyVisible = (showWindDirection && windDirection !== undefined) || (showWindSpeed && dWindSpeed !== undefined);
  if (!anyVisible) return html``;
  return html`
    <div>
      ${this._windRow_direction(showWindDirection, windDirection)}
      ${this._windRow_speed(showWindSpeed, dWindSpeed)}
      ${this._windRow_gust(showWindgustspeed, wind_gust_speed)}
    </div>
  `;
}

renderAttributes({ config, humidity, pressure, windSpeed, windDirection, sun, language, uv_index, dew_point, wind_gust_speed, illuminance, precipitation, precipitation_unit, sunshine_duration, sunshine_duration_unit } = this) {
  const dWindSpeed = this._convertDisplayWindSpeed(windSpeed);
  const dPressure = this._convertDisplayPressure(pressure);

  if (config.show_attributes === false) return html``;

  // Live-block sub-toggle defaults come from DEFAULTS (merged in
  // setConfig): headline attributes are on, detail attributes and
  // humidity are opt-in.
  // Precipitation display: a native rate sensor is converted to the
  // configured display unit in `set hass`; a cumulative counter is
  // turned into a live rate by `_maybeDerivePrecipRate`. The display
  // unit (mm | in) defaults to the sensor's own unit and can be
  // overridden via `units.precipitation`.
  // Site lat/lon for the sun-strength row's clear-sky reference. Pulled
  // from `hass.config` (Home Assistant's configured location) rather
  // than the card config — chrigu's setup wires it once and the live
  // panel inherits. Missing/non-finite values fall through to the
  // 110 000 lx constant inside `classifySunStrength`.
  const haCfg = this._hass?.config as { latitude?: number; longitude?: number } | undefined;
  const lat = haCfg && Number.isFinite(haCfg.latitude) ? haCfg.latitude as number : null;
  const lon = haCfg && Number.isFinite(haCfg.longitude) ? haCfg.longitude as number : null;

  const ctx = {
    // Opt-in since the dew-point line merge (v2.3): the line shows only
    // the dew point by default; humidity joins it on explicit `true`.
    showHumidity: config.show_humidity === true,
    showPressure: config.show_pressure !== false,
    showWindDirection: config.show_wind_direction !== false,
    showWindSpeed: config.show_wind_speed !== false,
    showSun: config.show_sun !== false,
    showDewpoint: config.show_dew_point !== false,
    showWindgustspeed: config.show_wind_gust_speed !== false,
    showUvIndex: config.show_uv_index !== false,
    showIlluminance: config.show_illuminance !== false,
    showPrecipitation: config.show_precipitation !== false,
    showSunshineDuration: config.show_sunshine_duration !== false,
    hasPrecipValue: precipitation !== undefined && precipitation !== '',
    sunshineHours: this._formatSunshineHours(sunshine_duration, sunshine_duration_unit),
    humidity, dPressure, dew_point, precipitation, precipitation_unit,
    pressureDelta3h: this._pressureDelta3h,
    sun, uv_index, illuminance, language,
    windDirection, dWindSpeed, wind_gust_speed,
    lat, lon,
  };

  return html`
    <div class="attributes">
      ${this._renderClimateGroup(ctx)}
      ${this._renderSunGroup(ctx)}
      ${this._renderWindGroup(ctx)}
    </div>
  `;
}

// Only the NEXT sun event is shown (2026-08): during the day that's
// the sunset, at night the sunrise — the other one is hours of stale
// information. The freed second line carries the moon phase (see
// _renderMoonLine).
renderSun({ sun, language } = this) {
  if (sun == undefined) {
    return html``;
  }

const use12HourFormat = this.config.use_12hour_format;
const timeOptions = {
    hour12: use12HourFormat,
    hour: 'numeric',
    minute: 'numeric'
} as Intl.DateTimeFormatOptions;

  const timeFmt = getDateTimeFormat(language, timeOptions);
  const rising = new Date(sun.attributes.next_rising);
  const setting = new Date(sun.attributes.next_setting);
  const nextIsRise = rising.getTime() <= setting.getTime();
  const next = nextIsRise ? rising : setting;
  return html`
    <ha-icon icon="${nextIsRise ? 'mdi:weather-sunset-up' : 'mdi:weather-sunset-down'}"></ha-icon>
      ${timeFmt.format(next)}
  `;
}

// Moon line — computed in-card (src/moon.ts, ADR-0022), no Moon
// integration or entity needed. Shows the exact illuminated fraction
// as a dynamically drawn disc + percentage, followed by the NEXT
// moonrise/moonset (same next-event-only policy as the sun line
// above). The line is text-free by design, so it needs no locale
// strings. `show_moon: false` opts out.
_renderMoonLine(language: string) {
  if (this.config?.show_moon === false) return html``;
  const now = new Date();
  const { fraction, waxing } = moonIllumination(now);

  // Site coordinates from hass.config (same source as the sun-strength
  // row). Missing/non-finite → the rise/set part is simply omitted;
  // the illumination is geocentric and renders regardless.
  const haCfg = this._hass?.config as { latitude?: number; longitude?: number } | undefined;
  const lat = haCfg && Number.isFinite(haCfg.latitude) ? haCfg.latitude as number : null;
  const lon = haCfg && Number.isFinite(haCfg.longitude) ? haCfg.longitude as number : null;

  // Southern-hemisphere observers see the moon mirrored — the waxing
  // moon grows from the LEFT there, so the lit side flips with lat.
  const litRight = lat !== null && lat < 0 ? !waxing : waxing;
  const pct = getNumberFormat(language, { style: 'percent', maximumFractionDigits: 0 })
    .format(fraction);

  const ev = lat !== null && lon !== null ? nextMoonEvent(now, lat, lon) : undefined;
  const evIcon = ev?.kind === 'rise' ? 'mdi:weather-moonset-up' : 'mdi:weather-moonset-down';
  const evPart = ev
    ? html` <ha-icon icon="${evIcon}"></ha-icon>
        ${getDateTimeFormat(language, {
          hour12: this.config.use_12hour_format,
          hour: 'numeric',
          minute: 'numeric',
        }).format(ev.time)}`
    : html``;

  return html`<br><svg class="wsc-moon" viewBox="0 0 24 24" aria-hidden="true"><circle
        cx="12" cy="12" r="9.5" fill="currentColor" fill-opacity="0.14"
        stroke="currentColor" stroke-opacity="0.45" stroke-width="1"></circle><path
        d=${litMoonPath(fraction, litRight)} fill="currentColor"></path></svg>
      ${pct}${evPart}`;
}

// ADR-0018: the wide per-column rows render up to 168 condition icons
// plus 168 wind arrows in hourly mode. As <ha-icon> each one costs a
// custom-element upgrade + async icon resolution — measured at ~140 ms
// of the hourly cold mount (ADR-0016 could only REORDER that work past
// the first paint, not remove it). The rows therefore render plain
// inline-SVG <use> references against a single hidden sprite emitted
// once per card (renderIconSpriteDefs in render()). Icon names outside
// the shipped sprite fall back to a regular <ha-icon>, so an upstream
// mapping addition degrades to the slow path instead of a blank cell.
// The template is hoisted to module scope (see ICON_SPRITE_TEMPLATE)
// so render() returns the SAME TemplateResult every pass — Lit's diff
// then skips the whole subtree instead of re-walking N symbol
// templates on every render (perf pass 2026-08).
renderIconSpriteDefs() {
  return ICON_SPRITE_TEMPLATE;
}

_spriteIcon(fullName: string | undefined, cls: string = '') {
  const name = (fullName ?? '').replace(/^.*:/, '');
  if (MDI_PATHS[name]) {
    return html`<svg class="wsc-icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#wsc-i-${name}"></use></svg>`;
  }
  return html`<ha-icon class="${cls}" icon="${fullName}"></ha-icon>`;
}

renderForecastConditionIcons({ config, forecastItems, sun } = this) {
  if (config.forecast.condition_icons === false) {
    return html``;
  }

  // Drop malformed entries (null, missing datetime) before the
  // per-item map below dereferences `item.datetime`.
  const forecast = sanitizeForecastEntries(
    this.forecasts ? this.forecasts.slice(0, forecastItems) : [],
  );

  // Per-time day/night icon resolution was removed with the move to
  // the canonical weatherIcons mapping — both variants render the
  // same glyph, so the per-column sunrise/sunset Date math that used
  // to live here (≈6 Date allocations + mutations per column, ~1 000
  // ops at 168 hourly columns) was dead work in the ADR-0016 reveal
  // frame. If per-time resolution comes back, reintroduce the
  // computation INSIDE the icon-name decision so it only runs when it
  // changes the output.
  return html`
    <div class="conditions">
      ${forecast.map((item) => html`
        <div class="forecast-item">
          ${this._spriteIcon(this.getWeatherIcon(item.condition, sun?.state))}
        </div>
      `)}
    </div>
  `;
}

renderWind({ config, forecastItems } = this) {
  // Two independent toggles: forecast.show_wind_arrow (direction) and
  // forecast.show_wind_speed (numeric speed). The wind row appears
  // when either is on.
  //
  // Deprecated: forecast.show_wind_forecast is a backwards-compat shim
  // that still accepts `false` as a hard master-off so existing YAML
  // configs that explicitly disabled the wind row keep working. New
  // configs should use `show_wind_arrow: false` + `show_wind_speed:
  // false` instead.
  const masterOff = config.forecast.show_wind_forecast === false;
  if (masterOff) return html``;

  const showArrow = config.forecast.show_wind_arrow !== false;
  const showSpeed = config.forecast.show_wind_speed !== false;
  if (!showArrow && !showSpeed) return html``;

  const forecast = sanitizeForecastEntries(
    this.forecasts ? this.forecasts.slice(0, forecastItems) : [],
  );
  const unit = this.unitSpeed ? this.ll('units')[this.unitSpeed] : '';

  return html`
    <div class="wind-details">
      ${forecast.map((item) => {
        const raw = item.wind_gust_speed ?? item.wind_speed;
        const dWindSpeed = this._convertWindSpeed(raw, item.wind_speed_unit);
        const hasSpeed = dWindSpeed !== null && dWindSpeed !== undefined;
        const hasBearing = item.wind_bearing != null;
        // Some integrations (notably HA's Open-Meteo at forecast_type:
        // 'hourly') only ship `temperature` / `precipitation` / `condition`
        // and omit wind fields entirely. Without these guards
        // getWindDirIcon(undefined) falls into its default branch and
        // every cell shows the same arrow, while the unit span renders
        // an orphan "km/h". Suppress each piece independently so
        // partial-data integrations also display cleanly.
        return html`
          <div class="wind-detail">
            ${showArrow && hasBearing ? this._spriteIcon(`hass:${this.getWindDirIcon(item.wind_bearing)}`, 'wind-icon') : ''}
            ${showSpeed && hasSpeed ? html`
              <span class="wind-value">
                <span class="wind-speed">${dWindSpeed}</span>
                <span class="wind-unit">${unit}</span>
              </span>
            ` : ''}
          </div>
        `;
      })}
    </div>
  `;
}

// Forecast-row wind converter. Per-entry `sourceUnit` (set by
// ForecastDataSource from the weather entity) wins over the synthetic-
// weather fallback (station unit), so forecast wind doesn't get
// mis-converted when the station and weather entity disagree on units.
// Delegates to the lookup-table utility per ADR-0009.
_convertWindSpeed(raw: unknown, sourceUnit?: string): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number') return null;
  const fromUnit = sourceUnit ?? this.weather.attributes.wind_speed_unit;
  return convertWindSpeed(
    raw,
    fromUnit,
    this.unitSpeed,
    (v) => this.calculateBeaufortScale(v),
  );
}

  _fire(type: string, detail: unknown, options?: { bubbles?: boolean; cancelable?: boolean; composed?: boolean }) {
    const node = this.shadowRoot;
    const opts = options ?? {};
    const eventDetail = detail ?? {};
    const event = new Event(type, {
      bubbles: opts.bubbles ?? true,
      cancelable: Boolean(opts.cancelable),
      composed: opts.composed ?? true,
    });
    (event as Event & { detail?: unknown }).detail = eventDetail;
    node?.dispatchEvent(event);
    return event;
  }

  // Sync the animation-tracking state once the chart block exists in
  // the DOM. Runs after every Lit commit, gated on whether the block
  // is currently mounted (it isn't during the loading branch).
  //
  // Two responsibilities, both behind the block-exists check:
  //   1. Set _chartMountAnimationPlayed=true so the next render
  //      doesn't reapply the 'first-mount' class. Delayed via
  //      setTimeout (animation duration + buffer) so HA's hass-state
  //      ping-pong — which re-renders this component every few 100 ms
  //      — doesn't strip the class mid-animation. Without the delay,
  //      Lit re-renders inside the 420 ms slide-up window with the
  //      flag already true, the template drops 'first-mount', the
  //      browser cancels the animation, and the user sees nothing.
  //   2. Detect a forecast.type change on a block that STAYED MOUNTED
  //      across the render (cached toggle case) and force-restart the
  //      view-change CSS animation via classList remove → reflow → add.
  //      Without this, Lit's template diff updates the class attribute
  //      but the browser collapses same-class-same-name into a no-op
  //      and the cross-fade doesn't re-fire on consecutive toggles.
  //      The remount case (cache miss) doesn't need this branch: the
  //      fresh element already carries 'view-changing' from the
  //      template, so the animation runs on mount.
  // Day-pager self-healing (2026-08): a data refresh can RESHAPE the
  // content — after midnight the series gains a day, a longer provider
  // forecast appends blocks — which changes .forecast-content's width
  // while the wrapper's PIXEL scrollLeft is preserved by the browser.
  // The preserved position then lands mid-page: the viewport shows
  // "21:00 yesterday … 18:00 today" instead of a whole day. After
  // every render, snap a drifted pager back to the nearest whole-day
  // page. Skipped while the user is actively dragging (the drag-end
  // snap in scroll-ux owns that case) and inert when already aligned.
  _maybeRealignDayPager() {
    if (this.config?.forecast?.type !== 'today') return;
    const wrapper = safeQuery<HTMLElement>(this.shadowRoot, '.forecast-scroll.scrolling');
    if (!wrapper || wrapper.classList.contains('dragging')) return;
    const w = wrapper.clientWidth;
    if (w <= 0 || wrapper.scrollWidth <= w) return;
    const offset = wrapper.scrollLeft % w;
    if (offset > 2 && offset < w - 2) {
      const maxLeft = wrapper.scrollWidth - w;
      wrapper.scrollLeft = Math.min(maxLeft, Math.max(0, Math.round(wrapper.scrollLeft / w) * w));
    }
  }

  _maybeRetriggerViewChangeAnimation() {
    const block = safeQuery<HTMLElement>(this.shadowRoot, '.forecast-scroll-block');
    if (!block) return;
    const type = this.config?.forecast?.type;
    const typeChanged = this._lastForecastType !== undefined && this._lastForecastType !== type;
    if (typeChanged) {
      block.classList.remove('view-changing');
      // Force reflow so the next add re-starts the animation from
      // its 0% keyframe instead of being collapsed by the browser.
      void block.offsetWidth;
      block.classList.add('view-changing');
    }
    if (!this._chartMountAnimationPlayed && this._chartMountAnimationTimer === null) {
      // Defer the flag-flip until the start animation has visibly
      // finished. Wall-clock delay matches the CSS animation duration
      // plus a small frame buffer. Stored on the instance so a Lit
      // disconnect/reconnect cycle doesn't accidentally schedule twice.
      this._chartMountAnimationTimer = window.setTimeout(() => {
        this._chartMountAnimationPlayed = true;
        this._chartMountAnimationTimer = null;
      }, 500);
    }
    this._lastForecastType = type;
  }

  // Apply the "scroll to now" position once per render generation.
  // A generation changes when forecast.type or number_of_forecasts
  // change — outside those, we leave scrollLeft alone so the user's
  // manual scroll position survives data refreshes (which fire every
  // hour from MeasuredDataSource).
  _maybeApplyInitialScroll(changedProperties: Map<PropertyKey, unknown>) {
    const wrapper = safeQuery(this.shadowRoot,'.forecast-scroll.scrolling');
    if (!wrapper) {
      // Non-scrolling render (or before first paint). Mark unapplied so
      // the next scrolling render re-positions.
      this._initialScrollApplied = false;
      return;
    }
    const cfg = this.config || {};
    const fcfg = cfg.forecast || {};
    const stationCount = this._stationCount || 0;
    const forecastCount = this._forecastCount || 0;
    const wantsStation = cfg.show_station !== false;
    const wantsForecast = cfg.show_forecast === true && !!cfg.weather_entity;
    // Defer the initial scroll until every block we *intend* to render
    // has data. Otherwise the forecast-loads-before-station case (the
    // ForecastDataSource WebSocket subscribe usually replies sooner
    // than the recorder/statistics_during_period roundtrip) hits the
    // forecast-only branch — scrollLeft 0 — and pins that position via
    // _initialScrollApplied before station data arrives. The result is
    // a combination card that opens scrolled to the start of station
    // history rather than centred on "now".
    const dataReady =
      (!wantsStation || stationCount > 0) &&
      (!wantsForecast || forecastCount > 0);
    if (!dataReady) {
      this._initialScrollApplied = false;
      return;
    }
    const generationKey = `${fcfg.type || 'daily'}|${fcfg.number_of_forecasts || 0}`;

    let needsReset = !this._initialScrollApplied;
    if (changedProperties?.has('config') && this._lastScrollGeneration
        && this._lastScrollGeneration !== generationKey) {
      needsReset = true;
    }
    if (!needsReset) return;

    // Tear down any in-flight observer / frame from a previous call —
    // e.g. when the user flips forecast.type while a previous settle
    // wait is still pending.
    this._teardownInitialScrollObserver();

    const apply = () => {
      if (!wrapper.isConnected) return false;
      // Lit's updateComplete guarantees DOM commit but NOT that browser
      // layout has measured the .forecast-content's `width: <ratio>%`
      // CSS, NOR that Chart.js has finished sizing the canvas inside
      // it — at the first paint scrollWidth can still equal clientWidth,
      // which makes computeInitialScrollLeft early-return 0.
      if (wrapper.scrollWidth <= wrapper.clientWidth) return false;
      // Cross-check: the wrapper's scrollWidth comes from
      // .forecast-content's `width: <pct>%` (computed in render() as
      // totalBars/visibleBars * 100). On a mode toggle, drawChart runs
      // synchronously from inside updated() — its rAF callback can fire
      // BEFORE Lit's queued re-render commits the NEW pct, so we'd
      // measure the PREVIOUS mode's content width with the NEW counts.
      // Bail when the measured width doesn't match what totalBars
      // implies; the ResizeObserver fallback below picks up the real
      // size change once Lit's re-render commits.
      const totalBars = (this._stationCount || 0) + (this._forecastCount || 0);
      const visibleBars = effectiveVisibleBars(this.config);
      if (totalBars > 0 && visibleBars > 0 && totalBars > visibleBars) {
        const expectedScrollWidth = wrapper.clientWidth * (totalBars / visibleBars);
        // Tolerance accounts for sub-pixel rounding + browser layout
        // quantisation — but stays well under the smallest meaningful
        // mode-to-mode width delta (daily≈583px ↔ hourly≈7689px).
        if (Math.abs(wrapper.scrollWidth - expectedScrollWidth) > expectedScrollWidth * 0.1) {
          return false;
        }
      }
      // Day pager: never open on a half-empty page. Station-only
      // anchors at the series END (rolling last-24-h window),
      // forecast-only at the START, combination on the current
      // calendar day's page. Falls back to the boundary-centred
      // position when no anchor matches (e.g. clock skew).
      const dayPage = fcfg.type === 'today'
        ? computeTodayPagerScrollLeft({
            forecasts: this.forecasts,
            stationCount: this._stationCount || 0,
            forecastCount: this._forecastCount || 0,
            contentWidth: wrapper.scrollWidth,
            viewportWidth: wrapper.clientWidth,
          })
        : null;
      const scrollLeft = dayPage ?? computeInitialScrollLeft({
        stationCount: this._stationCount || 0,
        forecastCount: this._forecastCount || 0,
        contentWidth: wrapper.scrollWidth,
        viewportWidth: wrapper.clientWidth,
      });
      wrapper.scrollLeft = scrollLeft;
      this._initialScrollApplied = true;
      this._lastScrollGeneration = generationKey;
      return true;
    };

    // Best case: layout already settled. Otherwise observe the inner
    // content for size changes — that fires once Chart.js's canvas
    // settles and the wrapper actually overflows. Hard cap (1 s after
    // dataReady) so we don't observe forever if the wrapper never
    // overflows for some reason.
    if (apply()) return;

    const content = wrapper.querySelector('.forecast-content');
    if (!content || typeof ResizeObserver === 'undefined') {
      this._pendingScrollFrame = requestAnimationFrame(() => {
        this._pendingScrollFrame = null;
        apply();
      });
      return;
    }
    const startedAt = Date.now();
    let framePending = false;
    const observer = new ResizeObserver(() => {
      // Chart.js sizes the canvas progressively over its ~800 ms grow
      // animation, so this observer fires many times per frame. apply()
      // reads wrapper.scrollWidth/clientWidth — each a forced synchronous
      // layout — so running it per tick thrashes layout. Coalesce into
      // one rAF: apply() runs at most once per frame. Behaviour is
      // unchanged (apply() just returns false until layout settles); the
      // 1 s hard cap still bounds the wait.
      if (framePending) return;
      framePending = true;
      this._pendingScrollFrame = requestAnimationFrame(() => {
        framePending = false;
        this._pendingScrollFrame = null;
        if (Date.now() - startedAt > 1000 || apply()) {
          this._teardownInitialScrollObserver();
        }
      });
    });
    observer.observe(content);
    this._initialScrollObserver = observer;
  }

  _teardownInitialScrollObserver() {
    if (this._initialScrollObserver) {
      this._initialScrollObserver.disconnect();
      this._initialScrollObserver = null;
    }
    if (this._pendingScrollFrame) {
      cancelAnimationFrame(this._pendingScrollFrame);
      this._pendingScrollFrame = null;
    }
  }

}

customElements.define('weather-station-card', WeatherStationCard);

// Console banner — same pattern Mushroom / mini-graph-card / etc. use.
// The literal '__CARD_VERSION__' is replaced at build time by the
// package.json version (see injectCardVersion in rollup.config.mjs).
// Single source of truth — no manual release-time bump dance. Lets
// users (and us during dev) confirm at a glance which build is loaded,
// especially useful when the browser served a stale-cached bundle and
// the rendered card looks wrong.
const CARD_VERSION = '__CARD_VERSION__';
console.info(
  `%c WEATHER-STATION-CARD %c v${CARD_VERSION} `,
  'color: white; background: #ff9800; font-weight: 700; padding: 2px 6px; border-radius: 4px 0 0 4px;',
  'color: #ff9800; background: white; font-weight: 700; padding: 2px 6px; border: 1px solid #ff9800; border-radius: 0 4px 4px 0;',
);

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "weather-station-card",
  name: "Weather Station Card",
  description: "Weather-chart-card layout for past weather station measurements.",
  preview: true,
  documentationURL: "https://github.com/chriguschneider/weather-station-card",
});
