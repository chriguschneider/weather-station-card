// DataSource: feeds the card a `forecast`-shaped array.
//
// The render layer consumes `this.forecasts` — an array of entries with
// fields `datetime`, `temperature`, `templow`, `precipitation`,
// `wind_speed`, `wind_bearing`, `pressure`, `humidity`, `uv_index`,
// `condition`. Anything that produces this shape can drive the chart.
//
// MeasuredDataSource: past data via recorder/statistics_during_period.
// ForecastDataSource: future data via weather/subscribe_forecast.
// Both expose subscribe(callback) → unsubscribe and emit
// { forecast, error? } events.

import {
  classifyDay,
  clearSkyNoonLux,
  clearSkyLuxAt,
  clearSkyLuxFactory,
  type ClassifyInputs,
  type ConditionThresholdOverrides,
} from './condition-classifier.js';
import { WeatherEntityFeature, type ConditionId } from './const.js';
import type { ForecastEntry } from './forecast-utils.js';
import { sunshineFromLuxHistory, type LuxSample } from './sunshine-source.js';
import {
  PRESSURE_CONVERSION,
  toMetersPerSecond,
  luxScaleFor,
  toCelsius,
  toMillimeters,
} from './utils/unit-converters.js';
import { dedupeRequest } from './utils/shared-requests.js';

// Dedup TTL for identical recorder requests across sibling cards on
// the same dashboard. Long enough to absorb staggered card mounts and
// drifting poll timers, short enough that a manual dashboard refresh
// still fetches fresh buckets.
const STATS_DEDUPE_TTL_MS = 60 * 1000;

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** A single recorder/statistics_during_period bucket. The recorder
 *  fills only the keys for the `types` requested in the WS call. */
export interface StatBucket {
  start: string;
  end?: string;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  change?: number | null;
  sum?: number | null;
  state?: number | null;
  last_reset?: string | null;
}

/** WS response shape: `{ entity_id: StatBucket[] }`. */
export type StatsResponse = Record<string, StatBucket[] | undefined>;

/** Sensor-id config bag. All keys optional — the user can wire only
 *  the sensors they have. Each value is a HA entity id (or undefined
 *  when the user hasn't picked one). */
export interface SensorMap {
  temperature?: string;
  humidity?: string;
  pressure?: string;
  wind_speed?: string;
  wind_direction?: string;
  gust_speed?: string;
  illuminance?: string;
  dew_point?: string;
  precipitation?: string;
  /** Dedicated live rate entity (mm/h · in/h). Live-panel and
   *  live-classifier only — the chart bars need bucket accumulation,
   *  which only `precipitation` can supply, so this key is EXCLUDED
   *  from the recorder statistics fetch below. */
  precipitation_rate?: string;
  uv_index?: string;
  /** Sunshine duration entity (handled by the sunshine overlay, not
   *  this module — listed so config-typing stays accurate). */
  sunshine_duration?: string;
  /** DEPRECATED (v2.3, ADR-0022): the moon line is computed in-card
   *  and reads no entity. The key stays typed so configs written for
   *  ≤v2.2 don't fail the type boundary, and stays EXCLUDED from the
   *  recorder statistics fetch below (its enum state has none). */
  moon_phase?: string;
}

/** Card config subset the data sources read from. The full config has
 *  more fields (display, layout, …) but those don't reach this layer. */
export interface DataSourceConfig {
  days?: number | string;
  forecast?: {
    type?: 'daily' | 'hourly' | 'today';
    /** Opt-in: backfill the past block from Open-Meteo when no station
     *  sensors are configured (ADR-0015). Read in main.ts, not by the
     *  data sources themselves — listed here so config typing stays
     *  accurate. */
    openmeteo_history?: boolean;
  } | null;
  sensors?: SensorMap;
  condition_mapping?: ConditionThresholdOverrides & {
    /** Threshold for the Method-B2 lux-derivation: a sample counts
     *  as sunshine when `measured_lux / clearsky_lux ≥ this`.
     *  Default 0.6. */
    sunshine_lux_ratio?: number;
  };
  weather_entity?: string;
  show_station?: boolean;
  show_forecast?: boolean;
}

/** Event payload emitted by both sources via `_listener`. */
export interface DataSourceEvent {
  forecast: ForecastEntry[];
  error?: string;
}

export type DataSourceListener = (event: DataSourceEvent) => void;
export type Unsubscribe = () => void;

/** Subset of the HA Connection API used by `ForecastDataSource`.
 *  `subscribeMessage` resolves to an unsubscribe callback. */
interface HassConnection {
  subscribeMessage(
    callback: (event: { forecast?: ForecastEntry[] } & Record<string, unknown>) => void,
    msg: Record<string, unknown>,
  ): Promise<Unsubscribe>;
}

/** Subset of `HomeAssistant` the data sources read. The full type
 *  comes from custom-card-helpers but importing it here would pull
 *  Lit and a chunk of the editor types. */
export interface HassLike {
  config?: { latitude?: number | null; longitude?: number | null; version?: string };
  states?: Record<string, { state: string; attributes?: Record<string, unknown> } | undefined>;
  connection?: HassConnection;
  callWS<T = unknown>(msg: Record<string, unknown>): Promise<T>;
}

/** Map indexed by bucket-start ms — used by `bucketPrecipitation` to
 *  diff adjacent buckets for `state_class: measurement` sensors. */
export type BucketMap = Map<number, StatBucket>;

function dayOfYearFromDate(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / DAY_MS);
}

