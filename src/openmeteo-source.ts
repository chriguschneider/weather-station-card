// Open-Meteo daily / hourly fetcher: one Forecast-endpoint call per
// refresh (`past_days` + `forecast_days`), feeding the sunshine overlay,
// the chance-of-rain overlay and the no-station past block (ADR-0015,
// ADR-0027, ADR-0028). The class owns lazy load, in-flight dedup, abort
// and the localStorage cache (ADR-0020).

import type { DailySunshineEntry, HourlySunshineEntry } from './sunshine-source.js';
import type { DailyProbabilityEntry, HourlyProbabilityEntry } from './precip-probability.js';
import type { ForecastEntry } from './forecast-utils.js';
import { wmoToCondition } from './weather-code-map.js';
import { dedupeRequest } from './utils/shared-requests.js';
import { safeLocalStorage } from './utils/safe-storage.js';
import { abandonOnAbort, withTimeout } from './utils/fetch-signal.js';
import { calendarFor, validTimeZone, type Calendar } from './utils/time-zone.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Daily variables requested in one call. `sunshine_duration` feeds the
// sunshine overlay, `precipitation_probability_max` the chance-of-rain
// pill (ADR-0027); the rest feed the no-station past block (ADR-0015).
// Always requested together, so one cache entry serves all three features.
const DAILY_FIELDS = [
  'sunshine_duration',
  'precipitation_probability_max',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'weather_code',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
].join(',');

// Hourly variables requested when `includeHourly` is on (hourly / today
// chart modes). `sunshine_duration` feeds the sunshine overlay,
// `precipitation_probability` the chance-of-rain pill; the rest feed
// the no-station past block at hourly resolution (ADR-0015).
const HOURLY_FIELDS = [
  'sunshine_duration',
  'precipitation_probability',
  'temperature_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
].join(',');

// The Forecast endpoint updates a few times per day; hourly polling is
// enough and stays far below the free tier's 10 000 calls/day per IP.
const REFRESH_TTL_MS = 60 * 60 * 1000;

// localStorage key prefix, keyed by lat/lon (2 decimals) and the card's
// time zone: cached hour keys and midnights are cut in that zone
// (ADR-0030), so cards in different zones must not share an entry. `v3`
// is the schema version (ADR-0020); `v2` entries are swept, never read.
const STORAGE_PREFIX = 'wsc_sunshine_v3_';
const LEGACY_PREFIX = 'wsc_sunshine_v2_';

/** Subset of the Web Storage API the source uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** Optional enumeration / removal, used only for the legacy sweep. */
  readonly length?: number;
  key?(index: number): string | null;
  removeItem?(key: string): void;
}

/** Subset of the Fetch API the source uses. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Listener payload — `ok: false` carries an error string. */
export type SunshineListener = (event: { ok: boolean; error?: string }) => void;

/** Open-Meteo Forecast API JSON response (`DAILY_FIELDS` / `HOURLY_FIELDS`).
 *  All arrays are parallel to `time`. */
