// Data sources that feed the card `ForecastEntry[]`-shaped arrays.
// MeasuredDataSource: past data via recorder/statistics_during_period.
// ForecastDataSource: future data via weather/subscribe_forecast.
// Both expose subscribe(callback) → unsubscribe and emit { forecast, error? }.

import {
  classifyDay,
  clearSkyNoonLux,
  clearSkyLuxAt,
  clearSkyLuxFactory,
  type ClassifyInputs,
  type ConditionThresholdOverrides,
} from './condition-classifier.js';
import { WeatherEntityFeature, type ConditionId } from './const.js';
import {
  anchorDailyDatetime,
  normalizeHourlyDatetime,
  type ForecastEntry,
} from './forecast-utils.js';
import { resolveLocation } from './location.js';
import { sunshineFromLuxHistory, type LuxSample } from './sunshine-source.js';
import { stationUnits, weatherEntityUnits, type UnitSystemLike, type WeatherUnits } from './sensor-readings.js';
import { deltaToCanonical, toCanonical, type Quantity } from './utils/units.js';
import { parseNumericSafe } from './utils/numeric.js';
import {
  luxScaleFor,
  toCelsius,
  toMillimeters,
} from './utils/unit-converters.js';
import { dedupeRequest } from './utils/shared-requests.js';
import { safeLocalStorage } from './utils/safe-storage.js';
import { HOUR_MS, serverCalendar, type Calendar } from './utils/time-zone.js';

// Long enough to absorb staggered card mounts and drifting poll timers,
// short enough that a manual dashboard refresh still fetches fresh buckets.
const STATS_DEDUPE_TTL_MS = 60 * 1000;

const POLL_INTERVAL_MS = 60 * 60 * 1000;

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

// Key order mirrors the editor's picker grid so the type, the stub config,
// the docs table and the UI all read the same.
export interface SensorMap {
  temperature?: string;
  pressure?: string;
  humidity?: string;
  dew_point?: string;
  precipitation?: string;
  /** Dedicated live rate entity (mm/h · in/h). Live-panel and
   *  live-classifier only — the chart bars need bucket accumulation,
   *  which only `precipitation` can supply, so this key is EXCLUDED
   *  from the recorder statistics fetch below. */
  precipitation_rate?: string;
  wind_speed?: string;
  gust_speed?: string;
  wind_direction?: string;
  illuminance?: string;
  uv_index?: string;
  /** Sunshine duration entity (handled by the sunshine overlay, not
   *  this module — listed so config-typing stays accurate). */
  sunshine_duration?: string;
  /** Deprecated (ADR-0022): the moon line is computed in-card and reads
   *  no entity. Stays typed so old configs pass, and is EXCLUDED from the
   *  recorder statistics fetch (its enum state has none). */
  moon_phase?: string;
}

/** Card config subset the data sources read from. The full config has
 *  more fields (display, layout, …) but those don't reach this layer. */
export interface DataSourceConfig {
  days?: number | string;
  forecast?: {
    type?: 'daily' | 'hourly' | 'today';
    /** Opt-in Open-Meteo backfill of the past block (ADR-0015). Not read
     *  by the data sources; listed so config typing stays accurate. */
    openmeteo_history?: boolean;
  } | null;
  sensors?: SensorMap;
  condition_mapping?: ConditionThresholdOverrides & {
    /** A lux sample counts as sunshine when `measured_lux / clearsky_lux
     *  ≥ this`. Default 0.6. */
    sunshine_lux_ratio?: number;
  };
  weather_entity?: string;
  /** Card `location` option; validated by `parseLocation`. */
  location?: unknown;
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
  config?: {
    latitude?: number | null;
    longitude?: number | null;
    version?: string;
    /** The HA server's IANA zone. */
    time_zone?: string;
    unit_system?: UnitSystemLike;
  };
  states?: Record<string, { state: string; attributes?: Record<string, unknown> } | undefined>;
  connection?: HassConnection;
  callWS<T = unknown>(msg: Record<string, unknown>): Promise<T>;
}

// A forecast field as its canonical unit (ADR-0035): numbers and numeric
// strings convert, anything else and an unknown unit give null.
function canonicalField(quantity: Quantity, value: unknown, unit: unknown): number | null {
  return toCanonical(quantity, typeof value === 'number' ? value : parseNumericSafe(value), unit);
}

/** Buckets indexed by start ms. */
export type BucketMap = Map<number, StatBucket>;