/** Bucket-relative rainfall extraction that adapts to the sensor's
 *  `state_class`:
 *
 *    total_increasing → API returns `change`     (use as-is)
 *    total            → API returns `sum`        (use as-is)
 *    measurement      → API returns `max` only   (diff current.max − previous.max)
 *
 *  For the diff path a non-positive delta means the lifetime counter
 *  reset between buckets (battery swap, device reinstall, integration
 *  restart); fall back to current bucket's max as the bucket total in
 *  that case.
 *
 *  The function is bucket-size-agnostic — it works the same for daily
 *  and hourly statistics. Callers pass keys that match whatever bucket
 *  granularity they fetched (`period: 'day'` or `period: 'hour'`).
 *
 *  Exported as a free function so the unit tests don't need to
 *  instantiate `MeasuredDataSource`. */
export function bucketPrecipitation(
  byBucket: BucketMap | null | undefined,
  currentKey: number,
  previousKey: number,
): number | null {
  if (!byBucket) return null;
  const current = byBucket.get(currentKey);
  if (!current) return null;

  if (current.change != null) return current.change;
  if (current.sum != null) return current.sum;
  if (current.max == null) return null;

  const previous = byBucket.get(previousKey);
  if (previous?.max != null) {
    const delta = current.max - previous.max;
    return delta >= 0 ? delta : current.max;
  }
  return current.max;
}

/** 1-entry cache shared between the call site and `fetchPressure3hDelta`.
 *  Caller owns the object; the fetch mutates `bucketMs` / `value` so a
 *  re-render within the same hour skips the WS roundtrip. Reset by
 *  setting `bucketMs = null` (e.g. when the configured sensor changes). */
export interface PressureDeltaCache {
  bucketMs: number | null;
  value: number | null;
}

/** Convert a pressure value from `sourceUnit` to hPa without rounding.
 *  Falls through unchanged when the unit is missing or unknown. */
function toHpa(value: number, sourceUnit: string | undefined): number {
  if (!sourceUnit || sourceUnit === 'hPa') return value;
  const factor = PRESSURE_CONVERSION[`hPa->${sourceUnit}`];
  return factor !== undefined ? value * factor : value;
}

/** Fetch the 3-hour pressure delta in hPa for the configured pressure
 *  sensor. Returns `null` when the recorder has fewer than the two
 *  buckets required (newest hour and 3 h earlier), when either mean is
 *  null, or on fetch error.
 *
 *  When `cache` is provided and its `bucketMs` matches the start of the
 *  current hour, the cached value is returned without issuing a WS
 *  call — multiple renders within the same hour share one roundtrip. */
export async function fetchPressure3hDelta(
  hass: HassLike | null,
  entityId: string | undefined,
  cache?: PressureDeltaCache,
): Promise<number | null> {
  if (!hass || !entityId) return null;

  // Window ends at the start of the current hour (exclusive) so we only
  // pull finalized buckets. The newest bucket starts at `bucketMs - 1h`
  // and the 3 h-earlier bucket starts at `bucketMs - 4h`.
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const bucketMs = now.getTime();
  if (cache?.bucketMs === bucketMs) return cache.value;

  const end = new Date(bucketMs);
  const start = new Date(bucketMs - 4 * HOUR_MS);

  let stats: StatsResponse;
  try {
    // Module-level dedup: the key carries entity + hour bucket, so all
    // cards watching the same pressure sensor share one roundtrip per
    // hour regardless of when each of them renders.
    stats = await dedupeRequest(
      `pressure3h:${entityId}:${bucketMs}`,
      HOUR_MS,
      () => hass.callWS<StatsResponse>({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: [entityId],
        period: 'hour',
        types: ['mean'],
      }),
    );
  } catch (err) {
    console.debug('[weather-station-card] pressure 3h delta fetch failed', err);
    if (cache) { cache.bucketMs = bucketMs; cache.value = null; }
    return null;
  }

  const series = stats?.[entityId];
  let delta: number | null = null;
  if (series && series.length > 0) {
    let newest: StatBucket | null = null;
    let newestMs = -Infinity;
    for (const b of series) {
      const t = new Date(b.start).getTime();
      if (t > newestMs) { newest = b; newestMs = t; }
    }
    if (newest?.mean != null) {
      const targetMs = newestMs - 3 * HOUR_MS;
      const older = series.find((b) => new Date(b.start).getTime() === targetMs);
      if (older?.mean != null) {
        const sourceUnit = hass.states?.[entityId]?.attributes?.unit_of_measurement as
          | string
          | undefined;
        const rawDelta = newest.mean - older.mean;
        delta = toHpa(rawDelta, sourceUnit);
      }
    }
  }

  if (cache) { cache.bucketMs = bucketMs; cache.value = delta; }
  return delta;
}

/** Internal shape of the bag passed to `_mapHourCondition` —
 *  `ClassifyInputs` plus the contextual fields the data source uses
 *  to drive `classifyDay`. */
interface HourClassifyBag extends ClassifyInputs {
  hourStart?: Date;
}

// ── Lux-sunshine per-day cache (perf pass 2026-08) ──────────────────
//
// The B2 lux derivation used to refetch the illuminance sensor's FULL
// high-resolution history over the whole window (days+1, typically 8
// days) on EVERY hourly poll — tens of thousands of rows of JSON over
// the WebSocket plus a recorder DB scan, although completed days can
// never change. The cache stores the derived hours per completed local
// day; once warm, each poll only fetches today's samples (~1/8 of the
// payload). Keyed by entity + derivation parameters so a threshold or
// location change invalidates cleanly.

const LUX_CACHE_PREFIX = 'wsc_lux_days_';
const LUX_CACHE_VERSION = 1;
const LUX_CACHE_MAX_DAYS = 120;