export interface OpenMeteoResponse {
  /** IANA zone Open-Meteo resolved `timezone=auto` to (the location's). */
  timezone?: string;
  utc_offset_seconds?: number;
  daily?: {
    time?: Array<number | string>;
    sunshine_duration?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    weather_code?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
    wind_gusts_10m_max?: Array<number | null>;
    wind_direction_10m_dominant?: Array<number | null>;
  };
  hourly?: {
    time?: Array<number | string>;
    sunshine_duration?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    temperature_2m?: Array<number | null>;
    precipitation?: Array<number | null>;
    weather_code?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
}

/** Persisted cache shape (also returned by `loadFromStorage`). */
interface CachedPayload {
  daily?: DailySunshineEntry[];
  hourly?: HourlySunshineEntry[];
  /** Daily / hourly station-block entries (ADR-0015). A cache without
   *  them forces one refetch via `isStale`. */
  dailyForecast?: ForecastEntry[];
  hourlyForecast?: ForecastEntry[];
  /** Chance-of-rain arrays (ADR-0027); absent forces one refetch. */
  dailyProbability?: DailyProbabilityEntry[];
  hourlyProbability?: HourlyProbabilityEntry[];
  /** Set by every save; absent marks a cache from before the
   *  chance-of-rain fields were requested (ADR-0027). */
  probabilityFetched?: boolean;
  /** Window the cached response was fetched for; absent counts as
   *  covering nothing in `isStale`. */
  pastDays?: number;
  forecastDays?: number;
  lastFetchMs?: number;
}

/** Result of `readCachedAvailability`; `lastFetchMs` 0 = no timestamp cached. */
export interface CachedAvailability {
  pastDays: number;
  forecastDays: number;
  lastFetchMs: number;
}

export interface OpenMeteoSourceOpts {
  latitude?: number | null;
  longitude?: number | null;
  pastDays?: number;
  forecastDays?: number;
  includeHourly?: boolean;
  fetchImpl?: FetchLike | null;
  storage?: StorageLike | null;
  now?: () => number;
  /** The card's calendar: civil dates and hour keys are cut in its zone. */
  calendar: Calendar;
}

/** Forecast-endpoint URL; `includeHourly` adds `hourly=HOURLY_FIELDS`.
 *  The request pins °C, mm and m/s because these are the card's
 *  canonical units (ADR-0035), so the values enter as they arrive. */
export function buildOpenMeteoUrl(
  latitude: number,
  longitude: number,
  pastDays: number,
  forecastDays: number,
  includeHourly: boolean = false,
): string {
  const p = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: DAILY_FIELDS,
    timezone: 'auto',
    // Epoch seconds instead of civil strings: Open-Meteo applies one
    // fixed UTC offset per response, so civil times are wrong on the
    // far side of a DST change in the range.
    timeformat: 'unixtime',
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
    wind_speed_unit: 'ms',
  });
  if (includeHourly) p.set('hourly', HOURLY_FIELDS);
  return `${FORECAST_URL}?${p.toString()}`;
}

/** `time` / `sunshine_duration` as the `{date, value}` array
 *  `attachSunshine` consumes. Values stay in seconds;
 *  `normalizeSunshineValue` converts at lookup. */
export function parseDailySunshine(response: OpenMeteoResponse | null | undefined, calendar: Calendar): DailySunshineEntry[] {
  if (!response?.daily) return [];
  const t = response.daily.time ?? [];
  const v = response.daily.sunshine_duration ?? [];
  const out: DailySunshineEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    const date = responseDayKey(t[i], response, calendar);
    if (v[i] != null && date) out.push({ date, value: v[i] });
  }
  return out;
}

/** Hourly counterpart, keyed "YYYY-MM-DDTHH:00" in the card's zone (what
 *  `localHourString` matches). Values are seconds within the hour. */
export function parseHourlySunshine(response: OpenMeteoResponse | null | undefined, calendar: Calendar): HourlySunshineEntry[] {
  if (!response?.hourly) return [];
  const t = response.hourly.time ?? [];
  const v = response.hourly.sunshine_duration ?? [];
  const out: HourlySunshineEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    const datetime = cardHourString(t[i], calendar);
    if (v[i] != null && datetime) out.push({ datetime, value: v[i] });
  }
  return out;
}

/** Daily chance of rain: Open-Meteo's `precipitation_probability_max`
 *  (integer %, the wettest hour of the civil date) as `{date, value}`
 *  pairs for `attachPrecipProbability`. Null cells are skipped. */
export function parseDailyProbability(response: OpenMeteoResponse | null | undefined, calendar: Calendar): DailyProbabilityEntry[] {
  if (!response?.daily) return [];
  const t = response.daily.time ?? [];
  const v = response.daily.precipitation_probability_max ?? [];
  const out: DailyProbabilityEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    const n = numOrNull(v[i]);
    const date = responseDayKey(t[i], response, calendar);
    if (n != null && date) out.push({ date, value: n });
  }
  return out;
}

/** Hourly chance of rain (`precipitation_probability`, integer %) as
 *  `{datetime, value}` pairs keyed like `localHourString` (card zone). */
export function parseHourlyProbability(response: OpenMeteoResponse | null | undefined, calendar: Calendar): HourlyProbabilityEntry[] {
  if (!response?.hourly) return [];
  const t = response.hourly.time ?? [];
  const v = response.hourly.precipitation_probability ?? [];
  const out: HourlyProbabilityEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    const n = numOrNull(v[i]);
    const datetime = cardHourString(t[i], calendar);
    if (n != null && datetime) out.push({ datetime, value: n });
  }
  return out;
}

/** "YYYY-MM-DD" of a daily `time` entry in the response's zone. The
 *  response has one UTC offset, so across a DST change the midnight
 *  instant can be an hour off; reading the date at noon is immune.
 *  Civil strings pass through. */
