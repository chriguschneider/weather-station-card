// main.ts — integration boundary file. LitElement + Home Assistant +
// Chart.js wiring, type-checked under `tsc --strict`. HA-shaped fields
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

import locale from './locale.js';
import {
  cardinalDirectionsIcon,
  weatherIcons,
} from './const.js';
import { DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS } from './defaults.js';
import {LitElement, html} from 'lit';
import './weather-station-card-editor.js';
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
  aggregateThreeHour,
  nextForecastType,
  stationFetchKey,
  forecastFetchKey,
  forecastsEqual,
} from './forecast-utils.js';
import { overlayFromOpenMeteo, sunshineFractions } from './sunshine-source.js';
import { OpenMeteoSunshineSource } from './openmeteo-source.js';
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
} from './utils/unit-converters.js';
import { drawChartUnsafe } from './chart/orchestrator.js';
import { renderChartSkeleton } from './chart/skeleton.js';
import { cardStyles } from './chart/styles.js';
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
  // Source units captured during phase 1 (sensor extraction) so phase 2
  // can build the synthesized weather stand-in without re-deriving them.
  _sourceWindUnit: string = 'm/s';
  _sourcePressureUnit: string = 'hPa';
  _sourceTempUnit: string = '°C';

  // --- Caching / live-condition memo ---
  _liveConditionKey: string | undefined;
  _liveCondition: string | undefined;

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
  _missingSensors: string[] = [];
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
  // Lazy-cache for #10 mode-toggle.
  // deno-lint-ignore no-explicit-any
  _stationCache: Record<string, any[]> = {};
  // deno-lint-ignore no-explicit-any
  _forecastCache: Record<string, any[]> = {};
  // deno-lint-ignore no-explicit-any
  _sunshineSource: any = null;

  // 3-h pressure tendency (hPa-normalized), populated by the station
  // refresh callback. `null` until the first fetch resolves or when
  // history is insufficient — render falls back to legacy gauge icon.
  _pressureDelta3h: number | null = null;
  _pressureDeltaCache: PressureDeltaCache = { bucketMs: null, value: null };

  // --- Chart / scroll lifecycle ---
  _chartError: unknown = null;
  _chartPhase: string | null = null;
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
  // deno-lint-ignore no-explicit-any
  _initialScrollObserver: any = null;
  _initialScrollApplied: boolean = false;
  _pendingScrollFrame: number | null = null;
  _lastScrollGeneration: string | undefined;
  _scrollUxTeardown: (() => void) | null = null;
  _actionHandlerTeardown: (() => void) | null = null;
  _clockTimer: ReturnType<typeof setInterval> | null = null;
  // Cross-module shared flag (scroll-ux ↔ action-handler): a swipe /
  // drag sets this so a trailing tap doesn't fire the card-level
  // tap_action. Owned by scroll-ux but lives on the card so the
  // action-handler can read it.
  _dragMoved: boolean = false;
  // deno-lint-ignore no-explicit-any
  _teardownRegistry: any;