interface LuxDayCacheShape {
  v: number;
  threshold: number;
  lat: number;
  lon: number;
  /** Irradiance→lux multiplier the cached hours were derived with
   *  (1 for plain lux sensors). A unit change on the same entity
   *  invalidates the cache. Missing in v1 payloads → treated as 1. */
  scale?: number;
  days: Record<string, number>;
}

function luxStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function loadLuxDayCache(
  entityId: string,
  threshold: number,
  lat: number,
  lon: number,
  scale: number,
): Record<string, number> | null {
  const storage = luxStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${LUX_CACHE_PREFIX}${entityId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LuxDayCacheShape | null;
    if (parsed?.v !== LUX_CACHE_VERSION) return null;
    // Any derivation-parameter change makes the cached hours wrong.
    if (parsed.threshold !== threshold) return null;
    if ((parsed.scale ?? 1) !== scale) return null;
    if (Math.abs(parsed.lat - lat) > 0.01 || Math.abs(parsed.lon - lon) > 0.01) return null;
    return (parsed.days && typeof parsed.days === 'object') ? parsed.days : null;
  } catch {
    return null;
  }
}

function saveLuxDayCache(
  entityId: string,
  threshold: number,
  lat: number,
  lon: number,
  scale: number,
  days: Record<string, number>,
): void {
  const storage = luxStorage();
  if (!storage) return;
  // Prune oldest entries — YYYY-MM-DD keys sort chronologically.
  const keys = Object.keys(days).sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < keys.length - LUX_CACHE_MAX_DAYS; i++) delete days[keys[i]];
  try {
    storage.setItem(
      `${LUX_CACHE_PREFIX}${entityId}`,
      JSON.stringify({ v: LUX_CACHE_VERSION, threshold, lat, lon, scale, days } satisfies LuxDayCacheShape),
    );
  } catch {
    // Quota / private mode — best-effort.
  }
}

