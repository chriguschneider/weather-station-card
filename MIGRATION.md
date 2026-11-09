# Migration guide

A single source of truth for every config-key removal, behaviour
change, and breaking refactor between major / minor releases. If
you're upgrading from an older version, scan this for any keys you
still set in your YAML.

Yet-unknown keys are silently ignored by Home Assistant, so an
out-of-date YAML keeps loading after an upgrade — but the keys do
nothing. Removing them keeps your config self-documenting.

## v3.0

### What changes on screen when you upgrade from 2.14

Existing configurations keep working. You will notice:

- Daily columns follow the card's own calendar (its time zone), cut from hourly statistics.
- The sunrise/sunset row is computed in the card from its location and is no longer a link to the `sun.sun` entity.
- `time_zone` defaults to `server`: times follow the Home Assistant server's time zone unless you set `location` and `time_zone: location` (or an IANA name).
- A small ⓘ info button appears in the top-right corner of every card (the clock moves slightly to the left). It lists where each live value comes from and turns orange when a station sensor has been unavailable for more than 5 minutes. To hide it, switch off "Info button: data sources" in the editor or set `show_sources: false`.
- Refresh the browser cache after updating (hard reload, or clear the app cache in the Home Assistant companion app), otherwise the old card keeps running.

### Deprecated: top-level `elevation`

The site elevation now lives in `location.elevation`. The top-level
`elevation:` option keeps working in 3.x exactly as before, but it is
deprecated and will be removed in 4.0. Nothing breaks today; when you
edit the card's location in the visual editor, the value is moved for
you. To change it by hand:

```yaml
# Before
elevation: 1200
location:
  time_zone: Europe/Zurich

# After
location:
  time_zone: Europe/Zurich
  elevation: 1200
```

A card without `location` has nowhere to put it and keeps the top-level
`elevation:` for now.

A card whose `location` has coordinates already ignores the top-level
`elevation:` (it may describe another place), and the editor leaves it
alone. Set `location.elevation` if you want the value to apply there.

## v1.9

### Removed config keys

The following keys are no longer parsed. Old YAML that still sets them
keeps loading without error, but the keys have no effect. Remove them
when convenient:

- `icon_style` — the icon-set switcher is gone; HA's MDI icons are
  used directly.
- `animated_icons` — animated SVG icon path removed.
- `icons` (custom URL) — custom icon paths are no longer plumbed in.

```yaml
# Before
icon_style: style2
animated_icons: true
icons: https://example.com/icons/

# After: just remove the lines.
```

### Default change — combination is the new default

New cards added via the picker default to **combination mode**
(`show_station: true` + `show_forecast: true`) instead of station-only.
**Existing cards are unaffected** — your current `show_station` /
`show_forecast` values are preserved.

If you want a new card in station-only or forecast-only mode, switch
in section 1 of the editor or set the corresponding flag to `false`.

### Deprecated — `forecast.show_wind_forecast`

The legacy master-off toggle for the chart's wind row still works as a
hard kill-switch for v1.x configs that explicitly set it to `false`.
**Slated for removal in v2.0.** Migrate to the independent toggles:

```yaml
# Before (still works in v1.9.x, will break in v2.0)
forecast:
  show_wind_forecast: false

# After
forecast:
  show_wind_arrow: false
  show_wind_speed: false
```

If you set `show_wind_forecast: true` (or omit it), nothing changes —
the deprecation only matters if you used it as a hard off switch.

### Forecast-only mode now uses weather-entity attributes

If you run a forecast-only card (no station sensors wired), the live
panel's attribute row will now read `humidity`, `pressure`,
`dew_point`, `uv_index`, `wind_speed`, `wind_bearing`, and
`wind_gust_speed` from the configured `weather_entity`'s attributes
when present. **No YAML change is required**; this is informational so
you know why attributes might appear that previously didn't surface.

### Theme-aware default chart colours (introduced v1.9.0, reverted v1.10.x)

