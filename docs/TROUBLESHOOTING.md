# Troubleshooting

Common errors, what they mean, and what to do about them. The README has a [shorter quick-help section](../README.md#troubleshooting) covering the top three issues; this document is the full reference.

→ Back to [README](../README.md)

## Error banners

The card surfaces problems via a red banner at the top. Each line maps to
a concrete cause:

| Banner text                                | What broke                                                     | What to do |
| ------------------------------------------ | -------------------------------------------------------------- | ---------- |
| `Statistics fetch failed: …`               | The `recorder/statistics_during_period` WebSocket call threw three times in a row. Often a recently-added or renamed sensor with no history yet. | Wait an hour for the recorder to accumulate, or remove the entity from `sensors.*` until it has data. |
| `Forecast unavailable: weather_entity not configured` | `show_forecast: true` but `weather_entity:` is empty. | Set `weather_entity:` to a `weather.*` entity, or set `show_forecast: false`. |
| `Forecast unavailable: weather entity "X" not found` | The entity ID is misspelled or the integration is unloaded. | Check **Developer Tools → States** for the actual entity ID. |
| `Forecast unavailable: entity "X" does not support daily forecasts` | The integration only exposes `hourly` (e.g. some Met.no, OpenWeatherMap configurations). | Either pick a different `weather.*` entity, or accept that this card is daily-only for now (`forecast.type: hourly` is upstream-defined but not yet wired in this fork). |
| `Chart render failed: <phase>: …`          | Chart.js or one of the custom plugins threw mid-render. The phase tag (`compute` / `init` / `draw`) tells you the rough location; the message is the underlying error. | Open the browser devtools console for the full stack. Most often: a sensor whose `unit_of_measurement` changed mid-history, or a `condition_mapping` override with the wrong type. |
| `Sensors unavailable: temperature (sensor.X), …` | The listed entities exist but report `unavailable` / `unknown`. | Card stays alive — just shows the live panel without those values. Check the sensor in **Developer Tools** to see why it's offline. |

## The card looks empty / no chart appears

- **Brand-new sensor with no history.** The recorder takes one hour to
  produce the first daily statistic. Wait, then refresh.
- **Browser cached the old bundle after an update.** Resources go through
  HACS's `?hacstag=` query — bumping it (Settings → Dashboards → Resources,
  edit the entry, change the suffix) forces every browser to re-fetch.
  A "Reload frontend" via your user profile menu also works.
- **Rain bars look tiny or clipped.** The rain axis is scaled in the
  card's precipitation unit: at least 20 mm for daily columns, 4 mm for
  hourly ones, 1 in for inches. That unit is `units.precipitation` if
  set, else the unit of your rain sensor, else the weather entity's, else
  Home Assistant's. Check `unit_of_measurement` on the sensor if it is
  not the unit you expect.

## Today's column is doubled — is that a bug?

No — when both `show_station: true` and `show_forecast: true`, today
appears twice on purpose: once as the *measured* daily aggregate (left
edge of the forecast block), and once as the *predicted* value from
`weather_entity` (right edge of the station block). The two columns are
framed together by thicker borders to read as one "today" unit. Set
`show_forecast: false` for the original single-today layout.

## Live "now" icon shows the wrong condition

- **Rain icon never appears.** The live classifier ignores cumulative
  precipitation counters (see [CONDITIONS.md → Precipitation in the live condition needs a *rate* unit](CONDITIONS.md#precipitation-in-the-live-condition-needs-a-rate-unit)).
  If your weather station only exposes a cumulative `mm` counter,
  configure an **HA Derivative helper** to expose a `mm/h` rate
  sensor and wire that into `sensors.precipitation` — see
  [SENSORS.md → Live precipitation rate from a cumulative sensor](SENSORS.md#live-precipitation-rate-from-a-cumulative-sensor).
- **`sunny` at noon when it's overcast / `cloudy` at noon when it's clear.**
  The cloud-cover ratio is `lux_max / clearsky_lux`. Indoor or
  partially-shaded illuminance sensors will read low and trigger `cloudy`;
  sensors aimed at a reflective surface can read high and trigger `sunny`.
  Tune `condition_mapping.sunny_cloud_ratio` and `partly_cloud_ratio` to
  match your sensor's typical noon reading.
- **`fog` at every overnight humidity peak.** Fog requires *all three*:
  humidity ≥ 95 %, dew-point spread ≤ 1 °C, and wind_mean < 3 m/s. If
  you're seeing it on calm humid nights without actual fog, raise
  `fog_humidity_pct` to 97 or lower `fog_dewpoint_spread_c` to 0.5.

## Editor changes don't take effect

Visual editor edits hit `setConfig()` — most options apply on the next
render tick. If a field doesn't seem to update:

- Toggling `show_station` or `show_forecast` triggers a full data-source
  rebuild (~1 s). Wait a moment.
- Editor sliders bound to `forecast.*` sub-keys can sometimes write the
  string `'25'` instead of the number `25`; the card coerces, but if you
  see a chart sized oddly, check the YAML view for stray quotes.

## Tap / hold action does nothing in the editor preview

The card-configuration dialog renders a live preview of the card on
the right side. `tap_action`, `hold_action`, and `double_tap_action`
all *fire* in the preview — but the visual side effects of `navigate`
or `url` actions are obscured by the dialog overlay. If you're testing
a navigation action and nothing seems to happen, close the editor and
try the action on the real dashboard.

## Removed in v1.9.x

The following config keys no longer exist in the code path. Old YAML
configs that still set them are silently ignored (no error, no effect):

| Removed key | What replaced it |
| --- | --- |
| `icon_style` | The card no longer ships an animated/static icon-set switcher; HA's own MDI icons are used directly. |
| `animated_icons` | Same — animated icons removed entirely. |
| `icons` (custom URL) | Same — custom icon paths are no longer plumbed in. |

If you're still maintaining a v1.x YAML, remove these keys at your
leisure. `forecast.show_wind_forecast` is **deprecated but still
works** as a hard master-off until v2.0 — see
[CONFIGURATION.md → Layout & Display](CONFIGURATION.md#layout--display).

## Known limitations

For the entries below, the YAML keys are parsed but the behaviour is
either upstream-defined or vestigial. Tracking issues are linked.

| Field | Symptom | Tracking |
| --- | --- | --- |
| Hourly wind values blank with Open-Meteo | At `forecast.type: hourly`, the wind row of the *forecast* block renders empty cells when the upstream `weather.*` integration omits per-hour wind data. HA's Open-Meteo integration ([source](https://github.com/home-assistant/core/blob/dev/homeassistant/components/open_meteo/weather.py) — see `_async_forecast_hourly`) currently ships only `datetime`, `condition`, `precipitation` and `temperature` per hourly entry; `wind_speed` / `wind_bearing` are present only on the daily branch. Met.no and other integrations may differ. The card hides the arrow + value when either field is missing, so cells stay empty rather than showing a default-direction arrow with an orphan unit. | upstream integration |

Reactions / comments on the linked issues help prioritise the wiring
work. PRs welcome — the relevant code paths are linked from each issue.