/** Local-date key (YYYY-MM-DD) for a midnight-aligned Date. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class MeasuredDataSource {
  hass: HassLike | null;
  config: DataSourceConfig;

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _listener: DataSourceListener | null = null;
  private _failureCount = 0;
  // True when an interval poll came due while the document was hidden.
  // The poll is skipped then (recorder roundtrips for an invisible
  // dashboard are pure waste); `notifyVisible` runs the deferred poll
  // as soon as the card is on screen again.
  private _pollDeferredWhileHidden = false;

  constructor(hass: HassLike | null, config: DataSourceConfig) {
    this.hass = hass;
    this.config = config;
  }

  setHass(hass: HassLike | null): void {
    this.hass = hass;
  }

  subscribe(callback: DataSourceListener): Unsubscribe {
    this._listener = callback;
    // Fire-and-forget the initial poll; the interval re-polls every
    // POLL_INTERVAL_MS regardless of whether the first call resolves.
    void this._poll(true);
    this._timer = setInterval(() => { void this._poll(); }, POLL_INTERVAL_MS);
    return () => this.unsubscribe();
  }

  unsubscribe(): void {
    this._listener = null;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Called by the card when the document became visible again. Runs
   *  the poll that was skipped while hidden (if any). */
  notifyVisible(): void {
    if (!this._pollDeferredWhileHidden) return;
    this._pollDeferredWhileHidden = false;
    void this._poll();
  }

  private async _poll(initial: boolean = false): Promise<void> {
    if (!this._listener || !this.hass) return;
    // Interval polls are skipped while the document is hidden — a
    // recorder statistics roundtrip for an off-screen dashboard is
    // wasted DB + WS load. The INITIAL poll always runs so a card
    // mounted in a background tab still has data when first shown.
    if (!initial && typeof document !== 'undefined' && document.hidden) {
      this._pollDeferredWhileHidden = true;
      return;
    }
    try {
      const forecast = await this._fetchAggregates();
      this._failureCount = 0;
      if (this._listener) this._listener({ forecast });
    } catch (err) {
      this._failureCount += 1;
      console.error('[weather-station-card] statistics fetch failed', err);
      // After a few consecutive failures, surface to the render layer so
      // the card can display a banner instead of hanging on stale data.
      if (this._failureCount >= 3 && this._listener) {
        const e = err as { message?: string } | null;
        this._listener({ forecast: [], error: String(e?.message ? e.message : err) });
      }
    }
  }

  private async _fetchAggregates(): Promise<ForecastEntry[]> {
    if (!this.hass) return [];
    const cfgDays = parseInt(String(this.config.days), 10) || 7;
    const type = this.config.forecast?.type;
    // 'today' (day pager, 2026-08 rework) shares the FULL hourly
    // window — the render layer 3-h-aggregates the whole span and
    // pages it one day per viewport. Identical fetch parameters also
    // mean 'today' and 'hourly' genuinely share the recorder response
    // via the request dedup and the mode-toggle lazy-cache.
    const isToday = type === 'today';
    const isHourly = type === 'hourly' || isToday;
    const days = cfgDays;
    const sensors: SensorMap = this.config.sensors ?? {};

    // Two keys never reach the recorder:
    //   - moon_phase: legacy ≤v2.2 configs may still carry it (an enum
    //     entity with no statistics); the card itself no longer reads it.
    //   - precipitation_rate: a live-only mm/h reading. Its statistics
    //     are mean/max of a rate, which bucketPrecipitation would
    //     happily diff into a meaningless "rainfall per day".
    const { moon_phase: _moonPhase, precipitation_rate: _precipRate, ...chartSensors } = sensors;
    void _moonPhase;
    void _precipRate;
    const entityIds = Object.values(chartSensors).filter(Boolean) as string[];
    if (entityIds.length === 0) return [];

    if (isHourly) {
      // Window ends at the next full hour (exclusive) and starts at
      // LOCAL MIDNIGHT `days` days back (2026-08): anchoring the start
      // to a day boundary keeps the first day complete, so the scroll
      // timeline's first segment is a full-width day (not a 2px
      // sliver whose label can't render) and the 'today' day pager's
      // first page carries real data instead of gap columns. One
      // extra hour before that start so a cumulative precipitation
      // sensor has a baseline to diff against on the oldest hour.
      const end = new Date();
      end.setMinutes(0, 0, 0);
      end.setHours(end.getHours() + 1);
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - days);
      const start = new Date(dayStart.getTime() - HOUR_MS);
      const hours = Math.round((end.getTime() - start.getTime()) / HOUR_MS) - 1;

      const stats = await this._callStatsDeduped({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: entityIds,
        period: 'hour',
        types: ['min', 'max', 'mean', 'change', 'sum'],
      });

      return this._buildHourlyForecast(stats, sensors, start, hours);
    }

    // Daily path. Window ends at tomorrow midnight (exclusive) so today's
    // partial-day bucket is included as the rightmost column. We fetch
    // one extra day at the start (days+1) so a cumulative precipitation
    // sensor has a baseline value to diff against on the oldest day.
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - (days + 1));

    const stats = await this._callStatsDeduped({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: entityIds,
      period: 'day',
      types: ['min', 'max', 'mean', 'change', 'sum'],
    });

    // Method B2 fallback: when the user has an illuminance sensor
    // configured but no `sensors.sunshine_duration`, derive sunshine
    // duration from the high-resolution illuminance history via the
    // lux/clearsky_lux ratio. Skipped silently if either input is
    // missing — Open-Meteo overlay or F3 then fills the row.
    const luxByDate = await this._fetchLuxSunshine(sensors, start, end);

    return this._buildForecast(stats, sensors, start, days, luxByDate);
  }

  /** Recorder statistics call routed through the module-level request
   *  dedup. Window boundaries are hour-/midnight-aligned, so sibling
   *  cards with the same sensors and window produce byte-identical
   *  request objects — N cards on one dashboard collapse to a single
   *  recorder roundtrip. */
  private _callStatsDeduped(msg: Record<string, unknown>): Promise<StatsResponse> {
    const hass = this.hass as HassLike;
    return dedupeRequest(
      `stats:${JSON.stringify(msg)}`,
      STATS_DEDUPE_TTL_MS,
      () => hass.callWS<StatsResponse>(msg),
    );
  }

  /** B2 past-tier helper: fetch the configured illuminance sensor's
   *  high-resolution history and convert it into a per-day
   *  sunshine-hours map. Returns `null` when the path is inapplicable
   *  (no illuminance sensor, recorder sensor takes precedence, or
   *  the WS call fails) so the caller can short-circuit to the next
   *  precedence tier. */
  private async _fetchLuxSunshine(
    sensors: SensorMap,
    start: Date,
    end: Date,
  ): Promise<Map<string, number> | null> {
    if (!this.hass) return null;
    const luxId = sensors.illuminance;
    if (!luxId || sensors.sunshine_duration) return null;
    const lat = this.hass.config?.latitude;
    const lon = this.hass.config?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const cm = this.config.condition_mapping ?? {};
    const threshold = (cm.sunshine_lux_ratio != null && Number.isFinite(cm.sunshine_lux_ratio))
      ? Number(cm.sunshine_lux_ratio)
      : 0.6;

    // Per-day cache: completed days never change, so after the first
    // full-window fetch every subsequent poll only needs TODAY's
    // samples. `neededDays` walks the completed local days inside the
    // requested window (start is midnight-aligned in the daily path).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const neededDays: string[] = [];
    {
      const d = new Date(start);
      d.setHours(0, 0, 0, 0);
      while (d.getTime() < todayMs) {
        neededDays.push(localDayKey(d));
        d.setDate(d.getDate() + 1);
      }
    }
    // W/m² irradiance sensors convert to lux before the
    // ratio-vs-clear-sky derivation (scale 1 for plain lux sensors);
    // the cache is keyed on the scale so a unit change invalidates.
    const luxScale = this._luxScale(luxId);
    const cachedDays = loadLuxDayCache(luxId, threshold, lat as number, lon as number, luxScale);
    const missingDays = cachedDays
      ? neededDays.filter((k) => cachedDays[k] === undefined)
      : neededDays;
    const fetchStart = missingDays.length === 0 ? today : start;

    // history/history_during_period is the modern, compact recorder
    // history WS call (HA 2022+). Returns
    // { [entity_id]: [ { s: '<state>', lu: <unix-seconds> }, … ] }.
    let history: Record<string, Array<{ s?: unknown; lu?: unknown }>> = {};
    try {
      const hass = this.hass as HassLike;
      const msg = {
        type: 'history/history_during_period',
        start_time: fetchStart.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [luxId],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      };
      // Same cross-card dedup as the stats call — the lux history is
      // by far the heaviest recorder payload the card requests.
      history = await dedupeRequest(
        `history:${JSON.stringify(msg)}`,
        STATS_DEDUPE_TTL_MS,
        () => hass.callWS<typeof history>(msg),
      );
    } catch (err) {
      // Recorder unavailable / entity gone / permission — silently
      // fall through to the next precedence tier rather than show
      // an error banner for an opportunistic enhancement. Cached
      // completed days still serve if we have them.
      console.debug('[weather-station-card] lux-history fetch failed', err);
      return this._luxMapFromCache(cachedDays, neededDays);
    }

    const samples: LuxSample[] = [];
    for (const row of (history[luxId] || [])) {
      const ts = typeof row.lu === 'number' ? row.lu * 1000 : NaN;
      const lux = typeof row.s === 'string' ? parseFloat(row.s) : NaN;
      if (Number.isFinite(ts) && Number.isFinite(lux) && lux >= 0) {
        samples.push({ ts, lux: lux * luxScale });
      }
    }
    if (samples.length < 2) return this._luxMapFromCache(cachedDays, neededDays);

    const perDay = sunshineFromLuxHistory(samples, lat as number, lon as number, threshold);

    // Result map: cached completed days first, freshly-derived values
    // (today, plus any completed days this fetch covered) on top.
    const map = new Map<string, number>();
    if (cachedDays) {
      for (const k of neededDays) {
        if (cachedDays[k] !== undefined) map.set(k, cachedDays[k]);
      }
    }
    for (const e of perDay) map.set(e.date, e.hours);

    // Persist every completed day the fetch window covered. Days the
    // derivation emitted nothing for are stored as an explicit 0 in
    // the CACHE (preventing a perpetual refetch for genuinely sunless
    // or sensor-offline days) but NOT injected into the returned map —
    // the caller's "configured sunshine source is authoritative → 0 h"
    // rule produces the same 0 downstream, and the returned map keeps
    // its historical only-days-with-sunshine shape.
    const fetchedFromMs = fetchStart.getTime();
    const updated: Record<string, number> = { ...(cachedDays ?? {}) };
    let dirty = false;
    for (const k of neededDays) {
      const dayMs = new Date(`${k}T00:00`).getTime();
      if (!Number.isFinite(dayMs) || dayMs < fetchedFromMs) continue;
      const v = map.get(k) ?? 0;
      if (updated[k] !== v) { updated[k] = v; dirty = true; }
    }
    if (dirty) saveLuxDayCache(luxId, threshold, lat as number, lon as number, luxScale, updated);
    return map;
  }

  /** Cache-only fallback when the history fetch failed or returned too
   *  few samples: serve whatever completed days we have; null when the
   *  cache has nothing usable (caller falls to the next tier). */
  private _luxMapFromCache(
    cachedDays: Record<string, number> | null,
    neededDays: ReadonlyArray<string>,
  ): Map<string, number> | null {
    if (!cachedDays) return null;
    const map = new Map<string, number>();
    for (const k of neededDays) {
      if (cachedDays[k] !== undefined) map.set(k, cachedDays[k]);
    }
    return map.size ? map : null;
  }

  private _buildForecast(
    stats: StatsResponse,
    sensors: SensorMap,
    start: Date,
    days: number,
    luxByDate: Map<string, number> | null = null,
  ): ForecastEntry[] {
    // Index each entity's series by midnight-of-day so day alignment doesn't
    // depend on positional indices (the API omits entries for empty days).
    const byDate: Record<string, BucketMap> = {};
    for (const [eid, series] of Object.entries(stats || {})) {
      const m: BucketMap = new Map();
      for (const entry of series ?? []) {
        const d = new Date(entry.start);
        d.setHours(0, 0, 0, 0);
        m.set(d.getTime(), entry);
      }
      byDate[eid] = m;
    }

    const dayMs = (date: Date): number => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };

    const windUnit = this._sensorUnit(sensors.wind_speed) || this._sensorUnit(sensors.gust_speed);
    const tempUnit = this._sensorUnit(sensors.temperature);
    const dewUnit = this._sensorUnit(sensors.dew_point) || tempUnit;
    const precipUnit = this._sensorUnit(sensors.precipitation);
    const out: ForecastEntry[] = [];
    for (let i = 1; i <= days; i++) {
      const dayStart = new Date(start);
      dayStart.setDate(start.getDate() + i);
      const dayKey = dayMs(dayStart);
      const prevKey = dayKey - DAY_MS;
      // Today is always the LAST bucket in the daily window (the caller
      // sizes start so start+days lands on today).
      const isToday = i === days;

      const at = (eid: string | undefined, field: keyof StatBucket): number | null => {
        if (!eid) return null;
        const m = byDate[eid];
        if (!m) return null;
        const e = m.get(dayKey);
        if (!e) return null;
        const v = e[field];
        return v === undefined ? null : (v as number | null);
      };

      let tempMax = at(sensors.temperature, 'max');
      let tempMin = at(sensors.temperature, 'min');
      // Fold the live reading into today's running high/low so the
      // current day always carries a measured temperature point. Today's
      // daily statistic is rolled up from COMPLETED hourly statistics, so
      // it lags real-time by up to an hour and is empty entirely in the
      // first hour after local midnight. When the bucket is still empty
      // both collapse to the live value (a single anchor); once completed
      // hours exist, max()/min() keep the recorded extremes and only
      // stretch the range to the live value. Without this the today column
      // goes null, the solid line stops at yesterday, and the de-overlap
      // in main.ts strands today on the forecast side — the visible gap.
      if (isToday) {
        const live = this._liveNumber(sensors.temperature);
        if (live != null) {
          tempMax = tempMax == null ? live : Math.max(tempMax, live);
          tempMin = tempMin == null ? live : Math.min(tempMin, live);
        }
      }
      const humidityMean = at(sensors.humidity, 'mean');
      const pressureMean = at(sensors.pressure, 'mean');
      const windMean = at(sensors.wind_speed, 'mean');
      const gustMax = at(sensors.gust_speed, 'max');
      const luxMaxRaw = at(sensors.illuminance, 'max');
      // Irradiance sensors (W/m²) scale into lux for the classifier's
      // clear-sky ratio; plain lux sensors pass through (scale 1).
      const luxMax = luxMaxRaw != null ? luxMaxRaw * this._luxScale(sensors.illuminance) : luxMaxRaw;
      const dewPointMean = at(sensors.dew_point, 'mean');

      const precipitation = sensors.precipitation
        ? bucketPrecipitation(byDate[sensors.precipitation], dayKey, prevKey)
        : null;

      // Sunshine duration from a HA recorder sensor (e.g. integration
      // sensor on `sensor.open_meteo_sunshine_today`). Daily-max is
      // the running total; for completed past days it's the full
      // day's sunshine in seconds (or hours, normalised by
      // attachSunshine). For TODAY's bucket the value is partial —
      // at 10 am it's the morning's "sunshine-so-far". #16 (closed)
      // briefly substituted Open-Meteo's full-day forecast there to
      // avoid the morning-feels-tiny problem, but the user feedback
      // in #37 (which is what reverts that here) was that the
      // forecast value felt wrong in the afternoon: an overcast
      // afternoon would still show "11 h" because the morning had
      // predicted it. Showing the measured running total is the
      // empirical truth even when small early in the day.
      let sunshineRaw = sensors.sunshine_duration
        ? at(sensors.sunshine_duration, 'max')
        : null;
      // B2 fallback: when no recorder sunshine sensor resolved
      // a value, look up the per-day total from the lux-derivation
      // map computed from the illuminance sensor's history. The
      // map's date key is `YYYY-MM-DD` in the local timezone — same
      // shape `sunshineFromLuxHistory` emits. Recorder sensor
      // (Method C) still wins when both are available.
      if (sunshineRaw == null && luxByDate) {
        const dayKeyStr = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
        const luxHours = luxByDate.get(dayKeyStr);
        if (luxHours != null && Number.isFinite(luxHours)) {
          sunshineRaw = luxHours;
        }
      }
      // A configured station sunshine source is authoritative for the
      // station columns: a day it has no value for is 0 h measured, not
      // "no data". Leaving sunshineRaw null lets attachSunshine's
      // Open-Meteo overlay overwrite the station column with a forecast
      // value — e.g. an overcast morning, where the lux derivation finds
      // no above-threshold interval and emits no entry, would otherwise
      // show the full-day forecast instead of the measured 0 h.
      if (sunshineRaw == null && (sensors.sunshine_duration || sensors.illuminance)) {
        sunshineRaw = 0;
      }

      out.push({
        datetime: dayStart.toISOString(),
        temperature: tempMax,
        templow: tempMin,
        precipitation,
        wind_speed: windMean,
        wind_gust_speed: gustMax,
        wind_bearing: at(sensors.wind_direction, 'mean'),
        pressure: pressureMean,
        humidity: humidityMean,
        uv_index: at(sensors.uv_index, 'max'),
        sunshine: sunshineRaw,
        condition: this._mapCondition({
          temp_max: toCelsius(tempMax, tempUnit),
          temp_min: toCelsius(tempMin, tempUnit),
          humidity: humidityMean,
          lux_max: luxMax,
          precip_total: toMillimeters(precipitation, precipUnit),
          wind_mean: toMetersPerSecond(windMean, windUnit),
          gust_max: toMetersPerSecond(gustMax, windUnit),
          dew_point_mean: toCelsius(dewPointMean, dewUnit),
        }, dayOfYearFromDate(dayStart)),
      });
    }
    return out;
  }

  /** Lux multiplier for the configured illuminance slot: 120 when the
   *  entity is a solar-IRRADIANCE sensor (W/m² unit or
   *  `device_class: irradiance` — community post 15, point 5), 1 for
   *  a plain lux sensor. Applied once wherever raw readings enter the
   *  lux-based sun pipeline. */
  private _luxScale(eid?: string): number {
    if (!eid || !this.hass?.states) return 1;
    const attrs = this.hass.states[eid]?.attributes as
      { unit_of_measurement?: unknown; device_class?: unknown } | undefined;
    return luxScaleFor(attrs?.unit_of_measurement, attrs?.device_class);
  }

  /** Native unit_of_measurement of a sensor entity, or undefined.
   *  classifyDay is unit-blind (°C / mm / m/s), so the builders use this
   *  to normalise each input to the classifier's canonical unit before
   *  feeding it — otherwise km/h wind, °F temp, or inch precip
   *  misclassify against the m/s / °C / mm thresholds. */
  private _sensorUnit(eid?: string): string | undefined {
    return eid
      ? (this.hass?.states?.[eid]?.attributes?.unit_of_measurement as string | undefined)
      : undefined;
  }

  /** Entity's current numeric state, or null when missing / non-finite.
   *  Used to live-fill the in-progress bucket the recorder hasn't
   *  finalized yet — today's daily column and the current hourly bucket.
   *  It's the same value the dashboard's "now" panel shows, so the
   *  fallback is both correct and consistent UX. */
  private _liveNumber(eid?: string): number | null {
    if (!eid || !this.hass?.states) return null;
    const s = this.hass.states[eid];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  private _mapCondition(day: ClassifyInputs, dayOfYear: number): ConditionId {
    const lat = this.hass?.config ? this.hass.config.latitude : null;
    const clearsky_lux = lat != null
      ? clearSkyNoonLux(lat, dayOfYear)
      : 110000; // sea-level perpendicular-sun fallback (IES)
    return classifyDay({ ...day, clearsky_lux }, this.config.condition_mapping ?? {});
  }

  /** Hourly counterpart to _buildForecast. Emits one entry per hour
   *  (datetime = hour-start ISO). Differences from daily:
   *    - temperature is the hourly `mean` (single-line render — see
   *      hourlyTempSeries in forecast-utils).
   *    - templow is omitted; the chart hides dataset[1] when no entry
   *      carries a low.
   *    - precipitation uses `bucketPrecipitation` against the previous
   *      hour as baseline (same logic as daily, just at hour scale).
   *    - condition still goes through `classifyDay`; clear-sky lux is
   *      computed for the actual hour rather than the day's noon, so
   *      the cloud-cover ratio reflects the relevant solar geometry.
   *      Threshold semantics (rainy_threshold_mm etc.) are kept as-is
   *      and known to be conservative at hour scale. */
  private _buildHourlyForecast(
    stats: StatsResponse,
    sensors: SensorMap,
    start: Date,
    hours: number,
  ): ForecastEntry[] {
    const byHour: Record<string, BucketMap> = {};
    for (const [eid, series] of Object.entries(stats || {})) {
      const m: BucketMap = new Map();
      for (const entry of series ?? []) {
        const d = new Date(entry.start);
        d.setMinutes(0, 0, 0);
        m.set(d.getTime(), entry);
      }
      byHour[eid] = m;
    }

    // Precompute lat/lon trig once and cache declination per day-of-year.
    // ~168 hourly rows × ~5 trig calls in clearSkyLuxAt would be ~840 trig
    // ops; with this factory it's ~168 (one cos(hourAngle) per row, the
    // rest reused from the cache).
    const cfg = this.hass?.config;
    const luxFor = clearSkyLuxFactory(cfg ? cfg.latitude : null, cfg ? cfg.longitude : null);

    const hourMs = (date: Date): number => {
      const d = new Date(date);
      d.setMinutes(0, 0, 0);
      return d.getTime();
    };

    const windUnit = this._sensorUnit(sensors.wind_speed) || this._sensorUnit(sensors.gust_speed);
    const tempUnit = this._sensorUnit(sensors.temperature);
    const dewUnit = this._sensorUnit(sensors.dew_point) || tempUnit;
    const precipUnit = this._sensorUnit(sensors.precipitation);
    const out: ForecastEntry[] = [];
    for (let i = 1; i <= hours; i++) {
      const hourStart = new Date(start.getTime() + i * HOUR_MS);
      const hourKey = hourMs(hourStart);
      const prevKey = hourKey - HOUR_MS;
      const isLastHour = i === hours;

      const at = (eid: string | undefined, field: keyof StatBucket): number | null => {
        if (!eid) return null;
        const m = byHour[eid];
        if (!m) return null;
        const e = m.get(hourKey);
        if (!e) return null;
        const v = e[field];
        return v === undefined ? null : (v as number | null);
      };
      // For the last (current, partial) hour: when the recorder hasn't
      // got the bucket yet, use the live state. For complete past hours
      // a missing entry is genuine missing data — keep null so Chart.js
      // draws a gap.
      const atOrLive = (eid: string | undefined, field: keyof StatBucket): number | null => {
        const v = at(eid, field);
        if (v != null || !isLastHour) return v;
        return this._liveNumber(eid);
      };

      const tempMean = atOrLive(sensors.temperature, 'mean');
      let tempMax = at(sensors.temperature, 'max');
      let tempMin = at(sensors.temperature, 'min');
      const humidityMean = atOrLive(sensors.humidity, 'mean');
      const pressureMean = atOrLive(sensors.pressure, 'mean');
      const windMean = atOrLive(sensors.wind_speed, 'mean');
      const gustMax = atOrLive(sensors.gust_speed, 'max');
      const luxMaxRaw = atOrLive(sensors.illuminance, 'max');
      // Same irradiance→lux scaling as the daily path.
      const luxMax = luxMaxRaw != null ? luxMaxRaw * this._luxScale(sensors.illuminance) : luxMaxRaw;
      const dewPointMean = atOrLive(sensors.dew_point, 'mean');
      // For the last hour with only a single live datapoint, max/min
      // collapse to the same value so the classifier still gets numbers
      // to work with (otherwise temp_max/min stay null and several
      // classifier branches go through the no-data fallback).
      if (isLastHour) {
        tempMax ??= tempMean;
        tempMin ??= tempMean;
      }

      let precipitation = sensors.precipitation
        ? bucketPrecipitation(byHour[sensors.precipitation], hourKey, prevKey)
        : null;
      if (isLastHour && precipitation == null && sensors.precipitation) {
        // Mirror the live-fill we do for temperature, scaled to the
        // bucketPrecipitation semantics: treat the entity's live state
        // as a synthetic "current.max" for the in-progress hour and
        // diff against the previous hour's recorded max.
        const live = this._liveNumber(sensors.precipitation);
        const map = byHour[sensors.precipitation];
        const prev = map ? map.get(prevKey) : null;
        if (live != null && prev?.max != null) {
          const delta = live - prev.max;
          precipitation = delta >= 0 ? delta : live;
        }
      }

      out.push({
        datetime: hourStart.toISOString(),
        temperature: tempMean,
        precipitation,
        wind_speed: windMean,
        wind_gust_speed: gustMax,
        wind_bearing: atOrLive(sensors.wind_direction, 'mean'),
        pressure: pressureMean,
        humidity: humidityMean,
        uv_index: atOrLive(sensors.uv_index, 'max'),
        condition: this._mapHourCondition({
          temp_max: toCelsius(tempMax, tempUnit),
          temp_min: toCelsius(tempMin, tempUnit),
          humidity: humidityMean,
          lux_max: luxMax,
          precip_total: toMillimeters(precipitation, precipUnit),
          wind_mean: toMetersPerSecond(windMean, windUnit),
          gust_max: toMetersPerSecond(gustMax, windUnit),
          dew_point_mean: toCelsius(dewPointMean, dewUnit),
          hourStart,
          clearsky_lux: luxFor(hourStart),
        }),
      });
    }
    return out;
  }

  private _mapHourCondition(hour: HourClassifyBag): ConditionId {
    // Caller (_buildHourlyForecast) precomputes clearsky_lux via the
    // cached factory so we don't redo per-row trig. Fall back to a
    // per-call clearSkyLuxAt if a caller passes the raw hour bag without
    // it (e.g. tests).
    let clearsky_lux = hour.clearsky_lux;
    if (clearsky_lux == null) {
      const cfg = this.hass?.config;
      const lat = cfg ? cfg.latitude : null;
      const lon = cfg ? cfg.longitude : null;
      clearsky_lux = (lat != null && lon != null)
        ? clearSkyLuxAt(lat, lon, hour.hourStart)
        : 110000;
    }
    const { hourStart: _ignored, clearsky_lux: _ignoredLux, ...inputs } = hour;
    void _ignored;
    void _ignoredLux;
    return classifyDay({ ...inputs, clearsky_lux }, this.config.condition_mapping ?? {}, 'hour');
  }
}