v1.9.0 wired chart line / bar colour defaults to HA theme tokens
(`var(--token, rgba-fallback)`). The follow-up audit in #121 found
that some of those tokens didn't mean what their names suggested
(`--warning-color` is HA's alert orange, not "warm yellow") and others
didn't actually exist in HA at all. Defaults are now back to literal
RGBA strings that don't drift per theme. **No YAML change required in
either direction**; user-set RGBA / hex / hsl strings still
pass-through, and you can opt back into theme-driven colouring by
passing your own `var(--token, fallback)` string in YAML.

### Editor sizing / colours / font-sizes are YAML-only

The editor no longer surfaces individual chart sizes
(`forecast.labels_font_size`, `forecast.chart_height`,
`forecast.precip_bar_size`), live-panel font sizes (`icons_size`,
`current_temp_size`, `time_size`, `day_date_size`), or per-key colour
overrides. **The keys keep working in YAML** — the visual editor just
has a smaller surface. Most users never touch these; if you do, see
[CONFIGURATION.md → Layout & Display](docs/CONFIGURATION.md#layout--display)
and [CONFIGURATION.md → Chart appearance](docs/CONFIGURATION.md#chart-appearance).

## v0.x → v1.0

v1.0 is a quality release: speed, tests, docs, accessibility. **No new
config keys, no removed config keys.** Existing v0.9 YAML keeps
working unchanged.

If you're coming from v0.8 or earlier, also work through the v0.8.x
sections below.

## v0.8.4 — `autoscroll` removed (issue #3)

The `autoscroll: true` toggle has been removed. The original timer
fired every hour but only triggered a redraw — there was no
horizontal pan or "centre 'now' in the visible window" logic
anywhere. v0.8's hourly viewport scrolling and the v0.8.2
jump-to-now button cover the user intent better.

```yaml
# Before (v0.8.3 and earlier)
autoscroll: true
```

```yaml
# After: just remove the line. The chart already starts centred on
# "now" in combination mode, and the jump-to-now button (visible
# when scrolled away) returns there in one click.
```

## v0.8.4 — Hourly classifier thresholds rescaled (issue #7)

When `forecast.type: hourly`, station hours and the live "current
condition" snapshot now classify with precipitation thresholds
calibrated for 1-hour totals instead of 24-hour totals:

| Threshold | Daily | Hourly |
|---|---|---|
| `rainy_threshold_mm` | 0.5 mm/24h | 0.1 mm/h |
| `pouring_threshold_mm` | 10 mm/24h | 4 mm/h |
| `exceptional_precip_mm` | 50 mm/24h | 30 mm/h |

Wind / gust / fog / cloud thresholds use the same value at either
period (those are instantaneous / mean values, not totals). Daily
classification is bit-identical to v0.8.3.

`condition_mapping` overrides in your YAML still apply on top of
the per-period defaults — the key names are the same. **No YAML
change is required**; this section is informational so you know what
changed if your hourly chart suddenly classifies things differently.

If you previously tuned thresholds for hourly use via overrides and
want to restore the exact pre-v0.8.4 behaviour, set:

```yaml
condition_mapping:
  rainy_threshold_mm: 0.5
  pouring_threshold_mm: 10
  exceptional_precip_mm: 50
```

## v0.8.3 — `forecast.precipitation_type` and `forecast.show_probability` removed (issue #4)

Both keys read `precipitation_probability` directly from
`weather/get_forecasts`, which most weather integrations relevant in
DACH (Open-Meteo daily, MeteoSchweiz, certain Met.no setups) don't
populate. The toggles silently produced no visible effect upstream;
the fork's `MeasuredDataSource` never had a probability field at all,
so probability mode + station data was always inert.

```yaml
# Before — these are now silently ignored:
forecast:
  precipitation_type: 'probability'
  show_probability: true
```

```yaml
# After: just remove the keys. If you genuinely need a probability
# overlay, raise an issue describing your weather integration —
# wiring this back correctly would need a per-column dataset switch
# rather than a global mode flag.
```

## Upstream `weather-chart-card` → this fork

If you originally configured the upstream `mlamberts78/weather-chart-card`,
this fork has substantially different defaults:

- `show_main: false` by default (upstream had it on); the live "now"
  panel is opt-in here.
- `show_station: true` by default; the historical block is the card's
  raison-d'être.
- `weather_entity` is OPTIONAL when `show_forecast: false`, since
  station-only mode doesn't need a forecast source.
- The `condition_mapping` block under `forecast.*` is supported here
  for tuning the classifier; upstream had no equivalent.

See README's "Configuration reference" for the full v1.0 schema.
