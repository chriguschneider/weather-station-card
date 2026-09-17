# 0025: Attribute row layout as a list of columns

**Status:** Accepted

**Date:** 2026-09-17

## Context

The live panel's attribute row has always been three fixed columns
(climate / sun / wind) with a fixed row order inside each, gated by a
dozen `show_*` booleans. Users can hide rows but not move them, and
every new reading — the zero-degree level from the MeteoSwiss
integration was the trigger — means one more boolean, one more editor
pill, and one more hard-coded slot in `renderAttributes`.

The concrete request: show the zero-degree level *where wind direction
used to be*, i.e. in the wind column, first row. That needs positional
control, not another toggle.

Alternatives on the table:

- **Free-form entity rows** (`custom_attributes: [{entity, icon, …}]`).
  Solves "show a sensor the card doesn't know" but not ordering, and
  gives up the card's semantic rows (pressure trend, dew-point comfort,
  sun strength, computed moon) for anything placed through it.
- **Position as a per-row key** (`show_pressure: {column: 1, order: 2}`).
  Twelve keys change shape; the editor pills stop mapping to booleans;
  YAML gets verbose for a one-row move.
- **Layout as a pure ordering** with `show_*` still deciding visibility.
  Cheapest for the editor, but a trap: listing `dew_point` in the layout
  shows nothing until `show_dew_point: true` is also set.
- **Layout as the single source of truth** — the chosen option.

## Decision

A new top-level key `attributes_layout`: a list of columns, each a list
of row tokens. The tokens are the `show_*` keys without the prefix
(`pressure`, `dew_point_humidity`, `dew_point`, `humidity`,
`precipitation`, `zero_degree_level`, `uv_illuminance`, `uv_index`,
`illuminance`, `sun`, `moon`, `wind_direction`, `wind_speed`,
`wind_gust_speed`), so the YAML vocabulary is one list, not two.

Rules, implemented in `src/attributes-layout.ts` (pure, no Lit):

1. **Layout wins.** A non-empty `attributes_layout` decides both which
   rows render and where. The `show_*` row keys are ignored; the
   validator emits one combined hint naming the ignored keys.
2. **Empty means automatic.** DEFAULTS ships `attributes_layout: []`;
   the card then renders `DEFAULT_ATTRIBUTES_LAYOUT` filtered by the
   `show_*` toggles, byte-for-byte what it rendered before this ADR.
   The moon stays coupled to the sun in this mode (it renders inside
   the sun cell); an explicit layout may list `moon` alone.
3. **A row is a line.** Every token renders as its own `<div>` line —
   what the editor's board shows is what the card draws. The two pairs
   the card has always drawn on one line when both were on (dew point +
   humidity, UV + illuminance) exist as explicit combined tokens
   (`dew_point_humidity`, `uv_illuminance`, `LINE_FAMILIES`) next to
   their singles, so a user can keep the shared line or split it. In
   automatic mode both singles on still fold into the combined line,
   and `show_dew_point_humidity` / `show_uv_illuminance` force it.
   (An earlier cut of this ADR merged singles implicitly at render
   time — "humidity rides on the dew-point line" — which left the board
   showing two pills for one line; that is why the pairs are tokens.)
4. **Rows without a value vanish**, as before; a column with nothing
   to show is dropped and the remaining columns spread across the width.
   Lines are `<div>`s rather than inline + `<br>` — the last row of a
   column used to carry no break, so a row appended after it shared its
   line.
5. **The editor edits the layout, always.** Attribute pills read their
   on/off state from the resolved layout; switching a pill on inserts
   the row next to its nearest default sibling (or opens a new column
   in default order), switching it off removes it. The first toggle on
   a card still driven by `show_*` keys starts from the arrangement
   those keys resolve to, writes it as `attributes_layout` and drops
   the keys — the `show_*` keys become the YAML-only legacy path.
   Position is edited on a *layout board* under the
   pills (`src/editor/layout-board.ts`): one drop zone per column plus
   a "new column" zone, rows dragged with pointer events (HTML5
   drag-and-drop does not fire on touch), arrow keys as the keyboard
   path. A drop writes the whole arrangement; "back to automatic"
   projects the current membership onto the `show_*` keys and removes
   the layout key, so nothing that was on disappears.

`renderAttributes` in `main.ts` iterates the resolved layout and maps
line ids onto the existing row helpers via a single switch. The three
hand-written group renderers from ADR-0010 are replaced by one
data-driven `_renderAttributeColumn`; the "any visible" gate survives
as "column has at least one non-`nothing` line".

The zero-degree level itself lands as a regular sensor slot
(`sensors.zero_degree_level`, `show_zero_degree_level`), not as a
free-form row — it inherits the entity-delta gate (ADR-0017), the
last-good fallback + stale dimming, the more-info link and the editor
picker for free.

## Consequences

**Pros**

- One key moves any row anywhere; no per-row position keys, no shape
  change for the twelve existing toggles.
- Zero behaviour change for existing configs (automatic mode is the
  old code path, expressed as data).
- Adding a future row is: one token, one line-id mapping, one row
  helper, one `show_*` default — the render loop does not change.
- The validator derives its token set from the same constant, so
  typos get "did you mean" hints and the docs can list one table.

**Cons**

- Two ways to express visibility. Documented and hinted, but a
  `show_pressure: false` next to a layout listing `pressure` will
  surprise someone once.
- The board is the editor's second hand-built control after the toggle
  pills (ADR-0024) — no HA selector arranges items in columns.
- Editor insert position for a pill switched on is a heuristic
  (nearest default sibling).
  Deterministic and tested, but not always what the user would pick.

**Tradeoffs**

- Rejected free-form rows: they answer a different question (unknown
  entities) and would coexist with, not replace, this layout. Can be
  added later as one more token kind.
- Rejected "ordering only": the `dew_point`-listed-but-hidden trap
  outweighs the editor savings.
- Rejected dropping empty columns in the editor's insert path by
  column index: after any removal the index no longer means "climate",
  which is how the sibling rule came about.

## Related

- [ADR-0008](./0008-defaults-single-source-of-truth.md) — DEFAULTS as
  merge floor; `attributes_layout: []` lives there.
- [ADR-0010](./0010-group-renderer-pattern.md) — the group renderers
  this ADR turns into data.
- [ADR-0017](./0017-entity-delta-gate-in-set-hass.md) — why the
  zero-degree level is a `sensors.*` slot.
- [ADR-0022](./0022-computed-moon-line.md) — the moon line's sun
  coupling in automatic mode.
- [ADR-0024](./0024-toggle-pills-for-editor-multi-selects.md) — the
  pills that now read from the layout.
- MeteoSwiss integration zero-degree sensor:
  https://github.com/chriguschneider/hass-meteoswiss-weather
