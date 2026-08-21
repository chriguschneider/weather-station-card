# Configuration reference

This document describes every YAML key supported by the card.

→ Back to [README](../README.md)

## Minimal examples

Three typical starting points — every other key below is optional.
(Adding the card through the UI pre-fills the sensors via ranked
auto-detect, so most cards never need hand-written YAML at all.)

**Combination** (the default: past station history + forecast):

```yaml
type: custom:weather-station-card
weather_entity: weather.home
sensors:
  temperature: sensor.outdoor_temperature
```

**Station only** (no `weather.*` entity needed):

```yaml
type: custom:weather-station-card
show_forecast: false
sensors:
  temperature: sensor.outdoor_temperature
  precipitation: sensor.rain_counter
```

**Forecast only, no station** (the past half of the chart comes from
Open-Meteo — see [SENSORS.md](SENSORS.md#open-meteo-past-block-no-station-sensors)):

```yaml
type: custom:weather-station-card
weather_entity: weather.home
forecast:
  openmeteo_history: true
```

## Editor-section mapping

The visual editor (redesigned in the v2.3 cycle, ADR-0023) shows the
basics directly and collapses everything else into five panels. The
reference below stays organised by config-key category (easier when
you're searching for a specific YAML key); this table maps each editor
block to where its keys live in the reference.

| Editor block | Where the keys are documented |
| --- | --- |
| Basics (always visible) | [General](#general) — `show_station` + `show_forecast` (the mode dropdown), `forecast.type`, `title`, `weather_entity` |
| Your weather station's sensors | [Sensors](#sensors) — `sensors.*`; the "Past data" source dropdown drives `forecast.openmeteo_history` |
| Chart | [General](#general) (`days`, `forecast_days`) and [Chart appearance](#chart-appearance) (`forecast.number_of_forecasts`, `forecast.chart_height`, the chart-row toggles, `forecast.style`) |
| Live panel | [Layout & Display](#layout--display) — the main-panel elements, the clock dropdown (`show_time`, `show_time_seconds`, `use_12hour_format`), and the attribute cells |
| Units | [Units](#units) |
| Actions | [Actions](#actions) |

Some keys (label/precip-bar sizes, individual colour overrides, font
sizes, `locale`, `condition_mapping`, `debug`) are not surfaced in the
editor but remain working YAML keys — see the relevant tables below
for "YAML-only" markers.

## General

The mode selector decides which blocks render. The YAML keeps two
separate booleans (`show_station`, `show_forecast`) for backwards
compatibility — the editor projects them onto a single radio.

**New cards default to combination** (both flags `true`) — past
station data on the left, forecast on the right. Set one to `false`
for a single-block card.

**Forecast-only mode without station sensors** is supported: the card
falls back to the configured `weather_entity`'s attributes for live
values (`humidity`, `pressure`, `dew_point`, `uv_index`, `wind_speed`,
`wind_bearing`, `wind_gust_speed`). The attributes row in the live
panel only surfaces toggles for keys that have a backing value — a
sensor under `sensors.*` or an attribute on the weather entity.

**Past block without station sensors.** A card needs *something* to
draw the past (station) half of the chart: either a station sensor, or
the `forecast.openmeteo_history` opt-in (Open-Meteo backfill — see the
chart-rows table below and [SENSORS.md](SENSORS.md#open-meteo-past-block-no-station-sensors)).
When neither is set, the visual editor disables the Station and
Combination mode options, switches the card to forecast-only, and
shows a hint in the Sensors section explaining how to get the past
block back — turn the opt-in on, or wire a station sensor. Enabling
either re-enables the mode options. (A hand-written YAML config that
sets `show_station: true` with no sensors and the opt-in off keeps the
old behaviour — an empty past area; only the editor steers you away
from it.)

**Invalid YAML safety net (since v1.9.0)**: structural errors in the
config (wrong types, malformed `condition_mapping`, non-`sensor.*`
entity IDs under `sensors.*`, non-`weather.*` under `weather_entity`)
make HA fall back to the YAML editor instead of trying to render the
visual editor against a config that can't be edited safely.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | — | Always `custom:weather-station-card`. |
| `title` | string | _none_ | Card header. Omit for a header-less card. |
| `show_station` | bool | `true` | Render the past station-history block on the left. (Editor: Mode.) |
| `show_forecast` | bool | `true` | Render the forecast block on the right. (Editor: Mode.) Requires `weather_entity`. |
| `weather_entity` | string | _none_ | `weather.*` entity used for the forecast block. Required when `show_forecast: true`. |
| `days` | integer | `7` | Number of past days (station block). 1–14. |
| `forecast_days` | integer | `days` | Number of forecast columns; defaults to the same span as `days`. |
| `tap_action` | object | `{ action: none }` | Action triggered by a single click on the card. See [Actions](#actions) below. |
| `hold_action` | object | `{ action: none }` | Action triggered by holding the card for ≥ 500 ms. |
| `double_tap_action` | object | `{ action: none }` | Action triggered by a double click within 250 ms. |
| `debug` | bool | `false` | When `true`, appends a collapsible diagnostics panel below the card content showing what the card detected — resolved sensor entities, the chosen render mode, each data source's subscription status, and the reason a chart column may be empty. Use it to troubleshoot a misconfigured card, then remove the key. YAML-only — there is no editor toggle. |

### Actions

The card exposes the standard Home Assistant action selector for tap, hold,
and double-tap. The supported `action` values are the ones HA's UI editor
offers — `more-info`, `navigate`, `url`, `toggle`, `perform-action`,
`assist`, and `none` (the default). The action runs on the **whole card**;
clicks anywhere on the chart, the main panel, or the attribute row trigger
the same configured action.

```yaml
tap_action:
  action: navigate
  navigation_path: /lovelace-garden
hold_action:
  action: more-info
  entity: sensor.outdoor_temperature
double_tap_action:
  action: perform-action
  perform_action: light.toggle
  target:
    entity_id: light.terrace
```

For `more-info` and `toggle`, if no `entity` is set the action falls back to
`sensors.temperature`. The cursor only switches to a hand when at least one
action is non-`none`, so the default read-only card looks read-only.

## Sensors

All keys are sensor `entity_id`s. Values populate the chart, the live "now"
classifier, and (where relevant) the attribute readouts. Only
`sensors.temperature` is strictly required.

| Key | Used for |
| --- | --- |
| `sensors.temperature` | Temperature curves (high/low), main-panel temperature, classifier |
| `sensors.humidity` | Humidity attribute, fog detection |
| `sensors.illuminance` | Cloud-cover ratio for live + daily conditions, and the lux-derived station sunshine. Accepts a plain illuminance sensor (lx) **or a solar-irradiance sensor (W/m², `device_class: irradiance`)** — irradiance readings are converted internally at 120 lm/W (daylight luminous efficacy); tune via `condition_mapping.sunshine_lux_ratio` if needed. *(irradiance support since v2.2.3)* |
| `sensors.precipitation` | Precipitation bars, rainy/pouring/snowy classification |
| `sensors.pressure` | Pressure attribute |
| `sensors.wind_speed` | Mean-wind classification, attribute readout |
| `sensors.gust_speed` | Gust-based windy/exceptional classification |
| `sensors.wind_direction` | Wind direction attribute & arrow |
| `sensors.uv_index` | UV attribute |
| `sensors.dew_point` | Fog detection (combined with humidity) |
| `sensors.sunshine_duration` | Today's live sunshine value (scalar, seconds or hours auto-detected at the `≥ 30` threshold). Past columns fall back to the recorder's daily-max for this same sensor. Only used when `forecast.show_sunshine: true`. *(since v0.9; fully wired in daily fetch since v1.4.)* |
| `sensors.moon_phase` | **Deprecated (v2.3, ADR-0022)** — the moon line is now computed in-card and reads no entity, so [HA's Moon integration](https://www.home-assistant.io/integrations/moon/) is no longer needed. The key is accepted and ignored so older configs keep validating. Use [`show_moon`](#layout--display) to control the line. *(entity-fed v2.2 only)* |

## Layout & Display

Three master toggles (`show_main`, `show_attributes`, plus the chart-row
toggles). In the editor each master expands its sub-fields only when
ON; in YAML the sub-keys are evaluated regardless.

**Main panel** (gated by `show_main: true`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `show_main` | bool | `false` | Show the live "now" panel (icon + temperature + condition). |
| `show_temperature` | bool | `true` | Show current temperature. |
| `show_current_condition` | bool | `false` | Show condition text under temperature. |
| `show_time` | bool | `false` | Live clock. |
| `show_time_seconds` | bool | `false` | Include seconds in the clock. |
| `use_12hour_format` | bool | `false` | Use 12-hour clock. |
| `show_day` | bool | `false` | Day-of-week label. |
| `show_date` | bool | `false` | Date label. |

**Attributes row** (gated by `show_attributes: true`; each entry
requires a backing value — either a sensor under `sensors.*` or the
matching attribute on `weather_entity`)

> **Opt-out semantics for the headline attributes**: pressure, UV,
> wind-direction, and wind-speed default to *visible* when their
> backing value is present. The `false` defaults in the table mean
> "absent unless the renderer sees a value"; the runtime check is
> `cfg.show_x !== false`, so omitting the key keeps the attribute
> visible. Set `show_x: false` explicitly to hide.
> `show_humidity`, `show_dew_point`, `show_wind_gust_speed`,
> `show_illuminance`, `show_precipitation`, `show_sunshine_duration`,
> and `show_sun` are opt-in (require an explicit `true`).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `show_attributes` | bool | `false` | Show humidity / pressure / dew point / sun / wind row. |
| `show_humidity` | bool | `false` | Humidity, rendered on the dew-point line after the dew point (opt-in). When `show_dew_point` is off or no dew-point value is wired, humidity takes the line alone. *(changed in v2.3: was its own row)* |
| `show_pressure` | bool | opt-out (`true` when value present) | Pressure attribute. |
| `show_dew_point` | bool | `false` | Dew-point attribute (opt-in). |
| `show_uv_index` | bool | opt-out (`true` when value present) | UV index attribute. |
| `show_illuminance` | bool | `false` | Illuminance attribute (opt-in, requires `sensors.illuminance`). |
| `show_precipitation` | bool | `false` | Precipitation attribute (opt-in, requires `sensors.precipitation`). A rate sensor shows its live rate; a cumulative counter is turned into a live rate. The display unit follows the sensor's own unit (`mm`/`mm/h` or `in`/`in/h`) and can be overridden via [`units.precipitation`](#units). See [SENSORS.md → Setting up a precipitation sensor](SENSORS.md#setting-up-a-precipitation-sensor) for live-rate guidance. |
| `show_sunshine_duration` | bool | `false` | Sunshine-duration attribute (opt-in, requires `sensors.sunshine_duration`). |
| `show_wind_direction` | bool | opt-out (`true` when value present) | Wind-direction arrow. |
| `show_wind_speed` | bool | opt-out (`true` when value present) | Wind-speed value. |
| `show_wind_gust_speed` | bool | `false` | Gust speed (opt-in, requires `sensors.gust_speed` or weather-entity attribute). |
| `show_sun` | bool | `false` | Sunrise / sunset row (opt-in). |
| `show_moon` | bool | `true` (renders with the sun cell) | Moon line inside the sun cell: dynamically drawn disc showing the exact illuminated fraction, the percentage, and the next moonrise/moonset. Computed in-card (ADR-0022) — no sensor or Moon integration required; rise/set times come from HA's configured location and are omitted when it has none. On the southern hemisphere the disc is mirrored to match the local view. Set `false` to keep the sun cell sun-only. *(since v2.3)* |

**Chart rows**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.condition_icons` | bool | `true` | Condition icons row above the chart. |
| `forecast.show_wind_arrow` | bool | `true` | Per-day wind-direction arrow. Independent of `show_wind_speed` since v1.9.x — either toggle alone surfaces the wind row. When both are on and a column is too narrow to fit the arrow + speed side-by-side, the speed wraps onto a second line below the arrow. |
| `forecast.show_wind_speed` | bool | `true` | Per-day wind-speed value. Independent of `show_wind_arrow` since v1.9.x. |
| `forecast.show_wind_forecast` | bool | `true` | ⚠️ **Deprecated in v1.9.x, removal v2.0.** Legacy master toggle that hides the entire wind row when set to `false`. The editor doesn't expose it. New configs should use the independent `show_wind_arrow` and `show_wind_speed` toggles instead — set both to `false` for the same effect. |
| `forecast.show_date` | bool | `true` | `dd/mm` date row in the X-axis. When off, only the weekday is rendered. |
| `forecast.show_mode_toggle` | bool | `true` | Show the small in-card button that cycles the view daily → today → hourly. On by default; set to `false` to hide it and lock the card to its configured `forecast.type` (the change is not persisted otherwise — a refresh resets it). |
| `forecast.show_sunshine` | bool | `false` | Sunshine-duration column inside the chart — half-bar in yellow on the right of every column (precipitation keeps the left half), with the day's hours rendered as a small "Xh" label at the top of the column. Off by default; turning it on without configuring at least one of the sunshine sensors below renders empty bars and labels (no warning, no banner). See [SENSORS.md → Sunshine duration](SENSORS.md#sunshine-duration) for setup. |
| `forecast.openmeteo_history` | bool | `false` | Fills the **past** (left) half of the chart from Open-Meteo's historical model data — temperature, precipitation, wind and condition icons — for cards that have a `weather_entity` but no station `sensors.*`. Works in daily, today and hourly modes. Off by default. Has no effect once any station sensor is configured (the recorder is always preferred) or when there is no weather entity. Sends your Home Assistant location to Open-Meteo — see [SENSORS.md → Open-Meteo past block](SENSORS.md#open-meteo-past-block-no-station-sensors). |

## Chart appearance

**Chart appearance**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.style` | `'style2' \| 'style1'` | `'style2'` | Temperature-label rendering. `style2` (default) shows plain text beside the lines; `style1` boxes each value with the line-coloured border. |
| `forecast.round_temp` | bool | `true` | Round temperature labels to integers. |
| `forecast.disable_animation` | bool | `false` | Disable chart redraw animation. |

**Sizing** (YAML-only since v1.9.x — most users never adjust these)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `icons_size` | number (px) | `25` | Forecast-row icon size. |
| `current_temp_size` | number (px) | `28` | Main-panel temperature font size. |
| `time_size` | number (px) | `26` | Clock font size. |
| `day_date_size` | number (px) | `15` | Day / date label font size. |
| `forecast.labels_font_size` | number (px) | `11` | Chart axis tick label size. The wind unit and the precip unit ("mm" / "km/h") render at half this size. |
| `forecast.chart_height` | number (px) | `180` | Chart canvas height. |
| `forecast.precip_bar_size` | number (%) | `100` | Width of precipitation bars (0–100 %). |

**Colours** (YAML-only since v1.9.x — defaults are literal RGBA)

Each default is a literal RGBA string. Theme-aware colour tokens were
tried in v1.9.0 but caused bugs (`--warning-color` resolved to orange
for sunshine; some `--state-sensor-*-color` tokens we picked don't
actually exist in HA), so the defaults are now pinned to predictable
literals. Pass your own `var(--ha-token, fallback)` string in YAML to
opt back into theme-driven colouring for any of these — the resolver
expands user-supplied `var(...)` exactly as before.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.temperature1_color` | CSS colour | `rgba(255, 152, 0, 1.0)` | High-temperature curve. |
| `forecast.temperature2_color` | CSS colour | `rgba(68, 115, 158, 1.0)` | Low-temperature curve. |
| `forecast.precipitation_color` | CSS colour | `rgba(132, 209, 253, 1.0)` | Precipitation bars. Forecast bars (combination mode) render at ~45 % of this colour's alpha. |
| `forecast.sunshine_color` | CSS colour | `rgba(255, 215, 0, 1.0)` | Sunshine bars. Same forecast-side alpha treatment as precipitation. |
| `forecast.chart_datetime_color` | CSS colour or `'auto'` | _none_ | X-axis weekday / date colour. |
| `forecast.chart_text_color` | CSS colour or `'auto'` | _none_ | All other chart text colour. |

## Units

| Key | Values | Description |
| --- | --- | --- |
| `units.pressure` | `'hPa' \| 'mmHg' \| 'inHg'` | Display unit; auto-converts from the sensor's native unit. |
| `units.speed` | `'m/s' \| 'km/h' \| 'mph' \| 'Bft'` | Display unit; auto-converts. |
| `units.precipitation` | `'mm' \| 'in'` | Display unit for the precipitation attribute; auto-converts (mm ↔ in) for both rate sensors and cumulative-counter-derived rates. Defaults to the sensor's own unit, so an inch sensor reads `in` / `in/h` with no config. |

## Advanced

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.type` | `'daily' \| 'hourly' \| 'today'` | `'daily'` | At hourly, station data is fetched at hour resolution (mean per hour, single temperature line) and the forecast is subscribed with `forecast_type: hourly`. `days` / `forecast_days` define the data window (so `days: 4` at hourly = 96 hours of station history). The `'today'` mode (since v1.4; reworked as a **day pager** in v2.2) frames exactly one calendar day of 3-hour blocks per viewport and pages day-wise through the whole `days` window — chevrons step ±1 day, free scrolling snaps to day boundaries. Editor radio in Setup. See [Daily vs. hourly resolution](#daily-vs-hourly-resolution) below. |
| `forecast.number_of_forecasts` | integer | `8` | Number of bars visible in the viewport at once. Default `8` works across the modes — at daily with `days: 7` everything fits without scrolling, at hourly it caps the viewport at ~8 hours and the user scrolls. Set `0` for "fit all" (no scrolling). **Ignored in `'today'` mode**, which always frames one calendar day (8 × 3-h blocks). When more bars are loaded than visible, the chart row + wind row + conditions row scroll horizontally in lockstep, and a slim day timeline below the chart shows where you are (click/scrub it to navigate). Initial scroll position is "now" (centred at the station/forecast boundary in combination mode; the current day's page in `'today'`). |
| `locale` | string | HA's selected language | Override locale (e.g. `de`, `fr`). Falls back to English for missing keys. |

### `condition_mapping` — override classifier thresholds

Every value documented in [CONDITIONS.md → How conditions are determined](CONDITIONS.md#how-conditions-are-determined)
can be overridden. Defaults are meteorologically grounded — only set what you
want to change. The editor exposes the same fields under Advanced; empty
fields use the default.

| Key                        | Unit  | Default | Used by rule |
| -------------------------- | ----- | ------- | ------------ |
| `rainy_threshold_mm`       | mm    | 0.5     | Precipitation tier (rainy / snowy / snowy-rainy) |
| `pouring_threshold_mm`     | mm    | 10      | Precipitation tier (pouring) |
| `exceptional_gust_ms`      | m/s   | 24.5    | Exceptional (Beaufort 10) |
| `exceptional_precip_mm`    | mm    | 50      | Exceptional (NWS heavy-rain outlook) |
| `snow_max_c`               | °C    | 0       | snowy cutoff (temp_max ≤ value) |
| `snow_rain_max_c`          | °C    | 3       | snowy-rainy cutoff |
| `fog_humidity_pct`         | %     | 95      | Fog rule (humidity ≥ value) |
| `fog_dewpoint_spread_c`    | °C    | 1       | Fog rule (temp_min − dew_point ≤ value) |
| `fog_wind_max_ms`          | m/s   | 3       | Fog rule (wind_mean < value — fog dissipates with wind) |
| `windy_threshold_ms`       | m/s   | 10.8    | windy / windy-variant on gust |
| `windy_mean_threshold_ms`  | m/s   | 8.0     | windy / windy-variant on mean wind |
| `sunny_cloud_ratio`        | ratio | 0.70    | sunny cutoff (cloud_ratio ≥ value) |
| `partly_cloud_ratio`       | ratio | 0.30    | partlycloudy cutoff |

```yaml
# Example: warmer-climate station that should never report snow,
# and a sheltered location where 5 m/s gusts already feel "windy".
condition_mapping:
  snow_max_c: -5
  snow_rain_max_c: 1
  windy_threshold_ms: 5
```

```yaml
# Example: indoor-mounted illuminance sensor that maxes out earlier
# than outdoor; lower the sunny cutoff so noon still classifies as sunny.
condition_mapping:
  sunny_cloud_ratio: 0.55
  partly_cloud_ratio: 0.20
```

## Daily vs. hourly resolution

`forecast.type` (added in v0.8) flips both blocks to hour resolution:
station data is aggregated per hour from the recorder (`period: 'hour'`,
mean per slot, single temperature line), and the forecast subscribes
with `forecast_type: 'hourly'`. Combination mode renders past hours +
future hours joined at a "now" line — no doubled-today column.

`days` and `forecast_days` keep their meaning at hourly: they're
the **data window in days**, so `days: 7` at hourly loads `7 × 24 =
168` hours of station history. `forecast.number_of_forecasts`
controls how many of those bars are visible at once — the chart
row, conditions row, and wind row all scroll horizontally in
lockstep. Default `8` works for both modes (fits 7-day daily without
scrolling and caps the hourly viewport at ~8 hours); set `0` to
disable the viewport and show everything.
