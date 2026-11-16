// Process-wide cache of `Intl.DateTimeFormat` / `Intl.NumberFormat`, keyed
// by `(language, options)`. Construction runs an ICU lookup; the instances
// are immutable, so sharing them is safe.
// FIFO-capped at MAX_ENTRIES only to bound a pathological caller (a fuzzed
// options bag); a normal working set is far below it.

const MAX_ENTRIES = 32;

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();

function stableKey(language: string, options: object | undefined): string {
  // Intl options bags hold only primitives, so JSON.stringify is a stable key.
  return language + '|' + (options ? JSON.stringify(options) : '');
}

function bump<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

/** Cached `Intl.DateTimeFormat`. Same `(language, options)` pair
 *  returns the same instance across the process. `timeZone` is required
 *  so every displayed time names its card's zone (ADR-0030); it is part
 *  of the key, so cards in different zones never share an instance. */
export function getDateTimeFormat(
  language: string,
  options: Intl.DateTimeFormatOptions & { timeZone: string },
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
