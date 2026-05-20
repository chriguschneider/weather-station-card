// Defensive sanitisers for the chart data path.
//
// The card trusts its data sources (recorder statistics, HA weather
// entities, Open-Meteo). In practice those can serve malformed shapes:
// a `null` forecast entry, an entry missing `datetime`, a temperature
// that arrived as the string "unavailable", a NaN from a divide-by-zero
// upstream. None of that should ever blank the card — it must render
// what it can or fall back to the degraded error banner.
//
// These helpers are pure and have no DOM / Chart dependency so they are
// cheap to unit-test against every malformed shape. They never throw.

/** Drop entries that cannot be drawn. An entry survives only when it is
 *  a plain object with a non-empty string `datetime` — every downstream
 *  consumer (`computeForecastData`, the chart plugins, the icon row)
 *  indexes `entry.datetime` and would throw on `null`/`undefined` or
 *  produce an `Invalid Date` column on a missing/blank value.
 *
 *  Generic so a typed input array keeps its element type (the call
 *  sites in main.ts feed `this.forecasts` and rely on the loose entry
 *  shape downstream). Returns a NEW array; never mutates the input;
 *  never throws. A non-array input yields `[]`. */
export function sanitizeForecastEntries<T>(
  entries: ReadonlyArray<T> | null | undefined,
): T[];
export function sanitizeForecastEntries(entries: unknown): unknown[];
export function sanitizeForecastEntries(entries: unknown): unknown[] {
  if (!Array.isArray(entries)) return [];
  const out: unknown[] = [];
  for (const e of entries) {
    if (e === null || typeof e !== 'object') continue;
    const dt = (e as { datetime?: unknown }).datetime;
    if (typeof dt !== 'string' || dt.trim() === '') continue;
    out.push(e);
  }
  return out;
}

/** Coerce one value to a chart-safe `number | null`. Strings that
 *  parse to a finite number are accepted ("21.4" → 21.4); NaN,
 *  Infinity, booleans, objects and unparseable strings all collapse to
 *  `null` so Chart/uPlot draws a gap instead of choking on a non-number
 *  or plotting a fake point at a coerced 0. */
export function coerceNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Map a positional series to chart-safe `(number | null)[]`. A
 *  non-array input yields `[]`. Used on the temperature / precip /
 *  sunshine arrays before they reach the dataset builder so a single
 *  bad cell can't NaN-poison an axis scale. */
export function coerceNumericSeries(
  values: unknown,
): Array<number | null> {
  if (!Array.isArray(values)) return [];
  return values.map(coerceNumeric);
}
