# 0009: Lookup-table pattern for unit conversions

**Status:** Accepted

**Date:** 2026-05-09

## Context

The card has two unit-conversion ladders that grew organically across
v1.x: wind-speed (m/s ↔ km/h ↔ mph ↔ Beaufort) and pressure
(mmHg ↔ hPa ↔ inHg). Through v1.10.0 both lived inline in
`renderAttributes` as nested `if` chains:

```ts
if (this.unitSpeed === 'm/s') {
  if (this.weather.attributes.wind_speed_unit === 'km/h') {
    dWindSpeed = Math.round(windSpeed * 1000 / 3600);
  } else if (this.weather.attributes.wind_speed_unit === 'mph') {
    dWindSpeed = Math.round(windSpeed * 0.44704);
  }
} else if (this.unitSpeed === 'km/h') {
  // … six more arms
}
```

Six wind-speed arms × four pressure arms = ten ladder entries, all
with the same shape (`Math.round(value × factor)`). The chain
contributed roughly half the function's CC=99 cyclomatic complexity.
Adding a new unit (e.g. knots) meant editing four arms and easily
producing an inconsistent set.

Alternatives considered:

- **Status quo.** Inline if-chains. Readable for small N; quickly
  unwieldy when a new unit lands.
- **Switch statements.** Better than if-chains stylistically but the
  same N×N branching. No reuse between wind and pressure.
- **Dedicated converter classes.** Over-engineered for two two-axis
  lookups; introduces ceremony and indirection.
- **Lookup tables keyed by `targetUnit->sourceUnit`.** Pure data,
  trivially extensible, dataset documents the conversion factors in
  one glance.

## Decision

Conversion factors live as `Record<string, number>` lookup tables in
`src/utils/unit-converters.ts`, keyed by `${targetUnit}->${sourceUnit}`:

```ts
export const WIND_CONVERSION: Record<string, number> = {
  'm/s->km/h': 1000 / 3600,
  'm/s->mph': 0.44704,
  'km/h->m/s': 3.6,
  // …
};
```

Same-unit and Beaufort cases are short-circuited inside the converter
function and never index into the table. Beaufort, which doesn't fit
the linear-multiply shape, takes the converter as an injected
callback (the classifier method lives on the card class; injecting
keeps `unit-converters.ts` leaf-only and dependency-free).

When adding a new unit (e.g. knots), update the lookup table — the
converter doesn't change.

## Consequences

**Pros**

- One-line addition for a new unit-pair conversion.
- Pure functions (no `this`, no DOM) — directly unit-testable; the
  v1.10.1 sweep adds `tests/unit-converters.test.js` with 31 cases.
- Tables sit in `src/utils/`, inside the coverage gate scope.
- Removes a chunk of `renderAttributes`'s CC=99 surface area.

**Cons**

- One indirection between caller and conversion factor (negligible
  perf impact; the lookup is a single map access).
- Less obvious at the call site which conversion is happening (mitigated
  by the converter function being clearly named).

**Tradeoffs**

- The table needs `target->source` keying, not `source->target`. We
  picked target-first because the call site usually starts from "I
  want to display in `unitSpeed`" — that becomes the first half of the
  lookup key.

## Amendment 2026-11-08 (#438): Beaufort is a pure converter

The injected Beaufort callback is gone. `calculateBeaufortScale` read
the source unit from the card's weather stand-in, so a forecast entry
in m/s (Open-Meteo) was banded as km/h whenever the station used km/h,
even though the per-entry unit reached the linear conversion. Beaufort
now lives in `unit-converters.ts` as `toBeaufort(value, unit)`: the
km/h band table `BEAUFORT_KMH_UPPER` plus a km/h normalisation through
`WIND_CONVERSION`. `convertWindSpeed(value, from, to)` calls it with
the same source unit as every other target, and the module stays
leaf-only (it imports only `utils/numeric.ts`). `convertWindSpeed`
also parses its input and returns `undefined` for a missing or
non-numeric speed, so callers hide the row instead of printing "NaN".

## Related

- Issue #57 (SonarCloud cleanup track that surfaced the complexity).
- ADR-0007 (`set hass` three-phase) — same flavour of "extract pure
  function from over-grown method".
- v1.10.1 commit a8e5d35 (extraction itself).
