// Open-Meteo daily / hourly fetcher.
//
// The card calls Open-Meteo's Forecast endpoint with `past_days`
// covering the visible station window plus `forecast_days` for the
// upcoming columns — one HTTP round-trip per refresh, no Archive call
// needed (Forecast supports up to past_days=92, well beyond the card's
// typical days=7..14 window).
//
// The source backs two features off the same fetch:
//   - the in-chart sunshine overlay (`forecast.show_sunshine`);
//   - the past/station chart block itself when the card has a weather
//     entity but no station sensors (`forecast.openmeteo_history` —
//     see ADR-0015). `buildDailyForecast` reshapes the response into
//     the exact `ForecastEntry[]` shape `MeasuredDataSource` emits, so
//     it drops into the station slot with no special-casing downstream.
//
// All fetch logic lives behind a class so the lifecycle (lazy load on
// first use, in-flight de-dup, abortable on disconnect, opaque retry)
// stays out of the render path.
//
// Unit-tested against a mocked fetch — see tests/openmeteo-source.test.js.

import type { DailySunshineEntry, HourlySunshineEntry } from './sunshine-source.js';
import type { ForecastEntry } from './forecast-utils.js';
import { wmoToCondition } from './weather-code-map.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Daily variables requested in one call. `sunshine_duration` feeds the
// sunshine overlay; the rest feed the no-station past block (ADR-0015).
// Always requested together — Open-Meteo does not charge per field and
// keeping the request shape constant keeps one cache entry valid for
// both features.
const DAILY_FIELDS = [
  'sunshine_duration',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'weather_code',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
].join(',');

// Hourly variables requested when `includeHourly` is on (hourly / today
// chart modes). `sunshine_duration` feeds the sunshine overlay; the
// rest feed the no-station past block at hourly resolution (ADR-0015).
const HOURLY_FIELDS = [
  'sunshine_duration',
  'temperature_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
].join(',');

// Refresh once per hour. Open-Meteo's free tier is 10 000 calls/day per
// IP — at most 24 calls/day per active dashboard tab, which is far
// below the threshold even for a household with several screens. The
// Forecast endpoint updates a few times per day, so an hourly poll
// catches new model runs without hammering the API.
const REFRESH_TTL_MS = 60 * 60 * 1000;

// LocalStorage key prefix. Keyed by lat/lon-rounded-to-2 so two
// dashboards at the same location share the cache, but a dashboard at
// a different location doesn't accidentally see stale far-away data.
const STORAGE_PREFIX = 'wsc_sunshine_';

/** Subset of the Web Storage API the source uses. Allows tests /
 *  unsupported environments to inject their own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Subset of the Fetch API the source uses. Allows tests to inject a
 *  mock without polluting the global. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Listener payload — `ok: false` carries an error string. */
export type SunshineListener = (event: { ok: boolean; error?: string }) => void;

/** Open-Meteo Forecast API JSON response. Daily carries the sunshine
 *  overlay value plus the fields that feed the no-station past block;
 *  hourly carries the per-hour sunshine value. All arrays are parallel
 *  to `time`. */
export interface OpenMeteoResponse {
  daily?: {
    time?: string[];
    sunshine_duration?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    weather_code?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
    wind_gusts_10m_max?: Array<number | null>;
    wind_direction_10m_dominant?: Array<number | null>;
  };
  hourly?: {
    time?: string[];
    sunshine_duration?: Array<number | null>;
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
  /** Daily / hourly station-block entries (ADR-0015). Absent in caches
   *  written by versions before the no-station past block landed — a
   *  missing field just forces one refetch via `isStale`. */
  dailyForecast?: ForecastEntry[];
  hourlyForecast?: ForecastEntry[];
  lastFetchMs?: number;
}

/** Result of `readCachedAvailability`. `lastFetchMs` is 0 when no fetch
 *  has happened yet (e.g. cache restored without a timestamp). */
export interface CachedAvailability {
  pastDays: number;
  forecastDays: number;
  lastFetchMs: number;
}

/** Constructor options for `OpenMeteoSource`. */
export interface OpenMeteoSourceOpts {
  latitude?: number | null;
  longitude?: number | null;
  pastDays?: number;
  forecastDays?: number;
  includeHourly?: boolean;
  fetchImpl?: FetchLike | null;
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Pure helpers (testable without instantiating the source class) ──

/** Builds the Forecast-endpoint URL. `includeHourly` adds the
 *  `hourly=sunshine_duration` parameter alongside `daily=…`, so a
 *  single call returns both granularities — used in hourly chart mode
 *  where the card renders one bar per hour.
 *
 *  Units are pinned explicitly (°C / mm / m·s⁻¹): with no station
 *  sensor the card has no source unit to derive from, so the response
 *  is locked to the card's canonical metric units. `buildDailyForecast`
 *  tags each entry's `wind_speed_unit` so the renderer still converts
 *  wind to the user's display unit. */
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
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
    wind_speed_unit: 'ms',
  });
  if (includeHourly) p.set('hourly', HOURLY_FIELDS);
  return `${FORECAST_URL}?${p.toString()}`;
}