static getConfigElement() {
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

  return {
    ...DEFAULTS,
    // Picker preview renders this stub before any recorder data is
    // available, so the past chart would otherwise come up empty and
    // HA falls back to a description-only tile. The live now-panel
    // (driven by hass.states, no recorder dependency) gives the picker
    // an immediate, honest visual — no synthetic NaN values needed.
    // New users adding the card via the picker also benefit from a
    // richer default than just the chart row.
    show_main: true,
    show_current_condition: true,
    show_attributes: true,
    sensors: {
      temperature: findByClass('temperature') || '',
      humidity: findByClass('humidity') || '',
      illuminance: findByClass('illuminance') || '',
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
      _hass: {},
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
      forecasts: { type: Array }
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

  this.config = cardConfig;

  // Mode-aware validation. Each enabled block has its own required key:
  //   show_station    → needs sensors.temperature (the past-data chart)
  //   show_forecast   → needs weather_entity      (the future-data chart)
  // A pure forecast-only card needs no station sensors; a pure station
  // card needs no weather entity. Combination needs both.
  if (cardConfig.show_station && !cardConfig.sensors?.temperature) {
    throw new Error('Station mode needs at least sensors.temperature in the card config');
  }
  if (cardConfig.show_forecast && !cardConfig.weather_entity) {
    throw new Error('Forecast mode needs a weather.* entity in weather_entity');
  }
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
  this.language = this.config.locale || hass.selectedLanguage || hass.language || 'en';
  this.sun = (hass.states && 'sun.sun' in hass.states) ? hass.states['sun.sun'] : null;

  this._extractSensorReadings(hass);
  this._classifyLiveCondition(hass);
  this._syncDataSources(hass);
}

// Phase 1: read sensor entity states, detect source units, populate
// the per-reading instance fields, and apply the weather_entity
// attribute fallback for forecast-only mode.
_extractSensorReadings(hass: HassMain): void {
  const sensors = this.config.sensors || {};
  const stateOf = (eid: string | undefined): HassEntityState | null =>
    (eid && hass.states?.[eid]) ? hass.states[eid] : null;
  const valueOf = (eid: string | undefined): string | undefined => {
    const s = stateOf(eid);
    return s ? s.state : undefined;
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

  this.unitSpeed = this.config.units.speed || sourceWindUnit;
  this.unitPressure = this.config.units.pressure || sourcePressureUnit;
  // Stash the source units so phase 2 can build the weather stand-in
  // without re-deriving them from the sensor attributes.
  this._sourceWindUnit = sourceWindUnit as string;
  this._sourcePressureUnit = sourcePressureUnit as string;
  this._sourceTempUnit = sourceTempUnit as string;

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
  this.illuminance = valueOf(sensors.illuminance);
  this.precipitation = valueOf(sensors.precipitation);
  this.precipitation_unit = (attrOf(sensors.precipitation, 'unit_of_measurement') as string | undefined) || undefined;
  this._maybeDerivePrecipRate(hass);
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

  this._precipBuffer = appendSample(this._precipBuffer, { t, v });
  this._recomputePrecipDisplay(precipEid);
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
_recomputePrecipDisplay(entityId: string): boolean {
  this._precipBuffer = pruneOlderThan(this._precipBuffer, DEFAULT_MAX_AGE_MS);
  saveBuffer(entityId, this._precipBuffer);

  const { rate } = computeRate(this._precipBuffer, Date.now());
  // Drop the decimal once we're above 10 mm/h — a cell showing
  // `339 mm/h` reads cleaner than `339.0`, and at that intensity
  // the tenths digit is noise anyway.
  const nextValue = rate >= 10 ? rate.toFixed(0) : rate.toFixed(1);
  const changed = this.precipitation !== nextValue || this.precipitation_unit !== 'mm/h';
  this.precipitation = nextValue;
  this.precipitation_unit = 'mm/h';
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
  this.weather = this._synthesizeWeatherEntity(currentCondition);
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
  const precipUnitRaw = precipState?.attributes?.unit_of_measurement;
  const precipUnit = typeof precipUnitRaw === 'string' ? precipUnitRaw : '';
  const precipIsRate = /\/(h|hr|hour)$/i.test(precipUnit);

  return {
    sensors,
    wxState: wxEntity?.state,
    nowTemp: parseNumericSafe(this.temperature),
    luxNow: parseNumericSafe(illuminanceState?.state),
    precipRateNow: precipIsRate ? parseNumericSafe(precipState?.state) : null,
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
  const { sensors, wxState, nowTemp, luxNow, precipRateNow, lat, lon } = inputs;
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
  const condition = classifyDay({
    temp_max: nowTemp,
    temp_min: nowTemp,
    humidity: parseNumericSafe(this.humidity),
    lux_max: luxNow,
    precip_total: precipRateNow,
    wind_mean: parseNumericSafe(this.windSpeed),
    gust_max: parseNumericSafe(this.wind_gust_speed),
    dew_point_mean: parseNumericSafe(this.dew_point),
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
  const sensors = this.config.sensors || {};

  this._stationData = this._stationData || [];
  this._forecastData = this._forecastData || [];

  const wantStation = this.config.show_station !== false;
  const wantForecast = this.config.show_forecast === true && !!this.config.weather_entity;

  if (wantStation) {
    if (!this._dataSource) {
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

  // Detect missing/unavailable sensor entities for the render-time banner.
  this._missingSensors = [];
  for (const [key, eid] of Object.entries(sensors)) {
    if (!eid || typeof eid !== 'string') continue;
    const s = hass.states?.[eid];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') {
      this._missingSensors.push(`${key} (${eid})`);
    }
  }
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
      if (this._sunshineSource) {
        this._sunshineSource.abort();
        this._sunshineSource = null;
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
  }

  _refreshForecasts() {
    // normalizeForecastMode validates forecast.type (typo'd values fall
    // back to 'daily'). Station block is now coherent at hourly too —
    // MeasuredDataSource fetches with period:'hour' when the type is
    // hourly — so the previous show_station-override at hourly is gone.
    const { config: effectiveCfg } = normalizeForecastMode(this.config);
    const todayStartMs = startOfTodayMs();
    const fcType = effectiveCfg.forecast.type;
    const isToday = fcType === 'today';

    const station = effectiveCfg.show_station !== false ? (this._stationData || []) : [];
    const forecast = this._sliceForecast(effectiveCfg, fcType, isToday, todayStartMs);
    // Earlier code dropped the trailing station-today entry when it
    // carried no recorded data yet (temperature + templow + precipitation
    // all null). That removed the FR-station column from ~00:00 to ~00:15
    // every day, breaking the doubled-today framing and stranding the
    // weekday labels. The column is now kept: HA's running aggregates
    // fill in over the first quarter-hour, partial values (e.g. 1 mm
    // precip since midnight) are visible immediately, and missing fields
    // render as gaps — same convention as an offline sensor on a
    // historical day.
    this._ensureSunshineSource(effectiveCfg);

    if (isToday) {
      this._buildTodayForecasts(station, forecast);
    } else {
      this._buildDailyOrHourlyForecasts(station, forecast, fcType, effectiveCfg);
    }
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
  // 'today' caps the forecast slice at end-of-today; combination splits
  // 12 station + 12 forecast hours, forecast-only expands to 24.
  // deno-lint-ignore no-explicit-any
  _sliceForecast(effectiveCfg: any, fcType: string, isToday: boolean, todayStartMs: number): any[] {
    if (effectiveCfg.show_forecast !== true || !effectiveCfg.weather_entity) return [];
    const isHourlyish = fcType === 'hourly' || isToday;
    const slotsPerUnit = isHourlyish ? 24 : 1;
    const cap = parseInt(effectiveCfg.forecast_days, 10);
    const dayLimit = cap > 0 ? cap : (parseInt(effectiveCfg.days, 10) || 7);
    const isForecastOnly = isToday && effectiveCfg.show_station === false;
    const todayLimit = isForecastOnly ? 24 : 12;
    const limit = isToday ? todayLimit : dayLimit * slotsPerUnit;
    return filterMidnightStaleForecast(this._forecastData || [], todayStartMs)
      .slice(0, limit);
  }

  // 'today' flow:
  //   1. Apply HOURLY sunshine to each entry (per-hour value).
  //   2. 3-hour aggregate: temp/wind/etc. mean, precip+sunshine SUM,
  //      condition mode. Day-length stays at hourly semantics
  //      (1h per block × 3 = 3h denominator).
  //   3. Recompute day_length to 3 (3 hours per block).
  // deno-lint-ignore no-explicit-any
  _buildTodayForecasts(station: any[], forecast: any[]): void {
    const merged = overlayFromOpenMeteo(
      [...station, ...forecast],
      this._hass,
      this._sunshineSource,
      'hourly',
    );
    const stationLen = station.length;
    const stationWithSun = merged.slice(0, stationLen);
    const forecastWithSun = merged.slice(stationLen);
    const stationAgg = aggregateThreeHour(stationWithSun);
    const forecastAgg = aggregateThreeHour(forecastWithSun);
    // Each 3h block represents 3 hours of "day". Used as the denominator
    // for the sunshine fraction (sunshine_h / 3).
    for (const e of stationAgg) e.day_length = 3;
    for (const e of forecastAgg) e.day_length = 3;
    this._stationCount = stationAgg.length;
    this._forecastCount = forecastAgg.length;
    this.forecasts = [...stationAgg, ...forecastAgg];
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
      this._sunshineSource,
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
      this._sunshineSource,
      granularity,
      granularity === 'daily' ? cloudExp : null,
    );
    this.updateChart();
  }

  // Lazy-init the Open-Meteo source on first use, tear it down when the
  // user toggles sunshine off, and trigger a fetch when the cache is
  // stale (no-op if a fetch is already in flight). On data arrival, the
  // listener routes through _overlaySunshineOnExisting to avoid a
  // chart rebuild (which caused a bar-width flicker).
  // deno-lint-ignore no-explicit-any
  _ensureSunshineSource(effectiveCfg: any) {
    const enabled = effectiveCfg?.forecast?.show_sunshine === true;
    if (!enabled) {
      if (this._sunshineSource) {
        this._sunshineSource.abort();
        this._sunshineSource = null;
      }
      return;
    }
    const cfg = this._hass?.config;
    const lat = cfg && Number.isFinite(cfg.latitude) ? cfg.latitude : null;
    const lon = cfg && Number.isFinite(cfg.longitude) ? cfg.longitude : null;
    if (lat == null || lon == null) return;

    // 'today' uses hourly Open-Meteo data (per-hour bars), same as
    // 'hourly' mode. Daily-only modes don't need the hourly fetch.
    const includeHourly = effectiveCfg.forecast.type === 'hourly'
      || effectiveCfg.forecast.type === 'today';

    // Re-create when location or hourly-mode flag changes — the
    // includeHourly flag determines whether the request URL carries
    // `hourly=…`, so flipping it requires a fresh fetch.
    const same = this._sunshineSource?.latitude === lat
      && this._sunshineSource?.longitude === lon
      && this._sunshineSource?.includeHourly === includeHourly;
    if (!same) {
      if (this._sunshineSource) this._sunshineSource.abort();
      const days = parseInt(effectiveCfg.days, 10) || 7;
      const fcDays = parseInt(effectiveCfg.forecast_days, 10) || days;
      this._sunshineSource = new OpenMeteoSunshineSource({
        latitude: lat,
        longitude: lon,
        // +1 covers today's column when station block ends at today's
        // local midnight (the entry has datetime today 00:00).
        pastDays: Math.min(92, days + 1),
        forecastDays: Math.min(16, fcDays + 1),
        includeHourly,
      });
      this._sunshineSource.setListener((event: { ok: boolean; error?: string } | null) => {
        // On a successful refresh, re-overlay sunshine on the existing
        // forecasts and push the new values into the live chart via
        // updateChart — NOT _refreshForecasts. Going through the
        // _refreshForecasts → measureCard → drawChart path destroys and
        // rebuilds the chart, which between the first build (sunshine
        // values still null) and the rebuild (sunshine values populated)
        // caused chart.js's bar ruler to recompute the per-column slot
        // allocation. The visible result was precip bars rendering wide
        // for a moment and then snapping to their final half-column
        // width once sunshine landed — read by the user as a "the bars
        // start twice as wide and then narrow" artefact. Keeping the
        // same Chart instance and only mutating dataset data sidesteps
        // the ruler recompute entirely; widths stay correct from frame 1.
        if (event?.ok) this._overlaySunshineOnExisting();
      });
    }
    // Fire-and-forget — the listener handles the redraw on completion.
    this._sunshineSource.ensureFresh();
  }

  attachResizeObserver() {
    // Section-grid resizes fire many ResizeObserver ticks per frame.
    // measureCard → drawChart destroys + recreates the Chart.js instance,
    // and doing that synchronously dozens of times confuses both Chart.js
    // and HA's grid layout — the card briefly drops out of the render tree
    // and only reappears after a hard reload. Coalesce into one rAF tick.
    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this.measureCard();
      });
    });
    const card = this.shadowRoot?.querySelector('ha-card');
    if (card) {
      this.resizeObserver.observe(card);
    }
  }

  detachResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
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
  // used to rebuild the Chart.js instance with a slightly different
  // canvas size, and the bar ruler re-allocated per-column slot
  // widths each time — visible to the user as bars starting wide
  // then narrowing once HA's layout settled. Chart.js's own
  // responsive:true ResizeObserver handles the canvas-size change
  // for us; the only reason to drawChart() here is when forecastItems
  // changed (different dataset length needs a fresh chart) or no
  // chart exists yet.
  if (this.forecastChart && this.forecastItems === prevForecastItems) {
    return;
  }
  this.drawChart();
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

  if (changedProperties.has('weather')) {
    this.updateChart();
  }
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
  const STATION_KEYS = ['sensors', 'days', 'show_station', 'forecast.type'];
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
}

_teardownForecast() {
  if (this._forecastUnsubscribe) { this._forecastUnsubscribe(); this._forecastUnsubscribe = null; }
  this._forecastSource = null;
  this._forecastDataReady = false;
  this._forecastData = [];
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
  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
  const dateTime = forecast.map((d) => d.datetime);
  const fcType = config.forecast?.type;
  const { tempHigh, tempLow } = hourlyTempSeries(forecast, {
    roundTemp: config.forecast.round_temp === true,
    // Hourly / today: derive high/low from a 3-hour rolling window so
    // the second blue spline shows up consistently across station AND
    // forecast halves, regardless of whether the provider emits a
    // per-hour `templow` (meteoswiss doesn't; openmeteo-hourly does).
    windowMode: fcType === 'hourly' || fcType === 'today',
  });
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

  render({config, _hass, weather} = this) {
    if (!config || !_hass) {
      return html``;
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
    // 'today' is 3-hour-aggregated to exactly 8 bars (00-02, 03-05,
    // …, 21-23) so the default 8-bar viewport fits the whole day
    // with no scroll.
    const visibleBars = parseInt(config.forecast.number_of_forecasts, 10) || 0;
    const totalBars = (this.forecasts ?? []).length;
    const scrolling = visibleBars > 0 && totalBars > visibleBars;
    const contentWidthPct = scrolling ? (totalBars / visibleBars) * 100 : 100;

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
          ${this.renderErrorBanner()}
          ${this.renderMain()}
          ${this.renderAttributes()}
          ${this._allExpectedDataReady() ? html`
          <div class="forecast-scroll-block">
            <div class="forecast-scroll ${scrolling ? 'scrolling' : ''}">
              <div class="forecast-content" style="width: ${contentWidthPct}%">
                <div class="chart-container">
                  <div id="forecastChart"></div>
                </div>
                ${this.renderForecastConditionIcons()}
                ${this.renderWind()}
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
          </div>
          ` : (() => {
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
          })()}
        </div>
      </ha-card>
    `;
  }

renderErrorBanner() {
  const errors = [];
  if (this._stationError) {
    errors.push(`Statistics fetch failed: ${this._stationError}`);
  }
  if (this._forecastError) {
    errors.push(`Forecast unavailable: ${this._forecastError}`);
  }
  if (this._chartError) {
    errors.push(`Chart render failed: ${this._chartError}`);
  }
  if (this._missingSensors?.length) {
    errors.push(`Sensors unavailable: ${this._missingSensors.join(', ')}`);
  }
  if (!errors.length) return html``;
  return html`
    <div style="background: var(--error-color, #b71c1c); color: white; padding: 8px 12px; margin: 8px; border-radius: 4px; font-size: 13px;">
      ${errors.map((e) => html`<div>${e}</div>`)}
    </div>
  `;
}

renderMain({ config, sun, weather, temperature } = this) {
  if (config.show_main === false)
    return html``;

  const use12HourFormat = config.use_12hour_format;
  // Live-block sub-toggles default to ON (opt-out): if the parent
  // show_main is enabled, every sub-cell appears unless the user has
  // explicitly turned it off in YAML / editor.
  const showTime = config.show_time !== false;
  const showDay = config.show_day !== false;
  const showDate = config.show_date !== false;
  const showCurrentCondition = config.show_current_condition !== false;
  const showTemperature = config.show_temperature !== false;
  const showSeconds = config.show_time_seconds === true;

  let roundedTemperature = parseFloat(temperature);
  if (!isNaN(roundedTemperature) && roundedTemperature % 1 !== 0) {
    roundedTemperature = Math.round(roundedTemperature * 10) / 10;
  }

  const iconHtml = html`<ha-icon icon="${this.getWeatherIcon(weather.state, sun.state)}"></ha-icon>`;

  const updateClock = () => {
    const currentDate = new Date();
    const timeOptions = {
      hour12: use12HourFormat,
      hour: 'numeric',
      minute: 'numeric',
      second: showSeconds ? 'numeric' : undefined
    };
    const currentTime = currentDate.toLocaleTimeString(this.language, timeOptions as Intl.DateTimeFormatOptions);
    const currentDayOfWeek = currentDate.toLocaleString(this.language, { weekday: 'long' }).toUpperCase();
    const currentDateFormatted = currentDate.toLocaleDateString(this.language, { month: 'long', day: 'numeric' });

    const mainDiv = this.shadowRoot?.querySelector('.main');
    if (mainDiv) {
      const clockElement = mainDiv.querySelector('#digital-clock');
      if (clockElement) {
        clockElement.textContent = currentTime;
      }
      if (showDay) {
        const dayElement = mainDiv.querySelector('.date-text.day');
        if (dayElement) {
          dayElement.textContent = currentDayOfWeek;
        }
      }
      if (showDate) {
        const dateElement = mainDiv.querySelector('.date-text.date');
        if (dateElement) {
          dateElement.textContent = currentDateFormatted;
        }
      }
    }
  };

  updateClock();

  if (this._clockTimer) {
    clearInterval(this._clockTimer);
    this._clockTimer = null;
  }
  if (showTime) {
    this._clockTimer = setInterval(updateClock, 1000);
  }

  return html`
    <div class="main">
      ${iconHtml}
      <div>
        <div>
          ${showTemperature ? html`${roundedTemperature}<span>${this.getUnit('temperature')}</span>` : ''}
          ${showCurrentCondition ? html`
            <div class="current-condition">
              <span>${this.ll(weather.state)}</span>
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

// Per-row template helpers. Each row is a single conditional render —
// clearer than 4-row nested ternaries and lets ESLint's
// no-nested-conditional rule apply at per-row granularity.

_climateRow_humidity(show: boolean, humidity: unknown) {
  if (!show || humidity === undefined) return html``;
  return html`<ha-icon icon="hass:water-percent"></ha-icon> ${humidity} %<br>`;
}
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
  return html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${dPressure} ${unitLabel}</span><br>`;
}
_climateRow_dewpoint(show: boolean, dew_point: unknown) {
  if (!show || dew_point === undefined) return html``;
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
  return html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${dew_point} ${displayUnit}</span><br>`;
}
_climateRow_precip(show: boolean, hasValue: boolean, precipitation: unknown, precipitation_unit: unknown) {
  if (!show || !hasValue) return html``;
  const unitSuffix = precipitation_unit ? ' ' + precipitation_unit : '';
  // When the value is a mm/h rate (either a native rate sensor or the
  // cumulative→rate derivation in precip-rate.ts), map intensity to a
  // matching icon. Other units (probability `%`, raw `mm`, …) keep the
  // legacy rainy icon since their numeric magnitude isn't a rate.
  const isRate = precipitation_unit === 'mm/h';
  const rate = isRate ? parseFloat(String(precipitation)) : NaN;
  const icon = isRate && Number.isFinite(rate) ? precipIcon(rate) : 'hass:weather-rainy';
  return html`<ha-icon icon="${icon}"></ha-icon> ${precipitation}${unitSuffix}<br>`;
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

  return html`<div title=${title} aria-label=${title}><ha-icon
      icon="hass:${out.iconShape}"
    ></ha-icon> ${valueText}</div>`;
}
_sunRow_sunshine(show: boolean, sunshineHours: number | undefined) {
  if (!show || sunshineHours === undefined) return html``;
  return html`<div><ha-icon icon="hass:weather-sunny"></ha-icon> ${sunshineHours} h</div>`;
}
// deno-lint-ignore no-explicit-any
_sunRow_sunPanel(show: boolean, sun: any, language: string) {
  if (!show || sun === undefined) return html``;
  return html`<div>${this.renderSun({ sun, language } as unknown as this)}</div>`;
}

// deno-lint-ignore no-explicit-any
_windRow_direction(show: boolean, windDirection: any) {
  if (!show || windDirection === undefined) return html``;
  return html`<ha-icon icon="hass:${this.getWindDirIcon(windDirection)}"></ha-icon> ${this.getWindDir(windDirection)} <br>`;
}
// deno-lint-ignore no-explicit-any
_windRow_speed(show: boolean, dWindSpeed: any) {
  if (!show || dWindSpeed === undefined) return html``;
  const unitLabel = this.unitSpeed ? this.ll('units')[this.unitSpeed] : '';
  return html`<ha-icon icon="hass:weather-windy"></ha-icon>
    ${dWindSpeed} ${unitLabel} <br>`;
}
// deno-lint-ignore no-explicit-any
_windRow_gust(show: boolean, wind_gust_speed: any) {
  if (!show || wind_gust_speed === undefined) return html``;
  const unitLabel = this.unitSpeed ? this.ll('units')[this.unitSpeed] : '';
  return html`<ha-icon icon="hass:weather-windy-variant"></ha-icon>
    ${this._convertWindSpeed(parseFloat(wind_gust_speed))} ${unitLabel}`;
}

// Climate group: humidity / pressure / dew-point / precipitation. Returns
// nothing-html when every row's toggle is off or backing value is empty.
// deno-lint-ignore no-explicit-any
_renderClimateGroup({ showHumidity, humidity, showPressure, dPressure, pressureDelta3h, showDewpoint, dew_point, showPrecipitation, precipitation, precipitation_unit, hasPrecipValue }: any) {
  const anyVisible = (showHumidity && humidity !== undefined) || (showPressure && dPressure !== undefined) || (showDewpoint && dew_point !== undefined) || (showPrecipitation && hasPrecipValue);
  if (!anyVisible) return html``;
  return html`
    <div>
      ${this._climateRow_humidity(showHumidity, humidity)}
      ${this._climateRow_pressure(showPressure, dPressure, pressureDelta3h)}
      ${this._climateRow_dewpoint(showDewpoint, dew_point)}
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

  // All live-block sub-toggles default to ON (opt-out): once the
  // master show_attributes is enabled, every available data point
  // appears unless explicitly turned off in YAML / editor.
  // Display the configured precipitation sensor's value as-is with
  // its native unit. For users who want a live mm/h rate from a
  // cumulative sensor: configure a Derivative helper in HA (see
  // GitHub issue) and wire its output sensor here. Card-side
  // auto-derivation was tried and removed — fragile, see issue.
  // Site lat/lon for the sun-strength row's clear-sky reference. Pulled
  // from `hass.config` (Home Assistant's configured location) rather
  // than the card config — chrigu's setup wires it once and the live
  // panel inherits. Missing/non-finite values fall through to the
  // 110 000 lx constant inside `classifySunStrength`.
  const haCfg = this._hass?.config as { latitude?: number; longitude?: number } | undefined;
  const lat = haCfg && Number.isFinite(haCfg.latitude) ? haCfg.latitude as number : null;
  const lon = haCfg && Number.isFinite(haCfg.longitude) ? haCfg.longitude as number : null;

  const ctx = {
    showHumidity: config.show_humidity !== false,
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

  return html`
    <ha-icon icon="mdi:weather-sunset-up"></ha-icon>
      ${new Date(sun.attributes.next_rising).toLocaleTimeString(language, timeOptions)}<br>
    <ha-icon icon="mdi:weather-sunset-down"></ha-icon>
      ${new Date(sun.attributes.next_setting).toLocaleTimeString(language, timeOptions)}
  `;
}

renderForecastConditionIcons({ config, forecastItems, sun } = this) {
  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];

  if (config.forecast.condition_icons === false) {
    return html``;
  }

  return html`
    <div class="conditions">
      ${forecast.map((item) => {
        const forecastTime = new Date(item.datetime);
        const sunriseTime = new Date(sun.attributes.next_rising);
        const sunsetTime = new Date(sun.attributes.next_setting);

        // Adjust sunrise and sunset times to match the date of forecastTime
        const adjustedSunriseTime = new Date(forecastTime);
        adjustedSunriseTime.setHours(sunriseTime.getHours());
        adjustedSunriseTime.setMinutes(sunriseTime.getMinutes());
        adjustedSunriseTime.setSeconds(sunriseTime.getSeconds());

        const adjustedSunsetTime = new Date(forecastTime);
        adjustedSunsetTime.setHours(sunsetTime.getHours());
        adjustedSunsetTime.setMinutes(sunsetTime.getMinutes());
        adjustedSunsetTime.setSeconds(sunsetTime.getSeconds());

        let isDayTime;

        if (config.forecast.type === 'daily') {
          // For daily forecast, assume it's day time
          isDayTime = true;
        } else {
          // For other forecast types, determine based on sunrise and sunset times
          isDayTime = forecastTime >= adjustedSunriseTime && forecastTime <= adjustedSunsetTime;
        }

        // isDayTime stays referenced so the var is used; the day/night
        // icon swap moves into ha-icon naming when we re-add per-time
        // resolution. For now both day and night use the canonical
        // weatherIcons mapping.
        void isDayTime;
        const iconHtml = html`<ha-icon icon="${this.getWeatherIcon(item.condition, sun.state)}"></ha-icon>`;

        return html`
          <div class="forecast-item">
            ${iconHtml}
          </div>
        `;
      })}
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

  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
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
            ${showArrow && hasBearing ? html`
              <ha-icon class="wind-icon" icon="hass:${this.getWindDirIcon(item.wind_bearing)}"></ha-icon>
            ` : ''}
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
      const visibleBars = parseInt(fcfg.number_of_forecasts, 10) || 0;
      if (totalBars > 0 && visibleBars > 0 && totalBars > visibleBars) {
        const expectedScrollWidth = wrapper.clientWidth * (totalBars / visibleBars);
        // Tolerance accounts for sub-pixel rounding + browser layout
        // quantisation — but stays well under the smallest meaningful
        // mode-to-mode width delta (daily≈583px ↔ hourly≈7689px).
        if (Math.abs(wrapper.scrollWidth - expectedScrollWidth) > expectedScrollWidth * 0.1) {
          return false;
        }
      }
      const scrollLeft = computeInitialScrollLeft({
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
