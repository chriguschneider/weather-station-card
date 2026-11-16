// Pure helpers for the sunshine-duration row: the overlay that fills
// `sunshine` on the merged forecast array (entity, Open-Meteo, cloud-cover
// estimate) and the lux derivation (Method B2) for the station past.
// Sources and precedence: ADR-0028.

import { clearSkyLuxFactory } from './condition-classifier.js';
import { resolveLocation } from './location.js';
import type { Calendar } from './utils/time-zone.js';
import { declinationDeg } from './utils/solar.js';


/** Date-input shapes the lookup helpers accept. Strings go through `new
 *  Date(...)`; numbers are treated as ms since epoch. */
export type DateLike = Date | string | number;

/** Per-key value shape: numeric strings, numbers or null (gap marker).
 *  `normalizeSunshineValue` normalises it. */
export type SunshineValueLike = number | string | null;

export interface DailySunshineEntry {
  date?: string;
  datetime?: string;
  value?: SunshineValueLike;
  sunshine?: SunshineValueLike;
  duration?: SunshineValueLike;
  sunshine_duration?: SunshineValueLike;
}

/** Per-hour sunshine entry: Open-Meteo's hourly series as {datetime, value}. */
export interface HourlySunshineEntry {
  datetime?: string;
  value?: number | string | null;
}

/** Daily values: entries, a date-keyed map, or a `history` / `forecast` envelope. */
export type DailySunshineInput =
  | ReadonlyArray<DailySunshineEntry | [string, number | string]>
  | { history?: DailySunshineInput; forecast?: DailySunshineInput }
  | Record<string, number | string | null>;

export type HourlySunshineInput = ReadonlyArray<HourlySunshineEntry>;

/** Forecast entry shape this module operates on. */
export interface SunshineForecastEntry {
  datetime?: string;
  sunshine?: number | null;
  day_length?: number | null;
  [k: string]: unknown;
}

/** Options bag for `attachSunshine`. */
export interface AttachSunshineOpts {
  dailyValues?: DailySunshineInput | null;
  hourlyValues?: HourlySunshineInput | null;
  latitude?: number | null;
  granularity?: 'daily' | 'hourly';
  /** When the recorder sensor and the Open-Meteo overlay both come up
   *  empty, estimate from `entry.cloud_coverage` with this Kasten
   *  exponent (#6 Option F3). Null turns the estimate off; the column
   *  stays empty. */
  cloudCoverageExponent?: number | null;
}

/** Astronomical day length in hours (sunrise equation: cos(H₀) =
 *  -tan(φ)·tan(δ), length = 2 H₀ / 15°). No refraction correction (~6
 *  min, negligible for the day-fraction scaling). Polar night → 0,
 *  midnight sun → 24, non-finite latitude → 12. */
export function dayLengthHours(latDeg: number | null | undefined, date: DateLike, calendar: Calendar): number {
  if (!Number.isFinite(latDeg)) return 12;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 12;
  const decl = declinationDeg(calendar.dayOfYear(d)) * Math.PI / 180;
  const lat = (latDeg as number) * Math.PI / 180;
  const cosH = -Math.tan(lat) * Math.tan(decl);
  if (cosH <= -1) return 24;
  if (cosH >= 1) return 0;
  const H = Math.acos(cosH);
  return (2 * H * 180 / Math.PI) / 15;
}

/** Sunshine in hours from a value in hours or seconds. A day cannot
 *  exceed 24 h, so values ≥ 30 are read as seconds (÷ 3600), smaller
 *  ones as hours. Null for non-numeric input, negatives clamp to 0. */
export function normalizeSunshineValue(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  return n >= 30 ? n / 3600 : n;
}

/** Civil date YYYY-MM-DD in the card's (server) zone. Open-Meteo's daily
 *  series uses the civil dates of the HA location (`timezone=auto`). */
export function localDateString(date: DateLike, calendar: Calendar): string | null {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return calendar.dayKey(d);
}

/** Local-hour key YYYY-MM-DDTHH:00; Open-Meteo emits one value per full hour. */
export function localHourString(date: DateLike, calendar: Calendar): string | null {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return calendar.hourKey(d);
}

