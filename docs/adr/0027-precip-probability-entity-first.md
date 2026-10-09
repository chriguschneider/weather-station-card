# 0027 — Chance of rain: weather entity first, Open-Meteo as fallback

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Issue #288 asked for the rain forecast in the chart to show the
*probability* next to the *amount*. The card had this once
(`forecast.show_probability`, inherited from the upstream
weather-chart-card) and removed it in v0.8.3 (issue #4) because it
read `precipitation_probability` straight off `weather/get_forecasts`
and the integrations that matter in DACH left that slot empty — the
toggle silently did nothing.

Two things changed since:

- [hass-meteoswiss-weather](https://github.com/chriguschneider/hass-meteoswiss-weather)
  fills `precipitation_probability` on both its daily and hourly
  forecast (their issue #112). The daily figure is derived: the
  maximum of the hourly 3-hour-window probabilities whose window ends
  in that local calendar day. AccuWeather, OpenWeatherMap, Pirate
  Weather and Tomorrow.io fill the slot too.
- The card already calls Open-Meteo for the sunshine bar (ADR-0002)
  and the no-station past block (ADR-0015). Open-Meteo offers
  `precipitation_probability_max` (daily) and
  `precipitation_probability` (hourly) on the same endpoint, so the
  value is one extra field on a request the card already makes.

Met.no and Home Assistant's core Open-Meteo integration still do not
populate the slot. A feature that only works for some weather
entities is what got the old toggle removed; the question is where
the value comes from when the entity has none.

The visual form was settled on a mock-up page before the code: the
amount and the chance side by side in the number size with a muted
slash between them, each unit centred under its own number
("4.2 / 85" over "mm  %"). Side by side rather than stacked because
the box grows ~7 px instead of ~12 px; units below rather than
inline because "4.2 mm / 85 %" measures ~60 px, wider than a column
on a phone (8 columns ≈ 45 px), while the chosen form stays at
41–44 px.

## Decision

1. **Source priority: entity, then Open-Meteo, never the recorder.**
   `precipitation_probability` on a forecast entry is kept when the
   weather entity provides it (normalized to an integer 0..100).
   Only entries without one are filled from Open-Meteo, matched by
   civil date (daily) or hour (hourly). Measured station entries —
   recorder-backed or the ADR-0015 Open-Meteo past block — never get
   a probability: it is a forecast notion, and the past columns keep
   their one-line amount box.

2. **The Open-Meteo fallback is fetched only when the gap is real.**
   `_ensureOpenMeteoSource` enables the source for this feature only
   when the row is on *and* the entity's forecast has arrived *and*
   carries no probability. A MeteoSwiss or AccuWeather user with the
   row on never sends their location to Open-Meteo for a value the
   entity already provides. Until the first forecast arrives the gap
   is unknown and counts as "entity covers it"; the source is
   re-evaluated on every forecast arrival, so the fallback kicks in
   one tick later when needed.

3. **Opt-in, like the sunshine bar.** `forecast.show_precip_probability`
   defaults to `false` (the fallback path can add a network call that
   sends the HA location to Open-Meteo). The editor exposes it as a
   chart-row pill next to *Sunshine bar*.

4. **Aggregation rule for 'today' mode:** a 3-hour block's probability
   is the **maximum** of its hours, not the sum or mean — the chance
   that any hour of the block is wet is at least the wettest hour's
   chance, and it is the rule MeteoSwiss itself uses for its daily
   value.

5. **Dry columns print the chance alone from 30 % up.** Below that a
   "5 / %" box on a sunny day is noise; from 30 % on the chance is
   something the reader wants to see. The threshold is a constant
   (`PROBABILITY_ONLY_MIN`), not a config key — one knob fewer, and
   nobody asked for it.

6. **Rendering stays in the existing precip-label plugin.** No new
   series, no new axis, no change to the bar grouping (which assumes
   at most two bar series). The two-line box hangs further below the
   baseline, so the chart's bottom padding and the mode-toggle /
   jump-to-now button position grow by `PROBABILITY_EXTRA_BOTTOM_PAD`
   only while the row is on — visual baselines for the default
   config are unchanged.

## Consequences

- One new config key, one new chart-row pill, two new locale keys in
  every language.
- `ForecastEntry` gains `precipitation_probability?`; the chart's
  render-data bag gains `precipProb` (null when the row is off, so the
  plugin treats "array present" as "draw the two-line box").
- `OpenMeteoSource` requests two more fields, caches two more arrays
  and marks the cache with `probabilityFetched` so a cache written
  before this ADR refetches exactly once (a flag rather than an
  array-length check, so a response without the fields cannot keep
  the source stale forever).
- The Open-Meteo cache key and TTL are unchanged; the request shape
  is the same for every card at a location, so the cross-card dedup
  (ADR-0020) still collapses to one roundtrip.
- Users of Met.no / core Open-Meteo who turn the row on send their HA
  location to Open-Meteo, as they already would for the sunshine bar.
  The editor hint says so.

### Rejected alternatives

- **Ghost column behind the amount bar (MeteoSwiss-app style)** — a
  third bar series on its own 0..100 scale. Reads well in hourly
  mode but collides with the temperature labels in daily mode, halves
  to a sliver next to the sunshine bar, and breaks the two-bar
  assumption in `draw.ts`. Kept as a possible later style.
- **A separate "chance" row under the condition icons** (DOM, like
  the wind row) — cheap and comparable across the week, but puts the
  value two rows away from the amount, and costs ~22 px per card.
- **Bar opacity ∝ probability** — overloads the channel the card
  already uses for "forecast vs measured", and 50 % is not
  distinguishable from 70 %.
- **Entity-only (no Open-Meteo fallback)** — the exact failure mode
  that got the feature removed in v0.8.3.
- **Always fetch Open-Meteo when the row is on** — simpler gating, but
  sends the location of every MeteoSwiss user to a third party for
  nothing.

## Related

- Issue #288 (the request), issue #4 / v0.8.3 (the earlier removal)
- ADR-0002 — Sunshine duration: tiered data-source policy (the same
  entity-before-Open-Meteo stance)
- ADR-0015 — Open-Meteo as a no-station data source (why the past
  block never gets a probability)
- ADR-0020 — Cross-card request dedup and persistent caches (the
  cache the new fields ride in)
- ADR-0021 — 'today' mode day pager (where the max-per-block rule
  applies)
- `src/precip-probability.ts`, `src/chart/plugins/precip-label.ts`,
  `src/openmeteo-source.ts`
