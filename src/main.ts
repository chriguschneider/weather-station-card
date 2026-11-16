// main.ts — the <weather-station-card> element, the Home Assistant boundary
// (ADR-0004). `any` only where the HA frontend shape is undocumented
// (synthesised `weather`, editor-callback payloads); the modules it imports
// are strictly typed.

import locale, { ensureLocaleLoaded, resolveLocaleKey } from './locale.js';
import { weatherIcons } from './const.js';
import { DEFAULTS, DEFAULTS_FORECAST } from './defaults.js';
import { validateConfig } from './config-validation.js';
import {LitElement, html, nothing, svg} from 'lit';
import {MDI_PATHS} from './icons/mdi-paths.js';
import type { HassLike } from './data-source.js';
import { classifyDay, clearSkyLuxAt } from './condition-classifier.js';
import { resolveTemp2Color } from './format-utils.js';
import { resolveCssVar } from './utils/resolve-css-var.js';
import { getThemeTokens } from './utils/theme-tokens.js';
import {
  hourlyTempSeries,
  effectiveVisibleBars,
  nextForecastType,
} from './forecast-utils.js';
import { sunshineFractions } from './sunshine-source.js';
import {
  buildForecastEntries,
  overlayOnEntries,
  planSources,
  type PipelineContext,
  type SourcePlan,
} from './forecast-pipeline.js';
import { normalizeConfig, type CardConfig } from './card-config.js';
import { pastFromOpenMeteo } from './past-source.js';
import type { LiveSource } from './live-source.js';
import { extractSensorReadings, liveSourcesOf, precipRateReading, type Reading, type SensorReadings, type StateLike, type StatesLike } from './sensor-readings.js';
import { AUTO_PICK_KEYS, autoPickSensor } from './sensor-match.js';
import type { LegendItem } from './chart-legend.js';
import { SourcesPopup, type SourceLine } from './sources-popup.js';
import { resolveLocation } from './location.js';
import { PROBABILITY_EXTRA_BOTTOM_PAD } from './chart/plugins/precip-label.js';
import { safeQuery } from './utils/safe-query.js';
import { parseNumericSafe } from './utils/numeric.js';
import { setupScrollUx } from './scroll-ux.js';
import { setupActionHandler } from './action-handler.js';
import { TeardownRegistry } from './teardown-registry.js';
import { PrecipRateController, type CounterState, type PrecipDisplay } from './precip-rate-controller.js';
import {
  toMetersPerSecond,
  toCelsius,
  toMillimeters,
  isPrecipRateUnit,
  formatPrecipDisplay,
  luxScaleFor,
} from './utils/unit-converters.js';
import { buildForecastChart, ChartBuildError, type ChartInputs } from './chart/orchestrator.js';
import { DataSourceController } from './data-source-controller.js';
import { sanitizeForecastEntries } from './chart/sanitize.js';
import { cardStyles } from './chart/styles.js';
import { getDateTimeFormat } from './utils/intl-cache.js';
import { isSunUp } from './moon.js';
import { classifyNextRain, formatCheckedUntil, formatNextRain, nextRainIcon } from './next-rain.js';
import { parseZeroDegreeCurve, ZeroDegreePopup, type ZeroDegreePoint } from './zero-degree-popup.js';
import { attrEntity, type LiveHass, type LivePanelCtx } from './live-panel/context.js';
import { renderAttributes as renderLiveAttributes } from './live-panel/attributes.js';
import { renderSun as renderLiveSun, renderMoonLine } from './live-panel/sun-rows.js';
import { renderForecastWind, spriteIcon } from './live-panel/wind-rows.js';
import { zeroDegreeElevation, zeroDegreeFormat, zeroDegreePlace } from './live-panel/zero-degree-rows.js';
import {
  renderAvailabilityNote,
  renderErrorBanner,
  renderNoWeather,
  renderOnboarding,
  type BannerCtx,
} from './render/banners.js';
import { renderDebugPanel as renderDebugView } from './render/debug-panel.js';
import {
  forecastRowsGenKey,
  renderForecastBlock,
  renderScrollTimeline as renderTimeline,
} from './render/forecast-block.js';
import {
  entityName,
  sourceLabelFor,
  sourceLegend,
  sourceLines,
  sourcesAlert,
  type EntityNameHass,
} from './render/source-lines.js';import {
  dayPagerRealignLeft,
  initialScrollDataReady,
  initialScrollGeneration,
  resolveInitialScrollLeft,
} from './render/scroll-position.js';
import { calendarFor, type Calendar } from './utils/time-zone.js';

/** Card-side extension of `HassLike` with the locale fields the `Intl`
 *  formatters read. */
interface HassMain extends HassLike {
  language?: string;
  selectedLanguage?: string;
  // HA's running version, read only by the `debug: true` panel; HassLike
  // narrows `config` to lat/lon, so widen it here.
  config?: HassLike['config'] & { version?: string };
}

/** A single HA entity state from `hass.states[eid]`. */
interface HassEntityState {
  state: string;
  attributes?: Record<string, unknown>;
}

/** Precipitation input for the live-condition classifier: a rate plus its
 *  unit, or a null rate when the sensor cannot express one.
 *
 *  A dedicated `sensors.precipitation_rate` entity (#253) is authoritative
 *  (mm/h), even with a bare `mm` unit: `toMillimeters` only reads the length
 *  base. A cumulative counter alone yields null; its total read as a rate
 *  would classify a dry day as 'rainy'. */
function resolvePrecipRateInput(
  rateState: HassEntityState | null | undefined,
  counterState: HassEntityState | null | undefined,
): { precipRateNow: number | null; precipUnit: string } {
  const state = rateState ?? counterState;
  const unitRaw = state?.attributes?.unit_of_measurement;
  const precipUnit = typeof unitRaw === 'string' ? unitRaw : '';
  const isRate = rateState ? true : isPrecipRateUnit(precipUnit);
  return {
    precipRateNow: isRate ? parseNumericSafe(state?.state) : null,
    precipUnit,
  };
}

declare global {
  interface Window {
    customCards?: any[];
  }
}

// Weather-entity states the live panel may borrow when the station has
// no illuminance sensor to measure cloud cover itself.
const SKY_STATES = new Set(['sunny', 'clear-night', 'partlycloudy', 'cloudy']);

// In-bundle icon sprite (ADR-0018), built once at module load; MDI_PATHS is
// a static import, so the symbol list cannot change at runtime.
const ICON_SPRITE_TEMPLATE = html`<svg class="wsc-sprite" aria-hidden="true">${
  Object.entries(MDI_PATHS).map(([name, path]) =>
    svg`<symbol id="wsc-i-${name}" viewBox="0 0 24 24"><path d="${path}"></path></symbol>`)
}</svg>`;

// Reactive Lit properties are listed in `static get properties()` below.
class WeatherStationCard extends LitElement {
  // `hass` is a setter that stamps `_hass` and derives the sensor values.
  _hass: HassMain | null = null;
  config: any = null;
  language: string = 'en';
  // Every day boundary and displayed time goes through this (ADR-0030).
  // The browser's zone until the first `set hass` brings the server's.
  calendar: Calendar = calendarFor();
  // The `sun.sun` state, kept only as a render tick: a new object every
  // attribute update (~1/min) schedules a Lit update that refreshes the
  // computed sun and moon lines. Nothing reads its attributes;
  // sun and moon come from the card location (ADR-0022).
  sun: any = null;
  weather: any = null;
  temperature: any;
  humidity: any;
  pressure: any;
  windSpeed: any;
  windDirection: any;
  forecastChart: any = null;
  forecastItems: any;
  forecasts: any[] | null = null;

  uv_index: any;
  dew_point: any;
  wind_gust_speed: any;
  illuminance: any;
  precipitation: any;
  precipitation_unit: string | undefined;
  // Zero-degree level (0 °C isotherm altitude): sensor-only, unit (m or ft)
  // from the entity.
  zero_degree_level: any;
  zero_degree_unit: string | undefined;
  zero_degree_48h_level: any;
  zero_degree_48h_unit: string | undefined;
  zero_degree_48h_change: number | undefined;
  // Parsed `forecast` attribute of the 48 h sensor (#330); null = no
  // popup, the rows open more-info. Re-parsed only when HA hands over a
  // new attribute array, so the identity stays stable for Lit.
  zero_degree_curve: ZeroDegreePoint[] | null | undefined;
  _zeroDegreeCurveRaw: unknown;
  _zeroDegreePopup: ZeroDegreePopup | null = null;
  _sourcesPopup: SourcesPopup | null = null;
  // Origin of each live value, keyed by sensor key (ADR-0031); read
  // only when `show_sources` is on.
  _liveSources: Record<string, LiveSource | undefined> = {};
  zero_degree_48h_at: string | undefined;
  // Display-ready strings, not the raw state object: a fresh object per
  // hass tick would defeat Lit's value comparison (ADR-0017).
  next_rain_text: string | undefined;
  next_rain_icon: string | undefined;
  next_rain_title: string | undefined;
  // Only runs while the row shows a minute countdown.
  _nextRainTimer: ReturnType<typeof setInterval> | null = null;
  // Counter → mm/h derivation: buffer, entity and its 30-s tick
  // (precip-rate-controller.ts). Created in the constructor.
  _precipRate: PrecipRateController;
  unitSpeed: string | undefined;
  unitPressure: string | undefined;
  unitPrecip: string | undefined;
  // Source units captured in phase 1 for the synthesised weather stand-in.
  _sourceWindUnit: string = 'm/s';
  _sourcePressureUnit: string = 'hPa';
  _sourceTempUnit: string = '°C';
  // Last extraction (value, unit and source per key); the classifier
  // reads units from it, the popup the sources via _liveSources.
  _readings: SensorReadings | null = null;
  // Precip source base unit ('mm' | 'in'), without any /h suffix.
  _sourcePrecipUnit: string = 'mm';

