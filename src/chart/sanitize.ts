// Defensive sanitisers for the chart data path. Sources can serve
// malformed shapes (a `null` entry, a missing `datetime`, "unavailable"
// as a temperature, NaN); none of that may blank the card. Pure, no
// DOM dependency, never throw.

/** Drop entries that cannot be drawn. An entry survives only when it is
 *  a plain object with a non-empty string `datetime`; consumers index
 *  `entry.datetime` and would throw or produce an `Invalid Date`
 *  column otherwise. Generic so a typed input keeps its element type.
 *  Returns a new array; a non-array input yields `[]`. */
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
 *  `null` so uPlot draws a gap instead of a fake point at a coerced 0. */
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

/** Map a positional series to chart-safe `(number | null)[]` so one
 *  bad cell can't NaN-poison an axis scale. A non-array input yields
 *  `[]`. */
export function coerceNumericSeries(
  values: unknown,
): Array<number | null> {
  if (!Array.isArray(values)) return [];
  return values.map(coerceNumeric);
}
