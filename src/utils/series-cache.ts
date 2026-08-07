// Persistent stale-while-revalidate cache for the card's two data
// series (station statistics, weather forecast). Perf pass 2026-08.
//
// Why: the FIRST chart paint is gated on every expected data source
// having produced a value (`_allExpectedDataReady`). The forecast
// usually lands in tens of ms (HA serves the weather entity's cached
// forecast), but the station side is a recorder/statistics_during_period
// roundtrip — 0.5–3 s on Pi-class hosts. Until then the user sees the
// skeleton. Persisting the last payload per fetch signature lets the
// card render REAL data immediately after a reload; the live fetch
// overwrites it seconds later (and `forecastsEqual` in main.ts skips
// the re-render entirely when nothing changed).
//
// Storage shape is versioned; unknown versions and malformed JSON are
// treated as a miss. Writes are best-effort — quota errors / private
// mode fall through silently, the card just keeps its skeleton path.

/** Structural stand-in for the card's ForecastEntry. The cache only
 *  round-trips JSON — it never reads a field — so a minimal record
 *  type keeps this module a true leaf (utils-leaf rule: no imports
 *  from other src/ subtrees, not even type-only). Callers narrow the
 *  loaded array back to their own entry type. */
export type CachedSeriesEntry = Record<string, unknown>;

const PREFIX = 'wsc_series_';
const VERSION = 1;

/** Reject cached payloads older than this. Stale data is *shown* on
 *  purpose (that's the point), but a payload from last week would
 *  render a visibly wrong window for the seconds until the live fetch
 *  lands — 12 h keeps the flash plausible (worst case: yesterday
 *  evening's columns for a moment). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface StoredSeries {
  v: number;
  ts: number;
  forecast: CachedSeriesEntry[];
}

function storageOrNull(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Access to localStorage itself can throw in hardened contexts.
    return null;
  }
}

/** Stable cache key for a data source's fetch signature. `parts` should
 *  contain everything that changes the fetched payload (fetch key,
 *  window size, entity ids). */
export function seriesCacheKey(kind: 'station' | 'forecast', parts: ReadonlyArray<string | number>): string {
  return `${PREFIX}${kind}_${parts.join('|')}`;
}

export function loadSeriesCache(key: string, now: number = Date.now()): CachedSeriesEntry[] | null {
  const storage = storageOrNull();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSeries | null;
    if (parsed?.v !== VERSION || !Array.isArray(parsed.forecast)) return null;
    if (!Number.isFinite(parsed.ts) || now - parsed.ts > MAX_AGE_MS) return null;
    return parsed.forecast;
  } catch {
    return null;
  }
}

/** `forecast` is typed `object` (not CachedSeriesEntry) so callers can
 *  pass interface-typed entry arrays — interfaces have no index
 *  signature and would not assign to a Record. The entries only get
 *  JSON-serialized here, never field-read. */
export function saveSeriesCache(key: string, forecast: ReadonlyArray<object>, now: number = Date.now()): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ v: VERSION, ts: now, forecast: [...forecast] as CachedSeriesEntry[] } satisfies StoredSeries));
  } catch {
    // Quota / private mode — cache write is best-effort.
  }
  pruneExpiredSeries(storage, now);
}

/** Sweep expired / unreadable `wsc_series_*` entries. Config edits
 *  (entity swaps, window changes) move a card to a new cache key and
 *  orphan the old one — without this sweep those slots would sit in
 *  localStorage forever. Runs on every save; the card has a handful
 *  of keys at most, so the scan is cheap. Best-effort like the write. */
function pruneExpiredSeries(storage: Storage, now: number): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      let expired = true;
      try {
        const parsed = JSON.parse(storage.getItem(k) ?? '') as StoredSeries | null;
        expired = parsed?.v !== VERSION
          || !Number.isFinite(parsed.ts)
          || now - parsed.ts > MAX_AGE_MS;
      } catch {
        // Unreadable payload — treat as stale.
      }
      if (expired) stale.push(k);
    }
    for (const k of stale) storage.removeItem(k);
  } catch {
    // Storage iteration can throw in hardened contexts — skip the sweep.
  }
}