  _liveConditionKey: string | undefined;
  _liveCondition: string | undefined;
  // True when the classifier picked the live condition and the sun is
  // down at the card location; the main icon swaps partlycloudy for its
  // night glyph.
  _liveNight = false;

  // eid → hass.states[eid] at the end of the last full `set hass` pass. HA
  // state objects are immutable, so identical references mean "unchanged" and
  // the three phases are skipped (ADR-0017). null forces the full path (after
  // setConfig or a data-source teardown).
  _watchedStatesSnapshot: Record<string, unknown> | null = null;

  // Station / forecast / Open-Meteo sources, calendar sync, pressure
  // delta and the availability scan. Created in the constructor.
  _sources: DataSourceController;
  // Column counts of the last merge; the chart frames the boundary with them.
  _stationCount: number = 0;
  _forecastCount: number = 0;
  /** entityId → last parseable state, the fallback when a sensor is unavailable.
   *  In-memory only. */
  _lastGoodStates: Record<string, string> = {};
  /** Advisory config-schema warnings from `validateConfig` (unknown keys,
   *  wrong-typed values), shown via `renderErrorBanner()`; never blocks render. */
  _configWarnings: string[] = [];
  /** The config exactly as HA handed it to `setConfig`. The mode toggle
   *  re-enters setConfig from this, not from `this.config`: the normalized
   *  object carries every `show_*` default, which validateConfig would read as
   *  user-set toggles next to `attributes_layout`. */
  _rawConfig: Record<string, unknown> | null = null;
  /** Last forecast.type the chart block was rendered with (data ready); decides
   *  the animation class. */
  _lastForecastType: string | undefined = undefined;
  /** True once the chart block has rendered with data and the start animation
   *  has played out (see _chartMountAnimationTimer). Later mounts get the
   *  view-change cross-fade instead of replaying the start animation. */
  _chartMountAnimationPlayed: boolean = false;
  /** Pending timer that flips _chartMountAnimationPlayed; cleared in
   *  disconnectedCallback. */
  _chartMountAnimationTimer: number | null = null;
  _initialChartBuilt: boolean = false;
  // Set when `forecasts` was rebuilt from source data; measureCard's skip path
  // (chart alive, same column count) consumes it via updateChart() so a
  // same-shape refresh still reaches the canvas.
  _forecastsDirty: boolean = false;
  _chartError: string | null = null;
  // Set when a `_refreshForecasts` pass throws on malformed source
  // data. Surfaced through `renderErrorBanner()`; cleared by the next
  // clean `_refreshForecasts`.
  _refreshError: string | null = null;
  // Set when a synchronous render section throws; cleared at the top of every
  // render() so a healed section stops reporting. Feeds renderErrorBanner() so
  // the card degrades to the banner instead of a blank card.
  _sectionError: string | null = null;
  // Set when setConfig sees an incomplete config (a block is enabled but its
  // required key is missing). Not thrown: a thrown setConfig kills the card
  // before its editor can load. Shown via renderErrorBanner().
  _configError: string | null = null;
  // True inside the card-config dialog's live preview (hui-card-preview /
  // hui-dialog-edit-card / hui-card-element-editor ancestor), detected once in
  // connectedCallback. The chart pipeline gets it as `inPreview`.
  _isInPreview: boolean = false;
  resizeObserver: any = null;
  resizeInitialized: boolean = false;
  _resizeRaf: number | null = null;
  // The ha-card the ResizeObserver observes. Lit can swap <ha-card> when the
  // render branch changes, so the observer must follow the live element.
  _resizeObservedCard: Element | null = null;
  _initialScrollObserver: any = null;
  _initialScrollApplied: boolean = false;
  _pendingScrollFrame: number | null = null;
  _lastScrollGeneration: string | undefined;
  _scrollUxTeardown: (() => void) | null = null;
  // Two-phase forecast render (ADR-0016): rows are placeholders on the first
  // paint of a chart generation, filled post-paint. Holds the generation key
  // (forecast.type + column count) whose rows are complete.
  _forecastRowsReadyGen: string = '';
  _forecastRowsRevealHandle: number | null = null;
  _actionHandlerTeardown: (() => void) | null = null;
  _clockTimer: ReturnType<typeof setInterval> | null = null;
  // Shared by scroll-ux and action-handler: a swipe/drag sets it so a trailing
  // tap doesn't fire tap_action. Lives on the card so both can read it.
  _dragMoved: boolean = false;
  // Stable listener identity, so Lit doesn't rebind the mode toggle's
  // click handler on every render.
  _onModeToggle = (ev: Event): void => this._onModeToggleClick(ev);
  _teardownRegistry: any;

// HA awaits the dynamic import; it splits the editor into its own chunk so
// card viewers never pay its parse cost.
static async getConfigElement() {
  await import('./weather-station-card-editor.js');
  return document.createElement("weather-station-card-editor");
}

// Throwing makes HA fall back to the YAML editor instead of rendering an
// editor that can't represent the config. Only structural problems; the
// runtime checks live in setConfig.
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
  // Auto-detect station sensors with the matcher the editor's pickers
  // use (sensor-match.ts), so every pick is also a picker candidate.
  const ids = allEntities || [];
  const pick = (key: string): string => autoPickSensor(key, ids, hass as Parameters<typeof autoPickSensor>[2]);

  // A freshly-added card gets a fuller layout than bare DEFAULTS; the live
  // panel needs no recorder data, so the picker preview is useful at once.
  // Sensors and the weather entity are auto-detected; only deltas are listed.
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
    show_zero_degree_level: true,
    show_zero_degree_level_48h: true,
    show_next_rain: true,
    days: 5,
    forecast_days: 5,
    weather_entity: weatherEntity,
    forecast: {
      ...DEFAULTS_FORECAST,
      show_sunshine: true,
    },
    // Key order mirrors the editor's picker grid (render-sensors.ts).
    sensors: Object.fromEntries(AUTO_PICK_KEYS.map((key) => [key, pick(key)])),
  };
}

  static get properties() {
    return {
      // Deliberately non-reactive: HA replaces the hass object 2–5×/s, and a
      // reactive `_hass` would schedule a full render per tick. Templates read the
      // value-compared props below instead (ADR-0017).
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
      // Read straight off `this` by renderAttributes, so reactive in their own
      // right (ADR-0017). Values are strings / undefined, so Lit's default !==
      // check is a value comparison.
      uv_index: { attribute: false },
      dew_point: { attribute: false },
      wind_gust_speed: { attribute: false },
      illuminance: { attribute: false },
      precipitation: { attribute: false },
      precipitation_unit: { attribute: false },
      zero_degree_level: { attribute: false },
      zero_degree_unit: { attribute: false },
      zero_degree_48h_level: { attribute: false },
      zero_degree_48h_unit: { attribute: false },
      zero_degree_48h_change: { attribute: false },
      zero_degree_curve: { attribute: false },
      zero_degree_48h_at: { attribute: false },
      next_rain_text: { attribute: false },
      next_rain_icon: { attribute: false },
      next_rain_title: { attribute: false },
      unitSpeed: { attribute: false },
      unitPressure: { attribute: false },
      unitPrecip: { attribute: false },
      // The availability lists and the pressure delta live in
      // `_sources`, which requests an update only when one changed.
    };
  }