function responseDayKey(
  t: number | string | undefined,
  response: OpenMeteoResponse | null | undefined,
  calendar: Calendar,
): string | null {
  if (typeof t === 'string') return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  const noon = (t + 12 * 3600) * 1000;
  const tz = validTimeZone(response?.timezone);
  return (tz ? calendarFor(tz) : calendar).dayKey(noon);
}

/** Card-zone midnight of the response's day, the daily `datetime`
 *  convention of `MeasuredDataSource`. */
function localMidnightIso(
  t: number | string | undefined,
  response: OpenMeteoResponse | null | undefined,
  calendar: Calendar,
): string | null {
  const d = civilMidnight(responseDayKey(t, response, calendar) ?? undefined, calendar);
  return d ? d.toISOString() : null;
}

function civilMidnight(civilDate: string | undefined, calendar: Calendar): Date | null {
  if (!civilDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(civilDate);
  if (!m) return null;
  const d = calendar.zonedDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Start of the card-zone hour holding an hourly `time`, as ISO. Floored
 *  with the card calendar, not to the UTC hour: in a half-hour zone
 *  (e.g. Asia/Kolkata) local hours sit on :30 UTC. */
function hourIso(t: number | string | undefined, calendar: Calendar): string | null {
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  return calendar.startOfHour(t * 1000).toISOString();
}

/** `Calendar.hourKey` of an hourly epoch-seconds `time`. */
function cardHourString(t: number | string | undefined, calendar: Calendar): string | null {
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  return calendar.hourKey(t * 1000);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Daily arrays as `ForecastEntry[]` in `MeasuredDataSource`'s shape
 *  (ADR-0015). temperature = daily high, wind_speed = daily max (no mean
 *  exists), humidity / pressure / uv_index stay null, sunshine is left
 *  to the overlay. Emits past, today and future rows; callers slice. */
export function buildDailyForecast(
  response: OpenMeteoResponse | null | undefined,
  calendar: Calendar,
): ForecastEntry[] {
  const daily = response?.daily;
  if (!daily) return [];
  const t = daily.time ?? [];
  const tMax = daily.temperature_2m_max ?? [];
  const tMin = daily.temperature_2m_min ?? [];
  const precip = daily.precipitation_sum ?? [];
  const code = daily.weather_code ?? [];
  const windMax = daily.wind_speed_10m_max ?? [];
  const gustMax = daily.wind_gusts_10m_max ?? [];
  const windDir = daily.wind_direction_10m_dominant ?? [];

  const out: ForecastEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    const iso = localMidnightIso(t[i], response, calendar);
    if (!iso) continue;
    out.push({
      datetime: iso,
      temperature: numOrNull(tMax[i]),
      templow: numOrNull(tMin[i]),
      precipitation: numOrNull(precip[i]),
      wind_speed: numOrNull(windMax[i]),
      wind_gust_speed: numOrNull(gustMax[i]),
      wind_bearing: numOrNull(windDir[i]),
      pressure: null,
      humidity: null,
      uv_index: null,
      condition: wmoToCondition(numOrNull(code[i])),
    });
  }
  return out;
}

/** Hourly counterpart of `buildDailyForecast`: one entry per hour, no
 *  `templow`, `datetime` on the hour. Emits past, current and future
 *  hours; callers slice. */
export function buildHourlyForecast(
  response: OpenMeteoResponse | null | undefined,
  calendar: Calendar,
): ForecastEntry[] {
  const hourly = response?.hourly;
  if (!hourly) return [];
  const t = hourly.time ?? [];
  const temp = hourly.temperature_2m ?? [];
  const precip = hourly.precipitation ?? [];
  const code = hourly.weather_code ?? [];
  const wind = hourly.wind_speed_10m ?? [];
  const gust = hourly.wind_gusts_10m ?? [];
  const dir = hourly.wind_direction_10m ?? [];

  const out: ForecastEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    const iso = hourIso(t[i], calendar);
    if (!iso) continue;
    out.push({
      datetime: iso,
      temperature: numOrNull(temp[i]),
      precipitation: numOrNull(precip[i]),
      wind_speed: numOrNull(wind[i]),
      wind_gust_speed: numOrNull(gust[i]),
      wind_bearing: numOrNull(dir[i]),
      pressure: null,
      humidity: null,
      uv_index: null,
      condition: wmoToCondition(numOrNull(code[i])),
    });
  }
  return out;
}

function storageKey(lat: number, lon: number, timeZone: string): string {
  // IANA names carry `/` (America/Denver); keep the key one flat token.
  const zone = timeZone.replace(/[^A-Za-z0-9_+-]/g, '-');
  return `${STORAGE_PREFIX}${lat.toFixed(2)}_${lon.toFixed(2)}_${zone}`;
}

/** Remove zone-less `v2` entries: their zone is unknown, so no card can
 *  trust them. */
function sweepLegacyEntries(storage: StorageLike | null): void {
  if (!storage?.key || !storage.removeItem || typeof storage.length !== 'number') return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(LEGACY_PREFIX)) stale.push(k);
    }
    for (const k of stale) storage.removeItem(k);
  } catch {
    // Storage iteration can throw in hardened contexts — skip the sweep.
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);
const finiteOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v));

