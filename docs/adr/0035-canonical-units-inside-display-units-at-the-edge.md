# 0035: Canonical units inside, display units at the edge

**Status:** Accepted

**Date:** 2026-11-16

## Context

The card reads the same physical quantities from five places (live
sensor states, recorder statistics, the weather entity, Open-Meteo,
sensor attributes), and each place brings its own unit. There is no
rule for where a unit is converted, so every unit bug was fixed where it
showed, with one more helper or one more tag:

| Version | Bug | Fix |
| --- | --- | --- |
| 1.11.1 | Forecast wind off by 3.6 when station and weather entity disagree (#145) | Per-entry `wind_speed_unit` tag |
| 2.1.2 | Wrong condition icon with km/h, °F or inches | `toMetersPerSecond`, `toCelsius`, `toMillimeters` in front of the classifier |
| 2.1.3 | Rain in inches labelled mm | `precipBaseUnit`, `convertPrecipLength`, `formatPrecipDisplay` |
| 2.2.3 | W/m² sensors in the illuminance slot | `luxScaleFor` |
| 2.4.3 | Weather-entity wind in mph read as m/s (#253) | Source units taken from the entity |
| 3.0 | A 20 °C entity value shown as 20 °F, Beaufort from the wrong unit (#438) | Rescale closures in `sensor-readings.ts`, `toBeaufort` |
| open | Pressure change in hPa next to a value in inHg (community post 24) | – |

The audit for #478 counts eighteen conversion helpers in six files, and
the unit travels beside the value in nine shapes, among them the
`{ value, unit, source }` reading, the `units` record of the station,
the per-entry `wind_speed_unit` tag, the `unitMetres` factor of the
zero-degree rows, the chart's `precipSourceBase` / `precipTargetBase`
pair and a lux scale factor. Every consumer has to know which shape it
holds and remember to convert.

Four defects are open and follow from that structure:

- **An unknown unit passes through and takes the display unit's
  label.** `convertWindSpeed(20, 'kn', 'km/h')` returns 20, shown as
  "20 km/h". A pressure sensor in kPa is classified against thresholds
  in hPa and always reads "stable".
- **Open-Meteo values stay metric** next to a °F / inch station
  ([ADR-0015](0015-openmeteo-no-station-data-source.md), Tradeoffs).
- **The chart guesses the precipitation unit** from Home Assistant's
  unit system instead of reading the sensor's.
- **Sunshine duration guesses its unit** from the size of the number.

On top of that, conversion and rounding are one step:
`convertPressure(-1.4, 'hPa', 'hPa')` returns -1. A difference cannot
be shown correctly through a helper that rounds a reading, and a
temperature difference would also get the 32 °F offset.

Alternatives on the table:

- **Value-plus-unit objects everywhere, converted on demand.** Today's
  direction (`Reading`). Every consumer still has to remember to
  convert, and a threshold comparison on the raw number stays one
  forgotten call away.
- **Let Home Assistant convert** through the `units` parameter of
  `recorder/statistics_during_period`. Covers statistics only; states,
  forecasts, attributes and Open-Meteo would keep the card's own
  converter, so there would be two.
- **A conversion library.** A runtime dependency against the bundle
  budget for a table of about forty rows, and it does not know Home
  Assistant's spellings (`inHg`, `kn`, `mm/h`, `°C`).
- **One canonical unit per quantity inside the card.** The shape of the
  time-zone rebuild in 3.0
  ([ADR-0026](0026-server-time-zone.md),
  [ADR-0030](0030-per-card-calendar.md)): normalise once at the entry,
  compute without the question, format once at the exit.

## Decision

1. **One canonical unit per quantity**, `CANONICAL_UNIT` in
   `src/utils/units.ts`: temperature °C, pressure hPa, speed m/s,
   precipitation mm, precipitation rate mm/h, illuminance lx, length m
   (zero-degree level, elevation), duration h (sunshine).
2. **Entry.** Every value is converted to canonical where it enters the
   card, with `toCanonical(quantity, value, unit)`. There are five
   doors: live sensor states (`sensor-readings.ts`), recorder statistics
   and history (`MeasuredDataSource`), the weather entity (its current
   attributes in `sensor-readings.ts`, its forecast entries in
   `ForecastDataSource`), Open-Meteo (`openmeteo-source.ts`), and sensor
   attributes (zero-degree curve, elevation).
3. **Inside.** Classifiers, trends, thresholds, axis logic and caches
   work on canonical values only and take no unit parameter.
4. **Exit.** One set of display units per card, resolved once for all
   quantities in this order: `config.units.<quantity>` → the station
   sensor's own unit → Home Assistant's unit system → canonical. One
   formatter converts and rounds (`toDisplay`). It knows readings and
   differences: a difference converts with the factor only, without the
   temperature offset, and has its own decimals (`ValueKind`,
   `deltaFromCanonical`). Number format, unit label and locale stay with
   the consumer.
5. **An unknown or missing unit never converts and never gets another
   unit's label.** `parseUnit` and `toCanonical` return null; the
   consumer shows the raw value with its own unit and leaves it out of
   classification.
6. **Guards** come at the end of the migration: a lint rule that keeps
   unit literals and `unit_of_measurement` reads inside the units module
   and the entry modules, a matrix test (the same weather in metric, US
   and exotic units gives the same icon, trend and texts), and a locale
   test that no string hard-codes a unit.
7. **The table.** `UNITS` in `src/utils/units.ts` holds, per quantity,
   every unit Home Assistant allows for it: the id in Home Assistant's
   spelling, the factor as `mul / div` (plus `zero` for °F and K), the
   display decimals of a reading and of a difference, and the other
   spellings integrations use. Factors come from Home Assistant's
   `homeassistant/util/unit_conversion.py`, cited by permalink in the
   module. Two entries are not plain factors and keep the sources the
   card already cites: W/m² enters as illuminance through the daylight
   efficacy of 120 lm/W (an approximation), and Beaufort is read with
   Home Assistant's formula as a source but shown as the WMO force
   band, without a difference.

## Migration

The model lands in slices (#478), so for a while the code holds both
the old helpers and the new table. What is true after each slice:

- **This slice (#492).** `src/utils/units.ts` and its tests exist.
  `toCelsius`, `fromCelsius`, `toMillimeters`, `convertPrecipLength`,
  the lux scale and `metresPerUnit` take their arithmetic from the
  table, with identical results. Their accepted spellings and their
  pass-through for unknown units are unchanged: points 2 to 5 are **not**
  in force anywhere yet, and the four defects above are still open.
  `WIND_CONVERSION`, `PRESSURE_CONVERSION`, `convertWindSpeed`,
  `convertPressure`, `toMetersPerSecond` and `toBeaufort` are untouched,
  because their factors (`1.60934`, `0.75006`, `33.8639`) differ from
  Home Assistant's in late digits and swapping them is a visible change.
  Only the Beaufort band table moved into `units.ts`, so that there is
  one copy.
- **Live panel.** Readings arrive canonical, one resolved set of display
  units per card, rows, tooltips and the sources popup format through
  the one formatter. This slice replaces the tables of
  [ADR-0009](0009-lookup-table-pattern-for-unit-conversions.md), which
  stays in force until then, and sets its status to
  "Superseded by 0035". [ADR-0031](0031-live-value-provenance.md)
  describes the reading record this slice changes and gets its
  amendment with it.
- **Past, forecast, Open-Meteo and chart.** Statistics and forecast
  entries arrive canonical, the per-entry `wind_speed_unit` tag goes,
  the chart converts once, sunshine duration reads the sensor's unit.
  [ADR-0015](0015-openmeteo-no-station-data-source.md) describes the
  Open-Meteo units this slice changes and gets its amendment with it.
- **Guards** (point 6) close the migration.

## Consequences

**Pros**

- One place to convert in and one to convert out. A classifier or a
  threshold cannot be handed the wrong unit, because it never sees one.
- An unknown unit becomes visible as such instead of a wrong number
  with a plausible label.
- A difference is a first-class value: the pressure change next to a
  value in inHg is the same formatter call with `'delta'`.
- A new unit is one row. The table is data with one source, and the
  tests walk every row.

**Cons**

- A value in the display unit is converted twice on its way through
  (in at the entry, out at the exit). The round trip costs float
  precision in the last digits, far below any display decimal.
- Until the last slice two models coexist, and a reader has to check
  which one a module is on. The Migration section is the map.
- The table follows one Home Assistant commit. A unit Home Assistant
  adds later is unknown to the card until its row is added; by point 5
  it then shows raw instead of wrong.

**Tradeoffs**

- Value-plus-unit objects were rejected: they move the unit around
  without removing the decision from the consumers, which is where the
  seven bugs came from.
- Home Assistant's own conversion in the statistics call was rejected:
  it covers one of five doors, so the card would run two converters
  that can disagree in rounding.
- A conversion library was rejected: a runtime dependency and bundle
  weight for about forty rows, and still a mapping layer for Home
  Assistant's spellings.
- Display decimals live in the table, not with each row renderer. A row
  that wants another precision (the precipitation row drops the decimal
  from 10 mm on) keeps that as its own formatting step.
- The factors of the wind and pressure tables change in late digits
  when the live panel moves (for example mph, `1.60934` → `1.609344`).
  A rounded display value can then flip at a rounding boundary, which
  is why this slice leaves them alone.

## Related

- [ADR-0009](0009-lookup-table-pattern-for-unit-conversions.md) —
  lookup tables keyed `target->source`; superseded by this ADR once the
  live-panel slice replaces them
- [ADR-0015](0015-openmeteo-no-station-data-source.md) — Open-Meteo
  pinned to metric units; amended in the Open-Meteo slice
- [ADR-0026](0026-server-time-zone.md),
  [ADR-0030](0030-per-card-calendar.md) — the same shape for time
- [ADR-0031](0031-live-value-provenance.md) — the reading record that
  carries the unit today; amended in the live-panel slice
- #478 (tracking), #492 (this step)
- Community post 24, the pressure change next to inHg:
  https://community.home-assistant.io/t/weather-station-card-weather-station-meets-forecast/1011385/24
- Home Assistant's conversion table:
  https://github.com/home-assistant/core/blob/a55395accc9e041e0a40b7c6e44491d20d98bf09/homeassistant/util/unit_conversion.py