// The shape is user-controlled, hence `any`; normalizeConfig applies the
// defaults.
setConfig(config: any) {
  const cardConfig: CardConfig = normalizeConfig(config);

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
  this._rawConfig = config;

  // Advisory config-schema check: unknown keys and wrong-typed values surface
  // as a banner. It never throws; the card still renders.
  this._configWarnings = validateConfig(config);
  // A changed `time_zone` / `location.time_zone` must reach the calendar
  // without waiting for the next hass push.
  if (this._hass) {
    this._sources.syncCalendar((this._hass.config as { time_zone?: unknown } | undefined)?.time_zone);
  }

  // Mode-aware completeness: show_station needs sensors.temperature,
  // show_forecast needs weather_entity. A miss is recorded, not thrown: a
  // thrown setConfig would kill a freshly-added card before its editor loads.
  const configErrors: string[] = [];
  // The temperature-sensor requirement is waived when the Open-Meteo
  // no-station fallback is active (ADR-0015): the past block is filled
  // from Open-Meteo, so there is no missing-data problem to warn about.
  if (
    cardConfig.show_station
    && !cardConfig.sensors?.temperature
    && !pastFromOpenMeteo(cardConfig)
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

// HA fires this 2–5×/s on any entity update. Phases: 1 _extractSensorReadings
// (readings + units), 2 _classifyLiveCondition (live condition + synthesised
// weather), 3 _sources.sync (subscriptions + missing-sensor scan).
set hass(hass: HassMain) {
  this._hass = hass;
  this._sources.syncCalendar((hass.config as { time_zone?: unknown } | undefined)?.time_zone);
  const lang = this.config.locale || hass.selectedLanguage || hass.language || 'en';
  if (lang !== this.language) {
    this.language = lang;
    // English ships eagerly; other languages are lazy chunks. Re-render once
    // the chunk lands so the right strings replace the en fallback.
    if (lang !== 'en' && lang.split('-')[0] !== 'en') {
      void ensureLocaleLoaded(lang).then(() => {
        this._refreshNextRain();
        this.requestUpdate();
      });
    }
    this._refreshNextRain();
  }

  // Entity-delta gate (ADR-0017): if no watched entity changed, skip all three
  // phases. The data sources still get the fresh hass for their next WS call.
  if (this._watchedStatesUnchanged(hass)) {
    this._sources.setHass(hass);
    return;
  }

  this.sun = (hass.states && 'sun.sun' in hass.states) ? hass.states['sun.sun'] : null;

  this._extractSensorReadings(hass);
  this._refreshNextRain();
  this._classifyLiveCondition(hass);
  this._sources.sync(hass);
  // Initial merge so forecasts is at least an empty array (not undefined).
  if (!this.forecasts) this._refreshForecasts();
  this._watchedStatesSnapshot = this._captureWatchedStates(hass);
}

// Every entity whose change re-renders the card: the configured sensors, the
// weather entity and sun.sun. sun.sun is only the render tick for the
// computed sun and moon lines (ADR-0022). Anything else is ignored.
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
  // First full pass must have completed — it seeds `forecasts` with
  // at least an empty merge.
  if (!this.forecasts) return false;
  // Never skip data-source (re)creation: a config change tears
  // a source down and re-enters via `this.hass = this._hass` with the
  // SAME hass object — phase 3 must run then to rebuild the source.
  // (The teardowns also null the snapshot; this guard is the backstop
  // for any future path that drops a source without doing that.)
  if (!this._sources.sourcesMatchConfig()) return false;
  // HA state objects are immutable: an unchanged entity keeps its reference,
  // so reference equality is an exact "unchanged" test.
  for (const eid of Object.keys(snapshot)) {
    if (hass.states?.[eid] !== snapshot[eid]) return false;
  }
  return true;
}

// Phase 1: read the live readings (value, unit and source per key,
// src/sensor-readings.ts) into the reactive per-reading fields, then
// turn the precipitation state into the live rate.
_extractSensorReadings(hass: HassMain): void {
  const sensors = this.config.sensors || {};
  const r = extractSensorReadings({
    sensors,
    states: hass.states as StatesLike,
    weatherEntity: this.config.weather_entity,
    lastGood: this._lastGoodStates,
  });
  this._readings = r;

  // Target units come from config and default to the source units.
  // Keeping the two apart is what the display conversions compare.
  this.unitSpeed = this.config.units.speed || r.units.wind;
  this.unitPressure = this.config.units.pressure || r.units.pressure;
  this.unitPrecip = this.config.units.precipitation || r.units.precipBase;
  this._sourceWindUnit = r.units.wind;
  this._sourcePressureUnit = r.units.pressure;
  this._sourceTempUnit = r.units.temperature;
  this._sourcePrecipUnit = r.units.precipBase;

  this.temperature = r.temperature.value;
  this.humidity = r.humidity.value;
  this.pressure = r.pressure.value;
  this.uv_index = r.uv_index.value;
  this.windSpeed = r.wind_speed.value;
  this.dew_point = r.dew_point.value;
  this.wind_gust_speed = r.gust_speed.value;
  this.windDirection = r.wind_direction.value;
  this.illuminance = r.illuminance.value;
  this.precipitation = r.precipitation.value;
  this.precipitation_unit = r.precipitation.unit;
  this.zero_degree_level = r.zero_degree_level.value;
  this.zero_degree_unit = r.zero_degree_level.unit;
  this.zero_degree_48h_level = r.zero_degree_level_48h.value;
  this.zero_degree_48h_unit = r.zero_degree_level_48h.unit;

  const attrOf = (eid: string | undefined, attr: string): unknown =>
    eid ? hass.states?.[eid]?.attributes?.[attr] : undefined;
  const rawChange = attrOf(sensors.zero_degree_level_48h, 'change');
  const changeNum = rawChange === undefined || rawChange === null || rawChange === '' ? NaN : Number(rawChange);
  this.zero_degree_48h_change = Number.isFinite(changeNum) ? changeNum : undefined;
  const rawCurve = attrOf(sensors.zero_degree_level_48h, 'forecast');
  if (rawCurve !== this._zeroDegreeCurveRaw || this.zero_degree_curve === undefined) {
    this._zeroDegreeCurveRaw = rawCurve;
    this.zero_degree_curve = parseZeroDegreeCurve(rawCurve);
  }
  const rawAt = attrOf(sensors.zero_degree_level_48h, 'at');
  this.zero_degree_48h_at = typeof rawAt === 'string' && rawAt ? rawAt : undefined;

  // Gated on show_precipitation: a hidden row would still pay for a buffer
  // prune, a localStorage write and a 30 s interval per hass set. Re-enabling
  // hot-loads from the stored buffer. Three shapes:
  //   - `sensors.precipitation_rate` (#253): measured mm/h; wins and replaces
  //     the precipitation reading, source included.
  //   - Native rate sensor (unit ends in /h): convert to the display unit.
  //   - Cumulative counter (everything else): derive a rate from the
  //     sliding-anchor buffer.
  if (this.config.show_precipitation !== false) {
    const rate = this._applyLivePrecipRateSensor(hass);
    if (rate) {
      r.precipitation = rate;
    } else if (isPrecipRateUnit(r.precipitation.unit)) {
      const num = parseNumericSafe(this.precipitation);
      if (num != null) {
        const { value, unit } = formatPrecipDisplay(num, r.precipitation.unit, this.unitPrecip);
        this.precipitation = value;
        this.precipitation_unit = unit;
      }
    } else {
      this._maybeDerivePrecipRate(hass);
    }
  }

  this._liveSources = liveSourcesOf(r);
}

// A dedicated `sensors.precipitation_rate` entity (#253) already is a rate,
// so it short-circuits both `sensors.precipitation` paths. Returns null when
// none is configured or its state isn't numeric.
_applyLivePrecipRateSensor(hass: HassMain): Reading | null {
  const eid = this.config.sensors?.precipitation_rate;
  const reading = precipRateReading(eid, eid ? hass.states?.[eid] as StateLike | undefined : undefined, this.unitPrecip);
  if (!reading) return null;

  // The cumulative derivation may already be running; its 30 s tick would keep
  // overwriting `precipitation` from the orphaned buffer, so release it here.
  this._precipRate.stop();
  this.precipitation = reading.value;
  this.precipitation_unit = reading.unit;
  return reading;
}

// A cumulative counter (unit not ending in /h) shows a live mm/h rate
// derived from recent samples (precip-rate-controller.ts) instead of its
// meaningless total. Rate units pass through untouched.
_maybeDerivePrecipRate(hass: HassMain): void {
  if (/\/(h|hr|hour)$/i.test(this.precipitation_unit ?? '')) return;
  const eid: string | undefined = this.config.sensors?.precipitation;
  this._precipRate.derive(eid, eid ? hass.states?.[eid] as CounterState | undefined : undefined);
}

// PrecipRateHost (precip-rate-controller.ts).
precipUnits(): { source: string; display: string | undefined } {
  return { source: this._sourcePrecipUnit, display: this.unitPrecip };
}

applyDerivedPrecip(display: PrecipDisplay): boolean {
  const changed = this.precipitation !== display.value || this.precipitation_unit !== display.unit;
  this.precipitation = display.value;
  this.precipitation_unit = display.unit;
  return changed;
}

onDerivedPrecipTick(): void {
  // The derived rate feeds the "Now" override of the next-rain row, and
  // the tick runs outside the hass path that normally refreshes it.
  this._refreshNextRain();
  this.requestUpdate();
}

// Phase 2: classify the live "now" condition (memoised per minute) and
// synthesise a weather-entity stand-in. Precipitation only contributes when
// the sensor reports a rate (see resolvePrecipRateInput).
_classifyLiveCondition(hass: HassMain): void {
  const inputs = this._resolveLiveClassifierInputs(hass);
  const currentCondition = this._pickLiveCondition(inputs);
  const candidate = this._synthesizeWeatherEntity(currentCondition);
  // Keep the previous object identity when nothing changed: `weather` is
  // reference-compared by Lit, so a fresh object per pass would schedule a
  // render per pass (ADR-0017).
  if (!this._weatherSynthesisEquals(this.weather, candidate)) {
    this.weather = candidate;
  }
}

// Field-wise equality of two synthesised stand-ins; the attribute key set is
// fixed and all values are scalars.
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

// Pull the classifier's numeric inputs out of hass.states.
_resolveLiveClassifierInputs(hass: HassMain): any {
  const sensors = this.config.sensors || {};
  const loc = resolveLocation(this.config, hass);
  const wxEntity = this.config.weather_entity ? hass.states?.[this.config.weather_entity] : null;
  const illuminanceState = sensors.illuminance ? hass.states?.[sensors.illuminance] : null;
  const { precipRateNow, precipUnit } = resolvePrecipRateInput(
    sensors.precipitation_rate ? hass.states?.[sensors.precipitation_rate] : null,
    sensors.precipitation ? hass.states?.[sensors.precipitation] : null,
  );

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
    precipRateNow,
    // Source units so the classifier can normalise to its canonical
    // °C / mm before comparing against thresholds. Dew point falls back
    // to the temperature unit (same station, same scale in practice).
    tempUnit: this._sourceTempUnit,
    dewUnit: this._readings?.dew_point.unit ?? this._sourceTempUnit,
    precipUnit,
    lat: loc?.latitude,
    lon: loc?.longitude,
  };
}