/** Entries carrying their string key field and a numeric (or null)
 *  `value`; anything else in the array is dropped. */
function keyedValues<T>(v: unknown, key: 'date' | 'datetime'): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((e) => isObj(e) && typeof e[key] === 'string' && finiteOrNull(e.value)) as T[];
}

function forecastEntries(v: unknown): ForecastEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((e) => isObj(e) && typeof e.datetime === 'string') as ForecastEntry[];
}

const nonNegative = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** Shape-check a parsed cache entry (it may be corrupt, hand-edited or
 *  written by another version). Invalid fields are dropped, not trusted. */
function validPayload(parsed: unknown): CachedPayload | null {
  if (!isObj(parsed)) return null;
  return {
    daily: keyedValues<DailySunshineEntry>(parsed.daily, 'date'),
    hourly: keyedValues<HourlySunshineEntry>(parsed.hourly, 'datetime'),
    dailyForecast: forecastEntries(parsed.dailyForecast),
    hourlyForecast: forecastEntries(parsed.hourlyForecast),
    dailyProbability: keyedValues<DailyProbabilityEntry>(parsed.dailyProbability, 'date'),
    hourlyProbability: keyedValues<HourlyProbabilityEntry>(parsed.hourlyProbability, 'datetime'),
    probabilityFetched: parsed.probabilityFetched === true,
    pastDays: nonNegative(parsed.pastDays),
    forecastDays: nonNegative(parsed.forecastDays),
    lastFetchMs: nonNegative(parsed.lastFetchMs),
  };
}

/** Cache read; null on any error (blocked storage, corrupt JSON). */
function loadFromStorage(storage: StorageLike | null, lat: number, lon: number, timeZone: string): CachedPayload | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(lat, lon, timeZone));
    if (!raw) return null;
    return validPayload(JSON.parse(raw));
  } catch (err) {
    // Fall through to a fresh fetch.
    void err;
    return null;
  }
}

function saveToStorage(storage: StorageLike | null, lat: number, lon: number, timeZone: string, payload: CachedPayload): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey(lat, lon, timeZone), JSON.stringify(payload));
  } catch (err) {
    // Best-effort write (quota, private mode).
    void err;
  }
}

/** Past vs forecast day counts in the cached daily array, so the editor
 *  can show when `forecast_days` outruns what Open-Meteo returns. Null
 *  when nothing is cached for the location. */
export function readCachedAvailability(
  latitude: number,
  longitude: number,
  calendar: Calendar,
  storage?: StorageLike | null,
  now: number = Date.now(),
): CachedAvailability | null {
  const store = storage !== undefined ? storage : safeLocalStorage();
  if (!store) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const cached = loadFromStorage(store, latitude, longitude, calendar.timeZone);
  if (!cached) return null;

  const todayMs = calendar.startOfDay(now).getTime();

  const daily = Array.isArray(cached.daily) ? cached.daily : [];
  let pastDays = 0;
  let forecastDays = 0;
  for (const item of daily) {
    if (!item?.date) continue;
    const t = civilMidnight(item.date, calendar)?.getTime();
    if (t === undefined) continue;
    if (t < todayMs) pastDays += 1;
    else forecastDays += 1;
  }
  return {
    pastDays,
    forecastDays,
    lastFetchMs: Number(cached.lastFetchMs) || 0,
  };
}

/** `null` = no network, `undefined` = the global `fetch` if present. A
 *  plain `fetchImpl ?? fetch` would turn an intended `null` into a real
 *  network call where a global `fetch` exists. */
function resolveFetchImpl(fetchImpl: FetchLike | null | undefined): FetchLike | null {
  if (fetchImpl === null) return null;
  if (fetchImpl) return fetchImpl;
  return typeof fetch === 'function' ? (fetch as FetchLike).bind(globalThis) : null;
}

