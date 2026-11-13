# 0031: Record and show the provenance of live values

**Status:** Accepted

**Date:** 2026-11-07

## Context

The live panel mixes origins. `_extractSensorReadings` takes a station
sensor's value when it has one, the sensor's last good value while it
is unavailable (#213), and otherwise falls back to the weather entity's
current attributes (`fromWxIfMissing`). Sun and moon are computed
in-card (ADR-0022). A user who wires a local station next to a forecast
provider cannot tell from the panel which number is measured and which
is the provider's. The typical case: an anemometer with a flat battery,
where the wind row silently switches to the forecast's wind.

`_attrEntity()` already links a row to an entity, but it names the
configured sensor even when that sensor is unavailable and the value
came from the weather entity, so it cannot serve as the source of truth
for provenance.

Alternatives considered:

- **A static legend card next to the card.** Cannot follow the
  per-value fallback (it does not know when the wind switches source).
- **Colour-coding values.** Conflicts with the existing semantic
  colours (pressure trend, dew-point bands) and is not accessible.
- **Deriving provenance at render time from `_attrEntity()`.** Wrong
  for the fallback case described above.

## Decision

- **`src/live-source.ts`** holds the pure logic: `resolveLiveSource()`
  mirrors the `fromWxIfMissing` rule and returns `station`, `stale` or
  `weather` with the entity id; `groupSources()` merges the sources of a
  combined row by kind; `sourceLabel()` resolves the tag text.
- **`_recordLiveSources()`** in `main.ts` runs at the end of
  `_extractSensorReadings` and stores one `LiveSource` per sensor key in
  `_liveSources`, plus `computed` for sun and moon. It reads the same
  `valueOf` / `stateOf` closures as the extraction, so the recorded
  source matches the shown value. Wind direction mirrors its own
  raw-state rule.
- **Rendering**: one info button (`_renderSourcesButton`) in the
  top-right corner of the live panel (class `wsc-sources-corner`, inside
  the clock's containing block; the clock shifts left by one icon width)
  opens `src/sources-popup.ts`; see *Presentation*
  below. The `SOURCE_KEYS_BY_TOKEN` map turns the attribute layout into
  the ordered list of shown live keys. With `show_sources` off the
  button and the line markers are not rendered, so the default render
  is unchanged.
- **Config surface**: `show_sources` (bool, `true`; on by default, set
  `false` to hide) in `DEFAULTS` and
  the live-panel editor section; `source_labels` (object, YAML only) as
  an extra top-level key in `config-validation.ts` and a delete-only
  path in the section reset.
- **Chart section** (`src/chart-legend.ts`, `_sourceLegend`): the
  popup's second section names the high/low colours, the solid station
  line, the dashed forecast line (`FORECAST_DASH`), and the
  precipitation and sunshine bars with their sources. The past source
  is Open-Meteo when `_openMeteoStationFallbackActive()` holds
  (ADR-0015); the sunshine bar names its source per part via
  `_sunshineSourceParts()`, mirroring `_sunshineNeedsOpenMeteo()`
  (ADR-0028): today's measured column comes from the sunshine /
  illuminance sensor (daily) or Open-Meteo, the forecast columns from the
  weather entity, Open-Meteo, or both when the entity covers only some.
  It is HTML, not uPlot's legend,
  which stays disabled: it labels encodings and sources rather than
  series values.
- Zero-degree rows are not listed: their sensors carry forecast data,
  so "Station" would mislead. Next rain is listed with the source its
  own tooltip already names (radar / forecast / station).
- Wording: the weather-entity source is "Weather service": live values
  from the provider are current values, not a forecast. Only the dashed
  chart line is called "Forecast".

## Presentation: info button instead of tags

The first draft (#424) put a tag after every live value and a legend
row under the chart. #431 replaces both with one info button that opens
a popup, for two reasons:

- **The overview stays clean.** Tags on every row add width (narrow
  cards wrapped) and repeat "Station" a dozen times for the common case
  where everything is measured. The details are one tap away.
- **A sensor problem is visible without a click.** Two states, no
  accent blue. OK: `mdi:information-outline` in `--secondary-text-color`.
  Problem: `mdi:alert-circle-outline` in `--warning-color` (fallback
  `#ff9800`), when a *configured* station sensor is unavailable and the
  card shows its last good value (#213) or the weather entity instead.
  The icon shape differs so the state is readable without colour; the
  accessible name becomes "Data sources: sensor problem". A value from
  the weather entity because no sensor is configured is by design and
  stays OK. The popup colours only the affected lines with
  `--warning-color`; a fallback line names the sensor ("sensor.x
  unavailable since 09:12"). Hover and focus do not change the OK icon's
  colour permanently.

The popup reuses the zero-degree popup's overlay pattern (plain DOM in
the shadow root outside `ha-card`, Escape / backdrop / × close, focus
trap, focus back to the opener, closed on teardown) in its own module,
so the zero-degree popup is untouched. The button reuses `_activatable`
(role button, Enter / Space); its accessible name comes from visually
hidden text. With `show_main: false` it sits next to the chart's
mode-toggle button; with neither a live block nor a chart there is no
button.

## Consequences

**Pros**

- Mixed setups become readable; a silent fallback (offline sensor)
  colours the info button and is named in the popup.
- On by default: every card gets the ⓘ (and the row markers); `show_sources: false` restores the previous render.
- Provenance is computed once per hass update next to the values, not
  re-derived per row.

**Cons**

- One more record per hass update (ten small objects); negligible next
  to the extraction itself.
- The source of a single value takes one tap instead of a glance; only
  the "something fell back" signal is on the card itself.
- Popup values are formatted by `_sourceValueText`, a second place
  next to the row helpers; sun and moon read the rendered line text
  instead of re-deriving the times.

**Tradeoffs**

- The sunshine legend entry names one source per part (measured /
  forecast), not per bar. When Open-Meteo fills only some forecast days
  the entry says "weather entity + Open-Meteo"; per-column attribution
  would need a mark on every bar.
- uPlot's built-in legend was not reused: it lists series with live
  values, not encodings and sources, and would need restyling.

## Related

- ADR-0008 (single source of defaults), ADR-0022 (computed sun/moon),
  ADR-0025 (attribute layout tokens), issue #213 (last-good fallback),
  #424 (tag presentation), #431 (info button), #330 (popup pattern).

## Amendment 2026-11-13 (#449): popup values come from the row helpers

The Consequences above name `_sourceValueText` as a second formatter
and say that sun and moon read the rendered line text. Both are gone.
`sourceValueText` (`src/live-panel/source-values.ts`) builds each value
from the same text helpers the row renders with (`pressureText`,
`dewPointText`, `sunText`, `moonText`, ...). Sun and moon derive their
times once and both the row and the popup read them. So the attribute
lines no longer carry a `data-wsc-token` marker, and `show_sources`
leaves the attribute markup unchanged in both states. Decided by: owner
(#449).