// Memoised: the inputs rarely change across the 2–5 hass ticks per second.
// The key buckets time at minute precision so clear-sky drift doesn't break
// the cache; setConfig clears it (condition_mapping changes).
_pickLiveCondition(inputs: any): string | undefined {
  const { sensors, wxState, nowTemp, luxNow, precipRateNow, tempUnit, dewUnit, precipUnit, lat, lon } = inputs;
  const minuteKey = Math.floor(Date.now() / 60_000);
  const conditionKey =
    nowTemp + '|' + luxNow + '|' + precipRateNow + '|' +
    this.humidity + '|' + this.windSpeed + '|' + this.wind_gust_speed + '|' +
    this.dew_point + '|' + wxState + '|' + minuteKey;
  if (this._liveConditionKey === conditionKey) return this._liveCondition;

  // No station temperature sensor — defer to the weather entity's own
  // state for the live condition. Forecast-only mode lands here.
  if (!sensors.temperature && wxState) {
    this._liveConditionKey = conditionKey;
    this._liveCondition = wxState;
    this._liveNight = false;
    return wxState;
  }

  const clearskyNow = lat != null && lon != null
    ? clearSkyLuxAt(lat, lon, this.calendar, new Date())
    : 110000;
  // precip_total is the instantaneous rate (mm/h), hence period 'hour'.
  // classifyDay is unit-blind (°C / mm / m/s thresholds), so normalise the
  // native-unit sensor values below first.
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
  // Without an illuminance sensor the classifier bottoms out at 'cloudy'; the
  // weather entity's sky state is a better guess (#253). Rain, fog and wind
  // stay station-measured.
  const fromEntity = condition === 'cloudy' && luxNow == null && SKY_STATES.has(wxState);
  // classifyDay has no night state; derive it from the computed sun position.
  // HA has no partly-cloudy-night state, so on the entity path only 'sunny'
  // and 'partlycloudy' change.
  const belowHorizon = lat != null && lon != null && !isSunUp(new Date(), lat, lon);
  const entityDay = fromEntity && (wxState === 'sunny' || wxState === 'partlycloudy');
  const night = belowHorizon && (!fromEntity || entityDay);
  const result = fromEntity
    ? (night && wxState === 'sunny' ? 'clear-night' : wxState)
    : night && condition === 'sunny' ? 'clear-night' : condition;
  this._liveConditionKey = conditionKey;
  this._liveCondition = result;
  this._liveNight = night;
  return result;
}

