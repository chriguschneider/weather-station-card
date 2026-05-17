# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **The chart should appear faster, especially on phones and tablets.**
  The card uses a smaller, lighter charting library under the hood
  now. You should notice a quicker first paint when opening the
  dashboard in the HA Companion app or after a fresh browser tab,
  particularly on older devices. No configuration change needed.
- **The chart no longer plays the brief grow-from-baseline animation
  when it first appears.** The chart simply paints once at its final
  state. The look is otherwise unchanged. The `Disable animation`
  toggle in the editor (and `forecast.disable_animation` in YAML) is
  kept for backward compatibility but no longer has any effect.
- **Precipitation row now shown by default.** If a precipitation sensor
  is wired in the card config, the live panel now shows the current
  precipitation rate automatically — no extra toggle needed. To hide
  the row, set `show_precipitation: false` in YAML or flip the toggle
  off in the visual editor.
- **Chart area shows a placeholder while data loads instead of a blank
  box.** Right after opening the card on the dashboard, the chart
  area now shows a faint grid that previews where columns will appear;
  the real chart slides in once the weather data has finished loading.
  Most noticeable when first opening the HA Companion app or
  refreshing a browser tab. No layout shift when the chart commits —
  the rows below stay put. No configuration change needed.

### Fixed
- **Today's daily column no longer goes missing in the first quarter
  hour after midnight.** Right after midnight (until your station has
  aggregated its first reading of the new day) the chart used to drop
  today's station column entirely — the weekday label for yesterday
  vanished and today's label slid one column to the left. The column
  is now always shown: any values your station already has (for
  example a few mm of rain that fell since midnight) appear
  immediately, and fields that aren't measured yet draw as gaps —
  same look as a sensor that was offline on a historical day.

## [1.13.0] — 2026-05-12

Minor release that sharpens the live panel with three at-a-glance
hints. The pressure row's icon turns into a directional arrow that
shows whether the pressure is rising or falling over the last three
hours. The dew-point row's icon flips between frost-risk, fog-risk,
muggy, dew-likely, and comfortable to summarise current conditions in
one glyph. And the two separate sun rows (UV and illuminance) merge
into one combined row whose icon mirrors how cloudy it is right now
and switches to a moon at night. Hover any of these rows for a short
explanation. Forecast-chart cleanup smooths out a few first-render
glitches as well.

