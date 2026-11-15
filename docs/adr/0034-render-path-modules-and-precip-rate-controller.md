# 0034: Render path as module functions, precip-rate derivation as a controller

**Status:** Accepted

**Date:** 2026-11-15

## Context

Step 5 of the main.ts split (#472, after #449–#452). After step 4
`src/main.ts` still had 3,354 lines, most of it render path: the
forecast block with its loading skeleton, mode toggle, scroll controls
and scroll timeline, the condition-icon row, the error and
config-warning banners, the availability hint, the two placeholder
cards, the `debug: true` panel, the content of the sources popup (lines
and legend), the initial-scroll and day-pager math, and the
counter-to-rate precipitation derivation with its 30-s tick.

ADR-0010 (amended for #449) already moved the live-panel rows to plain
functions over one context. ADR-0033 moved the data sources into a
`ReactiveController` and rejected moving the clock, next-rain and
precip-rate timers into *that* controller, because they belong to the
live panel and not to the data sources. The issue asks to decide per
timer where it lives.

Options for the render path:

- **Keep the methods on the card.** No churn, but the 3,000-line element
  stays the only place to test them, and it is outside the coverage gate.
- **Plain functions over a small context** (ADR-0010 pattern). The card
  builds the context, keeps the event wiring and the lifecycle.
- **Child elements per section.** Changes the DOM (shadow roots, slots),
  so the E2E baselines would move; ruled out by the no-behaviour-change
  rule.

## Decision

- New directory `src/render/`, plain functions over small contexts, no
  `this`, no DOM access:
  - `forecast-block.ts`: `renderForecastBlock(ctx)` (ready and loading
    branches), `renderModeToggle`, `renderScrollTimeline`,
    `renderForecastConditionIcons`, `forecastRowsGenKey`,
    `forecastAnimClass`, `timelineSegments`. The wind row and the chart
    sources button come in as callbacks so they keep their guards.
  - `banners.ts`: `renderErrorBanner(ctx)`, `bannerErrors`,
    `renderAvailabilityNote`, `renderOnboarding`, `renderNoWeather`.
  - `debug-panel.ts`: `renderDebugPanel(ctx)`, `emptyColumnReasons`.
    The data-source state comes in as a structural `DebugSources`.
  - `source-lines.ts`: `sourceLiveKeys`, `sourcesAlert`,
    `sourceLabelFor`, `entityName`, `sourceLines(ctx)` and
    `sourceLegend(inputs)`. The popup element and its open / close
    stay in the card.
  - `scroll-position.ts`: `initialScrollDataReady`,
    `initialScrollGeneration`, `resolveInitialScrollLeft` (null while
    the layout has not settled) and `dayPagerRealignLeft`. The card reads
    the wrapper sizes, writes `scrollLeft` and owns the settle observer.
- A dependency-cruiser rule `render-no-uplevel` keeps `src/render/` from
  importing main.ts, the editor, scroll-ux, action-handler, the chart
  orchestrator or the two controllers. The modules are in the coverage
  gate.
- `src/precip-rate-controller.ts` exports `PrecipRateController`, a
  `ReactiveController` created in the card's constructor
  (`this._precipRate`). It owns the sample buffer, the entity it was
  hydrated for and the 30-s tick, clears the tick in `hostDisconnected`
  and talks back through `PrecipRateHost` (`precipUnits`,
  `applyDerivedPrecip`, `onDerivedPrecipTick`). The card still decides
  which precipitation path runs (rate sensor, rate unit, counter).
- Timers, one by one:
  - **Precip-rate tick → `PrecipRateController`.** It recomputes from
    the buffer the controller owns and needs no DOM; its cleanup now
    sits next to the code that arms it.
  - **Clock (1 Hz) → stays in the card.** It writes the live panel's
    text nodes directly and follows the visibility gate; it is render
    work.
  - **Next-rain countdown (30 s) → stays in the card.** It refreshes
    reactive display strings of a live-panel row.
  - **Chart-mount animation timeout, two-phase row reveal (double rAF,
    ADR-0016), initial-scroll observer and frame → stay in the card.**
    All three are tied to the shadow DOM and the Lit update cycle.
  - **Availability grace timer** stays in `DataSourceController`
    (ADR-0033).

## Consequences

**Pros**

- main.ts drops from 3,354 to about 2,600 lines; every moved function is
  unit-tested without mounting the card (`tests/render-modules.test.js`,
  `tests/precip-rate-controller.test.js`).
- A banner, a debug-panel line or a timeline change touches one small
  file.

**Cons**

- More indirection: the card methods that tests and other modules call
  (`renderDebugPanel`, `renderScrollTimeline`, `_sourceLines`,
  `_sourceLegend`, `_entityName`, `_renderForecastBlock`) stay as thin
  wrappers.
- Tests that poked the precip buffer now go through `card._precipRate`.

**Tradeoffs**

- Moving the initial-scroll observer into a controller as well was
  rejected: it is armed from `updated()` and `drawChart()` with the
  rendered wrapper in hand, so a controller would only forward calls.
  The decision logic, which is what needs tests, is pure now.
- The ~1,500-line target of #358 is not reached. What remains is the
  HA boundary, `set hass` and its three phases, the chart lifecycle
  (`measureCard`, `drawChart`, `updateChart`), the live panel's main
  block and clock, the popups and the Lit hooks.

## Related

- [0010](0010-group-renderer-pattern.md) — the pattern, now also for the
  card sections
- [0016](0016-progressive-chart-render.md) — the deferred rows, unchanged
- [0033](0033-data-source-reactive-controller.md) — the other controller;
  its rejected timer move is settled here per timer
- #358, #449–#452, #472 — the main.ts split