/** Reshape Open-Meteo's parallel `time`/`sunshine_duration` arrays
 *  into the `{date, value}` array `attachSunshine` consumes — same
 *  shape we'd accept from a user-built REST sensor, so the data layer
 *  downstream doesn't know or care which way the values arrived.
 *
 *  Values come back in seconds; `normalizeSunshineValue` (in
 *  sunshine-source) does the sec→hours conversion at lookup time. */
export function parseDailySunshine(response: OpenMeteoResponse | null | undefined): DailySunshineEntry[] {
  if (!response?.daily) return [];
  const t = response.daily.time ?? [];
  const v = response.daily.sunshine_duration ?? [];
  const out: DailySunshineEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    if (v[i] != null) out.push({ date: t[i], value: v[i] });
  }
  return out;
}

/** Hourly counterpart. Open-Meteo's hourly time strings are
 *  "YYYY-MM-DDTHH:MM" in the requested timezone (we use timezone=auto,
 *  matching the user's HA location). `attachSunshine` consumes these
 *  via `localHourString` matching.
 *
 *  Values are seconds of sunshine within that hour, capped at 3600. */
export function parseHourlySunshine(response: OpenMeteoResponse | null | undefined): HourlySunshineEntry[] {
  if (!response?.hourly) return [];
  const t = response.hourly.time ?? [];
  const v = response.hourly.sunshine_duration ?? [];
  const out: HourlySunshineEntry[] = [];
  for (let i = 0; i < t.length; i++) {
    if (v[i] != null) out.push({ datetime: t[i], value: v[i] });
  }
  return out;
}

/** Parse Open-Meteo's "YYYY-MM-DD" civil date (timezone=auto → the
 *  user's local timezone) into a local-midnight ISO string. This
 *  matches `MeasuredDataSource`'s daily `datetime` convention, so the
 *  Open-Meteo past block's columns align with recorder-backed ones. */
function localMidnightIso(civilDate: string | undefined): string | null {
  if (!civilDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(civilDate);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parse Open-Meteo's "YYYY-MM-DDTHH:MM" hourly timestamp (local, since
 *  the request uses timezone=auto) into an on-the-hour ISO string,
 *  matching `MeasuredDataSource`'s hourly `datetime` convention. */
function localHourIso(hourString: string | undefined): string | null {
  if (!hourString) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(hourString);
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]),
  );
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Coerce a possibly-null Open-Meteo array cell to `number | null`. */
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Reshape Open-Meteo's daily parallel arrays into the card's
 *  `ForecastEntry[]` — one entry per civil date, in the exact shape
 *  `MeasuredDataSource` emits for recorder-backed station columns. That
 *  shape match is what lets the Open-Meteo past block drop into the
 *  station slot with no special-casing downstream (ADR-0015).
 *
 *  Conventions, matching `MeasuredDataSource._buildForecast`:
 *    - `datetime` is the local-midnight ISO of each civil date.
 *    - `temperature` is the daily HIGH, `templow` the daily LOW.
 *    - `wind_speed` is the daily MAX (Open-Meteo daily has no mean).
 *    - `humidity` / `pressure` / `uv_index` have no Open-Meteo daily
 *      field and stay null — the chart renders those rows as gaps.
 *    - `sunshine` is left undefined on purpose: the existing sunshine
 *      overlay fills it from the same response, keeping one code path.
 *    - `condition` comes from the WMO `weather_code` via `wmoToCondition`.
 *
 *  Emits every dated row (past, today, and future). Callers slice the
 *  window they need — the no-station station block takes only past +
 *  today; the future rows are the weather entity's job. */
export function buildDailyForecast(
  response: OpenMeteoResponse | null | undefined,
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
    const iso = localMidnightIso(t[i]);
    if (!iso) continue;
    out.push({
      datetime: iso,
      temperature: numOrNull(tMax[i]),
      templow: numOrNull(tMin[i]),
      precipitation: numOrNull(precip[i]),
      wind_speed: numOrNull(windMax[i]),
      wind_gust_speed: numOrNull(gustMax[i]),
      wind_bearing: numOrNull(windDir[i]),
      // The request pins wind_speed_unit=ms — tag each entry so the
      // renderer converts to the user's display unit (no station
      // sensor exists to derive the source unit from).
      wind_speed_unit: 'm/s',
      pressure: null,
      humidity: null,
      uv_index: null,
      condition: wmoToCondition(numOrNull(code[i])),
    });
  }
  return out;
}

