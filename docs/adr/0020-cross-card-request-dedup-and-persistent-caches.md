# 0020: Cross-card request dedup and persistent stale-while-revalidate caches

**Status:** Accepted

**Date:** 2026-08-07

## Context

Two independent load problems, one perf pass (2026-08):

1. **N cards → N identical requests.** A dashboard with several
   weather-station-cards issued one recorder
   `statistics_during_period` / `history_during_period` / Open-Meteo
   HTTP request PER CARD at load, and again each poll cycle. The
   payloads are byte-identical; the recorder DB scan and the
   Open-Meteo rate budget were paid N times.
2. **Skeleton until the recorder answers.** First paint is gated on
   every expected data source (`_allExpectedDataReady`); the
   recorder roundtrip takes 0.5–3 s on Pi-class hosts, so every
   reload showed the skeleton for seconds. The B2 lux-sunshine
   derivation additionally refetched the FULL high-resolution
   illuminance history (~8 days, tens of thousands of rows) every
   hourly poll although completed days can never change.

Alternatives considered:

- **A shared data-manager singleton owning all fetches.** Cleaner in
  theory, but inverts the card's per-instance data-source design
  (subscribe/unsubscribe per card) — a much larger rewrite with the
  same net effect as keyed dedup.
- **Service-worker / HTTP cache for Open-Meteo.** Not available inside
  the HA frontend context the card runs in; localStorage + module
  state is what a Lovelace card actually controls.
- **Accept the skeleton.** Rejected: the skeleton wait was the single
  most user-visible cold-start cost after the ADR-0012/0016 work.

## Decision

Three mechanisms, all keyed by full fetch signature:

- **`src/utils/shared-requests.ts` — `dedupeRequest(key, ttl, fn)`.**
  Module-level (per browser tab) in-flight dedup + short result TTL
  (60 s for recorder/Open-Meteo, hour-bucket for the pressure delta).
  All cards sharing a signature share one roundtrip. Failures are
  never cached. Resolved objects are SHARED references — callers must
  treat them as immutable (documented in the module header).
- **`src/utils/series-cache.ts` — persistent stale-while-revalidate.**
  The last station/forecast payload is persisted to localStorage per
  fetch signature (versioned schema, 12 h max age). On mount the card
  hydrates from the cache and paints REAL data immediately; the live
  fetch overwrites it and `forecastsEqual` absorbs identical
  payloads. Cache keys include the sensor **role=entity** mapping,
  the window size, and the fetch kind, so hydration can never show
  data fetched for another signature. Expired/orphaned slots are
  pruned on every save.
- **Lux per-day cache (`src/data-source.ts`).** Derived
  sunshine-hours per completed local day are persisted (keyed by
  entity + derivation parameters, capped at 120 days). Once warm,
  each poll fetches only today's samples (~1/8 of the payload);
  sunless days are stored as explicit 0 to prevent perpetual
  refetches.

## Consequences

**Pros**

- One recorder/Open-Meteo roundtrip per signature per dashboard
  instead of one per card.
- Reload shows real (≤12 h old) data instantly; the skeleton only
  appears on genuinely cold caches.
- The heaviest recurring payload (lux history) shrinks ~8× once warm.

**Cons**

- Stale data is deliberately shown for the seconds until the live
  fetch lands; the 12 h age cap bounds how wrong it can be.
- Shared response references make mutation a cross-card hazard
  (contract: derive, don't modify).
- localStorage schemas are now a compatibility surface — bump the
  embedded version numbers on shape changes; unknown versions read as
  a miss.

**Tradeoffs**

- Keyed module-level dedup over a data-manager singleton: ~60 lines,
  no architectural inversion, same effect.
- 60 s result TTL: long enough to absorb staggered card mounts,
  short enough that a manual dashboard refresh still fetches fresh.

## Related

- ADR-0017 (entity-delta gate — same "idle dashboards must be cheap"
  direction)
- ADR-0002 (sunshine tier policy — the B2 lux tier this caches)
- `src/utils/shared-requests.ts`, `src/utils/series-cache.ts`,
  `src/data-source.ts`, `src/openmeteo-source.ts`