export class ForecastDataSource {
  hass: HassLike | null;
  config: DataSourceConfig;

  private _listener: DataSourceListener | null = null;
  private _unsubPromise: Promise<Unsubscribe> | null = null;
  private _lastEntity: string | null = null;
  private _lastType: string | null = null;

  constructor(hass: HassLike | null, config: DataSourceConfig) {
    this.hass = hass;
    this.config = config;
  }

  setHass(hass: HassLike | null): void {
    this.hass = hass;
    // Resubscribe if entity or forecast type changed via config edit.
    const entity = this.config.weather_entity;
    const type = (this.config.forecast?.type) || 'daily';
    if (this._listener && (entity !== this._lastEntity || type !== this._lastType)) {
      this._resubscribe();
    }
  }

  subscribe(callback: DataSourceListener): Unsubscribe {
    this._listener = callback;
    this._resubscribe();
    return () => { void this.unsubscribe(); };
  }

  async unsubscribe(): Promise<void> {
    this._listener = null;
    const pending = this._unsubPromise;
    // Always clear the slot first so a subsequent unsubscribe() doesn't
    // await the same (possibly rejected) promise. If subscribeMessage
    // rejected, awaiting it again would just re-throw without progress.
    this._unsubPromise = null;
    if (!pending) return;
    try {
      const unsub = await pending;
      if (typeof unsub === 'function') unsub();
    } catch (err) {
      // Pending subscribe rejected or already disposed — either way the
      // resource is gone, no further teardown to do.
      void err;
    }
  }