/** Value of the {datetime, value} item in the same hour as `hourKey`.
 *  Compares the first 13 chars ("YYYY-MM-DDTHH"), so minutes are ignored. */
export function findInHourArray(
  arr: HourlySunshineInput | null | undefined,
  hourKey: string | null | undefined,
): number | null {
  if (!Array.isArray(arr) || !hourKey) return null;
  const k = hourKey.slice(0, 13);
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const itemKey = item.datetime != null ? String(item.datetime).slice(0, 13) : null;
    if (itemKey === k) return normalizeSunshineValue(item.value);
  }
  return null;
}

/** Look up a day's sunshine in a date-keyed input: `{date|datetime, value}`
 *  entries, `[date, value]` tuples, a `{date: value}` map, or a
 *  `{history|forecast: [...]}` envelope. Normalised via
 *  `normalizeSunshineValue`; null if there is no match. */
export function findInDateArray(
  arr: DailySunshineInput | null | undefined,
  dateString: string | null | undefined,
): number | null {
  if (!arr || !dateString) return null;

  if (!Array.isArray(arr) && typeof arr === 'object') {
    const obj = arr as { history?: DailySunshineInput; forecast?: DailySunshineInput }
      & Record<string, number | string | null>;
    if (Array.isArray(obj.history)) return findInDateArray(obj.history, dateString);
    if (Array.isArray(obj.forecast)) return findInDateArray(obj.forecast, dateString);
    if (Object.prototype.hasOwnProperty.call(obj, dateString)) {
      return normalizeSunshineValue(obj[dateString]);
    }
    return null;
  }

  if (!Array.isArray(arr)) return null;

  for (const item of arr) {
    const result = matchDailyEntry(item, dateString);
    if (result !== undefined) return result;
  }
  return null;
}

/** undefined: the item is for another date; number: match with a value;
 *  null: match with a missing or invalid value. */
function matchDailyEntry(item: unknown, dateString: string): number | null | undefined {
  if (!item) return undefined;

  if (Array.isArray(item)) {
    if (item.length < 2) return undefined;
    const k = String(item[0] || '').slice(0, 10);
    return k === dateString ? normalizeSunshineValue(item[1]) : undefined;
  }

  if (typeof item !== 'object') return undefined;

  const entry = item as DailySunshineEntry;
  const dateRaw = entry.date ?? entry.datetime;
  const k = dateRaw != null ? String(dateRaw).slice(0, 10) : null;
  if (k !== dateString) return undefined;
  const v = entry.value ?? entry.sunshine ?? entry.duration ?? entry.sunshine_duration;
  return normalizeSunshineValue(v);
}

/** Set `sunshine` and `day_length` on each entry; returns a new array.
 *  'daily' matches `dailyValues` by local date, day_length from the
 *  sunrise equation; 'hourly' matches `hourlyValues` by local hour,
 *  day_length 1. Values are clamped to 0..day_length. */
export function attachSunshine<T extends SunshineForecastEntry>(
  forecasts: ReadonlyArray<T>,
  calendar: Calendar,
  opts?: AttachSunshineOpts | null,
): T[] {
  if (!Array.isArray(forecasts)) return [];
  if (!opts) return forecasts.map((f) => ({ ...f }));

  const { dailyValues, hourlyValues, latitude, granularity = 'daily', cloudCoverageExponent } = opts;
  const isHourly = granularity === 'hourly';

  return forecasts.map((entry) => {
    const out: T = { ...entry };
    const dt = entry.datetime ? new Date(entry.datetime) : null;
    if (!dt || Number.isNaN(dt.getTime())) {
      out.sunshine = null;
      out.day_length = null;
      return out;
    }

    let value: number | null;
    let cap: number;
    if (isHourly) {
      const hourKey = localHourString(dt, calendar);
      value = findInHourArray(hourlyValues, hourKey);
      out.day_length = 1;
      cap = 1;
    } else {
      const entryMidnight = calendar.startOfDay(new Date(dt));
      const dateKey = localDateString(entryMidnight, calendar);
      out.day_length = dayLengthHours(latitude, entryMidnight, calendar);
      value = findInDateArray(dailyValues, dateKey);
      cap = out.day_length;
    }

    if (value != null) {
      if (cap > 0 && value > cap) value = cap;
      if (value < 0) value = 0;
    }
    // An existing value (recorder daily max, entity sunshine) wins; the
    // overlay only fills entries that have none. Today keeps the
    // recorder's running max although it is partial early in the day (#37).
    const existing = (entry as { sunshine?: number | null }).sunshine;
    if (existing != null && Number.isFinite(existing)) {
      out.sunshine = existing;
    } else if (value != null) {
      out.sunshine = value;
    } else if (
      cloudCoverageExponent != null
      && !isHourly
      && out.day_length != null
      && (out.day_length) > 0
    ) {
      // Daily only: hourly cloud_coverage is too coarse for a per-hour
      // estimate (#6 Option F3).
      const cc = (entry as { cloud_coverage?: number | null }).cloud_coverage;
      out.sunshine = sunshineFromCloudCoverage(cc, out.day_length, cloudCoverageExponent);
    } else {
      out.sunshine = null;
    }
    return out;
  });
}

