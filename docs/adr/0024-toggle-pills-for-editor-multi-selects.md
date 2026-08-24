# 0024: Toggle pills replace `ha-form` multi-selects in the editor

**Status:** Accepted

**Date:** 2026-08-24

## Context

ADR-0023 collapsed the editor into expansion panels and folded three
walls of switches into three multi-select fields — chart rows (6
options), main-panel elements (4), attribute cells (up to 12). Each is
an `ha-form` field with `selector.select` + `multiple: true`, driven by
`editor._applyTogglePaths`, which maps the selected leaves back onto
individual boolean config keys and deletes any key that lands on its
default.

That control renders only the **selected** options, as chips with a
small ×. Everything not selected lives behind an add-dropdown. Three
frictions follow:

- **No discoverability.** The panel does not show what it offers. A user
  who does not already know the card has a sunshine bar or a moon line
  has no way to find out short of opening every dropdown. This is a
  regression against the pre-ADR-0023 switch walls, which at least
  listed every capability.
- **Asymmetric interaction.** Removing is one click on the ×; adding is
  two — open the dropdown, pick an entry.
- **Reflow.** The chip list is the selection, so it grows and shrinks as
  you toggle and the remaining chips move under the pointer.

HA ships no selector that renders an always-visible option set with
per-option on/off state. `selector.select` without `multiple` is
single-choice; `boolean` is one switch per key, which is the wall
ADR-0023 removed; `ha-control-select` is single-choice segmented.

Prior art on the same Home Assistant instance: the `meteoswiss_radar`
integration's card editor uses the same `ha-expansion-panel` chrome
(icon, title, dot-separated summary, reset) and renders its Display
options as toggle pills — roughly 20 lines of CSS and 20 of DOM.

## Decision

The three multi-selects become rows of **toggle pills**, rendered by a
shared control in `src/editor/toggle-pills.ts` (`renderTogglePills`).
Every option is always visible: filled with `--primary-color` when on,
outlined when off, one click either way.

- The control is a plain Lit template over native `<button type="button">`
  elements with `role="switch"` and `aria-checked`, so keyboard and
  assistive-tech behaviour comes from the platform rather than being
  re-implemented.
- Styles (`.pill-field`, `.pills`, `.pill`) live in the editor's global
  `<style>` block next to the other cross-partial rules, not scoped in
  the partial — same convention as `.gated`, `.grid2`, `.divider`.
- The `on` fill uses `--text-primary-color` for its label, not a
  hardcoded white, so a theme with a light accent stays readable.
- **Config semantics are unchanged.** Callers pass the full next
  selection to `editor._applyTogglePaths(items, next)`, exactly as the
  multi-select's `value-changed` handler did. Same keys, same `def`
  handling, same delete-on-default. The YAML surface does not move.
- The emitted array is ordered by the option list, not by click order,
  so toggling something off and on again cannot reorder the written
  config keys.

This makes `renderTogglePills` the editor's **only** hand-built control.
Everything else stays schema-driven `ha-form` per ADR-0023, and new
fields should default to a selector; a pill row is justified only where
the always-visible option set is the point.

Applying it to all three multi-selects at once is part of the decision.
Two interaction patterns for the same kind of choice, inside panels that
already share their chrome, would be worse than either pattern alone.

## Consequences

**Pros**

- The panel states what the card can do. Options are found by looking,
  not by knowing.
- One click adds, one click removes; the row never reflows.
- Small and dependency-free: one module, ~30 lines of CSS, no runtime
  additions to the bundle beyond the template.
- Config, defaults and YAML output are untouched — a pure UI swap, so
  there is no migration and no version gate.

**Cons**

- First deviation from the schema-driven editor. `computeLabel`,
  `ha-form`'s own label/description handling and future HA selector
  improvements do not apply to a pill row.
- Theming is ours now. The control reads HA CSS custom properties, but a
  theme that restyles `ha-form` controls will not reach the pills.
- More vertical space when few options are selected. Bounded — the
  largest row is 12 options, and when most are on the old chip list was
  already the same height.

**Tradeoffs**

- *Keep `selector.select` with `multiple: true`.* Rejected: it is the
  cause of the discoverability problem, and no option on the selector
  makes unselected entries visible.
- *Go back to one `boolean` selector per key.* Rejected: that is the
  ~4.200 px wall ADR-0023 removed. Pills give the same visibility at a
  fraction of the height.
- *Convert only one panel to pills as a trial.* Rejected: three panels
  sharing an expansion-panel chrome but splitting into two interaction
  models is a worse outcome than either model applied consistently.
- *Contribute an always-visible multi-select upstream to HA.* Not
  rejected on merit, but it does not solve the card's problem on any
  useful timescale.

## Related

- [0023 — Editor collapses into expansion panels with state summaries](./0023-editor-expansion-panels.md)
  — establishes the schema-driven `ha-form` approach this deviates from,
  and introduced the multi-selects being replaced.
- [0005 — Editor partial reorganisation around user intent](./0005-editor-partial-reorg.md)
  — the section split the pill rows render inside.
- `custom_components/meteoswiss_radar` (Home Assistant custom
  integration) — prior art for the pattern on the same instance.