export class OpenMeteoSource {
  latitude: number | null;
  longitude: number | null;
  pastDays: number;
  forecastDays: number;
  includeHourly: boolean;

  private readonly _fetch: FetchLike | null;
  /** An injected fetchImpl bypasses the request dedup, which would leak
   *  responses across tests reusing a URL. */
  private readonly _fetchIsCustom: boolean;
  private readonly _storage: StorageLike | null;
  private readonly _now: () => number;
  private readonly _calendar: Calendar;

  private _daily: DailySunshineEntry[] = [];
  private _hourly: HourlySunshineEntry[] = [];
  private _dailyForecast: ForecastEntry[] = [];
  private _hourlyForecast: ForecastEntry[] = [];
  private _dailyProbability: DailyProbabilityEntry[] = [];
  private _hourlyProbability: HourlyProbabilityEntry[] = [];
  /** A flag, not array length: a response without the fields must not
   *  refetch on every tick. */
  private _probabilityFetched = false;
  private _lastFetchMs = 0;
  /** Window the held data was fetched for; 0 until a fetch (or a cache
   *  that recorded it) lands, so an unknown window counts as too short. */
  private _fetchedPastDays = 0;
  private _fetchedForecastDays = 0;
  private _inFlight: Promise<void> | null = null;
  private _abort: AbortController | null = null;
  private _listener: SunshineListener | null = null;

  constructor({
    latitude,
    longitude,
    pastDays = 14,
    forecastDays = 8,
    includeHourly = false,
    fetchImpl,
    storage,
    now,
    calendar,
  }: OpenMeteoSourceOpts) {
    this.latitude = latitude ?? null;
    this.longitude = longitude ?? null;
    this.pastDays = pastDays;
    this.forecastDays = forecastDays;
    this.includeHourly = includeHourly === true;
    this._fetch = resolveFetchImpl(fetchImpl);
    this._fetchIsCustom = fetchImpl != null;
    this._storage = storage !== undefined ? storage : safeLocalStorage();
    this._now = now ?? (() => Date.now());
    this._calendar = calendar;

    sweepLegacyEntries(this._storage);
    if (Number.isFinite(this.latitude) && Number.isFinite(this.longitude)) {
      const cached = loadFromStorage(this._storage, this.latitude as number, this.longitude as number, calendar.timeZone);
      if (cached) this._restore(cached);
    }
  }

  private _restore(cached: CachedPayload): void {
    this._daily = cached.daily ?? [];
    this._hourly = cached.hourly ?? [];
    this._dailyForecast = cached.dailyForecast ?? [];
    this._hourlyForecast = cached.hourlyForecast ?? [];
    this._dailyProbability = cached.dailyProbability ?? [];
    this._hourlyProbability = cached.hourlyProbability ?? [];
    this._probabilityFetched = cached.probabilityFetched === true;
    this._lastFetchMs = cached.lastFetchMs ?? 0;
    this._fetchedPastDays = cached.pastDays ?? 0;
    this._fetchedForecastDays = cached.forecastDays ?? 0;
  }

  /** Synchronous accessors; empty until `ensureFresh` resolves. */
  getDailyValues(): DailySunshineEntry[] {
    return this._daily;
  }
  getHourlyValues(): HourlySunshineEntry[] {
    return this._hourly;
  }

  /** Daily station-block entries (ADR-0015): past, today and future. */
  getDailyStationForecast(): ForecastEntry[] {
    return this._dailyForecast;
  }

  /** Hourly station-block entries (ADR-0015); empty without `includeHourly`. */
  getHourlyStationForecast(): ForecastEntry[] {
    return this._hourlyForecast;
  }

  /** Chance-of-rain arrays (ADR-0027); the hourly one needs `includeHourly`. */
  getDailyProbability(): DailyProbabilityEntry[] {
    return this._dailyProbability;
  }
  getHourlyProbability(): HourlyProbabilityEntry[] {
    return this._hourlyProbability;
  }

  /** True when the cache lacks the requested granularity or is stale. */
  isStale(now: number = this._now()): boolean {
    if (!this._daily.length) return true;
    // A cache without station-block entries (ADR-0015) or the
    // chance-of-rain fields (ADR-0027) is refetched once.
    if (!this._dailyForecast.length) return true;
    if (!this._probabilityFetched) return true;
    if (this.includeHourly && !this._hourly.length) return true;
    if (this.includeHourly && !this._hourlyForecast.length) return true;
    // The cache is shared by every card at this place, whatever its
    // window: one written for `days: 7` cannot serve `days: 30`.
    if (this._fetchedPastDays < this.pastDays || this._fetchedForecastDays < this.forecastDays) return true;
    return now - this._lastFetchMs >= REFRESH_TTL_MS;
  }

