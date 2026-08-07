// Module-level request deduplication (perf pass 2026-08).
//
// A dashboard with N weather-station-cards used to issue N identical
// recorder / history / Open-Meteo requests at load (and again every
// poll cycle when the cards' timers drift close together). The module
// map lives once per browser tab — every card instance shares it —
// so identical requests collapse into one roundtrip:
//
//   - in-flight dedup: a second caller with the same key awaits the
//     FIRST caller's promise instead of firing its own request;
//   - short result TTL: a caller arriving moments later (typical for
//     staggered card mounts during dashboard load) reuses the settled
//     result without any await-latency.
//
// Failures are never cached — a rejected fn() propagates to every
// concurrent caller and the next call retries fresh.
//
// SHARED-REFERENCE CONTRACT: every caller of the same key receives
// the SAME resolved object (no clone — payloads can be tens of
// thousands of recorder rows). Callers must treat the result as
// deep-frozen: mutating it would silently corrupt what every other
// card on the dashboard sees. Derive, don't modify.

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
      // FIFO prune — the map stays small (one entry per distinct
      // request signature on the dashboard).
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
