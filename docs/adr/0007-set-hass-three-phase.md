# 0007: `set hass` decomposed into three phase methods

**Status:** Accepted

**Date:** 2026-05-09

## Context

`WeatherStationCard.set hass(hass)` is the card's reactivity entry
point — HA fires it 2–5 times per second whenever any entity in
`hass.states` updates. Through v1.9.0 it was a single 240-line setter
that did three logically distinct things in one body:

1. **Sensor state extraction** — read every configured sensor entity,
   detect source units (wind / pressure / temperature), and apply the
   `weather_entity`-attribute fallback for forecast-only mode.
2. **Live condition classification** — derive the "now" weather
   condition with minute-level memoization, then synthesize a
   weather-entity stand-in for the render layer.
3. **Data-source synchronisation** — subscribe / unsubscribe
   `MeasuredDataSource` and `ForecastDataSource` to match
   `show_station` / `show_forecast`, then scan for missing sensors.

The function shared local helpers (`stateOf`, `valueOf`, `attrOf`,
`fromWxIfMissing`) across all three phases. ESLint
`sonarjs/cognitive-complexity` flagged it as warn-level
(see [docs/QUALITY-GATES.md → Lint](../QUALITY-GATES.md#lint--eslint-10-flat-config)
for how the warning backlog is managed). It was hard to reason about in isolation
— a change to memoization had to acknowledge the surrounding
subscription churn; a change to subscription teardown had to step over
~80 lines of classifier logic.

Alternatives considered:

- **Status quo.** The function works. Cognitive load is the only cost.
  Acceptable for a stable codebase but bad timing given v1.9.x adds
  weather-entity attribute fallback (~30 lines), which would have
  pushed the setter past 270 lines.
- **Helpers as static functions outside the class.** Pure-style.
  Rejected because the work mutates ~15 instance fields — passing them
  all in and out makes the call sites verbose without clearly
  improving testability (the work is fundamentally side-effecty on
  `this`).
- **Helpers as private methods on the class.** Each phase becomes a
  private `_phaseName(hass)` that mutates `this.*` directly. Symmetry
  with `disconnectedCallback` (which already organises teardown into
  per-concern private methods).

## Decision

`set hass(hass)` is now a 12-line orchestrator that delegates to three
private methods:

```ts
set hass(hass: HassMain) {
  this._hass = hass;
  this.language = this.config.locale || hass.selectedLanguage || hass.language || 'en';
  this.sun = (hass.states && 'sun.sun' in hass.states) ? hass.states['sun.sun'] : null;

  this._extractSensorReadings(hass);
  this._classifyLiveCondition(hass);
  this._syncDataSources(hass);
}
```

- **`_extractSensorReadings(hass)`** — Phase 1. Reads sensor entities,
  detects source units, applies the `weather_entity`-attribute
  fallback, populates `this.<reading>` fields plus three new
  `this._sourceWindUnit` / `_sourcePressureUnit` / `_sourceTempUnit`
  fields used by phase 2.
- **`_classifyLiveCondition(hass)`** — Phase 2. Minute-memoized
  classifier; synthesizes `this.weather` (the weather-entity stand-in
  the render layer reads from).
- **`_syncDataSources(hass)`** — Phase 3. Subscribe / unsubscribe to
  match `show_station` / `show_forecast`, scan
  `this._missingSensors`. Symmetrical to `disconnectedCallback`'s
  teardown side.

Each method derives what it needs from `hass` and `this.config`
locally. Some helper duplication (`stateOf` / `valueOf` etc.) is
accepted as the price of self-contained methods — phase 2 doesn't
need phase 1's full helper set, just the fields phase 1 already wrote
to `this`.

## Consequences

**Pros**

- Each phase fits on a screenful and reads in isolation. Reviewing a
  classifier change no longer requires scrolling past subscription
  teardown.
- ESLint cognitive-complexity warnings on the `set hass` region are
  gone. Promotes the broader plan of bumping the rule from `warn` to
  `error` once individual hot-spots are addressed.
- Future phase-level testing is straightforward: instantiate the card,
  call `_extractSensorReadings(hass)` directly, assert on the mutated
  fields. Earlier this required driving the full `set hass` path.
- Sets a precedent — `disconnectedCallback` already has this shape;
  `set hass` now mirrors it.

**Cons**

- Helper duplication: `stateOf`, `valueOf`, `attrOf` recur in phase 1
  and phase 2. Acceptable (~10 lines duplicated) given each method
  needs slightly different subsets and the alternative (a shared
  helper struct on `this`) is more plumbing than payoff.
- Three new instance fields (`_sourceWindUnit` etc.) to thread phase 1
  output to phase 2. Initialised in the class declaration with
  defaults so they're always defined.

**Tradeoffs**

- Pure functions in a separate `state-extractor.ts` module were
  considered and rejected. The work mutates `this` heavily; making it
  pure would force ~15 properties through the return value, and the
  reactivity contract (`set hass`) is fundamentally about updating
  instance state.
- Returning the phase-1 output object (instead of writing to `this`)
  was considered. Rejected because the render layer reads
  `this.temperature`, `this.humidity` etc. directly via Lit reactivity
  — phase 1 has to mutate to keep render in sync. Threading data
  through a return value would mean either duplicating it onto `this`
  in the orchestrator (verbose) or refactoring all render paths to
  consume a SensorReadings object (much larger change).

## Amendment 2026-11-13 (#452): phase 3 in a controller

Phase 3 is now `this._sources.sync(hass)` on the
`DataSourceController` (ADR-0033); the initial empty merge
(`_refreshForecasts` while `forecasts` is unset) stays in `set hass`.
Phases 1 and 2 are unchanged.

## Related

- [0033](0033-data-source-reactive-controller.md) — the data-source
  controller behind phase 3
- [`../../src/main.ts`](../../src/main.ts) — `set hass` orchestrator and
  the three private phase methods
- ARCHITECTURE.md → [Lifecycle](../../ARCHITECTURE.md#lifecycle)
- ESLint `sonarjs/cognitive-complexity` rule (`eslint.config.mjs`)