/** Bucket-relative rainfall extraction that adapts to the sensor's
 *  `state_class`:
 *
 *    total_increasing → API returns `change`     (use as-is)
 *    total            → API returns `sum`        (use as-is)
 *    measurement      → API returns `max` only   (diff current.max − previous.max)
 *
 *  A negative delta means the lifetime counter reset between buckets
 *  (battery swap, reinstall); the current bucket's max is the total then.
 *  Bucket-size-agnostic: callers pass keys of the granularity they fetched. */
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

/** A card-day bucket reduced from hourly statistics; `hours` counts the
 *  hour buckets that fell into the day (23 / 25 on DST days). */
export interface DayStatBucket extends StatBucket {
  hours: number;
}

/** Reduce hourly recorder buckets to days of `calendar` (#355). HA's
 *  `period: 'day'` cuts at the SERVER's midnight and the WS command
 *  takes no zone, so the card cuts its own days from `period: 'hour'`.
 *
 *  Each hour goes to the day containing its start. In a half-hour zone
 *  (Asia/Kolkata) HA's UTC-aligned hour straddles the card midnight;
 *  it counts for the day it starts in.
 *
 *  Per field, mirroring HA's own day reduction
 *  (`homeassistant/components/recorder/statistics.py`,
 *  `_reduce_statistics`): min of mins, max of maxes, sum of `change`,
 *  the last hour's `sum` (a running total, not a per-hour amount), and
 *  the arithmetic mean of the hour means — an approximation that
 *  weights every hour equally. A field no hour carried stays absent. */
export function reduceHourlyToDays(
  series: ReadonlyArray<StatBucket> | null | undefined,
  calendar: Calendar,
): DayStatBucket[] {
  const byDay = new Map<string, DayAcc>();
  for (const { b, t } of byStart(series)) {
    const key = calendar.dayKey(t);
    let acc = byDay.get(key);
    if (!acc) {
      acc = { day: { start: calendar.startOfDay(t).toISOString(), hours: 0 }, meanTotal: 0, meanCount: 0 };
      byDay.set(key, acc);
    }
    addHour(acc, b);
  }
  return [...byDay.values()].map((acc) => {
    if (acc.meanCount > 0) acc.day.mean = acc.meanTotal / acc.meanCount;
    return acc.day;
  });
}