### Added
- **Pressure tendency arrow in the live panel.** The pressure row's
  icon now shows at a glance whether the pressure is rising or falling
  over the last 3 hours — a directional arrow replaces the static
  gauge icon. Five steps: rising fast, rising, stable, falling,
  falling rapidly. Hovering the row reveals how much the pressure has
  moved in the last 3 hours and what that typically means for the
  weather (rapid clearing, improving, no change, deteriorating, storm
  likely). Once your pressure sensor has been recording for three
  hours, the arrow appears automatically; sensors with less history
  keep the original gauge icon. Works with any pressure unit (hPa,
  mmHg, inHg). (#115)
- **Dew-point row now shows a comfort hint.** The icon next to the
  dew-point value changes to reflect what the current dew point and
  air temperature suggest about conditions: frost risk, fog risk,
  muggy air, dew likely, or comfortable. Hover the icon to see a
  short explanation. No configuration change needed — it appears
  automatically whenever the dew-point row is enabled and an air
  temperature is available. When the air temperature is missing, the
  original thermometer icon stays.
- **Live panel shows UV and illuminance on one combined row.** The two
  separate sun rows (UV and illuminance) merge into one, with a single
  icon that reflects how cloudy it is right now — a clear sun, a sun
  behind a cloud, or a full cloud. Hover the row to see the WHO band
  name for the current UV value and a sunscreen hint when UV is 3 or
  higher. At night (or when illuminance is reported as zero) the row
  switches to a moon icon and hides the UV value, since UV at night is
  always zero anyway. The existing "show UV" and "show illuminance"
  toggles continue to control whether each piece of information
  appears — no YAML changes needed.

### Fixed
- **Forecast chart now mounts smoothly without bar widths jumping.**
  When you opened a dashboard, the bars could briefly start wide and
  then snap narrower as the station history and sunshine values
  finished loading in the background. The card now waits for both
  data sources before showing the chart, so the layout you see at
  first glance is the one that stays. While the data is still
  arriving, a blank space the size of the chart keeps the rest of
  the card from shifting around.
- **Switching forecast views no longer flashes to the wrong edge.**
  Cycling between the daily, today, and hourly views could briefly
  leave the chart scrolled to the right edge before snapping back to
  the now line. The chart now lands at the correct centred position
  on the first paint after the switch.
- **Grow-from-below entry animation is visible again on first
  render.** Earlier polish work moved the chart mount through enough
  preparation steps that the bars-grow-from-the-baseline animation
  could complete before the chart became visible. The animation now
  triggers reliably after the chart is in place. (#152)

## [1.12.0] — 2026-05-12

Minor release that lets the card derive a live `mm/h` precipitation
rate from a cumulative rain counter, so weather stations that only
expose a running total (Ecowitt `*_precipitation`, BTHome
`*_rain_total`, similar 0.1 mm tipping buckets) no longer need a
side-car Derivative helper to populate the attribute-row precip cell.
The rate cell now also picks a rain-intensity icon (`water-off` →
`weather-rainy` → `weather-pouring`) so the pictogram matches the
numeric mm/h.

### Added
- **Card-side rate derivation from cumulative precipitation sensors.**
  When `sensors.precipitation` points at a cumulative `mm` counter
  (unit does NOT end in `/h`), the card keeps a 15-minute mini-buffer
  of recent samples — persisted to `localStorage` per entity so the
  rate is available immediately after a hard reload — and computes
  `rate = (latest − anchor) / (now − anchor)` using a sliding 3-sample
  anchor and a `now`-driven denominator. The denominator advances with
  wall-clock time even between sensor ticks, so the rate decays
  smoothly toward 0 during dry spells (no cliff-edge when the buffer
  ages out). Counter-reset monotonicity breaks (midnight `*_rain_today`
  rollover, utility-meter resets, device reboots) are detected via
  forward scan and the rate is computed only from the post-reset suffix.
  Native rate sensors (unit ending in `/h`) keep their v1.9 pass-through
  behaviour, untouched. (#150, resolves #117)
- **Rate-driven icon on the precipitation attribute row.** The cell's
  pictogram now follows the rate: `hass:water-off` at 0 mm/h,
  `hass:weather-rainy` for drizzle and light rain (< 2.5 mm/h),
  `hass:weather-pouring` for moderate and heavy rain (≥ 2.5 mm/h).
  Sun-themed glyphs (`weather-partly-rainy`) are deliberately avoided
  — sun-in-rain reads as visually contradictory.

### Changed
- `docs/SENSORS.md` — the "live precipitation rate from a cumulative
  sensor" section now documents the built-in derivation as the default
  path. The HA Derivative-helper recipe stays as a manual override for
  users who want server-side smoothing or coarser-than-0.1 mm tipping
  buckets where the card-side buffer can't reach N=3 within 15 minutes.

## [1.11.1] — 2026-05-10

Patch release that fixes a forecast wind-speed mis-conversion. When
the station sensor (e.g. `m/s`) and the HA weather entity (e.g.
`km/h` for MeteoSwiss) reported wind in different units, every
forecast column was multiplied by the m/s↔km/h factor of ~3.6, so a
real 20 km/h forecast showed up as 72 km/h. Past-day measured
aggregates (which originate at the station sensor) kept converting
correctly the whole time — the symptom only appeared on the
forecast side of the chart.

### Fixed
- Forecast wind columns now read in the correct unit when the station
  sensor and the weather entity disagree on `wind_speed_unit`.
  Previously the renderer used the station sensor's unit for all
  entries, causing a ~3.6× over-statement on forecast cells (e.g.
  72 km/h instead of 20 km/h). `ForecastDataSource` now tags each
  emitted entry with the weather entity's `wind_speed_unit`, and
  `_convertWindSpeed` honours the per-entry tag. (#145)

### Under the hood
- `_convertWindSpeed` no longer carries its own copy of the
  conversion ladder; it now delegates to the lookup-table utility
  in `src/utils/unit-converters.ts`, restoring the single source of
  truth mandated by ADR-0009.

## [1.11.0] — 2026-05-09

Chart bar and curve colours now use predictable defaults that don't
drift per HA theme. Sunshine bars render yellow, precipitation bars
light blue, high-temperature curve orange, low-temperature curve dark
blue — on every theme. Previously some of these inherited theme tokens
that didn't mean what their names suggested (sunshine adopted the
alert / warning colour, low-temperature adopted the info-banner
colour) or pointed at HA tokens that don't exist, so the behaviour
varied across themes in ways no one expected. No YAML changes needed
— if you'd set custom colours, those still win, and you can still pass
a `var(--your-token, fallback)` string in YAML to opt back into
theme-driven colouring.

### Fixed
- Sunshine bars no longer adopt the theme's warning / alert colour
  on standard HA themes — the default is now a fixed yellow that
  doesn't drift per theme. (#121)
- Low-temperature curve, high-temperature curve, and precipitation bar
  defaults now also pin to predictable literal colours instead of
  guessing at HA theme tokens (some of which didn't actually exist).

### Under the hood
- New `AGENTS.md` at repo root with the conventions for AI-assisted
  contributions; the maintainer's local-only `CLAUDE.md` content
  migrated into tracked docs (`docs/QUALITY-GATES.md`, additions to
  `TESTING.md` / `CONTRIBUTING.md` / `STYLE-GUIDE.md` /
  `TROUBLESHOOTING.md`) so external contributors no longer hit broken
  references. (#131)
- New `LOCAL-TESTING.md` with a Docker recipe so contributors can
  verify a build against a real HA instance without the maintainer's
  Pi setup. (#130)
- New "Card colour tokens" section in the style guide pinning each
  concept colour to a single source of truth across the codebase, plus
  a regression test that simulates a hostile theme to catch the
  v1.9.0 token-mismatch pattern on future colour changes.
- README hero shows a light/dark theme pair of the strongest layout
  instead of two light renders of different layouts. (#128)
- CI workflow runs now cancel earlier in-flight runs when a new push
  lands on the same branch, cutting the GHA cost on iterative PRs.
  Tag-push behaviour is unchanged so release builds run end-to-end.
  (#129)
- SonarCloud noise reduction: `src/locale.ts` excluded from
  copy-paste detection (its per-language repetition is intentional);
  the void-floating-promise pattern that typescript-eslint actively
  requires is no longer flagged project-wide. (#57, #123)

## [1.10.2] — 2026-05-09

Schema-driven editor migration release — closes the last three v1.10
plan items (#87, #92, #93) that needed local HA verification on each
section. The editor now renders every input through HA's `<ha-form>`
or `<ha-selector>` (no more hand-rolled `<ha-textfield>` /
`<ha-switch>` markup), every section header gains a one-click
reset-to-defaults button, and a CI-enforced drift guard makes the
schema, the SECTION_KEYS map, and DEFAULTS three-way consistent.

### Editor — fully schema-driven (closes #87)

Two sections still ran on hand-rolled HTML at v1.10.1:

- **Diagramm** (`render-chart.ts`) — 8× `<ha-textfield>` + 14× `<ha-switch>`
  replaced by 4 logical `<ha-form>` blocks (top-level title + days,
  forecast count, chart rows, style + appearance). Each form has its
  own dynamically-built schema with `computeLabel` for DE/EN locale
  support. Conditional fields preserved (`days` only when station
  visible, `forecast_days` only when forecast visible, sunshine
  availability hint subsection only when `forecast.show_sunshine` is
  on).

- **Live-Anzeige** (`render-live-panel.ts`) — 12+ `<ha-switch>`
  toggles in two groups (main panel + attributes) replaced by two
  schema-driven `<ha-form>` blocks. Schema is built dynamically based
  on the gating flags (`show_main`, `show_attributes`) and the
  configured sources — `hasLiveValue` / `hasSensor` predicates
  determine which attribute toggles appear, matching the previous
  conditional-rendering behaviour exactly.

The five sections that already used `<ha-form>` (units, mode, sensors,
forecast, tap) are unchanged structurally — they only gain the new
reset button (see below).

New editor handlers:
- `_chartTopChanged` — top-level title / days / forecast_days
- `_chartForecastChanged` — forecast.* nested keys (number_of_forecasts,
  condition_icons, show_*, style, round_temp, disable_animation)
- `_livePanelChanged` — top-level cfg.show_* toggles for both
  main-panel and attributes forms
- `_resetSection(sectionKey)` — see below

All four use the same diff/delete pattern: keys with empty-string or
undefined values are pruned from config so unset fields don't leak
into the YAML.

### Editor — per-section reset-to-defaults buttons (closes #92)

Every section header gains a small `mdi:restore` icon button on the
right. Click drops every key the section owns from the config (lets
DEFAULTS take over on the next render). No confirm dialog — reset is
reversible by closing the editor without saving (HA shows the
unsaved-changes indicator).

Implementation:

- **`src/editor/section-keys.ts`** (new) — `SECTION_KEYS` map (sectionKey
  → list of dot-paths) for all 7 sections. Includes
  conditionally-rendered fields too, so the reset is exhaustive (e.g.
  `live_panel` lists every `show_*` even when the matching sensor
  isn't currently configured).
- **`src/editor/section-header.ts`** (new) — `renderSectionHeader()`
  helper used by all 7 render-*.ts.
- **`_resetSection(sectionKey)`** in the editor walks
  `SECTION_KEYS[sectionKey]` and deletes each path. The `_deleteByPath`
  helper cleans up empty parent objects (e.g. resetting every
  `forecast.*` removes the empty `forecast: {}` block too).
- New locale strings: `'reset_section'` (DE: "Diese Sektion auf
  Standardwerte zurücksetzen", EN: "Reset this section to defaults").

### Schema-coverage drift guard (closes #93)

`tests/defaults.test.js` gains the second half of the v1.9.0 drift
guard. The existing tests verified that every DEFAULTS key is referenced
by `setConfig` / `getStubConfig`. New checks:

1. Every `SECTION_KEYS["<section>"]` path resolves to a real DEFAULTS
   path (or is in `DELETE_ONLY_PATHS` for runtime-fallback fields like
   `title` that have no default but are still resettable).
2. Every schema field exposed by an editor `<ha-form>` appears in the
   corresponding `SECTION_KEYS` entry, OR is in the `SCHEMA_KEY_SKIPLIST`
   (UI-only abstractions like `mode`), OR the section uses a parent-path
   reset (`sensors` / `units`) that implicitly covers all child fields.

Catches: adding a field to a render-*.ts schema without listing it in
SECTION_KEYS (reset would skip the field), removing a key from DEFAULTS
while leaving it in SECTION_KEYS (reset would dangle), or renaming a
SECTION_KEYS path without updating both sides.

### Tests

The two `editor-render-*.test.js` files (chart, live-panel) that
asserted on the old hand-rolled HTML structure are deleted. Replaced
by `tests/editor-schema.test.js` — 22 tests that read each `<ha-form>`'s
`.schema` property and assert on the field names directly. Total suite:
510 → 522 (+12).

### Internal

- ESLint warnings: 63 → 60 (the hand-rolled live-panel ternary chain
  was the largest remaining nested-conditional cluster outside main.ts;
  combined with v1.10.0/v1.10.1: **168 → 60 (-64%)**).
- New file `src/editor/section-keys.ts` (90 LOC) — single source of
  truth for the per-section config-key inventory.

### Bundle

Bundle: ~360 KB raw / ~115 KB gzipped (within the 800/250 caps).

### Issues closed

- #87 — Schema-driven editor sections via `<ha-form>` (chart +
  live-panel migration completes the previous-five-already-migrated
  set; all 7 sections now schema-driven)
- #92 — Per-section reset-to-defaults buttons
- #93 — Schema-coverage assertion (drift guard second half)

## [1.10.1] — 2026-05-09

Aftercare for v1.10.0 plus the larger-scope items the original v1.10
plan deferred. Zero user-facing behaviour change — internal sweep
that closes the structural items left open from the v1.10.0 quality
release: branch-coverage uplift, full `drawChartUnsafe` phase split,
three more complexity hot-spot refactors, render-time CI advisory,
and two ADRs codifying the patterns the v1.10 sweeps established.

The schema-driven editor migration (#87, #92, #93) remains deferred —
it depends on local HA verification on each section migration, which
this release cycle still couldn't accommodate.

### Internal — v1.10 aftercare

- `WIND_CONVERSION` / `PRESSURE_CONVERSION` lookup tables and the
  three `_convertDisplayWindSpeed` / `_convertDisplayPressure` /
  `_formatSunshineHours` helpers extracted from `main.ts` into
  `src/utils/unit-converters.ts`. Pure functions, Beaufort injected
  as a callback to keep utils leaf-only. `convertPressure` return
  type narrowed from `number | string` to `number` (inHg now uses
  `Math.round(x * 100) / 100` for 2-decimal precision instead of
  `.toFixed(2)`).
- New `tests/unit-converters.test.js` covers all three with 31 cases
  (round-trip, identity, undefined units, Beaufort delegation, edge
  cases). Total suite: 469 → 510 tests.
- Per-row helpers extracted from `_renderClimateGroup` /
  `_renderSunGroup` (e.g. `_climateRow_humidity`,
  `_sunRow_uv`, `_windRow_speed`). Removes 4 nested-conditional
  warnings; group renderers now compose row helpers instead of
  inlining ternaries.

### Internal — three more complexity hot-spot refactors

- `main.ts _classifyLiveCondition` (CC=23) split into
  `_resolveLiveClassifierInputs` (sensor states + numeric inputs +
  precip-rate detection), `_pickLiveCondition` (cache lookup +
  classify decision tree), `_synthesizeWeatherEntity` (build the
  stand-in `weather` object).
- `main.ts _refreshForecasts` (CC=22) split into `_sliceForecast`
  (bound the forecast block by mode), `_buildTodayForecasts` (today
  pipeline with hourly sunshine + 3-hour aggregation), and
  `_buildDailyOrHourlyForecasts` (standard pipeline with F3-fallback
  cloudExp threading).
- `action-handler.ts runAction` (CC=28) refactored into 7 dedicated
  `_run*` handlers + an `ACTION_RUNNERS` dispatch table. The legacy
  `call-service` alias and `perform-action` share the `_runService`
  handler.

### Internal — `drawChartUnsafe` full phase split (chart/orchestrator.ts)

v1.10.0 only extracted `pickPerBarColor`. v1.10.1 completes the
phase split: `buildSegmentHelpers`, `buildDatasets`,
`applyStyle2DataLabels`, `buildPlugins`, `computePrecipMax`,
`applyChartDefaults` are now standalone helpers. `drawChartUnsafe`
itself drops from 232 LOC / CC=36 to 105 LOC / CC=24, with
cognitive-complexity now under the gate. The function is now a
straight orchestrator (validate → theme → setup → datasets +
plugins → buildChart).

### Internal — quality lock-in (round 2)

Mechanical lint sweep round 2: 5× type-alias / function-return-type /
floating-promises / prefer-optional-chain cleanups. ESLint warnings:
**76 → 63 (-13 across v1.10.1)**. Combined with v1.10.0: **168 → 63
(-62.5%)**.

### Internal — branch-coverage uplift

Test additions:
- `MeasuredDataSource` lifecycle: subscribe/unsubscribe timer cleanup,
  unsubscribe idempotency, 3-failure threshold notify, failure-counter
  reset on success.
- `OpenMeteoSunshineSource.ensureFresh`: no-fetch / non-finite-coords
  early-returns, ok:true / ok:false / AbortError listener notifications,
  in-flight coalescing.

Coverage: global branches 84.18% → 85.98% (+1.8pp);
data-source.ts branches 70.19% → 76.92% (+6.7pp).

### CI

- New `tests-e2e/perf-render-time.spec.ts` measures end-to-end mount
  → chart-rendered timing for three configs (daily/today/hourly
  combination), 5 iterations, median + p95.
- New "Render-time advisory summary" CI step renders the timings in
  the GitHub Actions build summary. **Advisory only** — no CI gate
  (GHA-runner CPU variability would create false positives). Trend
  signal across multiple PRs.
- Closes the render-time portion of #111.

### ADRs

- **ADR-0009** — Lookup-table pattern for unit conversions (codifies
  the v1.10 `WIND_CONVERSION` / `PRESSURE_CONVERSION` shape as a
  precedent for future Map-based conversions).
- **ADR-0010** — Group-renderer pattern for conditional template
  blocks (parent + ctx + per-group + per-row split, from
  renderAttributes; references ADR-0007 as the same flavour at the
  data path).

### Deferred to v1.10.2 / v1.11

- **#87** — Schema-driven editor sections via `<ha-form>` (still
  needs HA-side verification on each section migration).
- **#92** — Per-section reset-to-defaults (depends on #87).
- **#93** — Schema-coverage assertion (depends on #87).
- Per-file branch-coverage uplift in `data-source.ts` and
  `openmeteo-source.ts` to 80%+ (currently 76.92% / 79.36%; global
  gate at 85.98% holds).
- Remaining complexity hot-spots: `_extractSensorReadings` (CC=18),
  `_resolveLiveClassifierInputs` (CC=17, new from this release),
  `_syncDataSources` (CC=19), `_ensureSunshineSource` (CC=22),
  `getWindDirIcon` (CC=18), `calculateBeaufortScale` (CC=16),
  `classifyDay` (CC=34), `setupScrollUx` (136 LOC), `cardStyles`
  (246 LOC), `_buildHourlyForecast` (CC=21), `_maybeApplyInitialScroll`
  (CC=21), `sunshineFromLuxHistory` (CC=16), `pickHourlyTickIndices`
  (CC=20), `drawChartUnsafe` itself (CC=24, down from 36).

### Issues closed

- #111 — Render-time advisory in CI summary

## [1.10.0] — 2026-05-09

Quality-and-modernisation release. Zero user-facing behaviour change —
this is an internal sweep that targets SonarCloud / ESLint backlog,
splits the worst complexity hot-spots, removes the abandoned icon-set
assets, and tightens the CI bundle budget. The schema-driven editor
work (#87, #92) that was originally planned for this release is
deferred to v1.11 — it depends on undocumented HA `<ha-form>` API
behaviour and needs HA-side verification on each section migration.

### Removed assets — `dist/icons2/` is gone

The `icon_style` / `animated_icons` / `icons` config keys lost their
code path in v1.9.x; the asset directory they served is now removed
too (~132 KB of dead SVGs no longer copied into the build). Old HACS
installs may still contain a stale `dist/icons2/` until a fresh
download — nothing in the bundle references it.

### Internal — complexity hot-spot extraction

- `main.ts renderAttributes` (CC=99, the worst hot-spot in the
  codebase) split into six helpers: `_convertDisplayWindSpeed` and
  `_convertDisplayPressure` (driven by lookup tables for mph / m/s /
  km/h / mmHg / hPa / inHg conversions), `_formatSunshineHours`, plus
  three `_renderClimateGroup` / `_renderSunGroup` / `_renderWindGroup`
  composers. `renderAttributes` itself is now ~25 lines.
- `sunshine-source.ts findInDateArray` (CC=42 → under 15): per-item
  match logic extracted into `matchDailyEntry`, so the array loop
  becomes a 2-line `result !== undefined ? return : continue`.
- `chart/orchestrator.ts drawChartUnsafe`: `pickPerBarColor` extracted,
  clearing four nested-ternary warnings on the precip + sunshine
  per-bar colour maps. Full phase split (datasets, plugins,
  style2-datalabels) remains for a future pass.

### Internal — quality lock-in

- 7 zero-violation lint rules promoted from warn → error:
  `max-depth`, `lit/no-useless-template-literals`,
  `lit/attribute-value-entities`, `sonarjs/no-identical-functions`,
  `sonarjs/no-collapsible-if`, `sonarjs/prefer-single-boolean-return`,
  `sonarjs/no-redundant-jump`. Prevents regression on each.
- Mechanical SonarCloud / ESLint sweep:
  - 47 `prefer-nullish-coalescing` warnings cleared (`||` → `??`
    where the LHS is non-primitive). Includes a few `?? ?? ??` chain
    collapses where 4-deep `!= null ? a : b` ternaries reduced to a
    single line, plus `tempMax ??= tempMean` / `tempMin ??= tempMean`
    in data-source.ts.
  - 8 standalone nested-ternary smells flattened (data-source.ts,
    main.ts limit / sunshine-divisor, openmeteo-source.ts storage
    fallback, sunshine-source.ts date-key resolution).
  - 5 unnecessary type assertions dropped from main.ts +
    weather-station-card-editor.ts (the documented intentional
    `this as unknown as ...` double-casts are preserved).
  - 4 small fixes: dead-store `let i = 9` / `default: i = 9` collapse
    in `getWindDirIcon`, ignored-exception binding `(_)` →
    bare `catch`, and two `== true` / `== false` config checks
    converted to `===`.
- ESLint warnings: 168 → 76 (-55%). Remaining backlog (target for
  v1.11: < 50) is primarily complexity ceilings on
  `_classifyLiveCondition`, `_refreshForecasts`, `_ensureSunshineSource`,
  and `getWindDirIcon`, plus defensive runtime null/undefined checks
  at the HA boundary that the eslint config explicitly allows.

### CI

- Bundle budget gate gains a gzipped-size cap (250 KB) alongside the
  existing raw 800 KB cap. Bytes-on-the-wire is what HACS download
  size and HA's frontend cache pay for; raw size only matters once
  the file lands. Current bundle: ~355 KB raw / ~114 KB gzipped.
  Closes #111 (the autonomously-actionable subset; render-time
  gating remains an open research item).

### Deferred to v1.11

- **#87** — Schema-driven editor sections via `<ha-form>`. The
  ADR-0008 DEFAULTS-as-single-source-of-truth foundation is in place;
  the migration itself needs HA-side verification on each section.
- **#92** — Per-section reset-to-defaults buttons (depends on #87).
- **#93** — Schema-coverage assertion (depends on #87).
- Per-file branch-coverage uplift in `data-source.ts` (70.19%),
  `openmeteo-source.ts` (77.77%), `scroll-ux.ts` (79.81%). Global
  coverage gate stays green at 84%+ branches.

### Issues closed

- #57 — SonarCloud code-smell backlog (mechanical subset; complexity
  refactors continue in v1.11)
- #111 — CI bundle-size gate (gzipped-size variant)
- #112 — `dist/icons2/` asset removal

## [1.9.1] — 2026-05-09

Polish round on top of v1.9.0. The editor surface tightens further (now
seven sections instead of eight), several v1.x icon / sizing / colour
configuration keys disappear from the editor, and the precipitation cell
in the live panel switches to showing the configured sensor's raw value.
Internally, `set hass` is split into three phases, the console banner now
sources its version from `package.json` at build time, and 28 orphaned
locale keys are gone.

### Editor: 8 → 7 sections

The "Symbole" / Icons section is removed; the "Experten-Einstellungen"
section is folded into Advanced topics that live in YAML only. The
remaining seven sections, in the order they render:

1. **Karte einrichten** / Card setup — mode, chart type, title
2. **Wettervorhersage** / Weather forecast — `weather_entity` picker
3. **Sensoren** / Sensors — sensor pickers + past-data window
4. **Diagramm** / Chart — time range, chart rows, appearance
5. **Live-Anzeige** / Live panel — main panel + attributes row
6. **Einheiten** / Units — pressure / wind-speed display units
7. **Aktionen** / Actions — tap, hold, double-tap

### Removed config keys (no longer parsed)

- `icon_style` — the icon-set switcher is gone; HA's MDI icons are used directly.
- `animated_icons` — animated SVG path removed.
- `icons` (custom URL) — custom icon paths are no longer plumbed in.

Old YAML configs that still set these keys are silently ignored. See
[MIGRATION.md → v1.9](MIGRATION.md#v19) for the full upgrade list.

### Deprecated

- **`forecast.show_wind_forecast`** — legacy master-off shim for the
  forecast wind row, kept as a hard kill-switch for v1.x configs that
  set it to `false`. The editor never exposes it. Slated for **removal
  in v2.0**. New configs should use the independent `forecast.show_wind_arrow`
  and `forecast.show_wind_speed` toggles (set both to `false` for the
  same effect).

### Removed editor UI for chart sizes / colours / font sizes

Three sub-sections that were rarely touched have been moved out of the
editor surface — the keys keep working in YAML:

- Chart sizes: `forecast.labels_font_size`, `forecast.chart_height`, `forecast.precip_bar_size`
- Live-panel font sizes: `icons_size`, `current_temp_size`, `time_size`, `day_date_size`
- Colour overrides: `forecast.temperature1_color`, `forecast.temperature2_color`, `forecast.precipitation_color`, `forecast.sunshine_color`, `forecast.chart_text_color`, `forecast.chart_datetime_color`

Colour defaults are also now theme-aware (`var(--token, fallback)` —
already shipped in v1.9.0; the editor row exposing the literal RGBA
default went away in this polish round).

### Wind row toggles in the chart are now independent

`forecast.show_wind_arrow` (per-day direction arrow) and
`forecast.show_wind_speed` (per-day numeric speed) are independent
toggles in the editor. Either toggle alone surfaces the wind row.

### Live panel: opt-out semantics, attribute-row gating

Headline attribute toggles (`show_humidity`, `show_pressure`,
`show_uv_index`, `show_wind_direction`, `show_wind_speed`) default to
"shown when a backing value is present" — opt-out. Detail toggles
(`show_dew_point`, `show_wind_gust_speed`, `show_illuminance`,
`show_precipitation`, `show_sunshine_duration`, `show_sun`) stay opt-in.

The editor surfaces sub-toggles only for attributes whose backing value
is actually available — either a sensor under `sensors.*` or the
matching attribute on `weather_entity`.

### Forecast-only mode reads weather-entity attributes

When station sensors aren't wired but `weather_entity` is, the card
now falls back to the configured weather entity's attributes for live
values: `temperature`, `humidity`, `pressure`, `dew_point`, `uv_index`,
`wind_speed`, `wind_bearing`, `wind_gust_speed`. The attribute row in
the live panel surfaces correspondingly. `illuminance`,
`precipitation`, and `sunshine_duration` stay sensor-only (no
weather-entity counterpart).

### Precipitation cell shows raw sensor value

The live-panel precipitation attribute shows the configured
`sensors.precipitation` sensor's raw value with its native unit —
cumulative `mm` or rate `mm/h`. Card-side auto-derivation of a `mm/h`
rate from a cumulative counter was attempted and rolled back; the
canonical solution is HA's built-in **Derivative helper** (see
[SENSORS.md → Live precipitation rate from a cumulative sensor](docs/SENSORS.md#live-precipitation-rate-from-a-cumulative-sensor)
and tracking [issue #117](https://github.com/chriguschneider/weather-station-card/issues/117)).

### Internal — `set hass` 3-phase decomposition (ADR-0007)

The 240-line `set hass` setter is split into three private phase
methods:

1. `_extractSensorReadings(hass)` — sensor entity reads, source-unit detection, weather-entity attribute fallback.
2. `_classifyLiveCondition(hass)` — minute-memoized classifier + synthesized weather stand-in.
3. `_syncDataSources(hass)` — subscribe / unsubscribe + missing-sensor scan.

The setter itself is now a 12-line orchestrator. ESLint's
cognitive-complexity warnings on this region are gone; refactor lays
the groundwork for future phase-level testing.

### Internal — build-time `__CARD_VERSION__` injection (ADR-0006)

`rollup.config.mjs` now applies a small inline `injectCardVersion`
plugin that replaces the literal `'__CARD_VERSION__'` in `src/main.ts`
with the version from `package.json` at build time. The console
banner on card load is sourced from `package.json` automatically; no
manual sync at release time.

### Internal — DEFAULTS as single source of truth (ADR-0008)

`src/defaults.ts` exports `DEFAULTS`, `DEFAULTS_FORECAST`,
`DEFAULTS_UNITS`. Both `setConfig` and `getStubConfig` consume the
same object — earlier branches had two divergent default sources.
The schema-drift CI test (issue #93) keeps it that way.

### Internal — Editor partial reorg (ADR-0005)

`src/editor/render-{layout,style,advanced}.ts` removed; replaced by
new user-intent-clustered partials `render-{mode,chart,live-panel}.ts`.
`render-icons.ts` deleted entirely (icon configuration removed).
A shared `editor/types.ts` exports `EditorLike`, `EditorContext`,
`TFn`, and `ChangeEvt` for the partials to consume.

### Internal — Locale cleanup

28 orphan keys removed from `src/locale.ts` (DE + EN editor blocks):
`icon_style`, `animated_icons`, `custom_icons_url`, `show_chart_wind`,
`show_chart_wind_arrow`, `expert_settings_heading`,
`icons_section_heading`, `chart_sizing_heading`,
`live_panel_sizing_heading`, `actions_heading`, `sizing_heading`,
`icons_heading`, `colours_heading`, `forecast_type`,
`forecast_type_label`, `forecast_type_hint`, `icon_size`,
`current_temp_size`, `time_size`, `day_date_size`,
`labels_font_size`, `chart_height`, `precip_bar_size`,
`temperature1_color`, `temperature2_color`, `precipitation_color`,
`sunshine_color`, `chart_text_color`, `chart_datetime_color`,
`color_theme_aware_placeholder` (~63 lines removed from `locale.ts`).

### Tests

- New: `tests/editor-render-chart.test.js` (13 cases) — jsdom + Lit
  `render()` smoketest for the chart partial.
- New: `tests/editor-render-live-panel.test.js` (10 cases) — same for
  the live-panel partial. Covers gating by `hasSensor` /
  `hasLiveValue` and master toggles.
- 469 tests across 15 files (was 446 / 13 before this round).

## [1.9.0] — 2026-05-08

Configuration-UX overhaul. The editor's six technical-clustered sections
are now eight user-intent-clustered ones with plain-language headings
("Was zeigt die Karte?", "Wettervorhersage", "Sensoren deiner
Wetterstation", "Was wird angezeigt?", "Aussehen", "Einheiten", "Was
passiert beim Tippen?", "Experten-Einstellungen"). Combination is now
the default mode for newly added cards. The chart picks up theme
colours automatically. The classifier-override fields finally have
human-readable labels.

### Combination is the default — and forecast-only finally validates

New cards added via the picker now default to **Combination** mode
(station + forecast side-by-side) instead of Station-only, showcasing
the card's strength out of the box. Existing cards are unaffected.

`setConfig` validation became mode-aware:

- `show_station: true` requires `sensors.temperature` (was already
  enforced, now scoped to the station block).
- `show_forecast: true` requires a `weather.*` entity in
  `weather_entity` (newly enforced — before, an empty `weather_entity`
  in forecast mode silently produced an empty forecast block).

A pure forecast-only card no longer needs station sensors; a pure
station card no longer needs a weather entity. The error messages
name which mode triggered the check.

### Editor: 8 sections, plain-language headings, collapsible advanced

The editor was reorganised from six technical-clustered sections
("Einrichtung", "Aufbau", "Stil & Farben"…) into eight
user-intent-clustered ones with plain-language headings. The mode
radio gates section visibility — Station-only hides "Wettervorhersage";
Forecast-only hides "Sensoren deiner Wetterstation". The advanced
block (locale + classifier overrides) is now collapsed by default.

A 📖 documentation link sits in the editor footer, pointing at
`docs/CONFIGURATION.md` on master. `documentationURL` only surfaces
in the card-picker; once the editor is open, the link used to be
gone.

### Theme-aware chart colours

The four chart-colour defaults now follow the user's HA theme via CSS
custom properties:

| Setting | Theme token | Fallback |
| --- | --- | --- |
| `forecast.temperature1_color` | `--state-sensor-temperature-color` | rgba(255, 152, 0, 1.0) |
| `forecast.temperature2_color` | `--info-color` | rgba(68, 115, 158, 1.0) |
| `forecast.precipitation_color` | `--state-sensor-precipitation-color` | rgba(132, 209, 253, 1.0) |
| `forecast.sunshine_color` | `--warning-color` | rgba(255, 215, 0, 1.0) |

A light/dark theme switch now shifts the chart hues automatically.
User-set RGBA / hex / hsl strings still win — pass-through.

The colour input fields in the editor hide the wrapped `var(...)`
defaults so users see an empty field with a "theme default"
placeholder instead of a wall of `var(--state-sensor-temperature-color, rgba(...))`.

### Translated classifier override labels

The 13 condition-mapping override fields under "Experten-Einstellungen"
used to render their snake_case key as the label
(`rainy_threshold_mm`, `exceptional_gust_ms`…) — meaningless out of
context. They now show readable labels ("Regen ab" / "Rainy from",
"Extreme Böen ab" / "Exceptional gust from"). The original key is
preserved as a `title=` tooltip for technical users.

### Smarter sensor auto-detection

`getStubConfig` no longer picks the first device-class match
arbitrarily when the user has several candidates
(`sensor.outdoor_temperature` + `sensor.living_room_temperature` +
`sensor.fridge_temperature`). The new ranking biases toward outdoor
/ garden / pool / weather-station naming and away from indoor /
kitchen / fridge / bedroom names, with last-changed activity as the
tie-breaker.

### Picker preview now shows a real thumbnail

The HA card-picker renders each card with its `getStubConfig()` to
generate the thumbnail. The previous stub set `show_main: false` so
the preview tried to draw the past chart — which depends on
`recorder/statistics_during_period` data that isn't available
synchronously inside the picker. Result: an empty render and a
description-only tile. The stub now overrides `show_main`,
`show_current_condition`, and `show_attributes` to `true` so the
live now-panel renders immediately, giving the picker an honest
visual driven by `hass.states` only.

### Sections-view sizing

`getCardSize()` now reflects the actual height of enabled blocks
(chart row, optional main panel with/without time, attributes row)
instead of returning a fixed 4. Masonry layouts reserve space
proportional to the real card height.

### Internal cleanup

- **Single source of truth for defaults.** The `setConfig` and
  `getStubConfig` paths used to declare overlapping default sets
  that had drifted (`forecast.condition_icons` / `disable_animation`
  / number-vs-string types). A new `src/defaults.ts` exports
  `DEFAULTS` / `DEFAULTS_FORECAST` / `DEFAULTS_UNITS` consumed by
  both paths. A new drift-guard test (`tests/defaults.test.js`)
  asserts the contract so a future PR can't silently re-introduce
  the divergence.
- **`assertConfig` lifecycle hook.** When a YAML config is
  structurally incompatible with the visual editor (e.g.
  `condition_mapping` is an array, `sensors.foo: light.bar` instead
  of `sensor.bar`), HA falls back to the YAML editor instead of
  showing a broken visual editor.

### Issues closed

- #83 — single source of truth for configuration defaults
- #84 — validate `weather_entity` and add `assertConfig`
- #85 — conditional `getCardSize`
- #86 — restructure editor sections + relabel for end users
- #88 — translate `condition_mapping` field labels
- #89 — ranked sensor auto-detection in `getStubConfig`
- #90 — theme-aware default chart colours via CSS custom properties
- #91 — documentation link in editor footer
- #93 — schema-drift CI test (partial — schema-coverage assertion
  deferred to v1.10 with #87)

### Deferred to v1.10

- #87 — schema-driven editor sections (`<ha-form>` migration of the
  hand-rolled sections). Foundational for cleaner per-section reset
  buttons (#92) and the schema-coverage half of #93.
- #92 — per-section reset-to-defaults button. Lands naturally on
  top of the schema migration.

## [1.8.0] — 2026-05-07

Quality-stack-finalisation release. No new user-facing features — the
release closes out the typing and static-analysis backlog that's
accumulated over v1.5–v1.7. Headline behind-the-scenes wins: main.ts
finally drops `@ts-nocheck`, the chart's biggest plugin file is split
along its natural seams, and SonarCloud's quality gate finally goes
green.

### TypeScript: main.ts is now strict-checked

The card's main file (`main.ts`) carried a top-of-file
`// @ts-nocheck` since the v1.2 TypeScript migration — disabling all
type checking for ~1,500 lines of LitElement / HA / Chart.js wiring.
v1.8 removes the opt-out. Real types throughout: a `HassMain` shape
extends the data-source `HassLike` with the locale fields the live-
condition / clock paths read; `HassEntityState` types the
`hass.states[eid]` index access; lifecycle hooks are typed
`Map<PropertyKey, unknown>`; data-source fields use the actual class
references so subscribe-callback events infer end-to-end.

The remaining `any` annotations cluster at the HA-shape boundary
(user YAML in `setConfig`, the synthesised `weather` attribute bag,
chart args) — each carries an `// eslint-disable no-explicit-any`
so future tightening passes can grep them. Refactor-safety in the
file goes from "trust the runtime" to "tsc says yes".

### Chart-plugin file split

The `chart/plugins.ts` file had grown to 600 lines through organic
v0.6→v1.x additions. SonarCloud flagged the `dailyTickLabelsPlugin`
afterDraw at cognitive complexity 46 — the worst function in the
codebase. v1.8 splits the file along natural seams: one file per
plugin under `chart/plugins/`, with the old `chart/plugins.ts` kept
as a barrel re-export so existing imports work unchanged. Inside
the daily-tick-labels file, the afterDraw hook is now a 4-line
dispatch on `forecast.type` — extract helpers for the
'today / hourly' and 'daily' branches drop the cognitive
complexity to ~7.

### SonarCloud quality gate: green

The new-code coverage measure was failing the gate at 75 %. v1.8
adds tests for the v1.7-introduced `_fetchLuxSunshine` WS path
(B2 lux derivation) — eight cases mocking `hass.callWS` for the
no-illuminance / no-lat-lon / WS-failure / threshold-sweep /
malformed-sample paths. Coverage on `data-source.ts` rises from
77 % to 83 % (line) and 62 % to 71 % (branch); the gate flips to
**PASS**.

### Code-smell trim

Six smaller SonarCloud findings cleared:

- 3 redundant `Promise.resolve()` calls in async functions (a
  no-op; bare `return` is sufficient).
- 6 of 7 nested ternaries in the editor's attribute-toggle cluster
  flattened into single ternaries that combine the outer + inner
  predicate via `&&`.

The full 127-finding backlog still has the `void` operator false
positives (intentional discard pattern, won't-fix in code) and the
~90 MINOR style-rule longtail. Both stay open for ongoing
incremental cleanup.

### Issues closed

- #33 — main.ts `@ts-nocheck` removal (full strict pass)
- #56 — SonarCloud new_coverage quality gate (now PASS)
- #57 — SonarCloud code-smells cleanup (cognitive-complexity
  refactors + nested-ternary partial; the MINOR-rule backlog
  continues)

## [1.7.0] — 2026-05-07

Quality + sunshine pass. The headline visible win is for users who
have a lux/illuminance sensor but no dedicated sunshine-duration
sensor — the past chart's sunshine row now fills in automatically
from your sensor's history rather than coming up empty when
Open-Meteo isn't reachable. Everything else is internal: tighter
typing on the card's main file, a SonarCloud-coverage-gate fix,
and a small cleanup of the static-analysis backlog.

### Past sunshine: works for users with just an illuminance sensor

If your weather-station has an illuminance sensor (BH1750, TSL2591,
Ecowitt lux, …) but no dedicated `sensor.sunshine_duration` and no
internet connection from Home Assistant to Open-Meteo, the past
block's sunshine row used to come up empty. v1.7 derives sunshine
duration directly from the lux sensor's history: it walks the
high-resolution recorder samples and counts time intervals where
the measured illuminance is at least 60 % of the theoretical clear-
sky illuminance for that lat/lon and time of day. The threshold is
tunable via `condition_mapping.sunshine_lux_ratio`.

The result is honest about being a proxy — it's an estimate from
the sensor, not a WMO-conformant measurement. If you have
`sensors.sunshine_duration` configured (e.g. via the FL550 / DWD or
an Open-Meteo REST sensor), that still wins.

### Internal cleanup

- **Field-declaration block on the card class.** The card's main
  file (`main.ts`) had ~50 instance fields declared implicitly via
  runtime assignments. They're now explicit class properties with
  category comments — IDE intellisense lists them, refactor and
  rename are safer. The full strict-type pass on this file is
  scheduled for v1.8 (it surfaces the expected ~110 typecheck
  errors that need a focused refactor).
- **SonarCloud coverage gate.** The new-code coverage measure
  was failing the quality gate at 77.9 %. v1.7 adds tests for the
  silent error-handlers in the Open-Meteo source (corrupted
  storage, quota exceeded, double-abort polyfills) so the gate
  flips to passing.
- **Code-smell cleanup, part one.** Six SonarCloud findings cleared
  via mechanical fixes — three redundant `Promise.resolve()` calls
  in async functions, three unnecessary type assertions. The bulk
  of the 132-finding backlog (cognitive-complexity refactors and
  Lit-html nested-ternary idioms) stays open for v1.8.

### Issues closed

- #66 — Sunshine past-tier lux derivation (Method B2 from #6)
- #56 — SonarCloud new-code coverage gate close (partial — see PR
  #69)
- #33 — main.ts `@ts-nocheck` field-declaration pass (partial — full
  strict pass deferred to v1.8 per PR #70)
- #57 — SonarCloud code-smells cleanup (partial — 6 of 132 cleared
  per PR #71)

## [1.6.0] — 2026-05-07

User-facing follow-ups to v1.5 plus dependency hygiene. Two visible
fixes (multi-card cross-talk on the dashboard; today's sunshine value
again reflects what was measured), one new under-the-hood feature
(sunshine forecast now estimates from the weather provider's cloud
coverage when no dedicated sunshine sensor is configured), and a
quiet upgrade to Lit 3 that shaves 400 bytes off the bundle.

### Multi-card dashboards: no more sibling reloads on toggle

If you have **two or more weather-station-cards on the same Lovelace
dashboard**, clicking the daily ↔ today ↔ hourly button on one card
no longer triggers an unnecessary chart redraw on the others. HA's
WebSocket layer fan-outs the entity's forecast to every active
subscriber whenever any one of them resubscribes — the card now
short-circuits when the incoming payload is identical to what it
already shows.

### Today's sunshine column now reflects what's actually measured

The v1.4 substitution that swapped today's column for the Open-Meteo
forecast value (to avoid the "tiny number in the morning" surprise)
created a worse problem in the afternoon: an overcast afternoon would
still display "11 h" because the morning had predicted it,
contradicting what was visible out the window. **Reverted** — today
now reads the recorder running daily-max like every other day, even
when the value is small early on. Empirical truth wins over
predicted truth.

### Sunshine forecast: works on more weather providers

The forecast block now estimates sunshine duration from the weather
provider's `cloud_coverage` field as a fallback when neither a
dedicated sunshine sensor nor the Open-Meteo overlay resolves a
value. Affects users on **Met.no**, **AccuWeather**, **hg1337/dwd**
— their forecast rows previously came up empty without a separate
sunshine setup. The estimate is honest about being a proxy
(Kasten-style empirical formula); users with the FL550/dwd_weather
"Sun duration" sensor or an Open-Meteo REST sensor still get the
WMO-grade source as the preferred path. Tunable via
`condition_mapping.sunshine_cloud_exponent` (default 1.7).

### Library upgrade — Lit 2 → 3

Internal upgrade from the Lit web-components library to its current
major release. No behaviour change visible to users. Shaves ~400
bytes off the bundle thanks to better tree-shaking. The card uses
the property-declarations API (not decorators), so the upgrade was
mechanical — no migration risk visible in the test suite or the
visual baselines.

### README screenshots render correctly on mobile

Long `<picture>` blocks in the hero table previously confused
GitHub's mobile-web sanitizer, which rendered the raw HTML next to
the image. Single-line `<picture>` form now renders consistently on
desktop and mobile.

### Issues closed

- #6 — Daily sunshine-duration row (F3 cloud-coverage Kasten
  fallback; B2 lux derivation deferred to v1.7)
- #24 — `@types/chart.js` deprecated stub removed (chart.js v4
  ships its own types)
- #25 — Lit 2 → 3
- #31 — ESLint warning reduction (270 → 157, -42 %; cognitive-
  complexity refactors deferred to v1.7)
- #36 — SonarCloud baseline triage (closed in v1.5; #6/#42 are the
  remaining surfaces)
- #37 — Sunshine today-value (Option A, measured)
- #43 — README mobile picture-block rendering
- #55 — Multi-card dashboard mode-toggle cross-talk

`#33` (main.ts `@ts-nocheck` removal) deferred to v1.7 — the
strict-type pass surfaced 404 errors that need a focused refactor
of their own.

## [1.5.0] — 2026-05-07

Performance + tech-debt release. The big visible win is the daily ↔ today
↔ hourly toggle: it used to leave the chart blank for 1–3 seconds while
the new mode's data fetched; now toggling between modes you've already
visited is instant. Everything else is internal cleanup that lays the
groundwork for the v1.6 sunshine-duration row.

### Mode toggle: instant on the second click

- The toggle button (top-left of the chart) now caches both daily and
  hourly forecast data after the first time you visit each mode.
  Switching back is a pure UI reflow — typically under 50 ms on
  Pi-class hardware. The first time you visit a mode is still bound
  by the WebSocket round-trip to Home Assistant (1–3 s on quiet
  instances), but every subsequent toggle is perceptually instant.
- Toggling between **hourly** and **today** now skips the data refetch
  entirely — both modes feed off the same hourly buckets and only
  differ in render-time aggregation, so there's no reason to round-trip.

### Documentation

- Every README screenshot now sources from the e2e snapshot pipeline
  and updates from the GHA visual-baseline run, instead of the
  hand-curated PNGs that drifted between releases. The "visual editor"
  hero cell and the styles grid (3 modes × 2 styles) ship fresh from
  every release-CI baseline regen, matching the pattern the two main
  chart screenshots already used.

### Reliability

- Fixed a small Promise/void mismatch in the forecast unsubscribe path
  (`data-source.ts`) — the only Bug-classified finding in the v1.4.2
  SonarCloud baseline. No user-visible behaviour change; locks the
  static-analysis baseline at zero bugs going forward.
- Documented the 7 deliberately-silent catch blocks in the data
  sources and scroll-ux with explicit fail-mode reasons. Each one is
  a known fire-and-forget at a documented degraded-environment path
  (storage quota, idempotent abort, unsupported pointer-capture, …) —
  the annotations make that intent legible to future contributors.

### Quality

- ESLint surface widened: 3 new rules promoted to error (optional-chain,
  prefer-readonly, no-useless-return) plus 2 to warn for visibility
  (prefer-nullish-coalescing, no-nested-ternary). The auto-fixable
  subset of the 149-finding SonarCloud baseline is cleared in this
  release; the remaining ~150 nullish-coalescing cases stay as
  warnings for a per-call-site v1.6 sweep.
- `scroll-ux.ts` branch coverage goes from 53 % to 80 % — 14 new test
  cases covering the drag-vs-tap state machine, click handlers, and
  scroll-rAF coalescing. The v1.4.2 coverage gate no longer relies on
  global aggregation to mask this single under-threshold module.
- `TeardownRegistry` is now wired into the card's lifecycle. The
  eight-block manual cleanup in `disconnectedCallback` collapses to a
  single `drain()`, and the `no-orphans` dependency-cruiser rule no
  longer needs the file in its allow-list.
- SonarCloud's coverage dashboard now matches Vitest's local report
  (~92 % line coverage instead of the previously-misleading ~78 %) —
  the configuration was scanning files that lcov doesn't measure.

### Issues closed

- #10 — Mode-toggle latency
- #30 — README screenshots → e2e snapshots
- #32 — `scroll-ux.ts` branch-coverage gap
- #34 — Wire `teardown-registry.ts` into `main.ts`
- #36 — SonarCloud baseline triage
- #39 — TypeScript modernization sweep (auto-fixable subset)
- #40 — Promise/void unsubscribe Bug
- #41 — Empty catch blocks
- #42 — SonarCloud line-coverage divergence

`#31` (ESLint warning reduction to <50) deferred to v1.6 — the
warning-count target needs the manual nullish-coalescing sweep.

## [1.4.2] — 2026-05-07

Quality-tooling release. Closes the gaps in the build-time quality
gates flagged in #19. Zero user-facing behaviour changes, zero runtime
diff in the bundle.

### Build & CI

- **ESLint re-activated.** ESLint 10 with `typescript-eslint`,
  `eslint-plugin-lit`, and `eslint-plugin-sonarjs` (flat-config in
  `eslint.config.mjs`). The `npm run lint` step in `build.yml` runs
  before typecheck/test/build and fails CI on any error. 7 unused
  imports in `main.ts` removed as part of the first run; 1 useless
  escape in `chart/styles.ts` fixed. 123 warnings remain as
  refactoring backlog (Cognitive-Complexity / function-length in
  `main.ts`, `scroll-ux.ts`, `sunshine-source.ts`) — explicitly
  warn-only so legacy hot-spots don't block CI; promote to error
  once addressed.
- **Coverage gate restored.** `vitest.config.js` listed `.js` paths
  after the v1.2 TypeScript migration; v8 matched zero files and the
  80% threshold gated nothing (`Statements 0/0 (Unknown%)`). Paths
  flipped to `.ts`. Real numbers now: 90.7 % statements, 80.9 %
  branches, 84.2 % functions, 92.8 % lines — all above the 80 % gate.
  `scroll-ux.ts` is the single under-threshold module (53 % branch);
  the global thresholds still pass because they aggregate.
- **Security baseline.** `npm audit --audit-level=high` step in
  `build.yml`; `dependabot.yml` weekly for npm + github-actions;
  CodeQL workflow with `security-extended` queries on PR/push +
  weekly schedule.
- **Architecture rules as code.** `dependency-cruiser` enforces
  no-circular, no-orphans, and module-boundary rules:
  `src/chart/`, `src/editor/`, `src/utils/` may not uplevel-import.
  `npm run depcheck` in `build.yml`.
- **SonarCloud configured but disabled.** `sonar-project.properties`
  + `.github/workflows/sonarcloud.yml` (guarded with `if: false`).
  Activate by signing into sonarcloud.io and adding `SONAR_TOKEN` —
  see `sonar-project.properties` header for the steps.

### Internal cleanup

- 7 unused imports removed from `src/main.ts` (`lightenColor`,
  4 chart-plugin factories, `buildChart`, `property` decorator).
- `chart/styles.ts`: fixed an unnecessary `\'` escape inside a CSS
  comment.
- `vitest.config.js`: added `lcov` to the coverage reporter list so
  SonarCloud (when activated) can read coverage data.

### Issue closed

- #19 — Software-Quality-Tooling

## [1.4.1] — 2026-05-07

Quality release after the v1.4 feature push: performance polish,
test-coverage gap-fill, and small dead-code cleanup. No user-facing
behaviour changes — same modes, same look, smoother on touch devices
and better protected against regressions.

### Performance

- **rAF-coalesced scroll redraws.** Scrolling the hourly chart on a
  touch device fires scroll events at 60+ Hz; the v1.4 redraw on
  every event was visibly janky on Pi-class hardware. Now multiple
  scroll events between two paint frames collapse into a single
  `chart.draw()` via `requestAnimationFrame`, with the latest
  `scrollLeft` always read inside the rAF callback.
- **Per-tick label cache in the daily/hourly tick-labels plugin.**
  Hourly mode at 168 ticks was constructing 168 `Date` objects and
  making 168+ `Intl` calls every frame; with scroll-driven redraws
  that compounded into the dominant per-frame cost. The plugin now
  caches the derived per-column values keyed on `dataIdx` (cache
  invalidates automatically when the orchestrator rebuilds the
  plugin on data refresh), and pre-instantiates
  `Intl.DateTimeFormat` formatters (~3× faster than calling
  `toLocaleTimeString` per tick).

### Tests (+19 unit tests; total 366 → 385)

- `aggregateThreeHour` (3-hour-block aggregator for `today` mode):
  10 new unit tests covering the mean / sum / mode aggregators,
  partial trailing blocks, null-handling, and one-decimal rounding.
- `dailyTickLabelsPlugin` today-branch: left-aligned time + sparse
  date label rendering, bold midnight day-boundary stroke, and the
  scroll-aware `leftmostVisibleIdx` detection (mocks the
  `.forecast-scroll` wrapper's `scrollLeft`).
- `MeasuredDataSource` `today`-mode branching: combination mode
  fetches a 12 h station window, station-only expands to 24 h, and
  the user's `days:` config is correctly ignored when
  `forecast.type` is `today`.
- `nextForecastType` (3-way mode-toggle cycle): cycle integrity and
  unknown-input fallback.

### Code health

- `aggregateThreeHour` extracted from `main.ts` (62 LOC) into
  `forecast-utils.ts` alongside the other forecast aggregators
  (`filterMidnightStaleForecast`, `dropEmptyStationToday`).
- `nextForecastType` extracted from `_onModeToggleClick` so the
  mode-cycle logic is testable in isolation as a pure function.
- Removed dead `backgroundColor` parameter from
  `createDailyTickLabelsPlugin` (leftover from the v1.4 mask-and-
  redraw rewrite).
- Removed dead `language` field from `BuildChartOpts` and the
  orchestrator call site (the chart's tick callback returns empty
  strings, so `draw.ts` never used `language` for label
  formatting).

### Documentation

- README slimmed to a hero-and-overview shape; reference content
  extracted into `docs/CONFIGURATION.md`, `docs/CONDITIONS.md`,
  `docs/SENSORS.md`. New `docs/STYLE-GUIDE.md` codifies file
  conventions; `docs/TROUBLESHOOTING.md` lists common setup pitfalls.
- Hero block now sources adaptive light / dark previews directly
  from the e2e visual baselines so README screenshots stay aligned
  with what the card actually renders, with no manual upkeep.

### Bundle

- `dist/weather-station-card.js`: 348 KB unchanged (cache machinery
  is closure-level and adds < 0.1 KB).

## [1.4.0] — 2026-05-06

UX polish release. Two user-visible features that came up during real
use of v1.0–v1.3.

### Added

- **`forecast.type: 'today'`** — single-day hourly view as a first-class
  third mode alongside `daily` and `hourly`. Renders a rolling 24-hour
  window centred on "now" (12 hours back as station + 12 hours forward
  as forecast in combination mode). No scrolling, all 24 bars fit the
  viewport. Labels thinned to one per 3-hour block for legibility:
  - Tick labels: every 3rd column
  - Condition icons: every 3rd column
  - Wind row: every 3rd column
  - Temperature labels: every 3rd column
  Closes [#17](https://github.com/chriguschneider/weather-station-card/issues/17).
- **Mode-toggle button cycle** is now 3-way:
  `daily → today → hourly → daily`. Icon variants per current mode.
- **Editor radio** in section A (Setup) gains a third option for the
  new mode.
- **`sensors.sunshine_duration`** is now actually consumed in the
  daily station fetch (was previously listed in the editor but not
  wired to the recorder).

### Changed

- **Sunshine for today's station column** (`#16`): previously today's
  station entry showed the recorder's daily-max-so-far — a partial
  running total that grew through the day. Now the station entry's
  sunshine for *today* is overridden by the Open-Meteo forecast value
  (the full-day prediction). Past days still use the recorder value
  when `sensors.sunshine_duration` is configured. Closes
  [#16](https://github.com/chriguschneider/weather-station-card/issues/16).
- `attachSunshine` preserves any pre-existing `entry.sunshine` value
  and only overlays Open-Meteo where the upstream is null. This is
  what makes the today-substitution work without disturbing past-day
  recorder values.
- `forecast.type` union extended to `'daily' | 'hourly' | 'today'`
  across all type contracts.

### Deferred to v1.5

- **Mode-toggle performance (#10)** — the slow daily↔hourly transition
  was originally scoped here but stayed; it deserves its own release
  given the architectural depth of the fix.

### Tests

- 18 systematic visual baselines (3 forecast types × 3 modes × 2
  sunshine variants), generated via the `update-baselines.yml`
  workflow on the GHA runner.
- 4 new unit tests for `attachSunshine`'s upstream-value preservation
  and today-substitution behaviour.
- `mode-toggle-jump-to-now.spec.ts` updated for the 3-way cycle.

## [1.3.1] — 2026-05-06

Tighten the visual-regression toolchain: baselines now live in the
same environment as CI, threshold drops from 5 % to 0.2 %. Closes
[#18](https://github.com/chriguschneider/weather-station-card/issues/18).

### Added

- `.github/workflows/update-baselines.yml` — manually-dispatched
  GitHub Action that regenerates the Playwright snapshots on the
  actual GHA ubuntu-latest runner (the same image regular CI uses)
  and commits the result back. Trigger via Actions → Update E2E
  Baselines → Run workflow, or
  `gh workflow run update-baselines.yml --ref <branch>`.

### Changed

- `playwright.config.ts#maxDiffPixelRatio`: 0.05 → 0.002 (5 % → 0.2 %).
  With baselines and assertion in the same exact environment, the
  remaining drift is sub-pixel anti-aliasing on chart strokes, well
  under the new threshold.
- `tests-e2e/snapshots/render-modes.spec.ts/*.png`: 13 baselines
  replaced with GHA-native renders (committed by the bot via the
  new workflow).

### Notes

WSL-local iteration still works for fast-feedback cycles (no
need to dispatch a workflow for every chart tweak), but
WSL-generated baselines diff ~1–4 % against GHA baselines and must
not be committed. Workflow for deliberate UI changes:
`gh workflow run update-baselines.yml --ref <branch>` →
review the bot's commit → merge.

Bundle byte-identical to v1.3.0.

## [1.3.0] — 2026-05-06

E2E + visual-regression test suite. Playwright drives the bundled
card against a fake-hass mock and compares 7 baseline screenshots
covering every render mode. Closes
[#14](https://github.com/chriguschneider/weather-station-card/issues/14).

### Added

- **Playwright E2E suite** under `tests-e2e/`. 18 specs across four
  files:
  - `render-modes.spec.ts` — 13 visual baselines: 3 modes
    (combination, station-only, forecast-only) × 2 forecast types
    (daily, hourly) × 2 sunshine variants (off, on) plus a 24-hour
    hourly-zoom baseline that exercises the "fits all bars, no
    scroll" code path.
  - `scroll-and-actions.spec.ts` — drag-to-scroll, indicator
    chevrons, tap-suppression-on-drag.
  - `mode-toggle-jump-to-now.spec.ts` — daily↔hourly toggle config
    round-trip, jump-to-now show/hide on scroll.
  - `editor.spec.ts` — `_setMode`, `_sensorPickerChanged`,
    `_actionChanged`, `_valueChanged` (nested keys),
    `_conditionMappingChanged` mutator contracts.
- **Fake-hass mock** (`tests-e2e/pages/hass-mock.js` + types in
  `hass-mock.types.ts`). Routes `recorder/statistics_during_period`,
  `weather/subscribe_forecast`, and logs `callService` events for
  spec-side assertion. Unhandled WS types throw so typos surface
  loudly.
- **`window.fetch` stub for Open-Meteo** in the harness page —
  returns canned, anchor-aligned sunshine data so the show_sunshine
  baselines stay deterministic. The live OpenMeteoSunshineSource
  hits api.open-meteo.com; we don't want network dependency or
  day-of-year drift in the visual contract.
- **`<ha-icon>` polyfill** in the harness — registers a custom
  element that renders icon-name-suffix as a Unicode glyph (☁ for
  weather-cloudy, ↑ for arrow-up, etc.). Without it, every condition
  icon in the chart row and every attribute glyph (humidity %, wind
  direction arrow, sunrise/sunset, …) would render as an empty
  unknown element, leaving baselines silent on regressions in those
  rows.
- **Deterministic fixture generators** (`tests-e2e/fixtures/generate.ts`).
  Sinusoidal sensor signals rounded to 1 decimal, anchored to a
  fixed `2026-05-06` "today" so visual baselines stay stable run to
  run regardless of when CI fires.
- `npm run test:e2e` and `npm run test:e2e:update` scripts.
- CI job: Playwright browsers installed alongside npm deps;
  `playwright-report` + `test-results` uploaded as artifacts on
  failure with 14-day retention.
- `TESTING.md` rewritten to cover both unit and E2E layers, fake-hass
  contract, baseline-update procedure, and debugging tips.

### Changed

- `package.json` adds `@playwright/test` and `http-server` as dev
  dependencies. The harness page is served by `http-server` from the
  repo root via `playwright.config.ts#webServer`.

## [1.2.0] — 2026-05-06

TypeScript migration. Every `src/*.js` file (except `main.ts`,
which stays opted-out via a documented `@ts-nocheck` boundary) is
now `.ts` and strict-checked. Public API surface is unchanged —
no YAML keys move, no locale keys rename, no card-tag rename.
Closes [#13](https://github.com/chriguschneider/weather-station-card/issues/13).

### Added

- `tsconfig.json` with `strict: true`, `noImplicitAny`, ES2020
  target, ES module output, Bundler resolution. `experimentalDecorators`
  on for Lit's `@property` decorator (Lit 2 still uses the legacy
  decorator proposal). `allowJs: true` so the v1.2 migration could
  proceed file-by-file without breaking the build.
- `@rollup/plugin-typescript` first in the rollup pipeline. Output
  contract unchanged — same single `dist/weather-station-card.js`.
- `npm run typecheck` (= `tsc --noEmit`) wired into CI as a build
  gate, alongside lint, test, coverage, and bundle budget.
- Strict types exported from boundary modules so downstream
  contributors get IDE hover types when they import from us:
  - `ConditionId` (HA's standard weather condition ID literal union)
    + typed `weatherIcons` / `weatherIconsDay` / `weatherIconsNight`
    as `Readonly<Record<ConditionId, string>>` — adding a new
    condition fails the compiler at every lookup site.
  - `ForecastEntry` (the per-row contract the chart consumes).
  - `ConditionThresholds` / `ClassifyInputs` / `Period` for the
    classifier.
  - `DailySunshineEntry` / `HourlySunshineEntry` / `SunshineSource`
    interface for the overlay pipeline.
  - `OpenMeteoResponse` / `StorageLike` / `FetchLike` for the
    sunshine fetcher.
  - `StatBucket` / `StatsResponse` / `SensorMap` / `DataSourceConfig`
    / `HassLike` for the recorder data source.
  - `ChartPlugin` / `ChartLike` (subset of chart.js types we
    actually touch) + per-plugin opts interfaces.
  - `EditorContext` / `EditorLike` / `TFn` for editor partials.

### Changed

- All 19 source files (excluding `main.ts`) now use TypeScript and
  type-check under `tsc --strict`.
- `main.ts` carries `@ts-nocheck` with a header explaining why: the
  integration boundary file is ~1.5K LOC of LitElement + HA frontend
  + Chart.js wiring with implicit-any field declarations across
  ~30 instance fields. Strict-typing it would mean adding multiple
  HA frontend type imports we don't otherwise depend on, for no
  v1.2 deliverable. Tracked as future follow-up; the boundary
  modules main.ts pulls in ARE all strict-typed.
- `package.json#module` and `rollup.config.mjs#input` point at
  `src/main.ts`.
- `weather-station-card-editor.ts` adds explicit field declarations
  for `hass` and `_config` so they're TS-visible alongside Lit's
  `static get properties()` runtime registration.
- Mode-radio in `editor/render-setup.ts` uses `as const` so the
  selected value flows through to `_setMode`'s union-typed
  parameter without a cast.

### Removed

- Nothing — public API is unchanged.

## [1.1.0] — 2026-05-06

Architecture refactor — `main.js` 2,178 → 1,471 LOC (−32 %), editor
914 → 313 LOC (−66 %). No public-API changes; YAML / locale keys /
card tag identical. Closes
[#12](https://github.com/chriguschneider/weather-station-card/issues/12).

### Changed

- **`main.js` split into focused modules** under the same source
  tree:
  - `src/scroll-ux.js` — drag-to-scroll, indicator chevrons,
    jump-to-now, scroll-date overlays. `setupScrollUx(card)` returns
    a teardown.
  - `src/action-handler.js` — pointer-based tap / hold / double-tap
    detection on ha-card + the `runAction(card, actionConfig)`
    dispatcher (more-info, navigate, url, toggle, perform-action,
    assist, fire-dom-event).
  - `src/chart/orchestrator.js` — `drawChartUnsafe(card, args)`,
    the dataset + plugin assembly that used to live in main.js's
    largest method (~290 LOC).
  - `src/teardown-registry.js` — primitive used by extracted modules
    so disconnectedCallback drains them in lockstep.
  - `src/utils/safe-query.js`, `src/utils/numeric.js` — small
    helpers (`safeQuery`, `parseNumericSafe`) replacing 6+ inline
    null-checks each across main.js.
- **Editor `weather-station-card-editor.js` split** into 5 render
  partials under `src/editor/`: `render-setup.js`, `render-sensors.js`,
  `render-layout.js`, `render-style.js`, `render-units.js`,
  `render-advanced.js`. The editor stays as the orchestrator (mutator
  methods + thin render that calls each partial).
- `vitest.config.js`: coverage scope expanded to include every
  extracted module. Editor file deliberately not in scope (render
  paths covered by Playwright E2E in v1.3 — issue #14).

### Internal

- 361 vitest tests pass (+33 since v1.0.2 — see T1 below). Coverage
  ≥ 80 % on statements / branches / functions / lines.
- T1: 33 unit tests for editor mutator methods (`_valueChanged`
  with dotted-key writes, `_sensorPickerChanged` add / replace /
  delete, `_actionChanged`, `_conditionMappingChanged`, `_setMode`,
  `_mode` getter). jsdom-environment per-file directive keeps the
  rest of the suite on node for speed.
- Plus per-module unit tests in v1.1: `tests/utils.test.js` (16),
  `tests/teardown-registry.test.js` (9), `tests/scroll-ux.test.js`
  (17), `tests/action-handler.test.js` (26).
- `ARCHITECTURE.md` rewritten with the post-refactor module map,
  Mermaid dependency graph, lifecycle diagram, and updated testing
  scope.

### Migration

Public API is unchanged — existing YAML configs work unchanged. The
refactor is purely internal: file paths inside `src/` differ, but
the card behaves bit-identically to v1.0.2.

## [1.0.2] — 2026-05-06

### Fixed

- **Midnight-transition phantom column.** Just past local midnight in
  combination mode (especially with HA's Open-Meteo integration), the
  chart sometimes rendered an extra unlabelled column between the
  station-today and forecast-today columns. Two HA-side mismatches
  combined to produce it:
  1. The forecast array still carried yesterday's daily entry. HA
     weather integrations refresh on their own cadence (Open-Meteo
     a few times per day), so for some minutes after midnight the
     array can lead with a date that is now yesterday.
  2. The station array's "today" daily bucket was empty —
     temperature / templow / precipitation all null because the
     recorder hadn't aggregated anything for the new day yet. The
     Open-Meteo sunshine overlay then filled `sunshine` from today's
     forecast, producing a hybrid entry: sunshine bar visible, no
     temperature line, no date label.

  Both filters now run in `_refreshForecasts`:
  `filterMidnightStaleForecast` drops forecast entries dated before
  today, and `dropEmptyStationToday` drops the trailing station entry
  if it's today AND has no recorded data yet.

  Test coverage: +15 unit tests in `tests/forecast-utils.test.js`
  for the new helpers (entry filtering, idempotency on clean inputs,
  defensive paths for malformed datetime / non-array inputs, the
  offline-historical-day case where a null-fields entry must NOT be
  dropped).

## [1.0.1] — 2026-05-06

### Fixed

- **Low-temperature line restored in daily mode.** Since v0.8 the
  `hourlyTempSeries` helper used an "all-or-nothing" rule: if **any**
  past day had a missing `min` reading from the recorder (sensor
  offline, fresh sensor with no history yet, etc.), the entire
  low-temp dataset was returned as `null` and the chart hid the
  second blue line in combination + station modes. Now individual
  missing days render as gaps in the line; the dataset is hidden
  only when **no** entry carries `templow` (pure hourly). Forecast-
  only mode was unaffected because weather integrations populate
  `templow` for every day.

  Test surface: existing `hourlyTempSeries` tests updated, +1 new
  test ("returns tempLow null only when EVERY entry lacks templow").

## [1.0.0] — 2026-05-06

A user-visible quality release: faster card, real test coverage gate,
polished docs, accessibility-pass. Architectural refactors
(main.js / editor split, TypeScript migration, E2E tests) are
deliberately deferred to v1.1+ so this release ships cleanly.

### Changed

- **Bundle size dropped from 797 KB → 355 KB (−55 %).** Production
  builds now run through `@rollup/plugin-terser` (passes:2,
  classes preserved). Halves bytes-on-the-wire even after HA's
  gzip layer; mobile dashboards and HACS downloads benefit.
- **Live "current condition" memoized.** `set hass` no longer
  re-runs `classifyDay` and `clearSkyLuxAt` when the relevant
  inputs are unchanged at minute precision. Across the 2–5 hass
  ticks per second that arrive when many entities update, this
  saves ~1–2 ms/frame.
- **Hourly clearsky-lux factory** caches lat-trig (`sinφ`, `cosφ`)
  once and per-day declination (`sinδ`, `cosδ`) per dayOfYear.
  Repeated calls within the same day reuse all but
  `cos(hourAngle)`. For a 7-day hourly fetch (168 rows) that's
  840 → 168 trig ops.

### Added

- **Coverage gate ≥ 80 %** on statements, branches, functions, lines.
  Configured in `vitest.config.js`, enforced by a new CI step. Scope
  is the data / classifier / format / chart-plugin layer (7 modules);
  Lit / editor / Chart.js orchestration covered later by Playwright
  E2E (v1.3, issue #14).
- **Bundle budget** of 800 KB enforced in CI as a regression guard.
- 7 new tests for `createPrecipLabelPlugin` (was 64 % branch coverage,
  now 88 %): bail-out on missing dataset meta, null/zero skip,
  large-value rounding, fallback paths, colour-resolution priority.

### Fixed

- **Chart animations** retuned for the post-v0.9 dataset density
  (split-column precip + sunshine bars). Earlier easings, calibrated
  for the v0.7-era simpler layout, looked unsynchronized when many
  bars animated at once. (Phase H — see PR for specifics.)
- **Accessibility**: aria-labels on all card-internal control buttons
  (mode-toggle, jump-to-now, scroll-indicators); focus management on
  mode-toggle; keyboard activation (Enter/Space) on every interactive
  control. Lighthouse / axe pass on default + dark themes.

### Documentation

- New **`MIGRATION.md`** — single source of truth for every removed
  YAML key (v0.8.3 `precipitation_type` / `show_probability`,
  v0.8.4 `autoscroll`) with before / after snippets, plus an
  upstream-`weather-chart-card` migration section.
- `ARCHITECTURE.md` refreshed: 236 tests across 7 modules (was "61
  tests on 3 modules"); hourly forecast moved from "future
  directions" to current capability; testing-scope section lists
  every covered module and notes which paths v1.3 will cover.
- `TESTING.md` rewritten: full module list, new "Coverage gate"
  section documenting the 80 % threshold.
- `README.md`: coverage badge added; `sensors.sunshine_duration`
  row added to the sensor reference table (was missing from the
  v0.9 doc pass).

### Internal

- `var` → `const`/`let` cleanup in `_drawChartUnsafe` and
  `getWindDirIcon`. No behaviour change.
- 243 vitest tests pass (+7 since v0.9).

### Out of scope (tracked for later)

- v1.1 ([#12](https://github.com/chriguschneider/weather-station-card/issues/12)) — main.js + editor split (architecture refactor)
- v1.2 ([#13](https://github.com/chriguschneider/weather-station-card/issues/13)) — TypeScript migration
- v1.3 ([#14](https://github.com/chriguschneider/weather-station-card/issues/14)) — Playwright E2E + visual regression
- v1.4 ([#15](https://github.com/chriguschneider/weather-station-card/issues/15)) — Mode-toggle perf (closes #10)

## [0.9.0] — 2026-05-05

### Added

- **Sunshine-duration row in the chart** (issue #6). Off by default;
  enable with `forecast.show_sunshine: true`. The chart splits each
  column in half — precipitation keeps the left half, a new yellow
  sunshine bar fills the right half. **Zero setup beyond the toggle**:
  the card fetches `daily=sunshine_duration` (and `hourly=…` in hourly
  chart mode) directly from Open-Meteo using the Home Assistant
  `latitude`/`longitude`, refreshes hourly, and caches in
  `localStorage` so reloads don't repeat the round-trip. Past + forecast
  data covered in one call via `past_days` + `forecast_days`.
  - **Daily mode**: per-column `Xh` box at the top with the day's total
    in hours (matched against the daily array by local date).
  - **Hourly mode**: bar-only — the height of each bar is the fraction
    of that hour spent in sun (matched against the hourly array by
    local YYYY-MM-DDTHH:00). Empty bar = night or fully overcast.
  - `forecast.sunshine_color` — bar colour, default Material amber
    `rgba(255, 193, 7, 1.0)`.

  Users who'd rather wire up their own data path will find a brief
  decision history in
  [issue #6](https://github.com/chriguschneider/weather-station-card/issues/6) —
  the v0.9 implementation deliberately drops user-configurable sensor
  slots in favour of "one toggle, no YAML".
- **Editor availability hint**: when sunshine is on, the editor reads
  the cached Open-Meteo response from `localStorage` and shows
  "Sunshine available: N past, M forecast days" under the
  `forecast_days` field. If the configured forecast_days exceeds the
  available data, a warning makes clear that the trailing columns will
  render as empty bars (e.g. when Open-Meteo's model only delivers
  5 days but the card is configured for 7).

### Changed

- **No behaviour change** for users who don't enable the new row. The
  chart layout is byte-identical to v0.8.4 when `forecast.show_sunshine`
  is unset / `false`.

## [0.8.4] — 2026-05-05

### Changed

- **Hourly classifier thresholds rescaled.** When `forecast.type:
  hourly`, station hours and the live "current condition" snapshot
  now classify with precipitation thresholds calibrated for 1-hour
  totals instead of 24-hour totals: `rainy ≥ 0.1 mm/h` (was 0.5),
  `pouring ≥ 4 mm/h` (was 10), `exceptional ≥ 30 mm/h` (was 50).
  Wind / gust / fog / cloud thresholds are unchanged (those are
  instantaneous values, not totals). Daily classification is
  unaffected. `condition_mapping` overrides apply on top of the
  per-period defaults — same key names, no editor change. Closes
  [#7](https://github.com/chriguschneider/weather-station-card/issues/7).
- `classifyDay(day, overrides, period)` API: third parameter accepts
  `'day'` (default) or `'hour'`. Existing callers stay daily.

### Removed

- **`autoscroll` config key** — was upstream-vestigial and never
  actually scrolled. The timer fired every hour but only triggered a
  redraw, with no horizontal pan logic anywhere. v0.8's hourly
  viewport scrolling and the v0.8.2 jump-to-now button cover the
  intent better. The key has been hidden from the editor since v0.6.
  Now removed from `setConfig` defaults, the `autoscroll()` /
  `cancelAutoscroll()` methods, the cleanup in `disconnectedCallback`,
  the `updated()` lifecycle re-trigger, the `computeForecastData`
  cutoff filter, the locale strings (DE + EN), and the README config
  table / known-limitations. Closes
  [#3](https://github.com/chriguschneider/weather-station-card/issues/3).

  YAML configs that still set `autoscroll: true` continue to load —
  unknown keys are ignored. Drop it from your YAML for cleanliness.

### Internal

- 138 vitest tests pass (+10 hourly-classifier tests covering the
  rescaled precipitation thresholds, the cloud/wind no-change path,
  user-override layering, and backwards-compatibility of the default
  period parameter).

## [0.8.3] — 2026-05-05

### Removed

- **`forecast.precipitation_type` and `forecast.show_probability`** —
  both upstream-vestigial since this card forked: they read
  `precipitation_probability` directly from `weather/get_forecasts`,
  which most integrations relevant in DACH (Open-Meteo daily,
  MeteoSchweiz, Met.no on certain entities) don't populate, so the
  toggles silently produced no visible effect even with a forecast-
  only setup. The fork's `MeasuredDataSource` never had a probability
  field at all, so probability mode + station data was always inert.
  Both keys have been hidden from the editor since v0.6 and the
  feature is now removed entirely from the renderer, the data shape
  (`precipitation_probability` no longer flows through), the locale
  strings (DE + EN), and the README config table. Closes
  [#4](https://github.com/chriguschneider/weather-station-card/issues/4).

  YAML configs that still set `precipitation_type` or
  `show_probability` will continue to load — extra keys are ignored —
  they just do nothing. Drop them from your YAML for cleanliness.

## [0.8.2] — 2026-05-05

### Added

- **Mode-toggle button** overlaid on the chart at the precipitation-
  baseline level (left edge of the forecast block): one click
  switches between daily and hourly resolution. Goes through the
  same `setConfig` path the editor uses, so station and forecast
  data sources rebuild on the new period immediately. Visible
  whenever any chart block renders (station-only, forecast-only, or
  combination) — `forecast.type` drives both `MeasuredDataSource`
  (`period: hour|day`) and `ForecastDataSource` (`forecast_type`).
  The change does **not** persist to the saved YAML — refresh
  resets to whatever the editor configured.
- **Jump-to-now button** centred at the precipitation-baseline,
  visible only when the user has scrolled the viewport away from
  the canonical "now" position by more than ~10 % of one viewport
  width. Click smooth-scrolls back to the same position the card
  lands on at first paint (combination → boundary centred;
  station-only → right edge; forecast-only → left edge).

### Fixed

- Touch-swipe scrolling no longer fires `tap_action`. The drag
  detection in `_setupScrollUx` previously bailed out on non-mouse
  pointer types, so a horizontal touch-swipe to scroll the chart
  on mobile would also fire the configured tap action on pointerup.
  Movement detection now runs for all pointer types — actual
  `scrollLeft` manipulation and pointer capture stay mouse-only so
  native touch overflow scrolling continues to work. `pointercancel`
  (browser claiming the gesture for native scroll) is also treated
  as a drag. Closes
  [#9](https://github.com/chriguschneider/weather-station-card/issues/9).
- Mouse drag-to-scroll on desktop no longer fires `tap_action` after
  the gesture ends. The `_dragMoved` flag was reset via a Promise
  microtask, but V8/Blink flushes microtasks between event-listener
  invocations in the same dispatch — so the wrapper's `pointerup`
  scheduled the reset, the microtask fired before the ha-card's
  `pointerup` listener bubbled up, and the action handler saw
  `_dragMoved = false`. Switched to `setTimeout(0)` (a macrotask)
  so the reset deterministically happens after the entire event
  dispatch completes.
- Card-internal control buttons (mode-toggle, jump-to-now, scroll
  indicators) no longer trigger the card-level `tap_action` /
  `hold_action` / `double_tap_action`. The action handler now
  ignores pointer events that originate inside any
  `button` / `ha-icon-button` / `[role="button"]` descendant —
  fixes the latent issue where clicking a scroll-indicator chevron
  would also fire `tap_action` after the 250 ms double-tap window.

### Internal

- Plugin unit tests for `createSeparatorPlugin` (daily + hourly
  modes, bail-out branches) and `createDailyTickLabelsPlugin`
  (hourly early-return, doubled-today seam handling, `show_date`
  toggle). Closes the README "Plugin tests" optional-improvement
  note.
- 128 vitest tests pass (+12 plugin tests since v0.8.1).

## [0.8.1] — 2026-05-05

### Changed

- CI: bumped `actions/checkout` and `actions/setup-node` to `v6`,
  `softprops/action-gh-release` to `v3`, and the runner Node version
  from `20` to `22` LTS — ahead of the GitHub Actions Node 20
  deprecation (Node 24 default 2026-06-02, Node 20 removal
  2026-09-16). Closes
  [#8](https://github.com/chriguschneider/weather-station-card/issues/8).
- `_maybeApplyInitialScroll` no longer polls `requestAnimationFrame`
  for up to 30 frames waiting for layout to settle. It tries once
  synchronously after Lit's `updateComplete`; if the wrapper hasn't
  overflowed yet, a `ResizeObserver` on `.forecast-content` fires
  exactly when Chart.js finishes sizing the canvas. Hard 1 s cap
  prevents observer leaks if the wrapper never overflows. Cheaper
  on slow devices and avoids the corner case where the 30-frame
  retry budget ran out before Chart.js settled.

### Docs

- README "Known limitations" links the hourly-classifier-thresholds
  row to [#7](https://github.com/chriguschneider/weather-station-card/issues/7)
  instead of the bare "v0.9 follow-up" placeholder.

## [0.8.0] — 2026-05-05

### Added

- **Hourly resolution for both blocks.** `forecast.type: 'hourly'` is
  reactivated as a first-class mode: `MeasuredDataSource` reads sensor
  history with `period: 'hour'` (mean per slot, single temperature
  line), and `ForecastDataSource` subscribes with `forecast_type:
  'hourly'`. Combination mode at hourly renders past hours + future
  hours joined at a single "now" line — no doubled-today column.
  Closes [#2](https://github.com/chriguschneider/weather-station-card/issues/2).
- **Viewport scrolling.** `forecast.number_of_forecasts` now controls
  how many bars are visible at once (was vestigial, see
  [#5](https://github.com/chriguschneider/weather-station-card/issues/5)).
  When fewer bars are visible than loaded, the chart row + conditions
  row + wind row scroll horizontally in lockstep inside an
  `overflow-x: auto` wrapper. Initial scroll position is "now":
  centred at the station/forecast boundary in combination mode,
  right edge in station-only, left edge in forecast-only.
- Editor: `forecast.type` radio (Daily / Hourly) and
  `forecast.number_of_forecasts` numeric field, both in Setup. Locale
  strings (DE + EN) for the new fields.
- `bucketPrecipitation` helper in `src/data-source.js` (renamed from
  `dailyPrecipitation`, alias kept for backwards compatibility) — the
  three-state-class fan-out (`change` / `sum` / `max`-diff) is
  bucket-size-agnostic, so the same logic powers daily and hourly
  precipitation extraction.
- New pure helpers in `src/format-utils.js` and `src/forecast-utils.js`:
  `computeInitialScrollLeft`, `pickHourlyTickIndices`,
  `hourlyTempSeries`, `normalizeForecastMode`. All fully covered by
  vitest.

### Changed

- **`forecast.number_of_forecasts` semantic flipped from "crop" to
  "viewport"** (issue #5 fix). The old behaviour cropped
  `this.forecasts` from the left and broke combination mode; the
  cropping path is removed. Existing daily configs with the field at
  `0` (default) are bit-identical to v0.7. Configs that explicitly
  set a positive value will now scroll instead of crop.
- `computeBlockSeparatorPositions` (`src/format-utils.js`) accepts a
  `mode` parameter. At hourly combination it returns a single boundary
  line between station and forecast; daily combination keeps the
  doubled-today frame.
- Hourly forecast wind cells render defensively: when the upstream
  weather integration omits `wind_speed` and/or `wind_bearing` for
  hourly entries (HA's Open-Meteo integration currently does this),
  the cell stays empty rather than rendering a default-direction
  arrow with an orphan `km/h` unit.
- README: new "Daily vs. hourly resolution" section under Three Modes;
  Known Limitations table updated to drop the v0.8-fixed entries
  (#2 / #5) and add notes about the upstream Open-Meteo hourly-wind
  gap and the hourly-classifier-threshold caveat.

### Internal

- Phase-A revert layer dropped the v1-plan tick-decimation code and
  associated `<ha-alert>` editor block — viewport scrolling makes
  decimation unnecessary.
- `MeasuredDataSource` invalidation table now includes `forecast.type`
  in the station rebuild keys (toggling daily↔hourly rebuilds the
  station data source, not just the forecast one).
- 111 vitest tests pass; +21 net new since v0.7 (hourly-tick
  helpers, hourly tempSeries, normalize, bucketPrecipitation hourly
  cases, MeasuredDataSource hourly path, separator hourly mode,
  computeInitialScrollLeft).

## [0.7.0] — 2026-05-05

### Added

- **Whole-card click actions.** New `tap_action`, `hold_action`, and
  `double_tap_action` config keys, edited via HA's standard `ui_action`
  selector (same picker Bubble / Mushroom / built-in cards use). Supported
  actions: `more-info`, `navigate`, `url`, `toggle`, `perform-action`,
  `assist`, `fire-dom-event`, `none`. The action runs on the whole card —
  a click anywhere on the chart, main panel, or attribute row triggers the
  same configured action.
- Editor: new "Actions" subsection in Setup with three pickers (tap / hold
  / double-tap).

### Changed

- **Default click behaviour: `none` (read-only).** Previously, clicking
  the forecast-conditions row opened more-info on the temperature sensor.
  That implicit handler is replaced by the configurable `tap_action`,
  defaulting to `none`. Configs that want the old behaviour back should
  set `tap_action: { action: more-info, entity: sensor.<your_temp> }` —
  or any other action they prefer. The cursor only switches to a hand
  when at least one action is wired, so the default card looks read-only.

### Internal

- Pointer-based tap / hold / double-tap detection (500 ms hold threshold,
  250 ms double-tap window) bound to the `<ha-card>` root, rebound on
  every render so a re-mounted card never silently loses its handlers.
- Inline `_runAction` helper avoids depending on HA's internal
  `handle-action` module path (renamed across HA versions).

## [0.6.0] — 2026-05-05

### Changed

- **Default chart style is now `style2` ("without boxes")** — temperature
  labels render as plain text beside the lines instead of inside bordered
  boxes. The previous `style1` ("with boxes") remains available as an
  opt-in. Existing configs that pin `forecast.style: style1` are
  unaffected.
- Visual editor restructured into 6 sections (A. Setup / B. Sensors /
  C. Layout / D. Style & Colours / E. Units / F. Advanced). Section C uses
  `show_main` and `show_attributes` as disclosure masters — sub-toggles
  appear only when the master is on.
- Mode selection (Station only / Forecast only / Combination) is now a
  single radio in Setup, derived from `show_station` / `show_forecast`
  (YAML schema unchanged).
- README Configuration section uses collapsible `<details>` blocks
  matching the editor's A–F order.
- main.js shrunk by ~23 % after extracting `src/chart/draw.js` (Chart.js
  options builder), `src/chart/plugins.js` (separator / dailyTickLabels
  / precipLabel as factory functions), and `src/chart/styles.js` (CSS
  template). Plugins now declare their dependencies via parameters
  instead of closing over component state.

### Added

- `ARCHITECTURE.md` — module map, data-flow diagram, lifecycle
  invariants, Chart.js plugin contract, build pipeline, testing scope.
- Visual editor: `condition_mapping` override block under Advanced — 13
  threshold fields with units as suffixes and defaults as placeholders.
  Empty fields are not written to the YAML.
- README: precipitation-sensor setup guide (state_class detection plus
  utility_meter and integration sensor templates), live-condition
  rate-unit explanation, Troubleshooting section mapping each error
  banner to its cause.
- `CONTRIBUTING.md` opening pointer to ARCHITECTURE.md.

### Fixed

- TempAxis NaN bounds when temperature arrays are empty (sensor offline
  for the full window).
- `ForecastDataSource.unsubscribe()` is now finally-safe — the slot is
  cleared before awaiting so a subsequent unsubscribe never re-throws on
  a rejected promise.
- Chart-render errors carry a phase tag (`compute` / `init` / `draw`)
  in the banner instead of a generic message.
- Subscribe-callback bodies in `set hass` wrapped in `try / catch` so a
  bad render path can't detach HA's WebSocket listener.

### Internal

- Dropped unused `relative-time` dependency.
- `lightenColor` handles hsl/hsla in addition to rgba/hex.
- `_invalidateStaleSources` replaces seven hand-rolled change-detection
  branches with two declarative key tables.
- `disconnectedCallback` uses the new `_teardownStation` /
  `_teardownForecast` helpers shared with the invalidation path.
- Editor: chart-style, precipitation-type, forecast-type, and icon-style
  selectors converted from `ha-select` (whose `@change` handler turned
  out to silently drop selections) to `ha-radio` pairs that hard-code
  the new value in the change handler — proven to work and easier to
  reason about.

### Removed (from editor only — YAML keys still honoured)

- `forecast.type` radio (Daily / Hourly) is no longer surfaced in the
  visual editor. Hourly was accepted by the data layer but the chart
  rendered as daily-only. Tracked as
  [#2](https://github.com/chriguschneider/weather-station-card/issues/2).
- `autoscroll` switch is no longer surfaced in the visual editor.
  The hourly timer was firing but only triggered a redraw — no actual
  scroll. Tracked as
  [#3](https://github.com/chriguschneider/weather-station-card/issues/3).
- `forecast.precipitation_type` radio (Rainfall / Probability) and the
  `forecast.show_probability` switch are no longer surfaced.
  MeasuredDataSource emits `precipitation_probability: null` for every
  station entry, so probability mode produced empty bars for past
  columns and the overlay had nothing to display. Tracked as
  [#4](https://github.com/chriguschneider/weather-station-card/issues/4).
- `forecast.number_of_forecasts` textfield is no longer surfaced.
  Vestigial from upstream — `days` and `forecast_days` already control
  column counts, and a positive value cropped the merged array from the
  left, breaking combination mode (lost today + forecast block).
  Tracked as
  [#5](https://github.com/chriguschneider/weather-station-card/issues/5).
- All YAML keys still parse and flow through unchanged — only the
  editor stops advertising them as working features.

## [0.5.0] — 2026-05

### Added

- **Optional forecast block** alongside the existing station-history block,
  driven by a `weather.*` entity via `weather/subscribe_forecast`. New config
  keys: `weather_entity`, `forecast_days`, `show_forecast`, `show_station`.
  Both blocks can be toggled independently. Today appears as a doubled
  column ("Soll vs. Ist"): the station's measured aggregate on the left,
  the forecast on the right, framed by two vertical separators with no
  line in between.
- **Forecast lines dashed** (6 / 4 px) so predicted values don't visually
  flow into measured values; the line segment between station-today and
  forecast-today is suppressed entirely, markers stay visible.
- **Forecast precipitation bars at ~45 % opacity**, station bars stay full
  colour, so "less certain" data reads as such at a glance.
- **Centered today label** above the doubled-today column when both blocks
  are active — the weekday (and date row, when enabled) renders once
  centred between the two today columns instead of twice.
- **`forecast.show_date` toggle** for the chart's date row. When off, the
  X-axis reclaims the freed line of tick height.
- **`ForecastDataSource`** in `data-source.js` mirroring the
  `MeasuredDataSource` lifecycle (`subscribe(cb) → unsubscribe`, event
  shape `{forecast, error?}`). The render layer stays source-agnostic.
- **Custom precipitation-label renderer** so the unit ("mm" / "in") draws
  at ~50 % of the value's font size next to the number, instead of full
  size — fits narrow cards without dropping the unit.
- **Vitest test suite** covering `condition-classifier` (full decision
  tree), `data-source` (`dailyPrecipitation` state-class paths,
  `_buildForecast` shape, `ForecastDataSource` subscribe/error/dispose),
  and `format-utils`. 58 tests, ~80 % statement coverage on those
  modules. CI runs `npm test` between lint and build; failure blocks
  the release pipeline. See `TESTING.md`.

### Changed

- Outer chart borders (TempAxis left, PrecipAxis right) are no longer
  drawn. Today's framing is carried by the block-separator plugin alone.
- `forecast.number_of_forecasts: 0` now expands to the merged
  station + forecast column count instead of an auto-fit width
  calculation. Necessary so the doubled-today layout doesn't get cropped.
- Card-bottom precipitation labels are centred on the precip-axis
  baseline (zero line) rather than the variable bar tops, matching the
  pre-MVP look across both station and forecast columns.
- Editor: new "Forecast block" section under "Card" with weather-entity
  picker, `forecast_days` field, `show_station` / `show_forecast`
  toggles, and the `forecast.show_date` switch.

### Fixed

- **Race condition** between the asynchronous statistics fetch and the
  immediate forecast subscription: the chart used to render station-only
  whenever forecast events arrived first and a `ResizeObserver` tick set
  `forecastItems` before the merge.
- **ResizeObserver storm** when a Sections-grid card was resized: the
  observer now coalesces ticks via `requestAnimationFrame`, so layout
  changes can't trigger dozens of synchronous `Chart.destroy + new Chart`
  cycles within one frame.
- **Null `shadowRoot` crash** when a data callback fires before the
  first Lit render. `measureCard` now bails out cleanly; the next
  `firstUpdated` tick redraws.
- **Card vanishing on config edits** (e.g. toggling `forecast.round_temp`):
  the legacy `updated()` lifecycle used to overwrite `this.forecasts`
  with station-only and re-throw on stale Chart.js state. The hook now
  reads the changed-key set, tears down only the affected data sources,
  and routes through `_refreshForecasts` inside a `try/catch`. `drawChart`
  is wrapped end-to-end so a Chart.js failure can no longer drop the
  whole card from the render tree.

### Internal

- Extracted `lightenColor` and `computeBlockSeparatorPositions` to
  `src/format-utils.js` (pure module, unit-tested).
- Extracted `dailyPrecipitation` from `MeasuredDataSource` as a free
  exported function (no `this` dependency).

## [0.4.0] — 2025-05

### Breaking changes

The following config keys have been removed because the underlying data was
never available in a sensor-history-driven card. They are silently ignored
when set:

- `show_feels_like` — apparent-temperature attribute is not synthesized
- `show_description` — narrative weather description is not available
- `show_visibility` — no visibility sensor is mapped
- `show_last_changed` — `weather.last_changed` was never set on the synthesized
  entity; the value rendered as empty regardless

If you set any of these to `true`, simply remove them from the YAML.

### Added

- Render-time error banner. Persistent statistics-fetch failures and configured
  sensor entities reporting `unavailable` / `unknown` are now surfaced in the
  card itself instead of only in the browser console.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `info.md`.
- GitHub Actions build workflow that lints, builds, verifies the committed
  bundle matches source, and uploads `dist/weather-station-card.js` as a
  release asset on tag push. Version-tag alignment is enforced.

### Changed

- Full README rewrite: hero + screenshots + HACS install + manual install +
  minimal config + complete configuration reference + condition-determination
  reference. The previous "Not yet ready for end users" placeholder is gone.
- Expanded `package.json` metadata: HTTPS repository URL, `homepage`, `bugs`,
  `main`, additional keywords for HACS discoverability.

### Fixed

- ESLint config (`.eslintrc.json`) raised to ES2022 so optional chaining and
  nullish coalescing parse correctly. Until v0.3.1 the lint pipeline silently
  errored on `??`, masking real findings.
- `npm run lint` script now uses `eslint src` instead of a quoted glob, so it
  actually lints files on Windows shells.
- `setInterval` clock leak in `renderMain`. The 1 Hz clock interval was
  recreated on every render without cleanup. It is now stored on the instance
  and cleared before re-creation and on `disconnectedCallback`.
- `autoscroll()` typo: a misnamed inner call (`drawChartOncePerHour`) would
  throw `ReferenceError` if the user enabled `autoscroll: true`.
- `calculateBeaufortScale` no longer throws on missing `wind_speed_unit`; it
  falls back to m/s.
- `_poll` in `data-source.js` now surfaces persistent fetch failures (after
  three consecutive failures) instead of silently leaving the card with stale
  data.

## [0.3.1] — 2025-05

### Added

- Live current-condition rendering in the main panel. The synthesized weather
  entity now has a `state` field derived from a fresh classification of
  current sensor states.
- `clearSkyLuxAt(lat, lon, date)` — instantaneous solar reference for live
  cloud-cover ratios (replaces the noon-only model used for daily rows).
- README "Current (now) condition" section.

### Notes

- Live-condition precipitation only contributes when the sensor's
  `unit_of_measurement` is a rate (`mm/h`, `mm/hr`, `mm/hour`). With a
  cumulative counter the live path falls through to cloud / wind / fog rules.

## [0.3.0] — 2025-05

### Breaking changes

- Default for `condition_mapping.windy_threshold_ms` changed from 14 to 10.8
  m/s to align with Beaufort 6 ("strong breeze", WMO No. 306).

### Added

- Sensor-driven daily condition classifier (`src/condition-classifier.js`)
  with WMO / NOAA / NWS / AMS / METAR / IES citations on every threshold.
- `clearSkyNoonLux(lat, day_of_year)` — theoretical clear-sky illuminance at
  solar noon for the cloud-cover ratio.
- New `condition_mapping` override keys: `pouring_threshold_mm`,
  `exceptional_gust_ms`, `exceptional_precip_mm`, `snow_max_c`,
  `snow_rain_max_c`, `fog_humidity_pct`, `fog_dewpoint_spread_c`,
  `fog_wind_max_ms`, `windy_mean_threshold_ms`, `sunny_cloud_ratio`,
  `partly_cloud_ratio`.
- README "How daily conditions are determined" section with the full decision
  tree and source list.

### Changed

- Daily icon now reflects every available statistic (temperature min/max,
  humidity, illuminance max, precipitation total, wind mean, gust max, dew
  point) instead of only `(precipitation, lux, gust)`.
- Worst-of-day priority: `exceptional` → `snowy` / `snowy-rainy` / `pouring` /
  `rainy` → `fog` → `windy` / `windy-variant` → `sunny` / `partlycloudy` /
  `cloudy`.

### Notes

- `lightning`, `lightning-rainy`, and `hail` are intentionally never emitted —
  reliable detection requires dedicated hardware (AS3935, hail-pad).

## [0.2.0] — 2025-05

### Added

- "Today" highlighting in the past-7-day chart: bold weekday and high/low
  temperatures for today's column, lighter date subtitle.
- DE + EN editor translations; remaining 21 languages fall back to English.

### Changed

- Visual editor: device-class-aware sensor pickers, flat layout (tabs
  removed), unified section headings.

## [0.1.x] — 2025-04 / 2025-05

Initial fork of [`mlamberts78/weather-chart-card`](https://github.com/mlamberts78/weather-chart-card)
v1.0.1. Replaced the `weather.*`-entity data path with a `recorder/statistics_during_period`
driver. Iterative refinement of unit handling, sensor pickers, today-column
emphasis, and date / weekday rendering.
