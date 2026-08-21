# 0019: Virtualized chart canvas with viewport panning and low-DPR supersampling

**Status:** Accepted

**Date:** 2026-08-07

## Context

In the scrolling modes (hourly, today) the chart canvas was
CONTENT-width — ~7 700 CSS px at hourly × DPR² device px, tens of MB
of pixel buffer — and scrolled via CSS `overflow`. Every redraw
painted the full width, and the sticky date label forced a full
`chart.draw()` on every scroll frame (rAF-coalesced, but still the
whole canvas plus all label plugins per frame). On Pi-class wall
tablets this was the dominant scroll-jank source.

Separately, at DPR 1 the 1.5 px temperature spline had no solid pixel
core — users reported the line as "pixelated" ("verpixelt").

Alternatives considered:

- **Keep the full-width canvas, throttle harder.** Doesn't shrink the
  buffer or the per-frame paint cost; only trades jank for lag.
- **CSS `transform: translateX` panning of a full-width canvas.**
  Cheap pans, but keeps the multi-MB buffer and repaints stay
  full-width on data refresh; memory was the bigger problem on
  tablets.
- **OffscreenCanvas + worker.** Still on the roadmap (ADR-0012 slice
  3), but orthogonal: the buffer size and per-frame paint area have to
  shrink regardless of which thread paints.

## Decision

Virtualize the canvas in scrolling modes (`src/chart/draw.ts`):

- The canvas is **viewport-width**, pinned with `position: sticky`
  inside the full-width `.chart-container`. The DOM rows (condition
  icons, wind) keep the full-width native scroll.
- The x-scale spans only `visibleBars` columns; the scroll handler
  calls `UplotChart.setScrollWindow(scrollLeftPx)` which pans via
  uPlot `setScale`. Alignment with the DOM rows holds because
  px-per-column is identical on both sides
  (`viewportW / visibleBars === contentW / totalBars`).
- Label plugins cull off-viewport columns (guard bands of a few
  columns / fixed px per plugin) so per-draw work is proportional to
  the visible columns, not the series length.
- The scroll-position-dependent sticky date label moved OUT of the
  canvas into DOM overlays (`.scroll-date-left/right`, scroll-ux.ts),
  so canvas output no longer depends on scrollLeft.
- `visibleBars` is computed by the orchestrator via
  `effectiveVisibleBars(config)` and passed through `BuildChartOpts`
  — config interpretation stays out of the render module.
- **Supersampling:** at DPR < 1.5 the canvas buffer is allocated at 2×
  and the context pre-scaled (`setTransform`), re-applied on every
  `setSize`/`drawClear` because uPlot 1.6 has no per-instance
  `pxRatio`. CSS size is unchanged, so the browser downscales 4
  samples per displayed pixel — the smoothing a Retina display gets
  for free. Line width moved 1.5 → 2 px for a solid pixel core.

## Consequences

**Pros**

- Canvas buffer drops from tens of MB to ~2 MB (viewport-sized, even
  with the 4× supersample cost at DPR 1).
- Scroll cost is a `setScale` pan redrawing ~visibleBars columns, not
  a full-series repaint; plugins draw only visible columns.
- Sharp temperature line on DPR-1 wall tablets.

**Cons**

- Two coordinate systems must stay in lockstep: the wrapper's native
  scroll (DOM rows) and the panned x-window (canvas). `resize()` and
  mid-scroll rebuilds must re-anchor the window from
  `wrapper.scrollLeft`.
- The supersample hook reaches into uPlot's canvas management
  (assign `canvas.width/height`, re-apply transform) — a uPlot major
  bump must re-validate it.
- Plugins that positioned by tick index now go through the live scale
  window (`buildChartLikeShim`'s `xToPx`); a plugin that assumes
  tick 0 is at the canvas left edge would break silently.

**Tradeoffs**

- Sticky-canvas virtualization was chosen over CSS-transform panning
  because it shrinks the buffer, not just the pan cost.
- Supersampling is gated to DPR < 1.5: high-DPR devices are already
  smooth and would pay 4× buffer for nothing.

## Related

- ADR-0012 (uPlot swap — established the plugin shim this builds on)
- ADR-0016 (progressive chart render — two-phase paint unchanged)
- `src/chart/draw.ts`, `src/scroll-ux.ts`,
  `src/chart/plugins/daily-tick-labels.ts` (culling + DOM date
  overlays)
