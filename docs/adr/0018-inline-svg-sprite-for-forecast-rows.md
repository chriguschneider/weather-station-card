# 0018: In-bundle SVG sprite for the per-column forecast rows

**Status:** Accepted

**Date:** 2026-06-11

## Context

The forecast block renders one condition icon and one wind arrow per
column — up to 168 + 168 elements in hourly mode. Until now each was an
`<ha-icon>`: a HA-frontend custom element whose cost per instance is a
custom-element upgrade plus an async icon-name → SVG-path resolution.
ADR-0016 measured those rows at ~140 ms of the ~237 ms hourly cold
mount on a dev machine and **reordered** the work past the chart's
first paint (two-phase reveal). The work itself remained — paid on
every cold mount, mode toggle and shape change, and felt as a busy
reveal frame on slow devices.

The icon set the rows can emit is closed: `getWeatherIcon` maps HA's
15 standard condition ids through `weatherIcons` (`src/const.ts`), and
`getWindDirIcon` picks from 9 `arrow-*` names. `condition_mapping`
customises *sensor-value → condition* classification, not icons — no
user-supplied icon names reach these rows.

Alternatives considered:

- **Status quo** — keep paying the upgrade cost, rely on ADR-0016's
  reordering. Leaves the dominant cold-mount cost in place.
- **Virtualise/window the rows** — already evaluated and rejected in
  ADR-0016 (optimises the deprioritised axis, risks scroll jank).
- **Inline `<svg><path>` per column** — no custom elements, but each
  hourly row would carry ~168 copies of 0.5–2 KB path data in DOM
  attributes.
- **In-bundle sprite + `<use>` (chosen)** — one hidden `<svg>` of
  `<symbol>` definitions per card, one tiny `<use>` reference per
  column. Same closed glyph set HA itself renders, path data shipped
  once.

## Decision

- **`src/icons/mdi-paths.ts`** ships the 23 MDI path strings (15
  weather + 8 arrows) extracted verbatim from `@mdi/svg@7.4.47` — the
  same MDI release the e2e harness font pins, and the same glyphs HA's
  `<ha-icon>` resolves for these names (~11 KB raw, ~3 KB gzip bundle
  cost).
- **`renderIconSpriteDefs()`** (src/main.ts) emits one hidden
  `<svg class="wsc-sprite">` with all symbols into the card root;
  shadow-DOM scoping keeps ids collision-free across cards.
- **`_spriteIcon(name, cls)`** renders
  `<svg class="wsc-icon"><use href="#wsc-i-…">` when the name is in
  the sprite, and falls back to a regular `<ha-icon>` for unknown
  names — growing the upstream mappings without updating the sprite
  degrades gracefully (slow path, not a blank cell).
- `renderForecastConditionIcons` and `renderWind` use `_spriteIcon`
  for their per-column icons. Single-instance icons elsewhere (live
  panel, attribute rows, sun row) stay on `<ha-icon>` — one upgrade
  each is irrelevant and keeps them maximally HA-native.
- **Theming:** `.wsc-icon` sizes via `var(--mdc-icon-size, 24px)` and
  paints `fill: currentColor` with the same
  `color: var(--primary-text-color)` rule ha-icon gets — custom themes
  keep working.
- ADR-0016's two-phase reveal stays: it still moves the (now much
  cheaper) row render off the first-paint path.

## Consequences

**Pros**

- Eliminates up to 336 custom-element upgrades + async icon
  resolutions per hourly mount — the bulk of the ~140 ms row cost
  ADR-0016 could only defer. This is the one change in the 2026-06
  performance pass that improves the ADR-0014 cold-mount gate metric.
- The reveal frame (phase 2 of ADR-0016) gets proportionally lighter —
  less jank on Pi/tablet dashboards.
- No behavioural change: same glyphs, same sizing contract, same
  theming variables.

**Cons**

- ~11 KB raw (~3 KB gzip) added to the bundle; path data is duplicated
  knowledge of what HA would resolve at runtime. Pinned to the MDI
  release in the file header so an audit is one diff against
  `@mdi/svg`.
- Visual-regression baselines change (SVG anti-aliasing differs
  marginally from the harness's font rendering) — regenerated via the
  GHA `update-baselines.yml` workflow per ADR-0003.
- A future icon added to `weatherIcons` / `cardinalDirectionsIcon`
  must also be added to `MDI_PATHS` to stay on the fast path (the
  `<ha-icon>` fallback keeps it correct meanwhile).

**Tradeoffs**

- Importing `@mdi/js` as a dependency instead of vendoring the 23
  paths was rejected: it would add a dependency for data that changes
  ~never, and naive imports risk pulling unrelated path constants into
  the bundle.
- Replacing every `<ha-icon>` in the card was rejected — outside the
  wide rows the count is single-digit, the upgrade cost is noise, and
  `<ha-icon>` follows future HA icon-set changes for free.

## Related

- [0016](0016-progressive-chart-render.md) — measured the row cost and
  reordered it; this ADR removes most of it
- [0014](0014-perf-regression-gate.md) — cold-mount gate that benefits
- [0003](0003-e2e-baselines-pinned-to-gha.md) — baseline-regeneration
  constraint
- [`../../src/icons/mdi-paths.ts`](../../src/icons/mdi-paths.ts)
