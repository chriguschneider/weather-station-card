# 0005: Editor partial reorganisation around user intent

**Status:** Accepted — section structure superseded by
[ADR-0023](0023-editor-expansion-panels.md) (expansion panels; the
user-intent clustering and the thin-orchestrator/partial pattern
decided here carry over)

**Date:** 2026-05-09

## Context

Through v1.4 the editor consisted of six render partials clustered by
technical concern: `render-setup.ts`, `render-sensors.ts`,
`render-layout.ts`, `render-style.ts`, `render-units.ts`,
`render-advanced.ts`. Section headings followed suit ("A. Setup",
"B. Sensors", "C. Layout", "D. Style & Colours", "E. Units",
"F. Advanced") — readable to a developer skimming the codebase, less so
to an HA user thinking *"I want a forecast"* or *"I want a clock in the
panel"*.

User feedback (chrigu's own + observations from issue threads) showed
two recurring frictions:

- "Layout" mixed *what is shown* (live panel toggles, chart-row
  toggles) with *how the chart is sized* (chart height, font sizes).
- "Style & Colours" lumped chart appearance, sizing, icons, and
  colours into one section. Most users never touched any of it.
- The most common adjustment ("I want this card to also show a
  forecast") was buried under a generic "Setup" heading with no signal
  that `weather_entity` belonged there.

v1.9.0 (issue #86) restructured the section labels to user-intent
phrasing while keeping the six technical partials. v1.9.x finishes the
job by reorganising the partials themselves.

Alternatives considered:

- **Keep technical partials, only rename the headings.** The v1.9.0
  middle ground. It improved discoverability of *individual fields*
  but kept "Layout" mixed and the "Style & Colours" surface as one
  long page. The seam between *what's shown* and *how it's sized* is
  conceptual; if the partials don't reflect it, every new contributor
  re-rediscovers it.
- **One partial per editor field.** Maximal granularity. Rejected
  because section-level state (subsection headings, conditional
  rendering of dependent toggles) is naturally per-section, and the
  ratio of plumbing to actual render code becomes unfavourable below
  ~50 LOC per file.
- **A schema-driven editor (issue #87 / deferred).** A single render
  function consuming a JSON schema. Promising long-term but a much
  larger change; the section reorg is independent and ships first.

## Decision

The editor renders **seven partials** clustered around user intent.
Each partial owns one numbered section plus its sub-sections:

| # | File | Section heading (DE / EN) | What the user does there |
| - | --- | --- | --- |
| 1 | `editor/render-mode.ts` | Karte einrichten / Card setup | Pick mode + chart type, set title |
| 2 | `editor/render-forecast.ts` | Wettervorhersage / Weather forecast | Pick `weather_entity` |
| 3 | `editor/render-sensors.ts` | Sensoren / Sensors | Wire station sensors, set past-data window |
| 4 | `editor/render-chart.ts` | Diagramm / Chart | Time range, chart rows, appearance |
| 5 | `editor/render-live-panel.ts` | Live-Anzeige / Live panel | Now-panel + attributes-row toggles |
| 6 | `editor/render-units.ts` | Einheiten / Units | Display units |
| 7 | `editor/render-tap.ts` | Aktionen / Actions | Tap / hold / double-tap |

Deleted partials: `render-icons.ts`, `render-advanced.ts`,
`render-layout.ts`, `render-style.ts`. Their concerns redistribute:

- Live-panel UI (the bulk of old `render-layout.ts`) → `render-live-panel.ts`.
- Chart-row toggles + chart appearance → `render-chart.ts`.
- Icons partial → deleted entirely (icon configuration was removed in
  this round; HA MDI icons are used directly).
- Advanced (locale + classifier overrides) → these now live in YAML
  only; the visual surface for them is gone.
- Sizing and colour-override keys → still work in YAML, no longer in
  the editor.

A shared `editor/types.ts` exports `EditorLike`, `EditorContext`,
`TFn`, and `ChangeEvt` for the partials to consume. The orchestrator
(`weather-station-card-editor.ts`) is a thin host that owns
mutator methods (`_valueChanged`, `_sensorsChanged` etc.) and calls
the seven partials in order from its `render()`.

## Consequences

**Pros**

- Section ordering matches the typical card-creation flow: pick mode →
  pick forecast entity → pick sensors → tweak chart → tweak live panel
  → units → actions.
- Each partial is small (~150–200 LOC) and testable in isolation
  (jsdom Lit-render smoketests in `tests/editor-render-*.test.js`).
- "I want a forecast" and "I want a clock" land in separate sections
  with focused contents — no scrolling past unrelated controls.
- Removing the icon and chart-sizes / colours surface from the editor
  shrinks the visible knob count without removing the YAML
  capabilities.

**Cons**

- Section number drift: comments at the top of `render-units.ts` and
  `render-tap.ts` had stale "Section E" / "Section 8" labels for one
  iteration before being fixed. Any future reorg has the same risk.
- More partials = more places to update when the `EditorContext` shape
  changes. The shared `types.ts` cushions this somewhat.

**Tradeoffs**

- Sliced partials per editor field (~one partial per <ha-form>) was
  rejected as too granular — section-level conditional rendering
  (subsection headings, gated sub-toggles) lives naturally at the
  partial level.
- A pure schema-driven editor (issue #87) would replace this entire
  architecture. Punt to a future round where the right schema shape
  has clearer support; the current organisation is a strict
  improvement on the v1.4 layout regardless.
- Folding "Karte einrichten" and "Wettervorhersage" into a single
  section was tried and reverted: hiding `weather_entity` behind a
  chart-type radio felt cluttered. Splitting them mirrors the user's
  mental model (mode first, then which entity).

## Related

- [`../../src/editor/types.ts`](../../src/editor/types.ts) — shared editor types
- [`../../src/weather-station-card-editor.ts`](../../src/weather-station-card-editor.ts) — orchestrator
- v1.9.0 release entry in [`../../CHANGELOG.md`](../../CHANGELOG.md)
- Issue #86 (editor restructure) — landed in v1.9.0
- Issue #87 (schema-driven editor) — deferred