  /** Callback for refresh completion. */
  setListener(cb: SunshineListener | null): void {
    this._listener = cb;
  }

  /** Abort any in-flight fetch (on disconnect). */
  abort(): void {
    if (this._abort) {
      try {
        this._abort.abort();
      } catch (err) {
        // Older polyfills may throw on a second abort().
        void err;
      }
      this._abort = null;
    }
  }

  /** Refresh if stale and none is running; returns the in-flight promise. */
  async ensureFresh(): Promise<void> {
    if (this._inFlight) return this._inFlight;
    if (!this.isStale()) return;
    if (!this._fetch) return;
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) {
      return;
    }

    this._abort = (typeof AbortController === 'function') ? new AbortController() : null;
    const signal = this._abort ? this._abort.signal : undefined;

    const url = buildOpenMeteoUrl(
      this.latitude as number,
      this.longitude as number,
      this.pastDays,
      this.forecastDays,
      this.includeHourly,
    );

    this._inFlight = (async () => {
      try {
        const doFetch = async (fetchSignal: AbortSignal | undefined): Promise<OpenMeteoResponse> => {
          const res = await (this._fetch as FetchLike)(url, fetchSignal ? { signal: fetchSignal } : undefined);
          if (!res?.ok) {
            throw new Error(`Open-Meteo HTTP ${res ? res.status : '<no response>'}`);
          }
          const body = await res.json() as OpenMeteoResponse & { error?: unknown; reason?: unknown };
          // Open-Meteo reports invalid parameters and limits as
          // { error: true, reason } at HTTP 200.
          if (body && typeof body === 'object' && body.error === true) {
            throw new Error(`Open-Meteo error: ${String(body.reason ?? 'unknown reason')}`);
          }
          return body;
        };
        // Cross-card dedup: cards at one location share one request per
        // minute (ADR-0020); bypassed for injected fetch impls.
        // The shared request carries only its timeout, never this card's
        // signal: a card torn down mid-fetch abandons its own await and
        // must not abort the request the other cards are waiting on.
        const json = this._fetchIsCustom
          ? await doFetch(withTimeout(signal))
          : await abandonOnAbort(
            dedupeRequest(`openmeteo:${url}`, 60 * 1000, () => doFetch(withTimeout(undefined))),
            signal,
          );
        this._daily = parseDailySunshine(json, this._calendar);
        this._hourly = this.includeHourly ? parseHourlySunshine(json, this._calendar) : [];
        this._dailyForecast = buildDailyForecast(json, this._calendar);
        this._hourlyForecast = this.includeHourly ? buildHourlyForecast(json, this._calendar) : [];
        this._dailyProbability = parseDailyProbability(json, this._calendar);
        this._hourlyProbability = this.includeHourly ? parseHourlyProbability(json, this._calendar) : [];
        this._probabilityFetched = true;
        this._lastFetchMs = this._now();
        this._fetchedPastDays = this.pastDays;
        this._fetchedForecastDays = this.forecastDays;
        saveToStorage(this._storage, this.latitude as number, this.longitude as number, this._calendar.timeZone, {
          daily: this._daily,
          hourly: this._hourly,
          dailyForecast: this._dailyForecast,
          hourlyForecast: this._hourlyForecast,
          dailyProbability: this._dailyProbability,
          hourlyProbability: this._hourlyProbability,
          probabilityFetched: true,
          pastDays: this.pastDays,
          forecastDays: this.forecastDays,
          lastFetchMs: this._lastFetchMs,
        });
        if (this._listener) this._listener({ ok: true });
      } catch (err) {
        // AbortError (disconnect) is expected; anything else is logged and
        // reported so the chart keeps rendering the stale cache.
        const e = err as { name?: string; code?: number } | null;
        const isAbort = e != null && (e.name === 'AbortError' || e.code === 20);
        if (!isAbort) {

          console.warn('[weather-station-card] Open-Meteo fetch failed:', err);
          if (this._listener) this._listener({ ok: false, error: String(err) });
        }
      } finally {
        this._inFlight = null;
        this._abort = null;
      }
    })();

    return this._inFlight;
  }
}
