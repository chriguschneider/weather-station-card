// Precipitation-probability overlay for the forecast columns (#288).
//
// The chart prints the chance of rain next to the amount in the
// per-column precip pill. The value comes from two places, in this
// order (ADR-0027):
//   1. the weather entity's own forecast — `precipitation_probability`
//      is a standard HA Forecast slot (MeteoSwiss, AccuWeather,
//      OpenWeatherMap, Pirate Weather fill it);
//   2. Open-Meteo, as a fallback for entities that leave it empty
//      (Met.no, the core Open-Meteo integration) — one extra field on
//      the request the sunshine bar already makes.
//
// This module is the overlay step: match Open-Meteo's per-day / per-hour
// values onto forecast entries that have no probability yet. Measured
// station entries never get one — probability is a forecast notion —
// so callers pass the forecast slice only.
//
// Pure; unit-tested in tests/precip-probability.test.js.

import { localDateString, localHourString } from './sunshine-source.js';
import { startOfDay } from './utils/time-zone.js';

/** One Open-Meteo daily value: civil date "YYYY-MM-DD" → max chance of
 *  rain that day, integer percent. */
export interface DailyProbabilityEntry {
  date: string;
  value: number;
}

/** One Open-Meteo hourly value: "YYYY-MM-DDTHH:MM" (HA-location time)
 *  → chance of rain in that hour, integer percent. */
export interface HourlyProbabilityEntry {
  datetime: string;
  value: number;
}

/** What the overlay needs from an `OpenMeteoSource`. */
export interface ProbabilitySource {
  getDailyProbability(): ReadonlyArray<DailyProbabilityEntry> | null;
  getHourlyProbability(): ReadonlyArray<HourlyProbabilityEntry> | null;
}

/** Minimal entry shape the overlay reads and writes. */
export interface ProbabilityForecastEntry {
  datetime?: string;
  precipitation_probability?: number | null;
}

export interface AttachPrecipProbabilityOpts {
  dailyValues?: ReadonlyArray<DailyProbabilityEntry> | null;
  hourlyValues?: ReadonlyArray<HourlyProbabilityEntry> | null;
  granularity?: 'daily' | 'hourly';
}

/** Clamp a raw value to an integer 0..100, or null when it is not a
 *  finite number. Shared by the entity and Open-Meteo paths so the
 *  pill never prints "NaN" or "120". */
export function normalizeProbability(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(100, n)));
}

/** Overlay Open-Meteo probabilities onto forecast entries that have
 *  none. Non-destructive — returns a NEW array. An entry that already
 *  carries a finite `precipitation_probability` (from the weather
 *  entity) keeps it, normalized to an integer percent; an entry that
 *  matches nothing keeps `null` so the pill prints the amount alone. */
export function attachPrecipProbability<T extends ProbabilityForecastEntry>(
  forecasts: ReadonlyArray<T>,
  opts?: AttachPrecipProbabilityOpts | null,
): T[] {
  if (!Array.isArray(forecasts)) return [];
  const isHourly = opts?.granularity === 'hourly';
  const lookup = buildLookup(isHourly ? opts?.hourlyValues : opts?.dailyValues, isHourly);

  return forecasts.map((entry) => {
    const out: T = { ...entry };
    const existing = normalizeProbability(entry.precipitation_probability);
    if (existing != null) {
      out.precipitation_probability = existing;
      return out;
    }
    const dt = entry.datetime ? new Date(entry.datetime) : null;
    if (!dt || Number.isNaN(dt.getTime()) || lookup.size === 0) {
      out.precipitation_probability = null;
      return out;
    }
    const key = isHourly
      ? localHourString(dt)?.slice(0, 13)
      : localDateString(startOfDay(dt));
    out.precipitation_probability = key != null ? (lookup.get(key) ?? null) : null;
    return out;
  });
}

/** Index the Open-Meteo array by its time key. Hourly keys compare on
 *  "YYYY-MM-DDTHH" (first 13 chars), daily on "YYYY-MM-DD" — the same
 *  tolerance the sunshine overlay uses. Malformed items are skipped. */
function buildLookup(
  source: ReadonlyArray<DailyProbabilityEntry | HourlyProbabilityEntry> | null | undefined,
  isHourly: boolean,
): Map<string, number> {
  const lookup = new Map<string, number>();
  if (!Array.isArray(source)) return lookup;
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const raw = isHourly
      ? (item as HourlyProbabilityEntry).datetime
      : (item as DailyProbabilityEntry).date;
    const v = normalizeProbability((item as { value?: unknown }).value);
    if (typeof raw !== 'string' || v == null) continue;
    lookup.set(isHourly ? raw.slice(0, 13) : raw.slice(0, 10), v);
  }
  return lookup;
}

/** Wire `attachPrecipProbability` to an `OpenMeteoSource` (or anything
 *  with the two getters). A missing source still normalizes the
 *  entity-provided values. */
export function overlayPrecipProbability<T extends ProbabilityForecastEntry>(
  forecasts: ReadonlyArray<T>,
  source: Partial<ProbabilitySource> | null | undefined,
  granularity: 'daily' | 'hourly' = 'daily',
): T[] {
  const dailyValues = source && typeof source.getDailyProbability === 'function'
    ? source.getDailyProbability()
    : null;
  const hourlyValues = source && typeof source.getHourlyProbability === 'function'
    ? source.getHourlyProbability()
    : null;
  return attachPrecipProbability(forecasts, { dailyValues, hourlyValues, granularity });
}

/** True when at least one entry carries a usable probability — the
 *  card uses this to decide whether the entity covers the feature or
 *  the Open-Meteo fallback must be fetched. */
export function forecastHasProbability(
  forecasts: ReadonlyArray<ProbabilityForecastEntry> | null | undefined,
): boolean {
  if (!Array.isArray(forecasts)) return false;
  return forecasts.some((e) => normalizeProbability(e?.precipitation_probability) != null);
}
