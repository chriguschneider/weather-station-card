# 0012: Chart library — uPlot replaces Chart.js

**Status:** Accepted

**Date:** 2026-05-17

## Context

The card has used Chart.js since v0.x. After three rounds of perf work
(culminating in PR #157's selective `Chart.register`), the bundle
plateaued at ~273 KB raw / ~88 KB gzipped. Cold-mount perf-diagnose
(`npm run perf:diagnose` on the Pi via the HA Companion app) showed
the dominant time still inside chart.js's parse + first-draw — the
selective registration helped, but a fundamental cap remained.

`.workflow/perf-next-pass/alignment.md` settled on Chart.js → uPlot as
the next step in the cold-mount perf stack (slice 2 of three; slice 1
was the skeleton placeholder, slice 3 is OffscreenCanvas + worker).
`.workflow/perf-next-pass/slice-2-uplot-feasibility.md` validated that
uPlot's bars + lines + multi-axis + custom hooks cover everything the
card needs, before the rewrite committed.

Alternatives considered:

- **Stay on Chart.js + slice 3 worker.** Cheapest path, but the
  ~130 KB Chart.js + ~20 KB plugins remain in the cold-mount parse
  budget. The bundle ceiling stays put.
- **D3 or ECharts.** Both bigger than uPlot; D3 needs scaffolding
  every chart from scratch, ECharts is ~400 KB.
- **Hand-rolled canvas.** Maximum control, lowest size — but the
  per-bar / per-line / multi-axis layout work would dwarf the uPlot
  porting cost.

## Decision

Replace Chart.js with **uPlot ~1.6** as the rendering engine. Drop
`chart.js`, `chartjs-plugin-datalabels`, and the transitive
`@kurkle/color`. Add `uplot` to `dependencies` (~50 KB, MIT).

Implementation:

- `src/chart/draw.ts` rewritten to build a uPlot instance. It still
  exposes a `chart.js`-shaped facade (`data.labels`,
  `data.datasets[i].data`, `update()` / `reset()` / `destroy()` /
  `resize()` / `draw()`) so the callers in `src/main.ts` and
  `src/scroll-ux.ts` do not change shape.
- The four plugins under `src/chart/plugins/*` are **unchanged**. They
  read a `ChartLike` interface (`scales.x.getPixelForTick`, `ctx`,
  `chartArea`, `getDatasetMeta`); `draw.ts` synthesizes that interface
  from the uPlot instance on every redraw via a thin shim, then runs
  the plugins against it. The full 636-test plugin suite carries
  over unchanged.
- `src/chart/orchestrator.ts` calls the new `buildChart(targetEl,
  opts)` with the `<div id="forecastChart">` element instead of the
  old `<canvas>` (uPlot creates its own canvas children). The Chart.js
  `Chart.defaults` global-mutation step (`applyChartDefaults`) is
  removed — uPlot has no global defaults registry; theme tokens are
  passed in per instance.
- `src/main.ts` removes the `Chart.register(...)` block from the
  former selective-registration setup (PR #157). The card template
  swaps `<canvas id="forecastChart">` for `<div id="forecastChart">`.
- Animation: uPlot has no animation system. The chart.js
  grow-from-baseline tween (`reset()` + `update()` after construction)
  becomes a no-op. Per `alignment.md` this is an accepted casualty.

## Consequences

**Pros**

- **Bundle: 205 KB raw / 67 KB gzipped** (down from ~273 KB raw /
  ~88 KB gzipped — ~25 % drop, smashes the slice-2 plan ceiling).
- Cold-mount V8 parse cost drops proportionally; HA Companion app
  cold mount on chrigu's Pi is the recurring case the perf-next-pass
  alignment targeted.
- Smaller surface area for future maintenance: uPlot is ~5 KLOC; we
  no longer carry the `chart.js` controllers/scales/elements registry.
- Per-instance theming (no global mutation) makes multi-card pages
  safer — one card's colour config no longer leaks into another's
  defaults.

**Cons**

- **The grow-from-baseline animation is gone.** Charts paint once at
  their final state. `forecast.disable_animation` is now effectively
  always true; the config flag is kept on the surface but inert.
- The plugin shim costs ~one object allocation per plugin per redraw
  (4 allocations / redraw). Negligible vs. the per-frame canvas work.
- uPlot's bar drawing is less battle-tested than chart.js's; some
  edge-case visuals (per-bar borders, dashed-segment line styling at
  the station/forecast boundary) may render with subtle pixel-level
  differences. Per `alignment.md`, "feature-parity, visually close
  but not pixel-identical" is the accepted bar.

**Tradeoffs**

- Path (a) full swap was chosen over path (b) side-by-side with a
  feature flag. Rationale: feature flags violate the project
  preference against config-driven dual paths
  (memory: `feedback_no_masking`); the slice-2 feasibility
  research already validated all four concerns in advance; the swap
  is reversible by revert.
- Path (c) (retain Chart.js, jump straight to slice 3 worker) stays
  available if uPlot turns out to mis-render at scale in production.
  Worker integration is uPlot-portable too, but with more custom
  code than chart.js's `OffscreenCanvas` story.

## Related

- `.workflow/perf-next-pass/alignment.md` — the alignment that
  picked uPlot as slice 2.
- `.workflow/perf-next-pass/slice-2-uplot-feasibility.md` — research
  resolving the three concrete unknowns (bars, datalabels, ticks).
- ADR-0001 (dist committed for HACS) — the single-bundle contract
  this swap keeps; the worker slice may need to revisit it.
- ADR-0003 (e2e baselines pinned to GHA) — baseline regeneration
  goes through GHA per the existing rule.
- ADR-0011 (track package-lock.json) — `npm uninstall chart.js
  chartjs-plugin-datalabels` updates the lockfile in the same
  commit.
- PR #162 / #163 / #164 — 2026-05 perf session, ADR-0011, today
  column fix; immediate predecessors of this work.
