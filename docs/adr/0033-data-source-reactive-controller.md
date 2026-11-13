# 0033: Data-source lifecycle as a Lit ReactiveController, pure chart builder

**Status:** Accepted

**Date:** 2026-11-13

## Context

Step 4 of the main.ts split (#452). After steps 1–3 the card still
owned the whole data-source lifecycle: about 20 fields (sources,
unsubscribe handles, station / forecast data, errors, ready flags, the
mode lazy-cache, the Open-Meteo source, the pressure delta and its
cache, the availability-grace map and timer) plus `_syncDataSources`,
`_invalidateStaleSources`, `_syncCalendar`, `_ensureOpenMeteoSource`,
the teardowns and four entries in the card's TeardownRegistry. Every
change to a source touched the 3,900-line element.

The chart orchestrator had the opposite problem: `drawChartUnsafe(card)`
took the card through a structural `CardLike` interface, found the
container in `card.renderRoot`, destroyed `card.forecastChart`, wrote the
new chart back to it and set `card._chartPhase` for the error banner.

Options for the sources:

- **Plain helper module with functions over a state bag.** No lifecycle
  hook; the card would still have to call the teardown on disconnect.
- **A Lit `ReactiveController`.** Lit's own composition unit: the host
  calls `hostConnected` / `hostDisconnected`, and the controller asks
  for renders with `host.requestUpdate()`. No new dependency.
- **A child element.** Wrong tool: the sources render nothing.

## Decision

- `src/data-source-controller.ts` exports `DataSourceController`, a
  `ReactiveController` created in the card's constructor
  (`this._sources`). It owns the station (`MeasuredDataSource`), forecast
  (`ForecastDataSource`) and Open-Meteo sources, their data, errors,
  ready flags and lazy cache, the card calendar (`syncCalendar` replaces
  `host.calendar`), the 3-h pressure delta and the availability scan
  with its grace timer. Its methods are `sync`, `setHass`, `invalidate`,
  `ensureOpenMeteo`, `plan`, `scanAvailability`, `refreshPressureDelta`,
  `notifyVisible` and the two teardowns.
- The controller has its own `TeardownRegistry`, filled in
  `hostConnected` and drained in `hostDisconnected`. The card's
  registry keeps the DOM- and render-side cleanups.
- The controller talks back only through `DataSourceHost`:
  `onSourceData()` (rebuild the chart entries), `onOverlayData()`
  (sunshine / chance-of-rain overlay only), `onSourceDropped()` (null the
  ADR-0017 snapshot) and `requestUpdate()`.
- The card keeps the ADR-0017 gate and decides *when* to sync; the gate
  asks `_sources.sourcesMatchConfig()` instead of comparing source
  fields itself.
- `chart/orchestrator.ts` exports `buildForecastChart(inputs)`: target
  element, config, data, column counts, unit system, `ll`, theme host
  and preview flag in, the uPlot handle out. A failure is rethrown as
  `ChartBuildError` with `phase` `'compute'` or `'init'`. The card finds
  the container, destroys the previous chart and stores the result.

## Consequences

**Pros**

- The data-source lifecycle is unit-tested through a plain host object
  (`tests/data-source-controller.test.js`) and sits in the coverage
  gate, which main.ts is outside of.
- Disconnect cleanup for sources is in one place, next to the code that
  creates them.
- The orchestrator has no structural coupling to the card; its inputs
  are explicit and testable with `buildChart` stubbed.

**Cons**

- The availability lists and the pressure delta are no longer Lit
  reactive properties; the controller calls `requestUpdate()` when one
  changed. Same render behaviour, one more place to remember it.
- Tests that poked card internals now go through `card._sources`.

**Tradeoffs**

- Moving the clock, next-rain and precip-rate timers into the
  controller as well was rejected: they belong to the live panel's
  rendering, not to the data sources.

## Related

- [0007](0007-set-hass-three-phase.md) — phase 3 now calls the controller
- [0017](0017-entity-delta-gate-in-set-hass.md) — the gate stays in the
  card
- [0020](0020-cross-card-request-dedup-and-persistent-caches.md),
  [0015](0015-openmeteo-no-station-data-source.md),
  [0030](0030-per-card-calendar.md) — behaviour unchanged, now in the
  controller
- #449, #450, #451, #452 — the main.ts split
