# 0031: Record and show the provenance of live values

**Status:** Proposed

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
- **Rendering** appends tags in `_renderAttributeLine` via the
  `SOURCE_KEYS_BY_TOKEN` map and after the main temperature.
  `_sourceTags()` returns `nothing` unless `show_sources` is true, so
  the default render is unchanged.
- **Config surface**: `show_sources` (bool, `false`) in `DEFAULTS` and
  the live-panel editor section; `source_labels` (object, YAML only) as
  an extra top-level key in `config-validation.ts` and a delete-only
  path in the section reset.
- Zero-degree and next-rain rows get no tag: their sensors carry
  forecast or radar data, so "Station" would mislead and the existing
  next-rain tooltip already names its source.

## Consequences

**Pros**

- Mixed setups become readable; a silent fallback (offline sensor) is
  visible as a "Forecast" tag in place of a station value.
- Opt-in and render-neutral when off: no change for existing cards.
- Provenance is computed once per hass update next to the values, not
  re-derived per row.

**Cons**

- One more record per hass update (ten small objects); negligible next
  to the extraction itself.
- The tags add width to attribute rows; narrow cards may wrap.

**Tradeoffs**

- Chart series (solid station vs dashed forecast lines) are not
  labelled by this change; the chart already encodes the split by line
  style. A chart legend would be a separate decision.

## Related

- ADR-0008 (single source of defaults), ADR-0022 (computed sun/moon),
  ADR-0025 (attribute layout tokens), issue #213 (last-good fallback).
