// Request deduplication shared by every card in the tab (ADR-0020): an
// in-flight call is awaited by later callers with the same key, and a
// settled result is reused for a short TTL. Failures are never cached.
//
// SHARED-REFERENCE CONTRACT: every caller of the same key receives the SAME
// resolved object (no clone; payloads can be tens of thousands of rows).
// Treat it as deep-frozen: mutating it corrupts what every other card sees.

const inFlight = new Map<string, Promise<unknown>>();
const results = new Map<string, { ts: number; value: unknown }>();
const MAX_RESULTS = 32;

export function dedupeRequest<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const hit = results.get(key);
  if (hit && now() - hit.ts < ttlMs) {
    return Promise.resolve(hit.value as T);
  }
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    try {
      const value = await fn();
      results.set(key, { ts: now(), value });
      while (results.size > MAX_RESULTS) {
        const oldest = results.keys().next().value;
        if (oldest === undefined) break;
        results.delete(oldest);
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

/** Test hook — wipes both maps. */
export function clearDedupeCaches(): void {
  inFlight.clear();
  results.clear();
}
