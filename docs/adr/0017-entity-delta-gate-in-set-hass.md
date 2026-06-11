# 0017: Entity-delta gate in `set hass` + non-reactive `_hass`

**Status:** Accepted

**Date:** 2026-06-11

## Context

HA replaces the `hass` object and re-assigns it to every card 2–5
times per second — once for **any** entity state change anywhere in
the instance, not just entities this card reads. Until now each of
those ticks did real work:

1. `_hass` was a reactive Lit property, so the fresh object identity
   alone scheduled a full Lit render pass per tick.
2. `_classifyLiveCondition` (phase 2 of ADR-0007) synthesized a brand
   new `this.weather` stand-in object per tick — even when every
   reading was unchanged. `weather` is reference-compared by Lit, and
   `updated()` reacts to it with `updateChart()`: `computeForecastData()`
   (six array maps over up to 168 entries) plus a **full uPlot redraw
   including the four label-plugin passes**.

Net effect, measured with the new `tests-e2e/perf-steady-state.spec.ts`
(50 synthetic hass ticks where only an unrelated entity changed,
hourly-combination, dev machine): **50 Lit update passes, 49 uPlot
canvas redraws, ~11 ms per tick**. At HA's 2–5 Hz fan-out that is a
continuous double-digit-ms/s CPU tax — significant on wall tablets,
Raspberry Pi dashboards and the Companion app, where this card
typically runs around the clock. None of it changed a pixel: sensor
entities update on a far slower cadence than HA's fan-out.

Alternatives considered:

- **Status quo.** Lit's template diffing keeps the DOM commits cheap,
  but the uPlot redraw is canvas work that bypasses Lit entirely, and
  the cumulative cost is exactly the always-on-display scenario this
  card targets.
- **Debounce/throttle `set hass`.** Caps the frequency but still does
  wasted work on a timer, and adds latency to *real* sensor updates.
- **Entity-delta gate (chosen).** HA state objects are immutable — an
  entity that did not change keeps its object reference across hass
  objects. Comparing ~12 references per tick is exact and effectively
  free (the same property `hasConfigOrEntityChanged` in
  custom-card-helpers relies on).

## Decision

Three stacked guards in `src/main.ts`:

1. **Entity-delta fast path in `set hass`.** After a full pass, the
   card snapshots `eid → hass.states[eid]` for every watched entity
   (all configured `sensors.*`, `weather_entity`, `sun.sun`) in
   `_watchedStatesSnapshot`. On the next tick,
   `_watchedStatesUnchanged()` reference-compares the snapshot; when
   nothing changed the setter stores the fresh `_hass` handle, forwards
   it to the data sources (`setHass`) and returns — phases 1–3 are
   skipped wholesale. The fast path additionally requires the data
   sources to match their desired state (`wantMeasured === !!_dataSource`
   etc.), so it can never skip a needed source rebuild; the snapshot is
   invalidated in `setConfig`, `_teardownStation` and
   `_teardownForecast`, which covers the `_invalidateStaleSources`
   re-entry (`this.hass = this._hass` with the same hass object).
2. **Stable `weather` identity.** `_classifyLiveCondition` now compares
   the candidate synthesis field-wise against the previous one
   (`_weatherSynthesisEquals`) and keeps the previous object when
   nothing changed — `changedProperties.has('weather')` stays quiet, so
   `updateChart()`'s uPlot redraw only runs when a synthesized value
   actually moved.
3. **Non-reactive `_hass`.** Declared with `hasChanged: () => false`.
   Everything templates read live now sits in value-compared reactive
   props. The previously non-reactive read-side fields (`uv_index`,
   `dew_point`, `wind_gust_speed`, `illuminance`, `precipitation`,
   `precipitation_unit`, `sunshine_duration`, `sunshine_duration_unit`,
   `unitSpeed`, `unitPressure`, `unitPrecip`, `_missingSensors`) were
   promoted to reactive properties — they had silently depended on the
   per-tick `_hass` renders for freshness. `_missingSensors` is only
   reassigned when its joined content differs, so the scan stays inert
   on unchanged passes.

ADR-0007's three-phase decomposition is unchanged; this ADR amends its
implicit "phases run on every tick" contract to "phases run on every
tick **that changed a watched entity**".

## Consequences

**Pros**

- Steady-state cost on unrelated hass ticks drops from ~11 ms/tick
  (full render + canvas redraw) to ~0 (twelve reference compares).
  `perf-steady-state.spec.ts` asserts 0 update passes / 0 chart
  updates for 50 unrelated ticks, and asserts a watched-entity tick
  still triggers an update (the "card stopped updating" regression
  guard).
- Whole-dashboard benefit: less main-thread contention for sibling
  cards, lower battery drain on tablets.
- The stable-`weather` guard also kills redundant uPlot redraws on
  ticks where a watched entity changed but its displayed values did
  not (e.g. an attribute-only update).

**Cons**

- The reactivity contract is more intricate: a new template read of a
  live value must come from a reactive prop (or derive from one), not
  from `this._hass`. Render-time `_hass` reads that remain (debug
  panel entity-existence check, HA version banner, `hass.config`
  lat/lon) tolerate going stale until the next watched change.
- The live-condition classifier's minute-bucket memo key no longer
  rolls over on its own — between watched-entity changes the displayed
  condition is frozen. In practice any setup that can classify (it
  requires live sensors) receives watched ticks far more often than
  once a minute; the cumulative-precip decay path keeps its own 30-s
  wall-clock interval and is unaffected.
- Cumulative-precip displayed rate no longer recomputes on unrelated
  ticks — decay between samples is now solely owned by the existing
  30-s interval (which was always the documented owner).

**Tradeoffs**

- Comparing watched **values** instead of state-object references was
  rejected: references are exact under HA's immutability guarantee and
  cheaper; value comparison would re-implement phase 1 to decide
  whether to run phase 1.
- Removing `_hass` from `static properties` entirely (instead of
  `hasChanged: () => false`) was rejected — keeping the declaration
  documents the deliberate non-reactivity in the one place future
  readers will look.

## Related

- [0007](0007-set-hass-three-phase.md) — the three-phase decomposition
  this gates
- [0014](0014-perf-regression-gate.md) — cold-mount gate (unaffected;
  steady-state spec is advisory + counter-asserting, not time-gated)
- [`../../tests-e2e/perf-steady-state.spec.ts`](../../tests-e2e/perf-steady-state.spec.ts)
  — before/after measurement + gating contract
- [`../../tests/hass-tick-gating.test.js`](../../tests/hass-tick-gating.test.js)
  — unit coverage: fast path, snapshot invalidation, weather identity,
  precip-buffer persistence
