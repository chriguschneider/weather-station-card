// Process-wide cache of `Intl.DateTimeFormat` and `Intl.NumberFormat`
// instances, keyed by `(language, options)`. Construction of these
// formatters runs an ICU locale lookup and resolves a per-instance
// options bag — ~0.5-2 ms per call on a desktop, more on a Pi. The
// formatters themselves are immutable; sharing them across callers
// is safe and removes the per-frame construction cost.
//
// Hot callers covered today:
//   - `daily-tick-labels.ts` (4 formatters, already cached per
//     plugin instance — generalising drops the duplication when the
//     user toggles between render modes and a fresh plugin lands)
//   - `main.ts` `updateClock` (3 formatters per tick × once per
//     second from a `setInterval`)
//   - `main.ts` sun-row render (2 formatters per render — 2-5×/sec
//     under `set hass` fanout)
//   - `scroll-ux.ts` per-tick date label
//
// Eviction: simple Map with insertion-order eviction once the entry
// count crosses `MAX_ENTRIES`. The realistic working set is one
// `language` × ~6 distinct options shapes, so the cap of 32 is
// effectively unbounded for normal use; the cap exists only to
// stop a pathological caller (e.g. a fuzzed options bag) from
// growing the cache without bound.

const MAX_ENTRIES = 32;

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();

function stableKey(language: string, options: object | undefined): string {
  // JSON.stringify on a small options bag is faster than building a
  // structured key by hand; the bag has < 10 properties and only
  // primitive values (Intl options never contain functions or refs).
  return language + '|' + (options ? JSON.stringify(options) : '');
}

function bump<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    // Map iteration is insertion-order; the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

/** Cached `Intl.DateTimeFormat`. Same `(language, options)` pair
 *  returns the same instance across the process. */
export function getDateTimeFormat(
  language: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = stableKey(language, options);
  const hit = dateTimeCache.get(key);
  if (hit) return hit;
  return bump(dateTimeCache, key, new Intl.DateTimeFormat(language, options));
}

/** Cached `Intl.NumberFormat`. */
export function getNumberFormat(
  language: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = stableKey(language, options);
  const hit = numberCache.get(key);
  if (hit) return hit;
  return bump(numberCache, key, new Intl.NumberFormat(language, options));
}

/** Clears both caches. Exported for tests. */
export function _clearIntlCaches(): void {
  dateTimeCache.clear();
  numberCache.clear();
}