interface DayAcc {
  day: DayStatBucket;
  meanTotal: number;
  meanCount: number;
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function addHour(acc: DayAcc, b: StatBucket): void {
  const day = acc.day;
  day.hours += 1;
  if (finite(b.min)) day.min = finite(day.min) ? Math.min(day.min, b.min) : b.min;
  if (finite(b.max)) day.max = finite(day.max) ? Math.max(day.max, b.max) : b.max;
  if (finite(b.change)) day.change = (day.change ?? 0) + b.change;
  if (finite(b.sum)) day.sum = b.sum;
  if (finite(b.mean)) { acc.meanTotal += b.mean; acc.meanCount += 1; }
}

/** Buckets with a parseable start, oldest first. */
function byStart(series: ReadonlyArray<StatBucket> | null | undefined): Array<{ b: StatBucket; t: number }> {
  return (series ?? [])
    .map((b) => ({ b, t: new Date(b.start).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((x, y) => x.t - y.t);
}

/** Each card day's sunshine total from a sunshine-duration sensor's
 *  HOURLY statistics: the value at the END of the day.
 *
 *  The sensor is either a counter that resets at the SENSOR's midnight
 *  (a utility meter runs in the server zone) or a forecast total that
 *  is revised during the day, up AND down (hass-meteoswiss-weather
 *  "sunshine duration today"). The last hour's value is the final
 *  total for both; a running maximum would keep a forecast's highest
 *  intermediate value.
 *
 *  The counter reset lands a beat AFTER the hour rolls over, so HA
 *  records the server's 00:00 bucket as `min 0, max <yesterday's
 *  final>`. Its `min` is the post-reset floor; every other hour's
 *  `max` is the value at the hour's end.
 *
 *  Each hour's signed change is credited to the card day that hour
 *  starts in; a card day spanning two server days sums both. */
export function sunshineDailyTotals(
  series: ReadonlyArray<StatBucket> | null | undefined,
  calendar: Calendar,
  serverCalendar: Calendar,
): Map<string, number> | null {
  const serverDays = new Map<string, Array<{ t: number; v: number }>>();
  for (const { b, t } of byStart(series)) {
    const v = sunshineHourValue(b, t, serverCalendar);
    if (!finite(v)) continue;
    const sKey = serverCalendar.dayKey(t);
    const hours = serverDays.get(sKey);
    if (hours) hours.push({ t, v });
    else serverDays.set(sKey, [{ t, v }]);
  }
  const byDay = new Map<string, number>();
  // Signed change per hour: within a server day the steps add up to the
  // last known value, so a downward forecast revision lowers the total
  // and a missing last bucket falls back to the latest value.
  for (const hours of serverDays.values()) {
    let prev = 0;
    for (const { t, v } of hours) {
      const key = calendar.dayKey(t);
      byDay.set(key, (byDay.get(key) ?? 0) + (v - prev));
      prev = v;
    }
  }
  // A cross-zone split can leave a card day below zero after a downward
  // revision.
  for (const [key, v] of byDay) if (v < 0) byDay.set(key, 0);
  return byDay.size ? byDay : null;
}

/** The sensor value an hourly sunshine bucket stands for; see
 *  `sunshineDailyTotals` for why the server's 00:00 bucket reads `min`. */
function sunshineHourValue(b: StatBucket, t: number, serverCalendar: Calendar): number | null | undefined {
  return serverCalendar.hourOf(t) === 0 ? b.min : b.max;
}

/** The value of the newest hourly bucket inside the server day that
 *  contains `now`: the part of the live sensor state that
 *  `sunshineDailyTotals` has already credited to card days. 0 before
 *  the first bucket of that server day, where the counter starts. */
export function sunshineServerDayLast(
  series: ReadonlyArray<StatBucket> | null | undefined,
  serverCalendar: Calendar,
  now: number,
): number {
  const dayKey = serverCalendar.dayKey(now);
  let last = 0;
  for (const { b, t } of byStart(series)) {
    if (t > now || serverCalendar.dayKey(t) !== dayKey) continue;
    const v = sunshineHourValue(b, t, serverCalendar);
    if (finite(v)) last = v;
  }
  return last;
}

/** Caller-owned 1-entry cache for `fetchPressure3hDelta`: a re-render
 *  within the same hour skips the WS roundtrip. Reset with `bucketMs = null`
 *  (e.g. when the configured sensor changes). */
export interface PressureDeltaCache {
  bucketMs: number | null;
  value: number | null;
}

/** Fetch the 3-hour pressure delta in hPa for the configured pressure
 *  sensor. Returns `null` when the recorder has fewer than the two
 *  buckets required (newest hour and 3 h earlier), when either mean is
 *  null, when the sensor's unit is not a known pressure unit, or on fetch
 *  error. A sensor without a unit is read in `assumedUnit`. A `cache` hit for the current hour skips the WS call. */
export async function fetchPressure3hDelta(
  hass: HassLike | null,
  entityId: string | undefined,
  calendar: Calendar,
  cache?: PressureDeltaCache,
  assumedUnit = 'hPa',
): Promise<number | null> {
  if (!hass || !entityId) return null;

  // Window ends at the start of the current hour (exclusive) so we only
  // pull finalized buckets. The newest bucket starts at `bucketMs - 1h`
  // and the 3 h-earlier bucket starts at `bucketMs - 4h`.
  const bucketMs = calendar.startOfHour(Date.now()).getTime();
  if (cache?.bucketMs === bucketMs) return cache.value;

  const end = new Date(bucketMs);
  const start = new Date(bucketMs - 4 * HOUR_MS);

  let stats: StatsResponse;
  try {
    // Key carries entity + hour bucket: cards on the same sensor share one roundtrip per hour.
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
        delta = deltaToCanonical('pressure', rawDelta, sourceUnit || assumedUnit);
      }
    }
  }

  if (cache) { cache.bucketMs = bucketMs; cache.value = delta; }
  return delta;
}

interface HourClassifyBag extends ClassifyInputs {
  hourStart?: Date;
}

// Per-day lux-sunshine cache: completed days never change, so once warm each
// poll fetches only today's samples. Keyed by entity, zone and derivation
// parameters, so a threshold, scale or location change invalidates it.

const LUX_CACHE_PREFIX = 'wsc_lux_days_';
// The key carries the time zone the days were cut in (ADR-0030).
const LUX_CACHE_VERSION = 2;
const LUX_CACHE_MAX_DAYS = 120;

interface LuxDayCacheShape {
  v: number;
  threshold: number;
  lat: number;
  lon: number;
  /** Irradiance→lux multiplier the cached hours were derived with
   *  (1 for plain lux sensors); a unit change invalidates the cache.
   *  Missing → treated as 1. */
  scale?: number;
  days: Record<string, number>;
}

const luxStorage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeLocalStorage;

/** Cached day map with only finite hour counts, or null when the stored
 *  value is not a plain object (hand-edited or foreign data). */
function validLuxDays(days: unknown): Record<string, number> | null {
  if (!days || typeof days !== 'object' || Array.isArray(days)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(days as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** A missing or non-numeric cached coordinate is a miss, not a match. */
const nearCoord = (cached: unknown, want: number): boolean =>
  typeof cached === 'number' && Math.abs(cached - want) <= 0.01;

function luxCacheKey(entityId: string, timeZone: string): string {
  return `${LUX_CACHE_PREFIX}${timeZone}_${entityId}`;
}

function loadLuxDayCache(
  timeZone: string,
  entityId: string,
  threshold: number,
  lat: number,
  lon: number,
  scale: number,
): Record<string, number> | null {
  const storage = luxStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(luxCacheKey(entityId, timeZone));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LuxDayCacheShape | null;
    if (parsed?.v !== LUX_CACHE_VERSION) return null;
    // Any derivation-parameter change makes the cached hours wrong.
    if (parsed.threshold !== threshold) return null;
    if ((parsed.scale ?? 1) !== scale) return null;
    if (!nearCoord(parsed.lat, lat) || !nearCoord(parsed.lon, lon)) return null;
    return validLuxDays(parsed.days);
  } catch {
    return null;
  }
}

function saveLuxDayCache(
  timeZone: string,
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
      luxCacheKey(entityId, timeZone),
      JSON.stringify({ v: LUX_CACHE_VERSION, threshold, lat, lon, scale, days } satisfies LuxDayCacheShape),
    );
    // Drop the legacy slot keyed by entity alone so it does not linger.
    storage.removeItem(`${LUX_CACHE_PREFIX}${entityId}`);
  } catch {
    // Quota / private mode — best-effort.
  }
}

export class MeasuredDataSource {
  hass: HassLike | null;
  config: DataSourceConfig;

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _listener: DataSourceListener | null = null;
  private _failureCount = 0;
  // An interval poll came due while hidden and was skipped; `notifyVisible` runs it.
  private _pollDeferredWhileHidden = false;

  constructor(hass: HassLike | null, config: DataSourceConfig, readonly calendar: Calendar) {
    this.hass = hass;
    this.config = config;
  }

  setHass(hass: HassLike | null): void {
    this.hass = hass;
  }

  subscribe(callback: DataSourceListener): Unsubscribe {
    this._listener = callback;
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

  /** Runs the poll skipped while the document was hidden, if any. */
  notifyVisible(): void {
    if (!this._pollDeferredWhileHidden) return;
    this._pollDeferredWhileHidden = false;
    void this._poll();
  }

  private async _poll(initial: boolean = false): Promise<void> {
    if (!this._listener || !this.hass) return;
    // Hidden documents skip interval polls; the INITIAL poll always runs so
    // a card mounted in a background tab has data when first shown.
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
      // Surface repeated failures so the card shows a banner instead of stale data.
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
    // 'today' shares the FULL hourly window (the render layer pages it per
    // day); identical fetch parameters let it share the recorder response.
    const isToday = type === 'today';
    const isHourly = type === 'hourly' || isToday;
    const days = cfgDays;
    const sensors: SensorMap = this.config.sensors ?? {};

    // Two keys never reach the recorder:
    //   - moon_phase: an enum entity with no statistics, deprecated.
    //   - precipitation_rate: a live-only rate; bucketPrecipitation would
    //     diff its mean/max into a meaningless "rainfall per day".
    const { moon_phase: _moonPhase, precipitation_rate: _precipRate, ...chartSensors } = sensors;
    void _moonPhase;
    void _precipRate;
    const entityIds = Object.values(chartSensors).filter(Boolean) as string[];
    if (entityIds.length === 0) return [];

    // One hourly request serves every mode. The window ends at the next full
    // hour (exclusive) and starts at the card's midnight `days` days back, so
    // the first day is complete. One extra hour before that start is the
    // cumulative-precipitation baseline of the oldest hour.
    //
    // Daily mode reduces the same hours to card days (#355) instead of using
    // `period: 'day'`, which HA cuts at the server's midnight. Identical
    // requests share one roundtrip across modes and cards (ADR-0020).
    const todayStart = this.calendar.startOfDay(Date.now());
    const end = new Date(this.calendar.startOfHour(Date.now()).getTime() + HOUR_MS);
    const dayStart = this.calendar.addDays(todayStart, -days);
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

    if (isHourly) return this._buildHourlyForecast(stats, sensors, start, hours);

    const daily: StatsResponse = {};
    for (const [eid, series] of Object.entries(stats || {})) {
      daily[eid] = reduceHourlyToDays(series, this.calendar);
    }

    // Illuminance sensor without `sensors.sunshine_duration`: derive sunshine
    // from the lux / clear-sky-lux ratio. Null when inapplicable.
    const luxByDate = await this._fetchLuxSunshine(sensors, dayStart, this.calendar.addDays(todayStart, 1));
    // A sunshine counter (utility meter) resets at the server's midnight.
    const serverCal = serverCalendar(this.hass);
    const sunshineSeries = sensors.sunshine_duration ? stats?.[sensors.sunshine_duration] : null;
    const sunshineByDate = sensors.sunshine_duration
      ? sunshineDailyTotals(sunshineSeries, this.calendar, serverCal)
      : null;
    // The live sensor state runs since the SERVER's midnight; only when
    // that is the card's midnight too is it today's value as is (#379).
    const now = Date.now();
    const sunshineServerLast = sensors.sunshine_duration
      && serverCal.startOfDay(now).getTime() !== todayStart.getTime()
      ? sunshineServerDayLast(sunshineSeries, serverCal, now)
      : null;

    return this._buildForecast(daily, sensors, dayStart, days, luxByDate, sunshineByDate, sunshineServerLast);
  }

  /** Window boundaries are hour-/midnight-aligned, so sibling cards with
   *  the same sensors build byte-identical requests and share one roundtrip. */
  private _callStatsDeduped(msg: Record<string, unknown>): Promise<StatsResponse> {
    const hass = this.hass as HassLike;
    return dedupeRequest(
      `stats:${this.calendar.timeZone}:${JSON.stringify(msg)}`,
      STATS_DEDUPE_TTL_MS,
      () => hass.callWS<StatsResponse>(msg),
    );
  }

  /** Per-day sunshine-hours map derived from the illuminance sensor's
   *  history. Null when inapplicable (no illuminance sensor, a recorder
   *  sunshine sensor takes precedence, or the WS call fails). */
  private async _fetchLuxSunshine(
    sensors: SensorMap,
    start: Date,
    end: Date,
  ): Promise<Map<string, number> | null> {
    if (!this.hass) return null;
    const luxId = sensors.illuminance;
    if (!luxId || sensors.sunshine_duration) return null;
    const loc = resolveLocation(this.config, this.hass);
    if (!loc) return null;
    const { latitude: lat, longitude: lon } = loc;

    const cm = this.config.condition_mapping ?? {};
    const threshold = (cm.sunshine_lux_ratio != null && Number.isFinite(cm.sunshine_lux_ratio))
      ? Number(cm.sunshine_lux_ratio)
      : 0.6;

    // `neededDays`: the completed local days inside the window, served from
    // the per-day cache when present.
    const today = this.calendar.startOfDay(Date.now());
    const todayMs = today.getTime();
    const neededDays: string[] = [];
    for (let d = this.calendar.startOfDay(start); d.getTime() < todayMs; d = this.calendar.addDays(d, 1)) {
      neededDays.push(this.calendar.dayKey(d));
    }
    // W/m² sensors convert to lux first (scale 1 for plain lux sensors).
    const luxScale = this._luxScale(luxId);
    const cachedDays = loadLuxDayCache(this.calendar.timeZone, luxId, threshold, lat as number, lon as number, luxScale);
    const missingDays = cachedDays
      ? neededDays.filter((k) => cachedDays[k] === undefined)
      : neededDays;
    const fetchStart = missingDays.length === 0 ? today : start;

    // history/history_during_period (HA 2022+) returns
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
      // Same cross-card dedup as the stats call; this is the heaviest payload.
      history = await dedupeRequest(
        `history:${this.calendar.timeZone}:${JSON.stringify(msg)}`,
        STATS_DEDUPE_TTL_MS,
        () => hass.callWS<typeof history>(msg),
      );
    } catch (err) {
      // An opportunistic enhancement: no error banner, cached days still serve.
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

    const perDay = sunshineFromLuxHistory(samples, lat as number, lon as number, this.calendar, threshold);

    const map = new Map<string, number>();
    if (cachedDays) {
      for (const k of neededDays) {
        if (cachedDays[k] !== undefined) map.set(k, cachedDays[k]);
      }
    }
    for (const e of perDay) map.set(e.date, e.hours);

    // Days the derivation emitted nothing for are cached as an explicit 0
    // (no perpetual refetch of sunless or offline days) but not put in the
    // returned map; the caller's "configured source is authoritative → 0 h"
    // rule yields the same 0.
    // Compare day keys as strings: YYYY-MM-DD sorts chronologically, and
    // parsing the key as a local time would read it in the browser's
    // zone rather than the server's (ADR-0026).
    const fetchedFromKey = this.calendar.dayKey(fetchStart);
    const updated: Record<string, number> = { ...(cachedDays ?? {}) };
    let dirty = false;
    for (const k of neededDays) {
      if (k < fetchedFromKey) continue;
      const v = map.get(k) ?? 0;
      if (updated[k] !== v) { updated[k] = v; dirty = true; }
    }
    if (dirty) saveLuxDayCache(this.calendar.timeZone, luxId, threshold, lat as number, lon as number, luxScale, updated);
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
    sunshineByDate: Map<string, number> | null = null,
    sunshineServerLast: number | null = null,
  ): ForecastEntry[] {
    // Index by midnight-of-day: the API omits entries for empty days, so
    // positional indices would misalign.
    const byDate: Record<string, BucketMap> = {};
    for (const [eid, series] of Object.entries(stats || {})) {
      const m: BucketMap = new Map();
      for (const entry of series ?? []) {
        m.set(this.calendar.startOfDay(new Date(entry.start)).getTime(), entry);
      }
      byDate[eid] = m;
    }

    const dayMs = (date: Date): number => this.calendar.startOfDay(date).getTime();

    const units = this._stationUnits(sensors);
    const tempUnit = this._sensorUnit(sensors.temperature);
    const dewUnit = this._sensorUnit(sensors.dew_point) || tempUnit;
    const precipUnit = this._sensorUnit(sensors.precipitation);
    const out: ForecastEntry[] = [];
    for (let i = 1; i <= days; i++) {
      const dayStart = this.calendar.addDays(start, i);
      const dayStartMs = dayMs(dayStart);
      const prevKey = dayMs(this.calendar.addDays(dayStart, -1));
      // `start + days` lands on today, the last bucket.
      const isToday = i === days;

      const at = (eid: string | undefined, field: keyof StatBucket): number | null => {
        if (!eid) return null;
        const m = byDate[eid];
        if (!m) return null;
        const e = m.get(dayStartMs);
        if (!e) return null;
        const v = e[field];
        return v === undefined ? null : (v as number | null);
      };

      let tempMax = at(sensors.temperature, 'max');
      let tempMin = at(sensors.temperature, 'min');
      // Fold the live reading into today's high/low. Today's daily statistic
      // rolls up COMPLETED hours only: it lags by up to an hour and is empty
      // in the first hour after midnight. Without the fold today's column is
      // null and the solid line stops at yesterday.
      if (isToday) {
        const live = this._liveNumber(sensors.temperature);
        if (live != null) {
          tempMax = tempMax == null ? live : Math.max(tempMax, live);
          tempMin = tempMin == null ? live : Math.min(tempMin, live);
        }
      }
      const humidityMean = at(sensors.humidity, 'mean');
      const pressureMean = at(sensors.pressure, 'mean');
      const windMean = toCanonical('speed', at(sensors.wind_speed, 'mean'), units.wind_speed);
      const gustMax = toCanonical('speed', at(sensors.gust_speed, 'max'), units.gust_speed);
      const luxMaxRaw = at(sensors.illuminance, 'max');
      const luxMax = luxMaxRaw != null ? luxMaxRaw * this._luxScale(sensors.illuminance) : luxMaxRaw;
      const dewPointMean = at(sensors.dew_point, 'mean');

      const precipitation = sensors.precipitation
        ? bucketPrecipitation(byDate[sensors.precipitation], dayStartMs, prevKey)
        : null;

      // Sunshine from a recorder sensor, in seconds or hours (attachSunshine
      // normalises). TODAY shows the measured running total, even when small
      // early in the day, not Open-Meteo's full-day forecast (#37).
      let sunshineRaw = sensors.sunshine_duration
        ? at(sensors.sunshine_duration, 'max')
        : null;
      // Prefer the hourly end-of-day value: the daily max reports
      // `max(yesterday, this day)` (the 00:00 bucket carries yesterday's
      // final value) and keeps a revised forecast's highest intermediate value.
      if (sensors.sunshine_duration && sunshineByDate) {
        const recovered = sunshineByDate.get(this.calendar.dayKey(dayStart));
        if (recovered != null) sunshineRaw = recovered;
      }
      // On TODAY the live state beats both: statistics cover COMPLETED hours
      // only. This REPLACES rather than max()-ing the way the temperature
      // fold does: max() would re-elect the stale carry-over on an
      // uncorrected daily bucket.
      //
      // `sunshineServerLast` is set when the server's day starts at another
      // instant than the card's: take the hourly card-day total plus the live
      // growth since the last recorded hour of the server day (#379).
      if (isToday && sensors.sunshine_duration) {
        const live = this._liveNumber(sensors.sunshine_duration);
        if (live != null) {
          sunshineRaw = sunshineServerLast == null
            ? live
            : Math.max(0, (sunshineByDate?.get(this.calendar.dayKey(dayStart)) ?? 0) + live - sunshineServerLast);
        }
      }
      // Lux-derived fallback; a recorder sunshine sensor wins. Keys are
      // `YYYY-MM-DD` in the card's zone (#285).
      if (sunshineRaw == null && luxByDate) {
        const luxHours = luxByDate.get(this.calendar.dayKey(dayStart));
        if (luxHours != null && Number.isFinite(luxHours)) {
          sunshineRaw = luxHours;
        }
      }
      // A configured station sunshine source is authoritative: a day it has
      // no value for is 0 h measured, not "no data". Null would let
      // attachSunshine's Open-Meteo overlay put a forecast into the station
      // column (e.g. an overcast day the lux derivation emits no entry for).
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
          wind_mean: windMean,
          gust_max: gustMax,
          dew_point_mean: toCelsius(dewPointMean, dewUnit),
        }, this.calendar.dayOfYear(dayStart)),
      });
    }
    return out;
  }

  /** Lux multiplier of the illuminance entity: see `luxScaleFor` (1 for a
   *  plain lux sensor). Applied once wherever raw readings enter the lux pipeline. */
  private _luxScale(eid?: string): number {
    if (!eid || !this.hass?.states) return 1;
    const attrs = this.hass.states[eid]?.attributes as
      { unit_of_measurement?: unknown; device_class?: unknown } | undefined;
    return luxScaleFor(attrs?.unit_of_measurement, attrs?.device_class);
  }

  /** The units the station's statistics and states are in, once per build. */
  private _stationUnits(sensors: SensorMap) {
    return stationUnits({
      sensors,
      states: this.hass?.states,
      weatherEntity: this.config.weather_entity,
      unitSystem: this.hass?.config?.unit_system,
    });
  }

  /** Native unit_of_measurement of a sensor entity. classifyDay is
   *  unit-blind (°C / mm / m/s), so inputs are normalised before it. */
  private _sensorUnit(eid?: string): string | undefined {
    return eid
      ? (this.hass?.states?.[eid]?.attributes?.unit_of_measurement as string | undefined)
      : undefined;
  }

  /** Entity's current numeric state, or null when missing / non-finite.
   *  Live-fills the in-progress bucket the recorder hasn't finalized. */
  private _liveNumber(eid?: string): number | null {
    if (!eid || !this.hass?.states) return null;
    const s = this.hass.states[eid];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  private _mapCondition(day: ClassifyInputs, dayOfYear: number): ConditionId {
    const lat = resolveLocation(this.config, this.hass)?.latitude ?? null;
    const clearsky_lux = lat != null
      ? clearSkyNoonLux(lat, dayOfYear)
      : 110000; // sea-level perpendicular-sun fallback (IES)
    return classifyDay({ ...day, clearsky_lux }, this.config.condition_mapping ?? {});
  }

  /** Hourly counterpart to _buildForecast: one entry per hour
   *  (datetime = hour-start ISO). Temperature is the hourly mean and
   *  templow is omitted. Precipitation diffs against the previous hour.
   *  Clear-sky lux is computed for the actual hour, not the day's noon. */
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
        m.set(this.calendar.startOfHour(new Date(entry.start)).getTime(), entry);
      }
      byHour[eid] = m;
    }

    // The factory precomputes lat/lon trig and caches declination per day.
    const loc = resolveLocation(this.config, this.hass);
    const luxFor = clearSkyLuxFactory(loc ? loc.latitude : null, loc ? loc.longitude : null, this.calendar);

    const hourMs = (date: Date): number => this.calendar.startOfHour(date).getTime();

    const units = this._stationUnits(sensors);
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
      // The last (partial) hour falls back to the live state when the
      // recorder has no bucket yet. For complete past hours a missing entry
      // is genuine missing data: null, drawn as a gap.
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
      const windMean = toCanonical('speed', atOrLive(sensors.wind_speed, 'mean'), units.wind_speed);
      const gustMax = toCanonical('speed', atOrLive(sensors.gust_speed, 'max'), units.gust_speed);
      const luxMaxRaw = atOrLive(sensors.illuminance, 'max');
      const luxMax = luxMaxRaw != null ? luxMaxRaw * this._luxScale(sensors.illuminance) : luxMaxRaw;
      const dewPointMean = atOrLive(sensors.dew_point, 'mean');
      // A last hour with a single live datapoint: max/min collapse to it so
      // the classifier avoids its no-data fallback.
      if (isLastHour) {
        tempMax ??= tempMean;
        tempMin ??= tempMean;
      }

      let precipitation = sensors.precipitation
        ? bucketPrecipitation(byHour[sensors.precipitation], hourKey, prevKey)
        : null;
      if (isLastHour && precipitation == null && sensors.precipitation) {
        // Treat the live state as a synthetic "current.max" for the
        // in-progress hour and diff against the previous hour's max.
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
          wind_mean: windMean,
          gust_max: gustMax,
          dew_point_mean: toCelsius(dewPointMean, dewUnit),
          hourStart,
          clearsky_lux: luxFor(hourStart),
        }),
      });
    }
    return out;
  }

  private _mapHourCondition(hour: HourClassifyBag): ConditionId {
    // _buildHourlyForecast passes clearsky_lux from the cached factory;
    // the per-call clearSkyLuxAt covers a bag without it.
    let clearsky_lux = hour.clearsky_lux;
    if (clearsky_lux == null) {
      const loc = resolveLocation(this.config, this.hass);
      const lat = loc ? loc.latitude : null;
      const lon = loc ? loc.longitude : null;
      clearsky_lux = (lat != null && lon != null)
        ? clearSkyLuxAt(lat, lon, this.calendar, hour.hourStart)
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

  constructor(hass: HassLike | null, config: DataSourceConfig, readonly calendar: Calendar) {
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
    // Clear the slot first so a later unsubscribe() does not await the same
    // (possibly rejected) promise.
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
      this._unsubPromise = this.hass.connection.subscribeMessage(
        (event) => {
          const raw = (event.forecast as ForecastEntry[]) || [];
          // Resolve the server calendar and the entity's units at event
          // time: `hass` may have been swapped since the subscription.
          const serverCal = serverCalendar(this.hass);
          const units = weatherEntityUnits(
            this.hass?.states?.[entity]?.attributes,
            this.hass?.config?.unit_system,
          );
          this._emit({
            forecast: raw.map((e) => this._normalizeEntry(e, isHourly, serverCal, units)),
          });
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

  /** Daily entries are calendar days (#355), re-anchored at the card's
   *  midnight; hourly entries stay instants. Wind and gust enter as m/s
   *  (ADR-0035). Always a copy. */
  private _normalizeEntry(
    e: ForecastEntry,
    isHourly: boolean,
    serverCal: Calendar,
    units: WeatherUnits,
  ): ForecastEntry {
    const out: ForecastEntry = { ...e };
    const raw: unknown = e?.datetime;
    if (typeof raw === 'string') {
      const fixed = isHourly
        ? normalizeHourlyDatetime(raw, this.calendar)
        : anchorDailyDatetime(raw, this.calendar, serverCal);
      if (fixed && fixed !== raw) out.datetime = fixed;
    }
    // An absent key stays absent and null stays null, so the chart keeps
    // telling "no wind data" from "no such field".
    for (const key of ['wind_speed', 'wind_gust_speed'] as const) {
      const value: unknown = e?.[key];
      if (value === undefined || value === null) continue;
      out[key] = canonicalField('speed', value, units.wind_speed);
    }
    return out;
  }

  private _emit(event: DataSourceEvent): void {
    if (this._listener) this._listener(event);
  }
}
