// Data-source lifecycle of one card (#452), as a Lit ReactiveController:
// the recorder-backed station source, the weather-entity forecast
// subscription, the Open-Meteo source, the card calendar, the 3-hour
// pressure delta and the sensor-availability scan with its grace timer.
//
// The card keeps the ADR-0017 entity-delta gate and decides WHEN to
// sync; this controller decides WHAT runs. It owns its own
// TeardownRegistry, registered on connect and drained on disconnect, so
// the card's disconnect path no longer needs to know which source or
// timer is alive.

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  MeasuredDataSource,
  ForecastDataSource,
  fetchPressure3hDelta,
  type DataSourceConfig,
  type DataSourceEvent,
  type HassLike,
  type PressureDeltaCache,
} from './data-source.js';
import { forecastFetchKey, forecastsEqual, stationFetchKey } from './forecast-utils.js';
import {
  needsOpenMeteo,
  openMeteoFetchWindow,
  openMeteoStationWindow,
  planSources,
  type OpenMeteoReader,
  type PipelineEntry,
  type SourcePlan,
} from './forecast-pipeline.js';
import type { CardConfig } from './card-config.js';
import { pastFromOpenMeteo } from './past-source.js';
import { OpenMeteoSource } from './openmeteo-source.js';
import { cardCalendar, resolveLocation } from './location.js';
import { unavailableSensors } from './sensor-readings.js';
import { loadSeriesCache, saveSeriesCache, seriesCacheKey } from './utils/series-cache.js';
import {
  UNAVAILABLE_GRACE_MS,
  nextExpiryDelay,
  overdueMissing,
  updateMissingSince,
  type MissingSinceMap,
} from './utils/availability-grace.js';
import type { Calendar } from './utils/time-zone.js';
import { TeardownRegistry } from './teardown-registry.js';

/** What the controller needs from the card. */
export interface DataSourceHost extends ReactiveControllerHost {
  readonly config: CardConfig;
  readonly _hass: HassLike | null;
  /** Every day boundary follows this; `syncCalendar` replaces it. */
  calendar: Calendar;
  /** Station or forecast data changed: rebuild the chart entries. */
  onSourceData(): void;
  /** Open-Meteo refreshed the sunshine / chance-of-rain overlay only. */
  onOverlayData(): void;
  /** A source was dropped; the next hass tick must run the full path
   *  so it is rebuilt (ADR-0017). */
  onSourceDropped(): void;
}

// Config keys whose change rebuilds a source. forecast.type drives both
// the recorder period and the subscribe forecast_type; the Open-Meteo
// opt-ins turn the no-station past block on or off (ADR-0015).
const STATION_KEYS = ['sensors', 'days', 'show_station', 'forecast.type', 'forecast.openmeteo_history', 'forecast.openmeteo'];
const FORECAST_KEYS = ['show_forecast', 'weather_entity', 'forecast.type'];

