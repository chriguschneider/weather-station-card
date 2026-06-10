# 0016: Two-phase forecast render — defer the per-column DOM rows past first paint

**Status:** Accepted

**Date:** 2026-06-09

## Context

Since ADR-0012 the forecast chart is a single uPlot canvas. In the
scrolling hourly view the whole horizon is rendered at once: the chart
plus two sibling DOM rows — the **condition-icons row** (`.conditions`,
`renderForecastConditionIcons` — one `<ha-icon>` per column) and the
**wind row** (`renderWind` — arrow + speed per column) — all live inside
`.forecast-content`, whose width is `(totalBars / visibleBars) × 100 %`
(~2100 % for a 168-hour horizon). `forecastItems` is the scroll-viewport
size only, never a data cap, so **every column is rendered in every
view**, and the user scrolls natively via the `.forecast-scroll`
overflow container.

The maintainer priority this session: **first draw matters more than
smooth scrolling**; the off-screen remainder may be prepared in the
background after the first paint; and the mechanism should behave the
same across all three views (daily / today / hourly).

The original hypothesis (and an earlier draft of this ADR) was that the
*chart canvas* was the cold-mount cost — drawing 168 columns and the
`Intl`-heavy tick labels — and that the fix was to window the canvas
(viewport-sized uPlot + `setScale`). **Measurement refuted that.** Using
the cold-mount harness (`tests-e2e/perf-render-time.spec.ts`, median of
5, local dev machine — absolute numbers run faster than the GHA runner
per ADR-0003, but the ratios hold) with the hourly-combination scenario:

| variant | mount → chart-rendered |
|---|---|
| hourly, full (icons + wind) | ~237 ms |
| hourly, no condition-icons | ~163 ms |
| hourly, no wind | ~157 ms |
| **hourly, no icons + no wind** | **~94 ms** |

The chart itself costs ~94 ms even at 168 columns — the same as daily /
today. The entire ~140 ms hourly overhead is the **~168 condition-icon +
~168 wind DOM elements** (`<ha-icon>` custom-element upgrades dominate),
not the chart drawing. A first attempt that clipped the *chart plugins*
to the viewport moved the cold-mount number by ~0 ms (confirming the
plugins are not the bottleneck) and was reverted.

So the lever is the **DOM rows**, and the constraint is that they are
wide and scroll natively in lock-step with the canvas — windowing them
per scroll-frame would be a large, jank-prone change and contradicts the
"scroll is secondary" priority.

## Decision

Render the per-column DOM rows in **two phases**, uniform across views:

- **Phase 1 — first paint.** When the chart scrolls (`scrolling` =
  `totalBars > number_of_forecasts`: hourly, and combination daily that
  exceeds the viewport), `_renderForecastBlock` emits **placeholder-
  height** `.conditions` / `.wind-details` divs (26 px each, matching the
  loading skeleton's reservation so there is no layout shift) instead of
  the real rows. The chart canvas paints with the heavy per-column DOM
  excluded.
- **Phase 2 — post-paint reveal.** After `buildChart` succeeds,
  `_scheduleForecastRowsReveal` schedules a **double
  `requestAnimationFrame`**: the first frame paints the chart (Phase 1),
  the reveal runs before the second frame and flips
  `_forecastRowsReadyGen` to the current generation key, so the next
  render emits the real `renderForecastConditionIcons` / `renderWind`
  rows.
- **Generation key** = `forecast.type | forecasts.length`
  (`_forecastRowsGenKey`). The rows defer whenever the key differs from
  the last fully-rendered key — i.e. on cold mount, mode toggle, or a
  data-shape change — and do **not** defer on a routine same-shape data
  refresh (so hourly rows aren't blanked every hour).
- Non-scrolling views (today, single-block daily) never defer:
  `scrolling` is false, the rows are few and already on screen, so Phase
  1 renders them immediately — the same code path, no flash.
- The pending rAF handle is cancelled in `disconnectedCallback`.

Double-rAF (not `requestIdleCallback`) is deliberate: a single rAF runs
*before* the next paint (no deferral); rIC defers but with an unbounded
fire time that would let the e2e two-rAF settle screenshot empty rows.
Double-rAF defers past exactly one paint and lands within the next
frame — deterministic and inside the e2e settle window.

The chart pipeline, native scroll, and the four chart plugins are all
unchanged.

This also fixed the **pixelated hourly temperature line** as a side
effect. The symptom was a canvas built before the wide `.forecast-
content` layout had settled: uPlot measured a too-narrow width, drew at
that size, and the browser then CSS-stretched the backing store to the
final width — visibly blurry. Deferring the heavy DOM rows lets the
layout reach its final width before `buildChart` runs, so uPlot now
measures and draws at the correct full width and the line is crisp. (An
earlier `applySafePxRatio` DPR-cap attempt in `draw.ts` was reverted as
dead code: uPlot 1.6.32's internal `pxRatio` derives from
`devicePixelRatio` only and ignores the read-only `uPlot.pxRatio`
output mirror, so the cap had no effect.)

## Consequences

**Pros**

- Hourly chart first paint drops from ~237 ms to ~95 ms (≈ the
  rows-excluded floor) on the dev machine — the chart, the primary
  content, is visible ~140 ms sooner; proportionally larger on the
  slower real target (HA Companion / Pi).
- One uniform code path for all views; a no-op where it doesn't help
  (today, single-block daily), so no flash and no risk there.
- Native scroll, DOM-row alignment, and the chart pipeline are
  untouched — lowest-risk shape for the change.
- No cold-mount **regression**: total mount → all-rendered is unchanged
  (the row work is reordered, not added), so the ADR-0014 gate stays
  green.

**Cons**

- The condition-icon / wind rows appear ~one frame after the chart on a
  fresh hourly mount / mode toggle — a brief empty-then-filled moment
  for that secondary content. Accepted per the "first draw > scroll"
  priority.
- Total work is reordered, not reduced — the ADR-0014 metric (mount →
  fully-rendered) does not improve, so the win is not visible in that
  gate; it is a first-paint/perceived-latency win.
- Adds two instance fields and a rAF lifecycle handle that must be torn
  down on disconnect.

**Tradeoffs**

- Canvas windowing (viewport uPlot + `setScale`, the earlier draft's
  Decision) was rejected once measurement showed the chart is ~94 ms
  regardless of column count — it would have been large and risky for a
  cost that isn't there.
- Per-scroll-frame windowing of the DOM rows was rejected: it optimises
  scrolling (the deprioritised axis) and risks jank.
- Clipping the chart plugins to the viewport was tried and reverted:
  measured ~0 ms cold-mount effect (the plugins are not the bottleneck).
- Deferring on every data refresh (not just shape changes) was rejected:
  it would blank the rows on each hourly update — a visible flicker for
  no first-paint benefit.

## Related

- ADR-0012 (chart library — uPlot) — the single-canvas engine this
  builds on; unchanged here.
- ADR-0014 (cold-mount perf regression gate) — the harness used to
  locate the bottleneck; the change is gate-neutral (no regression).
- ADR-0003 (e2e baselines pinned to GHA) — rationale for treating local
  perf numbers as ratios only, and why the reveal must land inside the
  e2e settle window.
- `src/main.ts` — `_forecastRowsGenKey`, `_scheduleForecastRowsReveal`,
  `_renderForecastBlock` (Phase-1 placeholder branch), `disconnectedCallback`,
  and the `measureCard` `isConnected` rebuild guard that keeps the chart
  from staying blank after a dashboard view switch recreates its container.
