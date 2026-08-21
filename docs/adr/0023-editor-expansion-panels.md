# 0023: Editor collapses into expansion panels with state summaries

**Status:** Accepted

**Date:** 2026-08-21

## Context

The ADR-0005 reorganisation clustered the editor into seven user-intent
sections, but every section rendered permanently expanded. In
combination mode with sensors wired the editor scrolled ~4.200 px with
45+ visible controls. Recurring frictions:

- No overview: to learn what is configurable you scroll everything.
- Wall effects: 11 entity pickers in a row (each half-empty at full
  width), up to 21 toggles in the live-panel section.
- Structure noise: a subsection literally named like its parent
  ("Diagramm" inside "Diagramm"), the days fields separated from the
  "Zeitraum & Auflösung" heading they belong to, duplicate labels
  (wind direction/speed, date) across chart and live-panel sections
  with no visual scoping.
- The three-way clock booleans (show_time / show_time_seconds /
  use_12hour_format) looked like flat siblings.
- The Open-Meteo history opt-in (ADR-0015) rendered as a toggle beside
  the sensor pickers although the runtime ignores it entirely as soon
  as any station sensor is configured — the two are exclusive in
  practice, the UI suggested they compose.
- The units section labels were hardcoded English — the only
  unlocalized editor strings.

Alternatives considered:

- **Keep flat sections, only tighten spacing / two-column toggles.**
  Rejected: does not solve the no-overview problem; the editor still
  opens as a wall.
- **Tabs instead of panels.** Rejected: HA card editors converge on
  `ha-expansion-panel` (core tile/vehicle editors, "Interactions"
  pattern); tabs hide the "what exists" inventory the collapsed panel
  headers provide, and deep-linking/scroll state gets harder.
- **Checkbox-list multi-selects (`mode: list`).** Rejected: renders
  one row per option again — no compaction over toggles.

## Decision

The editor renders a **basics block plus five collapsed
`ha-expansion-panel` sections**, all collapsed by default:

| Block | Partial | Contents |
| --- | --- | --- |
| Basics (no panel) | `editor/render-basics.ts` | mode, chart type, title, weather_entity |
| Sensoren | `editor/render-sensors.ts` | past-source dropdown + 11 pickers (2-column grid) |
| Diagramm | `editor/render-chart.ts` | day/column/height grids, chart-rows multi-select, appearance |
| Live-Anzeige | `editor/render-live-panel.ts` | main gate + element multi-select + clock dropdown; attributes gate + multi-select |
| Einheiten | `editor/render-units.ts` | three unit dropdowns (grid, localized labels) |
| Aktionen | `editor/render-tap.ts` | tap / hold / double-tap |

Mechanisms:

- **Panel headers carry a one-line state summary** (e.g. "4+7 Tage ·
  8 Spalten · 5 Zeilen") built from the current config — the collapsed
  editor is a readable configuration overview. The per-section reset
  button (ADR-0005) moves into the panel header
  (`editor/expansion-panel.ts`).
- **Toggle walls become multi-selects.** The six chart rows, four
  main-panel elements, and up to twelve attribute cells render as
  `select` selectors with `multiple: true`. A generic
  `_applyTogglePaths(items, selected)` maps the value array back onto
  the individual boolean keys; each item carries its *editor-visible*
  default and keys landing on their default are deleted, keeping the
  YAML terse.
- **UI-only abstractions follow the `_mode` precedent.** The clock
  dropdown (off / 24h / 24h+s / 12h / 12h+s) projects onto the three
  clock booleans. The past-source dropdown projects onto
  `forecast.openmeteo_history` — choosing Open-Meteo hides the picker
  grid and **drops the `sensors:` block** so editor and runtime agree
  (the recorder always wins otherwise); reversible until save, like
  reset.
- **2-column `ha-form` grids** for pickers and number/dropdown pairs.
- **`forecast.chart_height` joins the editor** (the most practically
  useful of the former YAML-only knobs). Colours, font sizes, `locale`,
  `condition_mapping`, and `debug` stay YAML-only; the dead
  `_conditionMappingChanged` handler is removed.
- The YAML schema is unchanged — every existing key keeps its meaning.

## Consequences

**Pros**

- Initial editor height drops from ~4.200 px to ~660 px; every section
  is discoverable without scrolling.
- Summaries make the collapsed state informative, not opaque.
- The exclusive station/Open-Meteo relationship is now structurally
  visible instead of documented-only.
- Units labels localized (bugfix en route).

**Cons**

- Two clicks instead of one scroll to reach a buried option.
- Multi-select dropdowns hide unchecked options until opened — the
  toggle wall showed on/off state for everything at once.
- E2E visual baselines of the editor need regeneration (ADR-0003 flow).

**Tradeoffs**

- `basics` keeps a SECTION_KEYS entry but no reset button — resetting
  the card's identity (mode, entity, title) from a header icon felt
  more dangerous than useful.
- Editor-visible defaults for some attribute toggles (e.g.
  `show_pressure`) intentionally mirror the pre-redesign data bags
  (`!== false`) rather than DEFAULTS — `_applyTogglePaths` writes
  against the same defaults the display reads, so chips stay
  self-consistent; reconciling the editor/DEFAULTS mismatch is a
  separate cleanup.

## Related

- ADR-0005 — editor partial reorganisation (superseded structure)
- ADR-0013 — lazy editor chunk (unchanged)
- ADR-0015 — Open-Meteo no-station data source (now surfaced as the
  past-source dropdown)
- [`../../src/editor/expansion-panel.ts`](../../src/editor/expansion-panel.ts)
- [`../../src/weather-station-card-editor.ts`](../../src/weather-station-card-editor.ts)
- Drift guards: [`../../tests/defaults.test.js`](../../tests/defaults.test.js)