/** Hourly counterpart to `buildDailyForecast`. One `ForecastEntry` per
 *  hour, shaped like `MeasuredDataSource`'s hourly output: a single
 *  mean `temperature` (no `templow` — hourly is a single-line series),
 *  precipitation, wind, and a WMO-derived condition. Feeds the
 *  no-station past block in hourly / today chart modes.
 *
 *  `datetime` is the on-the-hour ISO of each timestamp. Emits every
 *  hour Open-Meteo returned — past, current, and future; the card
 *  slices the past window it needs. */
export function buildHourlyForecast(
  response: OpenMeteoResponse | null | undefined,
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
    const iso = localHourIso(t[i]);
    if (!iso) continue;
    out.push({
      datetime: iso,
      temperature: numOrNull(temp[i]),
      precipitation: numOrNull(precip[i]),
      wind_speed: numOrNull(wind[i]),
      wind_gust_speed: numOrNull(gust[i]),
      wind_bearing: numOrNull(dir[i]),
      wind_speed_unit: 'm/s',
      pressure: null,
      humidity: null,
      uv_index: null,
      condition: wmoToCondition(numOrNull(code[i])),
    });
  }
  return out;
}

function storageKey(lat: number, lon: number): string {
  return `${STORAGE_PREFIX}${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

/** Best-effort persistence so a page reload doesn't always re-fetch.
 *  Returns null on any error (private mode, quota, JSON corruption, …). */
function loadFromStorage(storage: StorageLike | null, lat: number, lon: number): CachedPayload | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as CachedPayload;
  } catch (err) {
    // Storage access blocked or JSON corrupted — fall through to a
    // fresh fetch instead of letting the read failure propagate.
    void err;
    return null;
  }
}

function saveToStorage(storage: StorageLike | null, lat: number, lon: number, payload: CachedPayload): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey(lat, lon), JSON.stringify(payload));
  } catch (err) {
    // Quota exceeded or private-mode storage rejection — the cache
    // write is best-effort; silent failure is correct here.
    void err;
  }
}

/** Read the cached daily array and count past vs forecast days. Used
 *  by the editor to surface "Open-Meteo currently has N forecast days
 *  for your location" so the user knows when their `forecast_days`
 *  setting outruns the available data (Open-Meteo's free Forecast
 *  endpoint returns 5–16 days depending on model and location).
 *
 *  Returns null when nothing is cached for that location yet. */
export function readCachedAvailability(
  latitude: number,
  longitude: number,
  storage?: StorageLike | null,
  now: number = Date.now(),
): CachedAvailability | null {
  const fallbackStore = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  const store = storage !== undefined ? storage : fallbackStore;
  if (!store) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const cached = loadFromStorage(store, latitude, longitude);
  if (!cached) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const daily = Array.isArray(cached.daily) ? cached.daily : [];
  let pastDays = 0;
  let forecastDays = 0;
  for (const item of daily) {
    if (!item?.date) continue;
    const d = new Date(item.date);
    d.setHours(0, 0, 0, 0);
    const t = d.getTime();
    if (Number.isNaN(t)) continue;
    if (t < todayMs) pastDays += 1;
    else forecastDays += 1;
  }
  return {
    pastDays,
    forecastDays,
    lastFetchMs: Number(cached.lastFetchMs) || 0,
  };
}

/** Resolve the constructor's `fetchImpl` option to a concrete fetch
 *  function or `null`. An explicit `null` is an opt-out — no network at
 *  all. `undefined` (the default) falls back to the global `fetch` when
 *  the runtime provides one. Kept separate from the constructor so the
 *  three-way resolution stays one simple, branch-isolated unit — and so
 *  the load-bearing null-vs-undefined distinction has a single home.
 *
 *  Why it matters: on modern Node a global `fetch` exists, so a plain
 *  `fetchImpl ?? globalFetch` coalesces an intended `null` ("no fetch")
 *  into a real network call. */
function resolveFetchImpl(fetchImpl: FetchLike | null | undefined): FetchLike | null {
  if (fetchImpl === null) return null;
  if (fetchImpl) return fetchImpl;
  return typeof fetch === 'function' ? (fetch as FetchLike).bind(globalThis) : null;
}

// ── Source class ────────────────────────────────────────────────────

export class OpenMeteoSource {
  latitude: number | null;
  longitude: number | null;
  pastDays: number;
  forecastDays: number;
  includeHourly: boolean;

  private readonly _fetch: FetchLike | null;
  private readonly _storage: StorageLike | null;
  private readonly _now: () => number;

  private _daily: DailySunshineEntry[] = [];
  private _hourly: HourlySunshineEntry[] = [];
  private _dailyForecast: ForecastEntry[] = [];
  private _hourlyForecast: ForecastEntry[] = [];
  private _lastFetchMs = 0;
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
  }: OpenMeteoSourceOpts = {}) {
    this.latitude = latitude ?? null;
    this.longitude = longitude ?? null;
    this.pastDays = pastDays;
    this.forecastDays = forecastDays;
    this.includeHourly = includeHourly === true;
    // Allow overriding the fetch and storage implementations so the
    // tests can run in a Node environment without polluting globals.
    // See resolveFetchImpl for the load-bearing null-vs-undefined
    // contract (`null` = no network, `undefined` = global fetch).
    this._fetch = resolveFetchImpl(fetchImpl);
    const fallbackStorage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    this._storage = storage !== undefined ? storage : fallbackStorage;
    this._now = now ?? (() => Date.now());

    if (Number.isFinite(this.latitude) && Number.isFinite(this.longitude)) {
      const cached = loadFromStorage(this._storage, this.latitude as number, this.longitude as number);
      if (cached) {
        if (Array.isArray(cached.daily)) this._daily = cached.daily;
        if (Array.isArray(cached.hourly)) this._hourly = cached.hourly;
        if (Array.isArray(cached.dailyForecast)) this._dailyForecast = cached.dailyForecast;
        if (Array.isArray(cached.hourlyForecast)) this._hourlyForecast = cached.hourlyForecast;
        this._lastFetchMs = Number(cached.lastFetchMs) || 0;
      }
    }
  }

  /** Synchronous accessors — return whatever's in cache (may be empty
   *  until `ensureFresh` resolves). `attachSunshine` picks the right
   *  one based on the chart's granularity (daily vs hourly). */
  getDailyValues(): DailySunshineEntry[] {
    return this._daily;
  }
  getHourlyValues(): HourlySunshineEntry[] {
    return this._hourly;
  }

  /** Daily station-block entries (ADR-0015). One `ForecastEntry` per
   *  civil date Open-Meteo returned — past, today, and future. The card
   *  slices the past + today window it needs for the station block. */
  getDailyStationForecast(): ForecastEntry[] {
    return this._dailyForecast;
  }

  /** Hourly station-block entries (ADR-0015) — one `ForecastEntry` per
   *  hour Open-Meteo returned. Empty unless `includeHourly` was set. */
  getHourlyStationForecast(): ForecastEntry[] {
    return this._hourlyForecast;
  }

  /** True when we should kick off a refresh (cache empty for the
   *  currently-requested granularity, or stale). */
  isStale(now: number = this._now()): boolean {
    if (!this._daily.length) return true;
    // A cache written before the no-station past block landed (ADR-0015)
    // has no dailyForecast — refetch once so the station block can fill.
    if (!this._dailyForecast.length) return true;
    if (this.includeHourly && !this._hourly.length) return true;
    if (this.includeHourly && !this._hourlyForecast.length) return true;
    return now - this._lastFetchMs >= REFRESH_TTL_MS;
  }

  /** Subscribe a one-shot callback for refresh completion. Lets the
   *  caller request an update / re-measure once the data lands. */
  setListener(cb: SunshineListener | null): void {
    this._listener = cb;
  }

  /** Abort any in-flight fetch — call this on `disconnectedCallback`. */
  abort(): void {
    if (this._abort) {
      try {
        this._abort.abort();
      } catch (err) {
        // AbortController.abort() is idempotent in modern browsers but
        // older polyfills may throw on a second call — safe to swallow.
        void err;
      }
      this._abort = null;
    }
  }

  /** Trigger a refresh if stale and none is already running. Returns
   *  the in-flight promise so callers can await it (most don't — the
   *  listener handles "data arrived" notifications). */
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
        const res = await (this._fetch as FetchLike)(url, signal ? { signal } : undefined);
        if (!res?.ok) {
          throw new Error(`Open-Meteo HTTP ${res ? res.status : '<no response>'}`);
        }
        const json = await res.json() as OpenMeteoResponse;
        this._daily = parseDailySunshine(json);
        this._hourly = this.includeHourly ? parseHourlySunshine(json) : [];
        this._dailyForecast = buildDailyForecast(json);
        this._hourlyForecast = this.includeHourly ? buildHourlyForecast(json) : [];
        this._lastFetchMs = this._now();
        saveToStorage(this._storage, this.latitude as number, this.longitude as number, {
          daily: this._daily,
          hourly: this._hourly,
          dailyForecast: this._dailyForecast,
          hourlyForecast: this._hourlyForecast,
          lastFetchMs: this._lastFetchMs,
        });
        if (this._listener) this._listener({ ok: true });
      } catch (err) {
        // AbortError (disconnect) is expected — don't surface as a
        // problem. Anything else, log and notify the listener so the
        // chart can stay rendering with whatever stale cache it has.
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
