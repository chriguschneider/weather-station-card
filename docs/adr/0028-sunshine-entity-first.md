# 0028 — Sunshine bar: weather entity first, Open-Meteo as fallback

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

The sunshine bar's forecast columns come from Open-Meteo (ADR-0002),
fetched by every browser with the HA location, because no weather
entity carried a sunshine forecast. The cloud-cover estimate (F3)
fills what Open-Meteo leaves empty.

MeteoSwiss publishes a sunshine forecast in its local forecast Open
Data: `sre000h0`, the hourly sunshine total in minutes, for every
forecast point. [hass-meteoswiss-weather](https://github.com/chriguschneider/hass-meteoswiss-weather)
puts it on its forecast entries as `sunshine_duration` since v0.6.0
(their ADR-0010): the hour's minutes on hourly entries and the local
day's sum on daily ones. It leaves the field out for a run's partial
first and last day rather than report an understated total.
`sunshine_duration` is not a standard HA Forecast slot, so other
integrations will not fill it.

For a MeteoSwiss user the Open-Meteo call then adds nothing. It sends
the location to a third party, and its values come from another model
than the condition icons and temperatures next to them. ADR-0027
solved the same problem for the chance of rain.

## Decision

1. **Source priority for forecast columns: entity, then Open-Meteo,
   then the cloud-cover estimate.** A forecast entry with a finite
   `sunshine_duration` gets `sunshine = minutes / 60` before the
   overlay runs. `attachSunshine` already keeps an existing value, so
   Open-Meteo and F3 fill only the entries without one. The unit is
   fixed to minutes rather than run through `normalizeSunshineValue`'s
   seconds/hours heuristic, which would read 45 min as 45 s.

2. **Station columns are unchanged.** The recorder sensor and the
   lux derivation still win there (ADR-0002); the entity field is a
   forecast notion.

3. **Open-Meteo is fetched for sunshine only when a column needs it.**
   `_sunshineNeedsOpenMeteo` enables the source when the bar is on and
   either
   - the visible forecast slice has an entry without
     `sunshine_duration`, or
   - the station block shows columns the recorder cannot fill: any
     station sensor is configured, but the mode is not daily or there
     is neither a sunshine nor an illuminance sensor.

   As in ADR-0027, a forecast that has not arrived yet counts as
   covered. The source is re-evaluated on every forecast arrival, so
   the fallback starts one tick later when needed.

4. **Every visible entry, not any entry.** Unlike the chance of rain,
   where one entity value shows the entity supports the field, a
   sunshine forecast that stops a day early still leaves bars empty.
   Open-Meteo is skipped only when the entity covers the whole slice.

## Consequences

- With an entity that fills `sunshine_duration` and a daily station
  block wired to a sunshine or illuminance sensor, the card makes no
  Open-Meteo request for the sunshine bar. The ADR-0015 past block and
  the ADR-0027 chance-of-rain fallback still enable the source on
  their own terms.
- Cards whose entity does not fill the field behave as before, except
  that the first Open-Meteo request waits for the first forecast
  arrival instead of firing on the first render.
- The editor's sunshine availability hint still reports Open-Meteo's
  cache. A card that never fetches shows the "pending" line.

### Rejected alternatives

- **Always fetch while the bar is on**: simpler, but it sends the
  location of every MeteoSwiss user to Open-Meteo for values the entity
  already provides. ADR-0027 rejected the same option.
- **Run the entity value through `normalizeSunshineValue`**: its
  ≥ 30 → seconds rule misreads minutes.

## Related

- ADR-0002: sunshine duration, the tiered data-source policy this
  extends
- ADR-0015: Open-Meteo as a no-station data source
- ADR-0027: chance of rain, entity first (the same gating)
- `src/sunshine-source.ts` (`attachEntitySunshine`,
  `forecastCoversSunshine`), `src/main.ts` (`_sunshineNeedsOpenMeteo`)
