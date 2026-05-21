# 0015: Open-Meteo as a no-station data source

**Status:** Accepted

**Date:** 2026-05-21

## Context

The card draws two chart blocks: a **station block** (past data, backed
by the Home Assistant recorder via `MeasuredDataSource`) and a
**forecast block** (future data, backed by a `weather` entity via
`ForecastDataSource`). The station block needs `sensors.*` wired to
recorder-backed entities.

A common configuration has a `weather_entity` but **no station
sensors** — the user wants the forecast but owns no weather station.
Today their past block is simply empty: half the chart is blank.

Open-Meteo was already a dependency for one narrow purpose — the
sunshine overlay (`forecast.show_sunshine`, ADR-0002) fetches
`daily=sunshine_duration` from Open-Meteo's Forecast endpoint. That
same endpoint also returns temperature, precipitation, a WMO weather
code, and wind for the same `past_days` window.

Approaches considered (full exploration in
`.workflow/weather-entity-fallback/brainstorm.md`):

- **A — Weather-entity recorder history.** Reconstruct the past block
  from the `weather.*` entity's own recorder history. Rejected: a
  weather entity records only its *current* state, not per-channel
  min/max/sum; the recorded history is sparse and unsuited to a
  daily-aggregate chart.
- **B — Open-Meteo drives both blocks.** Replace the weather entity
  entirely with Open-Meteo. Rejected: throws away the user's chosen
  forecast provider and its richer attributes; a bigger behaviour
  change than the problem warrants.
- **C — Hybrid.** The `weather_entity` keeps driving the forecast
  block; Open-Meteo backfills only the past block.
- **D — Template-sensor generation.** Have the card emit recorder-
  backed template sensors. Rejected: the card cannot create HA
  entities, and asking the user to hand-write template YAML defeats
  the "no setup" goal.

## Decision

Adopt **Approach C**, behind an opt-in.

- **New config key `forecast.openmeteo_history`** (boolean, default
  `false`, in `DEFAULTS_FORECAST` per ADR-0008). It gates the
  no-station past block.
- **The past block is backfilled from Open-Meteo** when *all* hold:
  no `sensors.*` configured, a `weather_entity` is set, `show_station`
  is on, and the opt-in is on. Any single configured sensor turns the
  fallback fully off (all-or-nothing — the recorder wins). It works in
  all three chart resolutions — daily, today and hourly — each pulling
  the matching Open-Meteo granularity in one shared fetch.
- **`OpenMeteoSunshineSource` is renamed `OpenMeteoSource`** and
  extended to request the daily station fields in the *same* HTTP
  call as the sunshine fetch — no second source class, no second
  round-trip. `buildDailyForecast` reshapes the response into the
  exact `ForecastEntry[]` shape `MeasuredDataSource` emits (daily high
  as `temperature`, low as `templow`, local-midnight `datetime`), so
  it drops into the station slot with **no special-casing
  downstream** — de-overlap, merge-at-now, and rendering all treat it
  identically to recorder data.
- **WMO `weather_code` → `ConditionId`** via a new lookup table
  `src/weather-code-map.ts`, following the ADR-0009 lookup-table
  pattern. It deliberately avoids the `lightning` / `hail` conditions
  (the card's own classifier never emits those); thunderstorm codes
  map to `pouring`.
- **The Open-Meteo request pins explicit units** (`temperature_unit`,
  `precipitation_unit`, `wind_speed_unit` → °C / mm / m·s⁻¹). With no
  station sensor there is no source unit to derive from; each entry is
  tagged `wind_speed_unit: 'm/s'` so the renderer still converts wind
  to the user's display unit.
- **`main.ts` owns the wiring.** `_ensureOpenMeteoSource` creates the
  source when the sunshine overlay *or* the no-station fallback is
  active; `MeasuredDataSource` is not created when the fallback is
  active, so the recorder's empty result cannot overwrite the
  Open-Meteo past block.
- **The visual editor enforces the invariant.** When a card has no
  past-data source (no sensors, opt-in off), the editor disables the
  station / combination mode options, switches the card to
  forecast-only, and shows a hint in the Sensors section pointing at
  the two fixes (wire a sensor, or turn on the opt-in). The rendered
  card gains *no* new no-data state — a hand-written YAML config keeps
  the pre-existing empty-past behaviour; only the editor steers away
  from it.

## Consequences

**Pros**

- A card with only a `weather_entity` shows a full chart — past *and*
  forecast — with one opt-in line of YAML.
- One shared HTTP call serves both the sunshine overlay and the past
  block; no extra network cost when both are on.
- Open-Meteo past entries are byte-shape-compatible with recorder
  entries, so the rest of the pipeline needed no fallback-aware code.

**Cons**

- The past block now depends on an internet round-trip — it is absent
  (not stale-cached) on the first load of an offline browser.
- Open-Meteo's daily model values are not the user's own measurements;
  they are a reanalysis/forecast blend for the location, not a true
  station record.
- Daily Open-Meteo offers no mean wind or humidity/pressure — the wind
  row shows the daily *max*, and humidity/pressure/uv rows stay empty.

**Tradeoffs**

- Approaches A, B and D were rejected for the reasons above; C keeps
  the user's forecast provider and confines the new behaviour to the
  one block that was actually empty.
- Units are pinned to metric rather than read from the weather
  entity. Temperature carries no per-entry unit tag, so a non-metric
  HA install sees the past block in °C — accepted for this slice
  (the card is metric-oriented and the acceptance criteria are
  metric); revisitable if it proves a problem.

## Related

- ADR-0002 — sunshine-duration tiered data-source policy (the original
  Open-Meteo integration this extends).
- ADR-0008 — DEFAULTS as the single source of truth (`openmeteo_history`
  lands in `DEFAULTS_FORECAST`).
- ADR-0009 — lookup-table pattern (followed by `weather-code-map.ts`).
- `.workflow/weather-entity-fallback/` — brainstorm, alignment, plan.
