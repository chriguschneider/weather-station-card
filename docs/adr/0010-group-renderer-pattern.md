# 0010: Group-renderer pattern for conditional template blocks

**Status:** Accepted

**Date:** 2026-05-09

## Context

Lit templates that mix multiple conditional sub-blocks tend to grow
into one long inline template with deeply nested ternaries. The
canonical example through v1.10.0 was `renderAttributes` in
`src/main.ts`:

```ts
return html`
  <div class="attributes">
    ${((showHumidity && humidity !== undefined) ||
       (showPressure && dPressure !== undefined) ||
       (showDewpoint && dew_point !== undefined) ||
       (showPrecipitation && hasPrecipValue)) ? html`
      <div>
        ${showHumidity && humidity !== undefined ? html`…` : ''}
        ${showPressure && dPressure !== undefined ? html`…` : ''}
        …
      </div>
    ` : ''}
    ${/* identical pattern for sun group */}
    ${/* identical pattern for wind group */}
  </div>
`;
```

Three near-identical group blocks, each with an outer "any visible"
gate and four inner conditional rows. The shape contributed CC=99 in
`renderAttributes`. ESLint's `no-nested-conditional` flagged ~20
locations across the function.

Alternatives considered:

- **Status quo.** Inline. Compact but the conditions are hard to read
  past four rows; adding a new row touches both the outer gate and
  the inner block.
- **lit-html `directive()` for each conditional row.** Heavy ceremony
  for what's just a presence check.
- **Map-based renderer registries.** Over-engineered when there are
  three groups with three different schemas.
- **Per-group method that takes a `ctx` object.** Each group becomes
  a focused method; the parent `renderAttributes` becomes a
  4-line composition.

## Decision

Conditional-heavy template methods that compose independent grouped
sections split into:

1. A small parent that builds a single `ctx` object holding all the
   toggles + values, then composes the groups.
2. One method per group: `_render<Name>Group(ctx)`, returns either
   `html\`\`` (when none of its rows are visible) or a wrapped
   `<div>` containing the visible rows.
3. One method per row: `_<group>Row_<field>(show, value)`, returns
   either `html\`\`` or the rendered row markup.

Applied in v1.10:

- `_renderClimateGroup` / `_climateRow_humidity` / `_climateRow_pressure`
  / `_climateRow_dewpoint` / `_climateRow_precip`
- `_renderSunGroup` / `_sunRow_uv` / `_sunRow_illuminance` /
  `_sunRow_sunshine` / `_sunRow_sunPanel`
- `_renderWindGroup` / `_windRow_direction` / `_windRow_speed` /
  `_windRow_gust`

The parent `renderAttributes` is now ~25 lines of ctx construction
plus three method calls.

## Consequences

**Pros**

- Each row is testable in isolation (and visible to ESLint as a
  small function under the complexity gate).
- Adding a new field is one new `_groupRow_*` method plus one line in
  the parent group renderer.
- The "no rows visible → no wrapper div" gate is explicit per group
  rather than baked into the outer ternary chain.
- ESLint's `no-nested-conditional` rule lands at per-row granularity
  (each row's ternary is a single conditional, not nested).

**Cons**

- More method names to scan in the file outline.
- Extracting an inline template into a method incurs Lit's
  template-cache overhead per method (negligible — Lit caches each
  TemplateResult once).

**Tradeoffs**

- We picked method-style helpers over standalone module functions
  because the renderers reference `this.unitPressure`, `this.ll()`,
  `this.weather.attributes`, etc. Standalone helpers would need
  threading every reference through the parameter list, which is
  worse than the small surface-area cost of methods.

## Related

- ADR-0007 (`set hass` three-phase) — applied the same "split a
  fat method into composable units" pattern at the data path.
- v1.10.0 release commit fe55ee7 (initial split).
- v1.10.1 commit bb1a4dc (per-row helper extraction).

## Amendment 2026-11-13 (#449): rows as module functions

The Tradeoffs above picked methods because the rows read `this.ll()`,
`this.unitPressure`, `this.weather.attributes` and similar. As main.ts
grew past 5,000 lines, keeping the rows there cost more than passing
those references in. The rows now live in `src/live-panel/` as plain
functions. Each takes one `LivePanelCtx` (`src/live-panel/context.ts`)
that main.ts builds once per render in `_liveCtx()`. The context holds
config, hass, language, calendar, locale lookup, units and the live
readings, plus two link callbacks (`entityLink`, `zeroDegreeLink`), so
event wiring and popups stay in main.ts. The shape is the same as
before: a parent (`renderAttributes`), a column composer and one
function per row (`climateRowPressure`, `windRowGust`, ...). Only `this`
is gone. A dependency-cruiser rule (`live-panel-no-uplevel`) stops the
rows from importing main.ts. The modules are in the coverage gate.
Decided by: owner (#449).