const keyPath = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>(
  (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
  obj,
);

export class DataSourceController implements ReactiveController {
  stationData: PipelineEntry[] = [];
  forecastData: PipelineEntry[] = [];
  stationError: string | null = null;
  forecastError: string | null = null;
  // Whether each configured source has produced a value (callback or a
  // restored cache). The first chart waits for both: rendering after
  // only the fast one would draw forecast-only columns that narrow once
  // the station block lands.
  stationReady = false;
  forecastReady = false;
  measured: MeasuredDataSource | null = null;
  forecastSource: ForecastDataSource | null = null;
  openMeteo: OpenMeteoSource | null = null;
  // 3-h pressure tendency (hPa); null until fetched or without history.
  pressureDelta3h: number | null = null;
  /** Overdue unavailable sensors (`key (eid)`), past the grace period. */
  missingSensors: string[] = [];
  /** In-grace unavailable sensors, typically an HA restart. */
  staleSensors: string[] = [];
  /** Entity ids behind `missingSensors`, for the sources popup. */
  overdueIds: Set<string> = new Set();

  private _measuredUnsub: (() => void) | null = null;
  private _forecastUnsub: (() => void) | null = null;
  // Mode-toggle lazy cache, keyed by fetch key: station 'day' | 'hour',
  // forecast 'daily' | 'hourly'. 'today' shares the hourly keys, so
  // hourly ↔ today needs no refetch.
  private _stationCache: Record<string, PipelineEntry[]> = {};
  private _forecastCache: Record<string, PipelineEntry[]> = {};
  private _pressureDeltaCache: PressureDeltaCache = { bucketMs: null, value: null };
  private _missingSince: MissingSinceMap = {};
  private _graceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _teardown = new TeardownRegistry();

  constructor(private readonly host: DataSourceHost) {
    host.addController(this);
  }

  hostConnected(): void {
    if (this._teardown.size > 0) return;
    this._teardown.add(() => this.teardownStation());
    this._teardown.add(() => this.teardownForecast());
    this._teardown.add(() => this._dropOpenMeteo());
    this._teardown.add(() => this._clearGraceTimer());
  }

  hostDisconnected(): void {
    this._teardown.drain();
  }

  private get config(): CardConfig {
    return this.host.config;
  }

  /** Which sources the config asks for. With the Open-Meteo past block
   *  (ADR-0015) the recorder source is NOT created: its empty result
   *  would overwrite the Open-Meteo data on every poll. */
  wanted(): { station: boolean; measured: boolean; forecast: boolean } {
    const cfg = this.config;
    const station = cfg.show_station !== false;
    return {
      station,
      measured: station && !pastFromOpenMeteo(cfg),
      forecast: cfg.show_forecast === true && !!cfg.weather_entity,
    };
  }

  /** True while the live sources match the config, i.e. a sync would
   *  neither create nor drop one. */
  sourcesMatchConfig(): boolean {
    const want = this.wanted();
    return want.measured === !!this.measured && want.forecast === !!this.forecastSource;
  }

  allExpectedDataReady(): boolean {
    const want = this.wanted();
    if (want.station && !this.stationReady) return false;
    if (want.forecast && !this.forecastReady) return false;
    return true;
  }

  /** Hand a fresh hass object to the live sources (the gate's fast path). */
  setHass(hass: HassLike): void {
    this.measured?.setHass(hass);
    this.forecastSource?.setHass(hass);
  }

  /** A poll that came due while the tab was hidden runs now. */
  notifyVisible(): void {
    this.measured?.notifyVisible();
  }

  // Create, keep or drop each source to match the config, then rescan
  // sensor availability. Source callbacks run from HA's WebSocket
  // listener or our poll timer; a throw there could detach the listener,
  // so each body is caught and logged.
  sync(hass: HassLike): void {
    const want = this.wanted();
    if (want.measured) {
      if (this.measured) this.measured.setHass(hass);
      else this._createMeasured(hass);
    } else if (this.measured) {
      this.teardownStation();
      this.stationError = null;
    }
    if (want.forecast) {
      if (this.forecastSource) this.forecastSource.setHass(hass);
      else this._createForecast(hass);
    } else if (this.forecastSource) {
      this.teardownForecast();
      this.forecastError = null;
    }
    this.scanAvailability(hass);
  }

  private _createMeasured(hass: HassLike): void {
    // Stale-while-revalidate: paint the last persisted payload while the
    // recorder roundtrip (0.5–3 s on a Pi) is in flight.
    if (!this.stationReady) {
      const cached = loadSeriesCache(this.stationSeriesKey());
      if (cached?.length) {
        this.stationData = cached;
        this.stationReady = true;
      }
    }
    this.measured = new MeasuredDataSource(hass, this.config as DataSourceConfig, this.host.calendar);
    this._measuredUnsub = this.measured.subscribe((event) => {
      try {
        // Before the identical-payload guard: after a reload the first
        // live result usually equals the hydrated cache, and the delta
        // would otherwise wait an hour. fetchPressure3hDelta dedupes per
        // hour, so repeated calls cost a cache lookup.
        void this.refreshPressureDelta();
        const next = this._fresh(event, this.stationData, this.stationError);
        if (!next) return;
        this.stationData = next.data;
        this.stationReady = true;
        this._stationCache[stationFetchKey(this.config)] = this.stationData;
        if (this.stationData.length) saveSeriesCache(this.stationSeriesKey(), this.stationData);
        this.stationError = next.error;
        this.host.onSourceData();
      } catch (err) {
        console.error('[weather-station-card] station callback failed', err);
      }
    });
  }

  private _createForecast(hass: HassLike): void {
    if (!this.forecastReady) {
      const cached = loadSeriesCache(this.forecastSeriesKey());
      if (cached?.length) {
        this.forecastData = cached;
        this.forecastReady = true;
      }
    }
    this.forecastSource = new ForecastDataSource(hass, this.config as DataSourceConfig, this.host.calendar);
    this._forecastUnsub = this.forecastSource.subscribe((event) => {
      try {
        const next = this._fresh(event, this.forecastData, this.forecastError);
        if (!next) return;
        this.forecastData = next.data;
        this.forecastReady = true;
        this._forecastCache[forecastFetchKey(this.config)] = this.forecastData;
        if (this.forecastData.length) saveSeriesCache(this.forecastSeriesKey(), this.forecastData);
        this.forecastError = next.error;
        this.host.onSourceData();
      } catch (err) {
        console.error('[weather-station-card] forecast callback failed', err);
      }
    });
  }

  // HA fans the cached payload out to every subscriber whenever one
  // (re)subscribes; without this a mode toggle on one card would redraw
  // its siblings. Returns null for an identical data + error event.
  private _fresh(
    event: DataSourceEvent, current: PipelineEntry[], currentError: string | null,
  ): { data: PipelineEntry[]; error: string | null } | null {
    const data = (event.forecast || []) as unknown as PipelineEntry[];
    const error = event.error || null;
    return forecastsEqual(current, data) && currentError === error ? null : { data, error };
  }

  teardownStation(): void {
    if (this._measuredUnsub) { this._measuredUnsub(); this._measuredUnsub = null; }
    this.measured = null;
    this.stationData = [];
    this.stationReady = false;
    this.host.onSourceDropped();
  }

  teardownForecast(): void {
    if (this._forecastUnsub) { this._forecastUnsub(); this._forecastUnsub = null; }
    this.forecastSource = null;
    this.forecastReady = false;
    this.forecastData = [];
    this.host.onSourceDropped();
  }

  // Tear down whichever source a config change made stale; the caller
  // re-enters `set hass` to rebuild it. Cached data for the new fetch
  // key is restored at once so the chart doesn't blank while the new
  // subscription is in flight. Returns false when nothing changed.
  invalidate(oldConfig: unknown): boolean {
    const stale = (key: string) =>
      JSON.stringify(keyPath(this.config, key)) !== JSON.stringify(keyPath(oldConfig, key));
    const stationStale = STATION_KEYS.some(stale);
    const forecastStale = FORECAST_KEYS.some(stale);
    if (!stationStale && !forecastStale) return false;

    const old = oldConfig as Parameters<typeof stationFetchKey>[0];
    const oldStationKey = stationFetchKey(old);
    const newStationKey = stationFetchKey(this.config);
    const oldForecastKey = forecastFetchKey(old);
    const newForecastKey = forecastFetchKey(this.config);

    // hourly ↔ today: forecast.type changed but both fetch keys did not,
    // so the data on hand is still right; only the aggregation differs.
    const onlyType = (keys: string[]) => !keys.filter((k) => k !== 'forecast.type').some(stale);
    if (stale('forecast.type') && onlyType(STATION_KEYS) && onlyType(FORECAST_KEYS)
        && oldStationKey === newStationKey && oldForecastKey === newForecastKey) {
      return false;
    }

    if (stationStale) {
      this.teardownStation();
      const cached = oldStationKey !== newStationKey ? this._stationCache[newStationKey] : undefined;
      if (cached?.length) {
        this.stationData = cached.slice();
        this.stationReady = true;
      }
      this._dropDeltaIfPressureChanged(oldConfig);
    }
    if (forecastStale) {
      this.teardownForecast();
      const cached = oldForecastKey !== newForecastKey ? this._forecastCache[newForecastKey] : undefined;
      if (cached?.length) {
        this.forecastData = cached.slice();
        this.forecastReady = true;
      }
    }
    return true;
  }

  // A different pressure sensor makes the cached delta meaningless.
  private _dropDeltaIfPressureChanged(oldConfig: unknown): void {
    const oldPressureId = (oldConfig as { sensors?: { pressure?: string } } | undefined)?.sensors?.pressure;
    if (oldPressureId === this.config.sensors?.pressure) return;
    this.pressureDelta3h = null;
    this._pressureDeltaCache = { bucketMs: null, value: null };
  }

  // Day boundaries and displayed times follow one zone per card (ADR-0030).
  // A zone change drops every source and cache that holds the old days.
  syncCalendar(serverZone: unknown): void {
    const next = cardCalendar(this.config, serverZone);
    if (next.timeZone === this.host.calendar.timeZone) return;
    this.host.calendar = next;
    this._stationCache = {};
    this._pressureDeltaCache = { bucketMs: null, value: null };
    if (this.measured) this.teardownStation();
    this._forecastCache = {};
    if (this.forecastSource) this.teardownForecast();
    this._dropOpenMeteo();
  }

  /** The source plan for the current config and forecast (#450). */
  plan(): SourcePlan {
    return planSources(this.config, this.forecastData, this.host.calendar);
  }

  /** The Open-Meteo source as the forecast pipeline reads it. */
  get openMeteoReader(): OpenMeteoReader | null {
    return this.openMeteo as unknown as OpenMeteoReader | null;
  }

  openMeteoStationWindow(): PipelineEntry[] {
    return openMeteoStationWindow(this.openMeteoReader, this.config, this.host.calendar);
  }

  // Create, keep or drop the Open-Meteo source as the plan says and
  // start a fetch when its cache is stale (no-op while one is in
  // flight). One call backs the sunshine overlay, the chance-of-rain
  // fallback and the past block. Returns the plan it decided on.
  ensureOpenMeteo(): SourcePlan {
    const plan = this.plan();
    const feedsStation = plan.openMeteo.past;
    if (!needsOpenMeteo(plan)) {
      this._dropOpenMeteo();
      return plan;
    }
    const loc = resolveLocation(this.config, this.host._hass);
    if (!loc) {
      // No location, no fetch. When Open-Meteo is the station block's
      // only provider, settle into a forecast-only render instead of
      // waiting on the skeleton.
      if (feedsStation) {
        this.stationData = [];
        this.stationReady = true;
      }
      return plan;
    }

    const { pastDays, forecastDays, includeHourly } = openMeteoFetchWindow(this.config);
    // Each value is baked into the request URL, so any change refetches.
    const src = this.openMeteo;
    const same = src?.latitude === loc.latitude
      && src?.longitude === loc.longitude
      && src?.includeHourly === includeHourly
      && src?.pastDays === pastDays
      && src?.forecastDays === forecastDays;
    if (!same) {
      this._dropOpenMeteo();
      this.openMeteo = new OpenMeteoSource({
        latitude: loc.latitude,
        longitude: loc.longitude,
        pastDays,
        forecastDays,
        includeHourly,
        calendar: this.host.calendar,
      });
      this.openMeteo.setListener((event) => {
        // Re-read the CURRENT config: it may have changed since the
        // source was created. Feeding the station block, every finished
        // fetch (success or failure) resolves the station's loading state.
        if (pastFromOpenMeteo(this.config)) {
          this.stationData = this.openMeteoStationWindow();
          this.stationReady = true;
          this.host.onSourceData();
          return;
        }
        // Overlay-only: update values in the live chart instead of a
        // rebuild, which re-allocated the bar slots and made the precip
        // bars start wide and snap narrow once sunshine landed.
        if (event?.ok) this.host.onOverlayData();
      });
    }
    // The source rehydrates from localStorage in its constructor, so a
    // warm cache fills the past block on the first render.
    if (feedsStation) {
      const win = this.openMeteoStationWindow();
      if (win.length) {
        this.stationData = win;
        this.stationReady = true;
      }
    }
    // Fire-and-forget: the listener handles the redraw on completion.
    void this.openMeteo?.ensureFresh();
    return plan;
  }

  private _dropOpenMeteo(): void {
    if (!this.openMeteo) return;
    this.openMeteo.abort();
    this.openMeteo = null;
  }

  // Persistent-cache keys: everything that changes the fetched payload
  // (period / forecast_type, window, the role → entity mapping, zone) is
  // part of the key, so hydration never shows another signature's data.
  stationSeriesKey(): string {
    const roleEids = Object.entries(this.config.sensors || {})
      .filter((kv): kv is [string, string] => typeof kv[1] === 'string' && kv[1] !== '')
      .map(([role, eid]) => `${role}=${eid}`)
      .sort((a, b) => a.localeCompare(b));
    return seriesCacheKey('station', [
      this.host.calendar.timeZone,
      stationFetchKey(this.config),
      this.config.days,
      ...roleEids,
    ]);
  }

  forecastSeriesKey(): string {
    return seriesCacheKey('forecast', [
      this.host.calendar.timeZone,
      forecastFetchKey(this.config),
      String(this.config.weather_entity || ''),
    ]);
  }

  // Requests a render when the delta lands after the station callback
  // already triggered one.
  async refreshPressureDelta(): Promise<void> {
    const pressureId = this.config.sensors?.pressure;
    if (!pressureId || this.config.show_pressure === false) {
      this.pressureDelta3h = null;
      return;
    }
    try {
      const delta = await fetchPressure3hDelta(
        this.host._hass, pressureId, this.host.calendar, this._pressureDeltaCache,
      );
      if (delta !== this.pressureDelta3h) {
        this.pressureDelta3h = delta;
        this.host.requestUpdate();
      }
    } catch (err) {
      console.debug('[weather-station-card] pressure delta refresh failed', err);
    }
  }

  // Availability scan with a grace period (#213). An HA restart flips
  // every sensor to unavailable for a minute or two: in grace (< 5 min,
  // or HA still starting) the live panel dims and keeps the last values;
  // overdue sensors get a compact warning, never the red banner. A
  // render is requested only when a list actually changed (ADR-0017).
  scanAvailability(hass: HassLike): void {
    const missingNow = unavailableSensors(this.config.sensors || {}, hass.states);
    const now = Date.now();
    this._missingSince = updateMissingSince(this._missingSince, missingNow.map((m) => m.eid), now);

    const coreState = (hass.config as { state?: unknown } | undefined)?.state;
    const haStarting = typeof coreState === 'string' && coreState !== 'RUNNING';
    const overdueSet = haStarting
      ? new Set<string>()
      : new Set(overdueMissing(this._missingSince, UNAVAILABLE_GRACE_MS, now));

    const label = (m: { key: string; eid: string }): string => `${m.key} (${m.eid})`;
    const overdue = missingNow.filter((m) => overdueSet.has(m.eid));
    const inGrace = missingNow.filter((m) => !overdueSet.has(m.eid)).map(label);
    this.overdueIds = new Set(overdue.map((m) => m.eid));
    const overdueLabels = overdue.map(label);
    let changed = false;
    if (overdueLabels.join('|') !== this.missingSensors.join('|')) {
      this.missingSensors = overdueLabels;
      changed = true;
    }
    if (inGrace.join('|') !== this.staleSensors.join('|')) {
      this.staleSensors = inGrace;
      changed = true;
    }
    if (changed) this.host.requestUpdate();

    // In-grace entries must turn overdue even if HA goes silent: re-scan
    // at the earliest expiry.
    this._clearGraceTimer();
    const delay = haStarting ? 30_000 : nextExpiryDelay(this._missingSince, UNAVAILABLE_GRACE_MS, now);
    if (delay !== null && missingNow.length) {
      this._graceTimer = setTimeout(() => {
        this._graceTimer = null;
        if (this.host._hass) this.scanAvailability(this.host._hass);
      }, delay + 1000);
    }
  }

  private _clearGraceTimer(): void {
    if (!this._graceTimer) return;
    clearTimeout(this._graceTimer);
    this._graceTimer = null;
  }
}