/** Kasten-style estimate: sunshine_h ≈ day_length × (1 − cc^p). */
export function sunshineFromCloudCoverage(
  cloudPercent: number | null | undefined,
  dayLengthH: number | null | undefined,
  exponent = 1.7,
): number | null {
  if (cloudPercent == null || !Number.isFinite(cloudPercent)) return null;
  if (dayLengthH == null || !Number.isFinite(dayLengthH) || dayLengthH <= 0) return null;
  const cc = Math.max(0, Math.min(100, cloudPercent));
  const fraction = 1 - Math.pow(cc / 100, exponent);
  if (!Number.isFinite(fraction)) return null;
  return dayLengthH * Math.max(0, fraction);
}

/** (sunshine_h, dayLength_h) pairs as 0..1 bar fractions. Null sunshine
 *  or a missing/zero day length gives null, so uPlot draws a gap and not
 *  a thin baseline stripe. */
export function sunshineFractions(
  sunshineHours: ReadonlyArray<number | null | undefined>,
  dayLengthHoursArr: ReadonlyArray<number | null | undefined> | null | undefined,
): Array<number | null> {
  if (!Array.isArray(sunshineHours)) return [];
  return sunshineHours.map((v, i) => {
    // A malformed sunshine value (NaN, a non-numeric string, an object)
    // must come out as a gap, not as a NaN bar height that uPlot would
    // then fold into the axis scale.
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const dl = Array.isArray(dayLengthHoursArr) ? dayLengthHoursArr[i] : null;
    if (!Number.isFinite(dl) || (dl as number) <= 0) return null;
    return Math.max(0, Math.min(1, v / (dl as number)));
  });
}

/** What the overlay reads from an `OpenMeteoSource`. */
export interface SunshineSource {
  getDailyValues(): DailySunshineInput | null;
  getHourlyValues(): HourlySunshineInput | null;
}

interface HassLatLon {
  config?: { latitude?: number | null };
}

/** Forecast entry as the weather entity delivers it. `sunshine_duration`
 *  is not a standard HA Forecast slot: hass-meteoswiss-weather fills it
 *  in MINUTES (hourly entries: that hour, daily: the local day's sum). */
export interface EntitySunshineEntry {
  sunshine?: number | null;
  sunshine_duration?: unknown;
}

/** The entity's sunshine in hours, or null when the entry has none.
 *  Explicit minutes → hours instead of `normalizeSunshineValue`'s
 *  seconds/hours heuristic, which would read 45 min as 45 s. */
export function entitySunshineHours(entry: EntitySunshineEntry | null | undefined): number | null {
  const raw = entry?.sunshine_duration;
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(0, n) / 60;
}

/** Set `sunshine` from the entity's `sunshine_duration` (ADR-0028).
 *  Runs before `attachSunshine`, which keeps an existing `sunshine`, so
 *  Open-Meteo and the cloud-cover estimate only fill entries without
 *  one. Non-destructive — returns a NEW array. */
export function attachEntitySunshine<T extends EntitySunshineEntry>(
  forecasts: ReadonlyArray<T>,
): T[] {
  if (!Array.isArray(forecasts)) return [];
  return forecasts.map((entry) => {
    const hours = entitySunshineHours(entry);
    return hours == null ? { ...entry } : { ...entry, sunshine: hours };
  });
}