  private _resubscribe(): void {
    if (this._unsubPromise) {
      const pending = this._unsubPromise;
      this._unsubPromise = null;
      pending.then(
        (unsub) => {
          try {
            if (typeof unsub === 'function') unsub();
          } catch (err) {
            // Disposing a previous subscription that already errored —
            // nothing actionable for the caller mid-resubscribe.
            void err;
          }
        },
        () => { /* rejected — nothing to dispose */ },
      );
    }
    const entity = this.config.weather_entity;
    if (!entity) {
      this._emit({ forecast: [], error: 'weather_entity not configured' });
      return;
    }
    const state = this.hass?.states?.[entity];
    if (!state) {
      this._emit({ forecast: [], error: `weather entity "${entity}" not found` });
      return;
    }
    const type = (this.config.forecast?.type) || 'daily';
    // 'today' is hourly with days=1 — same forecast subscription.
    const isHourly = type === 'hourly' || type === 'today';
    const feature = isHourly ? WeatherEntityFeature.FORECAST_HOURLY : WeatherEntityFeature.FORECAST_DAILY;
    const supported = state.attributes && state.attributes.supported_features as number | undefined;
    if (!supported || (supported & feature) === 0) {
      this._emit({ forecast: [], error: `entity "${entity}" does not support ${isHourly ? 'hourly' : 'daily'} forecasts` });
      return;
    }
    this._lastEntity = entity;
    this._lastType = type;
    try {
      if (!this.hass?.connection) {
        this._emit({ forecast: [], error: 'hass connection unavailable' });
        return;
      }
      // Tag each entry with the weather entity's wind_speed_unit so
      // the renderer can convert correctly even when the station
      // sensor (which feeds the synthetic weather attributes used as
      // the default fromUnit) reports a different unit. Without this,
      // a m/s station + km/h weather entity yields ~3.6× too-high
      // forecast wind.
      const wxWindUnit = state.attributes?.wind_speed_unit as string | undefined;
      this._unsubPromise = this.hass.connection.subscribeMessage(
        (event) => {
          const raw = (event.forecast as ForecastEntry[]) || [];
          const tagged = wxWindUnit
            ? raw.map((e) => ({ ...e, wind_speed_unit: wxWindUnit }))
            : raw;
          this._emit({ forecast: tagged });
        },
        {
          type: 'weather/subscribe_forecast',
          forecast_type: isHourly ? 'hourly' : 'daily',
          entity_id: entity,
        },
      );
    } catch (err) {
      const e = err as { message?: string } | null;
      this._emit({ forecast: [], error: String(e?.message ? e.message : err) });
    }
  }

  private _emit(event: DataSourceEvent): void {
    if (this._listener) this._listener(event);
  }
}
