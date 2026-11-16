// Precipitation-probability overlay for the forecast columns (#288): the
// weather entity's own `precipitation_probability` first, Open-Meteo values
// only for entries that have none (ADR-0027). Measured station entries never
// get one, so callers pass the forecast slice only.

import { localDateString, localHourString } from './sunshine-source.js';
import type { Calendar } from './utils/time-zone.js';

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

/** Clamp a raw value to an integer 0..100, or null when it is not a finite number. */
export function normalizeProbability(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(100, n)));
}

/** Overlay Open-Meteo probabilities onto entries that have none; returns a
 *  new array. An entity-provided value wins; an unmatched entry gets `null`. */
export function attachPrecipProbability<T extends ProbabilityForecastEntry>(
  forecasts: ReadonlyArray<T>,
  calendar: Calendar,
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
      ? localHourString(dt, calendar)?.slice(0, 13)
      : localDateString(calendar.startOfDay(dt), calendar);
    out.precipitation_probability = key != null ? (lookup.get(key) ?? null) : null;
    return out;
  });
}

/** Index by time key: "YYYY-MM-DDTHH" (hourly) or "YYYY-MM-DD" (daily). Malformed items are skipped. */
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

/** `attachPrecipProbability` fed from an `OpenMeteoSource`; a missing source
 *  still normalizes entity-provided values. */
export function overlayPrecipProbability<T extends ProbabilityForecastEntry>(
  forecasts: ReadonlyArray<T>,
  source: Partial<ProbabilitySource> | null | undefined,
  calendar: Calendar,
  granularity: 'daily' | 'hourly' = 'daily',
): T[] {
  const dailyValues = source && typeof source.getDailyProbability === 'function'
    ? source.getDailyProbability()
    : null;
  const hourlyValues = source && typeof source.getHourlyProbability === 'function'
    ? source.getHourlyProbability()
    : null;
  return attachPrecipProbability(forecasts, calendar, { dailyValues, hourlyValues, granularity });
}

/** True when at least one entry carries a usable probability, i.e. the
 *  entity covers it and no Open-Meteo fallback is needed. */
export function forecastHasProbability(
  forecasts: ReadonlyArray<ProbabilityForecastEntry> | null | undefined,
): boolean {
  if (!Array.isArray(forecasts)) return false;
  return forecasts.some((e) => normalizeProbability(e?.precipitation_probability) != null);
}
