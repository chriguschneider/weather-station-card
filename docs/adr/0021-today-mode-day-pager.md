# 0021: 'today' mode is a day pager over calendar-aligned 3-hour blocks

**Status:** Accepted

**Date:** 2026-08-07

## Context

'today' mode was a fixed 24-hour zoom: 12 h station history + 12 h
forecast (24 h station-only), 3-hour-aggregated to exactly 8 bars
with no scroll. Users could not look at yesterday or the day after
tomorrow without switching modes, and the 12/12 split produced
surprising windows early in the morning or late at night.

The index-based 3-hour aggregator (`aggregateThreeHour`) grouped
entries by array position, so a recorder gap shifted every later
block off its wall-clock slot.

Alternatives considered:

- **Keep the fixed 24 h zoom.** No navigation; the mode stays a
  dead end next to the scrollable hourly mode.
- **Free scrolling like hourly, 3-h aggregated.** Navigable, but
  page boundaries land mid-day; "one screen = one day" — the whole
  point of the mode — is lost.
- **Client-side zoom buttons on hourly.** More UI surface and state;
  rejected in favour of keeping three clearly distinct modes.

## Decision

'today' becomes a **day pager** (2026-08 rework):

- The data window equals hourly's (`days × 24 h` station + full
  forecast); 'today' and 'hourly' share recorder responses via the
  request dedup and the mode-toggle lazy-cache (ADR-0020).
- `aggregateThreeHourCalendar` (`src/forecast-utils.ts`) anchors
  blocks to the LOCAL calendar (00/03/…/21) and gap-fills the output
  to whole days: every day contributes exactly 8 blocks, empty blocks
  are all-null (the chart draws gaps). This invariant — 8 blocks ≡
  1 viewport ≡ 1 calendar day — is what makes paging exact.
- `effectiveVisibleBars` pins the 'today' viewport to 8 bars
  regardless of `number_of_forecasts`.
- scroll-ux adds day-page semantics for the mode: chevrons page ±1
  day, free scrolling snaps to day boundaries after a settle delay,
  programmatic navigations declare their destination (`pendingTarget`)
  so the snap never cancels an in-flight smooth scroll. Initial
  position and jump-to-now target the current day's page
  (`computeDayPageScrollLeft`).
- The station/forecast split happens at block granularity after the
  merge; a boundary block containing both counts as station
  (measured wins).

## Consequences

**Pros**

- One viewport frames exactly one calendar day; scrolling moves in
  whole days — the mental model matches the mode's name.
- Calendar-anchored buckets are immune to recorder gaps; DST days
  still yield exactly 8 blocks (date iteration, not ms arithmetic).
- Shared fetch parameters with hourly mean a daily↔today↔hourly
  toggle reuses cached data.

**Cons**

- The mode fetches `days × 24 h` even though one day is visible at a
  time (mitigated by ADR-0020's dedup/caches).
- The 8-blocks-per-day invariant is load-bearing for paging math;
  any future change to the block size must touch
  `effectiveVisibleBars`, the aggregator, and scroll-ux together.
- `number_of_forecasts` is intentionally ignored in 'today' — a
  config surface that silently does nothing in one mode.

**Tradeoffs**

- Gap-filling with all-null blocks costs a few empty columns but buys
  exact integer page boundaries; the free-scrolling alternative was
  rejected because mid-day page boundaries defeat the mode.

## Related

- ADR-0020 (request dedup — shared 'today'/'hourly' fetches)
- ADR-0019 (virtualized canvas — day pages pan the same x-window)
- `src/forecast-utils.ts` (`aggregateThreeHourCalendar`,
  `effectiveVisibleBars`, `computeDayPageScrollLeft`),
  `src/scroll-ux.ts`, `src/main.ts` (`_buildTodayForecasts`)