/** True when EVERY entry carries the entity's sunshine — only then can
 *  the card skip the Open-Meteo request for the forecast columns. An
 *  empty slice has nothing to fill and counts as covered. */
export function forecastCoversSunshine(
  forecasts: ReadonlyArray<EntitySunshineEntry> | null | undefined,
): boolean {
  if (!Array.isArray(forecasts)) return true;
  return forecasts.every((e) => entitySunshineHours(e) != null);
}

/** Run `attachSunshine` with the Open-Meteo source's values. The latitude
 *  comes from the card's `location` option, else from `hass.config`. */
export function overlayFromOpenMeteo<T extends SunshineForecastEntry>(
  forecasts: ReadonlyArray<T>,
  hass: HassLatLon | null | undefined,
  source: Partial<SunshineSource> | null | undefined,
  calendar: Calendar,
  granularity: 'daily' | 'hourly' = 'daily',
  cloudCoverageExponent: number | null = null,
  location: unknown = null,
): T[] {
  const lat = resolveLocation({ location }, hass)?.latitude ?? null;
  const dailyValues = source && typeof source.getDailyValues === 'function'
    ? source.getDailyValues()
    : null;
  const hourlyValues = source && typeof source.getHourlyValues === 'function'
    ? source.getHourlyValues()
    : null;
  return attachSunshine(forecasts, calendar, {
    dailyValues,
    hourlyValues,
    latitude: Number.isFinite(lat as number) ? lat as number : null,
    granularity,
    cloudCoverageExponent,
  });
}

/** A single illuminance sample as emitted by HA's `recorder/history`
 *  WS call: timestamp + measured lux value. */
export interface LuxSample {
  /** Sample timestamp in ms since epoch (i.e. `new Date(state.last_changed).getTime()`). */
  ts: number;
  /** Measured illuminance in lux (BH1750 / TSL2591 / Ecowitt-class). */
  lux: number;
}

/** Per-day result from `sunshineFromLuxHistory`. */
export interface DailyLuxSunshine {
  /** Local date key (`YYYY-MM-DD`) for the day this aggregate covers. */
  date: string;
  /** Sunshine duration in hours (not capped; callers cap at day length). */
  hours: number;
}

/** Sunshine hours per local day from illuminance samples (Method B2,
 *  #6/#66). An interval counts when lux / clearsky_lux at its start
 *  (zero-order hold) is >= `threshold`. Intervals longer than
 *  `maxIntervalMs` are skipped, so a data gap is not one sunny interval.
 *  Samples are sorted here; malformed ones are dropped. */
export function sunshineFromLuxHistory(
  samples: ReadonlyArray<LuxSample>,
  latitude: number,
  longitude: number,
  calendar: Calendar,
  threshold = 0.6,
  maxIntervalMs = 10 * 60 * 1000,
): DailyLuxSunshine[] {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  if (!Number.isFinite(threshold) || threshold <= 0) return [];

  const valid = samples
    .filter((s) => s != null && Number.isFinite(s.ts) && Number.isFinite(s.lux) && s.lux >= 0)
    .slice()
    .sort((a, b) => a.ts - b.ts);
  if (valid.length < 2) return [];

  const clearsky = clearSkyLuxFactory(latitude, longitude, calendar);
  const totals = new Map<string, number>();

  for (let i = 0; i < valid.length - 1; i++) {
    const s = valid[i];
    const next = valid[i + 1];
    const gap = next.ts - s.ts;
    if (gap <= 0 || gap > maxIntervalMs) continue;

    const cs = clearsky(new Date(s.ts));
    if (cs <= 0) continue; // night — sun below horizon
    const ratio = s.lux / cs;
    if (ratio < threshold) continue;

    // An interval spanning midnight (polar summer only) is credited
    // entirely to its start day.
    const dateKey = calendar.dayKey(s.ts);
    totals.set(dateKey, (totals.get(dateKey) ?? 0) + gap);
  }

  return Array.from(totals.entries())
    .map(([date, ms]) => ({ date, hours: ms / (60 * 60 * 1000) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
