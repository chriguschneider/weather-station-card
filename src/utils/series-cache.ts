// Persistent stale-while-revalidate cache for the card's two data series
// (station statistics, forecast): the first chart paint waits for every
// source, so the last payload per fetch signature is shown until the live
// fetch lands. Unknown versions and malformed JSON are a miss; writes are
// best-effort.
import { safeLocalStorage } from './safe-storage.js';

/** Structural stand-in for ForecastEntry: the cache only round-trips JSON,
 *  and a minimal record type keeps this module a leaf (no imports from other
 *  src/ subtrees). Callers narrow the loaded array to their own type. */
export type CachedSeriesEntry = Record<string, unknown>;

const PREFIX = 'wsc_series_';
// Bump when the stored shape or what an entry means changes: keys carry the
// time zone (ADR-0030), daily entries are card days (#355), and entries
// are in canonical units (ADR-0035).
const VERSION = 5;

/** Older payloads would show a visibly wrong window until the live fetch lands. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface StoredSeries {
  v: number;
  ts: number;
  forecast: CachedSeriesEntry[];
}

const storageOrNull = safeLocalStorage;

/** Stable cache key for a data source's fetch signature. `parts` should
 *  contain everything that changes the fetched payload (time zone, fetch
 *  key, window size, entity ids). */
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

/** `forecast` is typed `object` because interface-typed entries have no
 *  index signature and would not assign to a Record. */
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

/** Sweep expired / unreadable `wsc_series_*` entries: a config edit moves a
 *  card to a new key and orphans the old one. Best-effort like the write. */
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