// Synthesized stand-in for the original weather entity. The *_unit
// fields here represent the SOURCE units (what the data layer actually
// emits); the conversion code compares them against this.unitSpeed /
// unitPressure to decide whether to convert.
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

  constructor() {
    super();
    this.resizeObserver = null;
    this.resizeInitialized = false;
    this._teardownRegistry = new TeardownRegistry();
    this._sources = new DataSourceController(this);
    this._precipRate = new PrecipRateController(this);
  }

  // DataSourceHost (data-source-controller.ts).
  onSourceData(): void {
    this._refreshForecasts();
  }

  onOverlayData(): void {
    this._overlaySunshineOnExisting();
  }

  onSourceDropped(): void {
    this._watchedStatesSnapshot = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._isInPreview = this._detectInPreview();
    if (!this.resizeInitialized) {
      this.delayedAttachResizeObserver();
    }
    this._registerLifecycleTeardowns();
  }

  // Walk shadow-DOM hosts to find the card-config dialog wrappers HA mounts the
  // live preview in. Tag names may change in HA; the failure mode is benign
  // (animation stays on).
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

  // Every disconnect-time cleanup goes through the TeardownRegistry (the data
  // sources drain their own). Closures read `this._foo` at drain time, so
  // replaced resources are still torn down; registry.size gates re-registering.
  _registerLifecycleTeardowns() {
    if (this._teardownRegistry.size > 0) return;
    const r = this._teardownRegistry;
    r.add(() => this.detachResizeObserver());
    r.add(() => this._teardownInitialScrollObserver());
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
    // uPlot keeps a window `dppxchange` listener per instance, so an
    // undestroyed chart pins the whole removed card in memory. Reconnect
    // rebuilds because measureCard sees no live chart.
    r.add(() => {
      if (this.forecastChart) {
        try { this.forecastChart.destroy(); } catch { /* already gone */ }
        this.forecastChart = null;
      }
    });
    r.add(() => this._stopNextRainTick());
    r.add(() => this._zeroDegreePopup?.close(false));
    r.add(() => this._sourcesPopup?.close(false));
    r.add(() => {
      if (this._clockTimer) {
        clearInterval(this._clockTimer);
        this._clockTimer = null;
      }
    });
    // Pause the 1 Hz clock and wake the hourly station poll when tab visibility
    // flips.
    if (typeof document !== 'undefined') {
      const onVisibility = () => this._handleVisibilityChange();
      document.addEventListener('visibilitychange', onVisibility);
      r.add(() => document.removeEventListener('visibilitychange', onVisibility));
    }
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

  // Malformed source data (a wrong-shaped forecast entry, a NaN datetime) must
  // degrade to the error banner, never throw out of a hass or subscription
  // callback, and never leave `forecasts` undefined (which blanks the chart).
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

  _pipelineCtx(plan: SourcePlan): PipelineContext {
    return {
      plan,
      calendar: this.calendar,
      hass: this._hass,
      openMeteo: this._sources.openMeteoReader,
      location: this.config.location,
    };
  }

  _refreshForecastsUnsafe() {
    // Ensure the Open-Meteo source up front. When it feeds the station
    // block (ADR-0015) a warm cache populates the station data
    // synchronously here, so the build below sees it on the same render.
    const plan = this._sources.ensureOpenMeteo();
    const built = buildForecastEntries(this._sources.stationData, this._pipelineCtx(plan));
    // The trailing station-today entry is kept even without recorded data:
    // partial values show at once and missing fields render as gaps.
    this._stationCount = built.stationCount;
    this._forecastCount = built.forecastCount;
    this.forecasts = built.entries;
    // Data genuinely changed shape or content — flag it so measureCard's
    // skip-path pushes the fresh arrays into the live chart in place.
    this._forecastsDirty = true;
    this.requestUpdate();
    // measureCard() recomputes forecastItems from the new length; calling
    // drawChart() directly could crop the merged array with a stale value.
    // Data callbacks can fire before the first render built the shadow root;
    // firstUpdated() calls measureCard() then.
    if (this.shadowRoot) this.measureCard();
  }

  // Async sunshine / chance-of-rain (#288) arrival: patch forecasts in place
  // and updateChart. Falls back to _refreshForecasts without a chart or at
  // type 'today', whose 3-hour aggregation rebuilds the whole array.
  _overlaySunshineOnExisting(): void {
    const plan = this._sources.plan();
    if (!this.forecasts || !this.forecastChart || plan.type === 'today') {
      this._refreshForecasts();
      return;
    }
    this.forecasts = overlayOnEntries(this.forecasts, this._stationCount || 0, this._pipelineCtx(plan));
    this.updateChart();
  }

  attachResizeObserver() {
    // Section-grid resizes fire many ResizeObserver ticks per frame; a
    // synchronous measureCard → drawChart per tick confuses HA's grid layout (the
    // card drops out of the render tree until reload). Coalesce into one rAF.
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

  // (Re-)point the ResizeObserver at the current <ha-card>. Observing once
  // goes dead (1) when the delayed attach runs before ha-card renders, so no
  // resize ever reaches measureCard, and (2) when Lit swaps <ha-card> on a
  // render-branch change. Called after every render; idempotent.
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
    // Lets connectedCallback re-attach on a reconnect.
    this.resizeInitialized = false;
    if (this._resizeRaf) {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = null;
    }
  }

measureCard() {
  // Callers gate on shadowRoot; ha-card itself can be missing briefly during
  // teardown.
  const card = safeQuery(this.shadowRoot,'ha-card');
  if (!card) return;

  // forecastItems is the count of bars rendered: the full series, since
  // number_of_forecasts is a viewport size (overflow-x scroll), not a cap.
  // Width-based auto-fit only applies before any data is loaded.
  const prevForecastItems = this.forecastItems;
  if (this.forecasts?.length) {
    this.forecastItems = this.forecasts.length;
  } else {
    const fontSize = this.config.forecast.labels_font_size;
    this.forecastItems = Math.round((card as HTMLElement).offsetWidth / (fontSize * 6));
  }
  // Skip the rebuild when the chart is live and forecastItems is unchanged:
  // ResizeObserver ticks while HA's grid settles would otherwise rebuild it at
  // slightly different widths (bars start wide, then narrow). "Live" means the
  // root is still connected: after an HA view switch Lit builds a fresh
  // #forecastChart div and the old canvas is detached.
  const chartAlive = this.forecastChart?.uplot?.root?.isConnected === true;
  if (chartAlive && this.forecastItems === prevForecastItems) {
    // Same-shape data refresh (hourly poll, forecast push): push the new values
    // into the live chart. Only _refreshForecastsUnsafe sets the flag, so resize
    // and sensor ticks cost no canvas work.
    if (this._forecastsDirty) {
      this._forecastsDirty = false;
      this.updateChart();
    }
    // uPlot does not auto-resize (ADR-0012): buildChart measures the container
    // once and CSS then stretches the fixed pixel buffer, so a later width change
    // (sidebar, window, grid settling) leaves a blurry line. resize() re-measures
    // and calls uplot.setSize() without a rebuild.
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

ll(str: string): any {
  const selectedLocale: string = resolveLocaleKey(this.config.locale || this._lang);

  const localeAny = locale as Record<string, Record<string, any>>;
  // Per key, like the editor's tEditor: a language that lacks a key (or
  // has not finished loading) shows the English string, not a blank.
  const own = localeAny[selectedLocale]?.[str];
  return own === undefined || own === '' ? localeAny.en[str] : own;
}

/** Locale string for `key`, '' when not even English has it. */
_str(key: string): string {
  const v = this.ll(key);
  return typeof v === 'string' ? v : '';
}

/** Display language; `language` is resolved in `set hass`. */
get _lang(): string {
  return this.language || 'en';
}

  // Masonry layout reserves space from this (≈50 px per unit); the floor of 1
  // keeps the picker preview from collapsing.
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

  getWeatherIcon(condition: string): string {
    const condKey = condition as keyof typeof weatherIcons;
    return weatherIcons[condKey];
  }

_mainIcon(condition: string): string {
  return this._liveNight && condition === 'partlycloudy'
    ? 'mdi:weather-night-partly-cloudy'
    : this.getWeatherIcon(condition);
}

async firstUpdated(changedProperties: Map<PropertyKey, unknown>) {
  super.firstUpdated(changedProperties);
  this.measureCard();
  await new Promise(resolve => setTimeout(resolve, 0));
  this.drawChart();
}


async updated(changedProperties: Map<PropertyKey, unknown>) {
  // Apply the initial scroll before the await below: Lit has already committed
  // the DOM, so scrollLeft is set in the same task, before the next paint (no
  // frame visible at scrollLeft=0).
  this._maybeApplyInitialScroll(changedProperties);
  this._maybeRealignDayPager();
  this._maybeRetriggerViewChangeAnimation();
  await this.updateComplete;

  // Re-bind after every render: Lit can swap <ha-card> when the render branch
  // changes (the weather-undefined fallback uses a different template); the
  // per-element _wsActionHandlerBound flag keeps it idempotent.
  // The helpers take tighter types than the card class; cast through
  // `unknown` to keep tsc happy.
  setupActionHandler(this as unknown as Parameters<typeof setupActionHandler>[0]);
  setupScrollUx(this as unknown as Parameters<typeof setupScrollUx>[0]);
  // Same element-swap reasoning (see _observeResizeTarget).
  this._observeResizeTarget();

  if (changedProperties.has('config')) {
    const oldConfig = changedProperties.get('config');
    if (oldConfig) {
      // A source with a changed config dependency was torn down; re-enter
      // `set hass` now to resubscribe instead of waiting for HA's next state push.
      if (this._sources.invalidate(oldConfig)) {
        if (this._hass) this.hass = this._hass;
        this._refreshForecasts();
      }

      // Render-only config changes re-merge against the existing forecasts;
      // forecast_days alone only crops what we have, so refresh even with no data.
      const forecastDaysChanged = this.config.forecast_days !== (oldConfig as { forecast_days?: unknown })?.forecast_days;
      if ((this.forecasts?.length) || forecastDaysChanged) {
        try { this._refreshForecasts(); } catch (e) { console.error('[weather-station-card] redraw failed', e); }
      }
    }
  }

}

drawChart(): void {
  // Hold off the first render until every expected data source has produced a
  // value; building from the forecast alone and then prepending station columns
  // would visibly narrow every column. Lifted for good after the first build.
  if (!this._initialChartBuilt && !this._sources.allExpectedDataReady()) {
    return;
  }
  try {
    this._buildChart();
    if (this.forecastChart) {
      this._initialChartBuilt = true;
      // A full rebuild consumed the freshest `forecasts` — no in-place
      // update needed on the next measureCard pass.
      this._forecastsDirty = false;
      // Two-phase render (ADR-0016): fill the deferred condition-icon / wind rows
      // post-paint. No-op for non-scrolling views.
      this._scheduleForecastRowsReveal();
      // A fresh build moves the boundary pixel (e.g. daily↔hourly), so re-arm the
      // initial scroll for the next updated() cycle. No-op rebuilds never reach
      // drawChart.
      this._initialScrollApplied = false;
      // uPlot has no animation system: update() repaints at the final state.
      if (this.config?.forecast?.disable_animation !== true && !this._isInPreview) {
        this.forecastChart.update();
      }
      // drawChart runs inside _refreshForecasts, whose forecasts assignment
      // enqueues a second Lit update that commits the new .forecast-content width.
      // Drain it, then resize() so the canvas matches its parent; a stale canvas
      // width inflates scrollWidth and the browser clamps scrollLeft to it.
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
  } catch (thrown) {
    // The phase tag (ChartBuildError) says where the build crashed; untagged
    // failures fall back to 'draw'.
    const phase = thrown instanceof ChartBuildError ? thrown.phase : 'draw';
    const e = thrown instanceof ChartBuildError ? thrown.original : thrown;
    console.error(`[weather-station-card] chart ${phase} failed`, e);
    if (this.forecastChart) {
      try { this.forecastChart.destroy(); } catch { /* already gone */ }
      this.forecastChart = null;
    }
    const err = e as { message?: string } | null;
    const msg = String(err?.message ? err.message : e);
    this._chartError = `${phase}: ${msg}`;
    this.requestUpdate();
  }
}

// Throws ChartBuildError (chart/orchestrator.ts).
_buildChart(): void {
  if (!this.forecasts?.length) return;
  const target = this.renderRoot?.querySelector<HTMLElement>('#forecastChart');
  if (!target) {
    // drawChart can run inside _refreshForecasts before Lit commits the
    // chart container; retry on the next frame, after the commit.
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => this.drawChart());
    }
    return;
  }
  if (this.forecastChart) {
    this.forecastChart.destroy();
    this.forecastChart = null;
  }
  let data;
  try {
    data = this.computeForecastData();
  } catch (err) {
    throw new ChartBuildError('compute', err);
  }
  this.forecastChart = buildForecastChart({
    target,
    config: this.config,
    language: this.language,
    calendar: this.calendar,
    data,
    stationCount: this._stationCount || 0,
    forecastCount: this._forecastCount || 0,
    unitSystem: (this._hass?.config as { unit_system?: ChartInputs['unitSystem'] } | undefined)
      ?.unit_system as ChartInputs['unitSystem'],
    ll: (key: string) => this.ll(key),
    // The card inherits the global AND the view-level theme; detached,
    // it falls back to the body.
    themeHost: this.isConnected ? this : document.body,
    inPreview: this._isInPreview,
  });
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
  // Hourly entries have a single temperature; some providers emit an identical
  // per-hour `templow` that would draw a dashed line on top of the high, so
  // drop it. Daily and 3h-aggregated 'today' keep their pairs.
  const tempLow = fcType === 'hourly' ? null : rawTempLow;
  const precip = forecast.map((d) => d.precipitation);
  const sunshine = forecast.map((d) => d.sunshine ?? null);
  const dayLength = forecast.map((d) => d.day_length ?? null);
  // Chance of rain for the precip pill (#288), gated on the row toggle here so
  // the label plugin can read "array present" as "draw the two-line box";
  // station entries never carry the field.
  const precipProb = config.forecast?.show_precip_probability === true
    ? forecast.map((d) => d.precipitation_probability ?? null)
    : null;

  return {
    forecast,
    dateTime,
    tempHigh,
    // Coerced to [] because the dataset builder indexes by position; the
    // orchestrator hides the second line from tempLowAvailable, below.
    tempLow: tempLow ?? [],
    // False at hourly: the chart then draws a single temperature line.
    tempLowAvailable: tempLow !== null,
    precip,
    sunshine,
    dayLength,
    precipProb,
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
    // The sunshine dataset (index 3) exists only when its toggle is on.
    if (forecastChart.data.datasets[3]) {
      forecastChart.data.datasets[3].data = sunshineFractions(data.sunshine, data.dayLength);
    }
    // The value-printing label plugins read from a render-data object captured by
    // reference at chart-build time, not from the datasets above. Refresh its
    // fields in place, or the bars move while the printed numbers stay frozen
    // (always-on tablets only ever take this path).
    const rd = forecastChart.renderData;
    if (rd) {
      rd.dateTime = data.dateTime;
      rd.precip = data.precip;
      rd.tempHigh = data.tempHigh;
      rd.tempLow = data.tempLow;
      rd.sunshine = data.sunshine;
      rd.precipProb = data.precipProb;
    }
    forecastChart.update();
  }
}

// Scroll timeline below the chart (render/forecast-block.ts).
renderScrollTimeline() {
  return renderTimeline(this.forecasts, this.calendar, this._lang, effectiveVisibleBars(this.config));
}

// Cycle daily → today → hourly → daily through setConfig, like the editor
// radio. Not persisted: a reload resets to the saved YAML.
_onModeToggleClick(ev?: Event) {
  if (ev) ev.stopPropagation();
  // Cycle from the merged type (the raw config may leave it to the
  // default), but rebuild from the raw config so the advisory
  // validation keeps seeing what the user actually wrote.
  const current = this.config?.forecast?.type;
  const raw = (this._rawConfig ?? this.config ?? {}) as Record<string, unknown>;
  const rawForecast = (raw.forecast ?? {}) as Record<string, unknown>;
  this.setConfig({ ...raw, forecast: { ...rawForecast, type: nextForecastType(current) } });
}

_forecastRowsGenKey(): string {
  return forecastRowsGenKey(this.config?.forecast?.type, this.forecasts);
}

// Fill the deferred condition-icon / wind rows after the chart's first paint
// (ADR-0016). Double rAF: a single rAF runs before the paint (no deferral);
// rIC has an unbounded fire time, so the e2e settle could screenshot empty
// rows. Double rAF defers past exactly one paint.
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
    this._sectionError = null;

    // Nothing real to draw yet: show a calm onboarding placeholder instead of NaN
    // values and a red banner.
    const hasTemp = !!config.sensors?.temperature;
    const hasWeather = !!config.weather_entity;
    if (!hasTemp && !hasWeather) return renderOnboarding(config.title);

    // Match the mm-unit sizing rule from precipLabelPlugin so the wind unit
    // ("km/h", "m/s", …) renders at the same compact size as the precip unit
    // alongside its number.
    const labelsBaseSize = parseInt(config?.forecast?.labels_font_size) || 11;
    const labelsSmallSize = Math.max(6, Math.round(labelsBaseSize * 0.5));
    if (!weather?.attributes) return renderNoWeather(config.title);
    // number_of_forecasts is the viewport size in bars (default 8): daily fits
    // without scrolling, hourly scrolls. 0 disables the viewport. 'today' is a
    // day pager: effectiveVisibleBars pins it to 8 (one day of 3-h blocks).
    const visibleBars = effectiveVisibleBars(config);
    const totalBars = (this.forecasts ?? []).length;
    const scrolling = visibleBars > 0 && totalBars > visibleBars;
    const contentWidthPct = scrolling ? (totalBars / visibleBars) * 100 : 100;

    // Sections render through _safeSection first, so a throw on malformed data
    // collapses only that section and records the cause; renderErrorBanner() is
    // computed last, so the banner reflects this same pass.
    const mainSection = this._safeSection('live panel', () => this.renderMain());
    const attributesSection = this._safeSection('attributes', () => this.renderAttributes());
    const forecastSection = this._safeSection('forecast', () =>
      this._renderForecastBlock({ config, scrolling, contentWidthPct, visibleBars }),
    );
    const banner = this._safeSection('error banner', () => renderErrorBanner(this._bannerCtx()));
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
        extraBottomPad: config.forecast.show_precip_probability === true
          ? PROBABILITY_EXTRA_BOTTOM_PAD
          : 0,
      })}</style>

      <ha-card header="${config.title}">
        <div class="card">
          ${this.renderIconSpriteDefs()}
          ${banner}
          ${this._safeSection('availability note', () => renderAvailabilityNote(this._sources.missingSensors, this._sources.staleSensors))}
          <div class="${(this._sources.staleSensors?.length || this._sources.missingSensors?.length) ? 'wsc-stale' : ''}">
            ${mainSection}
            ${attributesSection}
          </div>
          ${forecastSection}
          ${debugSection}
        </div>
      </ha-card>
    `;
  }

  // The data-ready / loading branch, wrapped in one _safeSection catch
  // by render() (render/forecast-block.ts).
  _renderForecastBlock({ config, scrolling, contentWidthPct, visibleBars }: any) {
    return renderForecastBlock({
      config,
      ready: this._sources.allExpectedDataReady(),
      scrolling,
      contentWidthPct,
      visibleBars,
      forecasts: this.forecasts,
      forecastItems: this.forecastItems,
      unitSpeed: this.unitSpeed,
      calendar: this.calendar,
      language: this._lang,
      mountAnimationPlayed: this._chartMountAnimationPlayed,
      lastForecastType: this._lastForecastType,
      rowsReadyGen: this._forecastRowsReadyGen,
      onModeToggle: this._onModeToggle,
      renderWind: () => this.renderWind(),
      renderSourcesButton: () => this._renderSourcesButton('chart'),
    });
  }

  // Run a render section under try/catch: log, record the cause in
  // _sectionError (the banner is evaluated after the sections, so it shows on
  // the same pass) and return an empty fragment. Only that section collapses.
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

// `debug: true` diagnostics (render/debug-panel.ts).
renderDebugPanel() {
  return renderDebugView({
    config: this.config,
    hasEntity: (eid) => !!this._hass?.states?.[eid],
    haVersion: this._hass?.config?.version,
    cardVersion: CARD_VERSION,
    sources: this._sources,
    chartBuilt: this._initialChartBuilt,
  });
}

_bannerCtx(): BannerCtx {
  return {
    haVersion: this._hass?.config?.version,
    configError: this._configError,
    stationError: this._sources.stationError,
    forecastError: this._sources.forecastError,
    chartError: this._chartError,
    refreshError: this._refreshError,
    sectionError: this._sectionError,
    configWarnings: this._configWarnings ?? [],
  };
}

renderMain({ config, weather, temperature } = this) {
  if (config.show_main === false) {
    // The block is hidden: stop the 1 Hz clock too, or it keeps ticking against
    // missing DOM.
    this._syncClockTimer(false);
    return html``;
  }

  // Sub-toggles default to on (opt-out) under show_main. The clock's own
  // options are read in _updateClock at tick time.
  const showTime = config.show_time !== false;
  const showDay = config.show_day !== false;
  const showDate = config.show_date !== false;
  const showCurrentCondition = config.show_current_condition !== false;
  const showTemperature = config.show_temperature !== false;

  let roundedTemperature = parseFloat(temperature);
  if (!isNaN(roundedTemperature) && roundedTemperature % 1 !== 0) {
    roundedTemperature = Math.round(roundedTemperature * 10) / 10;
  }

  // The condition glyph opens the weather entity's more-info (it carries the
  // forecast panel); station-only setups use the temperature sensor.
  const iconHtml = this._entityLink(
    this.config?.weather_entity || this.config?.sensors?.temperature,
    html`<ha-icon icon="${this._mainIcon(weather.state)}"></ha-icon>`,
  );

  // _syncClockTimer is idempotent; _updateClock reads config at tick time, so a
  // config edit needs no re-arm. The immediate update keeps the text fresh on
  // the render that mounts it.
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
        ${this._renderSourcesButton()}
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

// 1 Hz clock tick. Reads config at tick time, so edits apply on the next
// second without re-arming the timer.
_updateClock(): void {
  const cfg = this.config || {};
  const currentDate = new Date();
  const timeZone = this.calendar.timeZone;
  const timeOptions = {
    hour12: cfg.use_12hour_format,
    hour: 'numeric',
    minute: 'numeric',
    second: cfg.show_time_seconds === true ? 'numeric' : undefined,
    timeZone,
  };
  const currentTime = getDateTimeFormat(this._lang, timeOptions as Intl.DateTimeFormatOptions & { timeZone: string }).format(currentDate);
  const mainDiv = this.shadowRoot?.querySelector('.main');
  if (!mainDiv) return;
  const clockElement = mainDiv.querySelector('#digital-clock');
  if (clockElement) clockElement.textContent = currentTime;
  if (cfg.show_day !== false) {
    const dayElement = mainDiv.querySelector('.date-text.day');
    if (dayElement) {
      dayElement.textContent = getDateTimeFormat(this._lang, { weekday: 'long', timeZone }).format(currentDate).toUpperCase();
    }
  }
  if (cfg.show_date !== false) {
    const dateElement = mainDiv.querySelector('.date-text.date');
    if (dateElement) {
      dateElement.textContent = getDateTimeFormat(this._lang, { month: 'long', day: 'numeric', timeZone }).format(currentDate);
    }
  }
}

// Idempotent clock timer: runs only while the clock is shown and the document
// is visible (a hidden wall-tablet dashboard stops burning a wakeup per
// second). _handleVisibilityChange re-arms it and repaints at once.
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
    this._sources.notifyVisible();
  }
}

// Render context of the live-panel rows (src/live-panel/, ADR-0010):
// the instance state they read, plus the two link callbacks that keep
// event wiring here. `language` overrides the card's for tests.
_liveCtx(language?: string): LivePanelCtx {
  const units = this.ll('units');
  const directions = this.ll('cardinalDirections');
  const attrs = this.weather?.attributes ?? {};
  return {
    config: this.config || {},
    hass: this._hass as unknown as LiveHass | null,
    language: language || this._lang,
    calendar: this.calendar,
    str: (k: string) => this._str(k),
    units: units && typeof units === 'object' ? units : {},
    cardinalDirections: Array.isArray(directions) ? directions : [],
    unitPressure: this.unitPressure,
    unitSpeed: this.unitSpeed,
    weatherUnits: {
      temperature: attrs.temperature_unit,
      windSpeed: attrs.wind_speed_unit,
      pressure: attrs.pressure_unit,
    },
    sourceTempUnit: this._sourceTempUnit,
    values: {
      temperature: this.temperature,
      humidity: this.humidity,
      pressure: this.pressure,
      dew_point: this.dew_point,
      precipitation: this.precipitation,
      precipitation_unit: this.precipitation_unit,
      uv_index: this.uv_index,
      illuminance: this.illuminance,
      windSpeed: this.windSpeed,
      windDirection: this.windDirection,
      wind_gust_speed: this.wind_gust_speed,
      zero_degree_level: this.zero_degree_level,
      zero_degree_unit: this.zero_degree_unit,
      zero_degree_48h_level: this.zero_degree_48h_level,
      zero_degree_48h_unit: this.zero_degree_48h_unit,
      zero_degree_48h_change: this.zero_degree_48h_change,
      zero_degree_48h_at: this.zero_degree_48h_at,
      zero_degree_curve: this.zero_degree_curve,
      next_rain_text: this.next_rain_text,
      next_rain_icon: this.next_rain_icon,
      next_rain_title: this.next_rain_title,
      pressureDelta3h: this._sources.pressureDelta3h,
    },
    entityLink: (eid, content) => this._entityLink(eid, content),
    zeroDegreeLink: (eid, content) => this._zeroDegreeLink(eid, content),
  };
}

// Clicking a live-panel value opens HA's more-info for its sensor.
// `role="button"` is also what action-handler's isCardControl excludes from
// tap/hold detection, so a row click never fires tap_action. Values without a
// backing entity render unwrapped.
_entityLink(entityId: string | undefined, content: any): any {
  if (!entityId || !this._hass?.states?.[entityId]) return content;
  return this._activatable(() => this._fire('hass-more-info', { entityId }), content);
}

_activatable(activate: (el: HTMLElement) => void, content: any, hasPopup?: 'dialog'): any {
  const open = (ev: Event) => {
    ev.stopPropagation();
    activate(ev.currentTarget as HTMLElement);
  };
  return html`<span class="wsc-entity-link" role="button" tabindex="0"
    aria-haspopup=${hasPopup ?? nothing}
    @click=${open}
    @keydown=${(ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev); }
    }}>${content}</span>`;
}

// Info button (show_sources, ADR-0031): a muted icon in the live panel's
// top-right corner, or next to the chart's mode toggle when the live block is
// hidden. Accent-coloured when a shown value fell back or a sensor is stale.
_renderSourcesButton(place: 'main' | 'chart' = 'main'): unknown {
  const cfg = this.config;
  if (cfg?.show_sources === false) return nothing;
  let placeClass = ' wsc-sources-corner';
  if (place === 'chart') {
    placeClass = '';
    const chartShown = cfg.show_station !== false || (cfg.show_forecast === true && !!cfg.weather_entity);
    if (!chartShown) return nothing;
    const toggleShown = cfg.forecast?.show_mode_toggle !== false;
    placeClass = toggleShown ? ' wsc-sources-chart' : ' wsc-sources-chart wsc-sources-chart-alone';
  }
  // Derived at render time from the availability scan's overdue ids, so grace
  // expiry re-renders the button (the controller requests the update).
  const alert = sourcesAlert(cfg, this._liveSources, this._sources.overdueIds);
  const label = this._str(alert ? 'sources_button_problem' : 'sources_button');
  const button = this._activatable(
    (el) => this._openSourcesPopup(el),
    // The hidden text gives the role=button span its accessible name.
    html`<ha-icon icon=${alert ? 'mdi:alert-circle-outline' : 'mdi:information-outline'} aria-hidden="true"></ha-icon><span class="wsc-sr-only">${label}</span>`,
    'dialog',
  );
  return html`<span class="wsc-sources-info${placeClass}${alert ? ' wsc-sources-alert' : ''}" title=${label}>${button}</span>`;
}

_sourceLabelFor(key: string): string {
  const ed = (this.ll('editor') || {}) as Record<string, string | undefined>;
  const enEd = ((locale.en as Record<string, unknown>).editor || {}) as Record<string, string | undefined>;
  return sourceLabelFor(key, (k) => this._str(k), ed, enEd);
}

_sourceLines(): SourceLine[] {
  return sourceLines({
    live: this._liveCtx(),
    liveSources: this._liveSources,
    overdueIds: this._sources.overdueIds,
    tempUnit: this.getUnit('temperature'),
    labelFor: (key) => this._sourceLabelFor(key),
    entityName: (eid) => this._entityName(eid),
  });
}

_entityName(entityId: string): string {
  return entityName(this._hass as unknown as EntityNameHass | null, entityId);
}

// Chart section of the popup, in the colours chart/orchestrator.ts
// draws with.
_sourceLegend(config: any): LegendItem[] {
  return sourceLegend({
    config,
    str: (k) => this._str(k),
    resolve: () => {
      const fc = config.forecast || {};
      const plan = planSources(config, this._sources.forecastData, this.calendar);
      const host: HTMLElement = this.isConnected ? this : document.body;
      const bg = getThemeTokens(host).backgroundColor;
      return {
        pastFromOpenMeteo: plan.past === 'openmeteo',
        sunshineParts: plan.sunshine,
        colors: {
          high: resolveCssVar(fc.temperature1_color, 'rgba(255, 152, 0, 1.0)', host),
          low: resolveTemp2Color(fc.temperature2_color, bg, host),
          precip: resolveCssVar(fc.precipitation_color, 'rgba(132, 209, 253, 1.0)', host),
          sunshine: resolveCssVar(fc.sunshine_color, 'rgba(255, 215, 0, 1.0)', host),
        },
      };
    },
  });
}

_openSourcesPopup(returnFocus: HTMLElement | null): void {
  const root = this.shadowRoot;
  if (!root) return;
  this._zeroDegreePopup?.close(false);
  const popup = this._sourcesPopup ??= new SourcesPopup();
  popup.open({
    root,
    lines: this._sourceLines(),
    legend: this._sourceLegend(this.config || {}),
    strings: {
      title: this._str('sources_title'),
      close: this._str('close'),
      liveTitle: this._str('sources_live_title'),
      chartTitle: this._str('sources_chart_title'),
    },
    returnFocus,
    onMoreInfo: (entityId) => this._fire('hass-more-info', { entityId }),
  });
}

// Both zero-degree rows open the forecast-curve popup when the 48 h
// sensor carries a usable `forecast` attribute (#330), else more-info.
_zeroDegreeLink(entityId: string | undefined, content: any): any {
  if (!this.zero_degree_curve) return this._entityLink(entityId, content);
  return this._activatable((el) => this._openZeroDegreePopup(el), content, 'dialog');
}

_openZeroDegreePopup(returnFocus: HTMLElement | null): void {
  const curve = this.zero_degree_curve;
  const root = this.shadowRoot;
  if (!curve || !root) return;
  const ctx = this._liveCtx();
  const historyEid = this._attrEntity('zero_degree_level_48h', false);
  const elevation = zeroDegreeElevation(ctx);
  this._sourcesPopup?.close(false);
  const popup = this._zeroDegreePopup ??= new ZeroDegreePopup();
  popup.open({
    root,
    themeHost: this,
    curve,
    site: elevation === undefined
      ? undefined
      : {
          elevation,
          label: zeroDegreePlace(ctx, elevation),
          precipitationColor: this.config?.forecast?.precipitation_color,
        },
    unit: this.zero_degree_48h_unit,
    language: ctx.language,
    hour12: this.config?.use_12hour_format,
    calendar: this.calendar,
    formatValue: (level, withUnit) => zeroDegreeFormat(ctx, level, withUnit),
    strings: {
      title: this._str('zero_degree_popup_title'),
      lowest: this._str('zero_degree_lowest'),
      history: this._str('history'),
      close: this._str('close'),
    },
    returnFocus,
    onHistory: historyEid && this._hass?.states?.[historyEid]
      ? () => {
          popup.close(false);
          this._fire('hass-more-info', { entityId: historyEid });
        }
      : undefined,
  });
}

// Entity id backing an attribute row (see attrEntity).
_attrEntity(sensorKey: string, weatherFallback: boolean = true): string | undefined {
  return attrEntity(this.config, sensorKey, weatherFallback);
}

// Recompute the next-rain strings from the entity and the wall clock.
// Called on every hass pass and by the countdown tick; assigning an
// unchanged string schedules no render.
_refreshNextRain(): void {
  const eid = this.config?.sensors?.next_rain;
  const stateObj = eid ? this._hass?.states?.[eid] : undefined;
  const now = Date.now();
  const view = classifyNextRain(stateObj, now, this._isRainingNow());
  const str = (k: string) => this._str(k);

  let text = '';
  let icon = '';
  let title = '';
  if (view) {
    const lang = this._lang;
    const hour12 = this.config?.use_12hour_format;
    const strings = {
      now: str('next_rain_now'),
      none: str('next_rain_none'),
      checked_until: str('next_rain_checked_until'),
    };
    text = formatNextRain(view, lang, hour12, strings, this.calendar);
    icon = nextRainIcon(view);
    if (view.kind === 'none') title = formatCheckedUntil(view, now, lang, hour12, strings, this.calendar);
    else if ('source' in view && view.source) title = str(`next_rain_source_${view.source}`);
  }
  this.next_rain_text = text;
  this.next_rain_icon = icon;
  this.next_rain_title = title;

  if (view?.kind === 'minutes') this._startNextRainTick();
  else this._stopNextRainTick();
}

/** True while the live precipitation row shows a rate above zero —
 *  from a dedicated rate sensor or the counter-derived rate, both of
 *  which land in `precipitation` with a per-hour unit. A cumulative
 *  counter without a derived rate (no `/h` unit) says nothing about
 *  right now, so it never claims rain. */
_isRainingNow(): boolean {
  if (!/\/(h|hr|hour)$/i.test(this.precipitation_unit ?? '')) return false;
  const rate = parseNumericSafe(this.precipitation);
  return rate != null && rate > 0;
}

// The integration refreshes every five minutes; between updates the
// countdown is ours to keep honest.
_startNextRainTick(): void {
  if (this._nextRainTimer) return;
  this._nextRainTimer = setInterval(() => this._refreshNextRain(), 30_000);
}

_stopNextRainTick(): void {
  if (!this._nextRainTimer) return;
  clearInterval(this._nextRainTimer);
  this._nextRainTimer = null;
}

renderAttributes() {
  return renderLiveAttributes(this._liveCtx());
}

renderSun(language?: string) {
  return renderLiveSun(this._liveCtx(language));
}

_renderMoonLine(language?: string) {
  return renderMoonLine(this._liveCtx(language));
}

// ADR-0018: the per-column rows use inline-SVG <use> references against one
// hidden sprite per card, not up to 168 <ha-icon> elements. Names outside the
// sprite fall back to <ha-icon>. The hoisted template (ICON_SPRITE_TEMPLATE)
// is the same TemplateResult every pass, so Lit skips the whole subtree.
renderIconSpriteDefs() {
  return ICON_SPRITE_TEMPLATE;
}

_spriteIcon(fullName: string | undefined, cls: string = '') {
  return spriteIcon(fullName, cls);
}

renderWind({ forecastItems } = this) {
  return renderForecastWind(this._liveCtx(), this.forecasts, forecastItems);
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

  // Day pager: a data refresh can reshape .forecast-content (a new day after
  // midnight, a longer forecast) while the browser keeps the pixel scrollLeft,
  // leaving the viewport mid-page. After every render, snap back to the
  // nearest whole day, unless the user is dragging (scroll-ux owns that snap).
  _maybeRealignDayPager() {
    if (this.config?.forecast?.type !== 'today') return;
    const wrapper = safeQuery<HTMLElement>(this.shadowRoot, '.forecast-scroll.scrolling');
    if (!wrapper || wrapper.classList.contains('dragging')) return;
    const left = dayPagerRealignLeft(wrapper.scrollLeft, wrapper.scrollWidth, wrapper.clientWidth);
    if (left !== null) wrapper.scrollLeft = left;
  }

  // Runs after every Lit commit while the chart block is mounted. Restarts the
  // view-change animation when forecast.type changed on a still-mounted block
  // (Lit only updates the class; the browser collapses that into a no-op). A
  // remounted block already carries 'view-changing' from the template.
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
      // Flip the flag once the start animation has played: HA re-renders every few
      // 100 ms and would otherwise drop 'first-mount' mid-animation.
      this._chartMountAnimationTimer = window.setTimeout(() => {
        this._chartMountAnimationPlayed = true;
        this._chartMountAnimationTimer = null;
      }, 500);
    }
    this._lastForecastType = type;
  }

  // Apply the "scroll to now" position once per render generation (a change of
  // forecast.type or number_of_forecasts). Otherwise scrollLeft is left alone,
  // so the user's manual position survives data refreshes.
  _maybeApplyInitialScroll(changedProperties: Map<PropertyKey, unknown>) {
    const wrapper = safeQuery(this.shadowRoot,'.forecast-scroll.scrolling');
    if (!wrapper) {
      // Non-scrolling render (or before first paint). Mark unapplied so
      // the next scrolling render re-positions.
      this._initialScrollApplied = false;
      return;
    }
    const cfg = this.config;
    if (!initialScrollDataReady(cfg, this._stationCount || 0, this._forecastCount || 0)) {
      this._initialScrollApplied = false;
      return;
    }
    const generationKey = initialScrollGeneration(cfg);

    let needsReset = !this._initialScrollApplied;
    if (changedProperties?.has('config') && this._lastScrollGeneration
        && this._lastScrollGeneration !== generationKey) {
      needsReset = true;
    }
    if (!needsReset) return;

    // Drop an in-flight observer / frame from a previous call, e.g. a
    // forecast.type flip while a settle wait is still pending.
    this._teardownInitialScrollObserver();

    const apply = () => {
      if (!wrapper.isConnected) return false;
      const scrollLeft = resolveInitialScrollLeft({
        config: cfg,
        forecasts: this.forecasts,
        stationCount: this._stationCount || 0,
        forecastCount: this._forecastCount || 0,
        scrollWidth: wrapper.scrollWidth,
        clientWidth: wrapper.clientWidth,
        calendar: this.calendar,
      });
      if (scrollLeft === null) return false;
      wrapper.scrollLeft = scrollLeft;
      this._initialScrollApplied = true;
      this._lastScrollGeneration = generationKey;
      return true;
    };

    // If layout has already settled, apply now; otherwise observe the content
    // for size changes until the wrapper overflows. The 1 s cap stops the
    // observer from running forever.
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
      // The observer fires many times per frame while the canvas settles, and
      // apply() forces layout via scrollWidth/clientWidth; coalesce into one rAF
      // per frame. The 1 s cap still bounds the wait.
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

// Console banner (as Mushroom / mini-graph-card do): shows which build is
// loaded, e.g. when a stale cached bundle is served. '__CARD_VERSION__' is
// replaced at build time from package.json (ADR-0006).
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
