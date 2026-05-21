# Sensors — setup recipes

Most sensors just need their entity ID under `sensors.*`. Two have additional considerations: precipitation (cumulative vs. rate) and sunshine duration (Open-Meteo integration).

→ Back to [README](../README.md)

## Setting up a precipitation sensor

The precipitation bars show **mm of rain per day**, not running totals.
Most weather-station integrations (Ecowitt, Pirateweather, BTHome,
ESPHome `pulse_meter`, …) expose a cumulative `total_increasing` counter
in mm — plug it into `sensors.precipitation` and the daily values come
out right. The data layer also accepts `total` counters and `measurement`
sensors that already represent "today's rain" (e.g. via a daily
`utility_meter`).

Note: for the **live "now" condition icon** to show rain, the sensor's
`unit_of_measurement` must be a *rate* (`mm/h`, `mm/hr`, `mm/hour`, `in/h`).
A cumulative counter still feeds the daily chart correctly, but the live
icon falls through to cloud/wind/fog. See
[CONDITIONS.md → Precipitation in the live condition needs a *rate* unit](CONDITIONS.md#precipitation-in-the-live-condition-needs-a-rate-unit)
for the mechanic.

### Live precipitation rate from a cumulative sensor

If your weather station only exposes a cumulative `mm` counter
(Ecowitt `*_precipitation`, BTHome `*_rain_total`, similar
0.1 mm tipping buckets), point `sensors.precipitation` at the
cumulative sensor directly — **the card derives the live `mm/h` rate
itself**. No HA-side helper required.

How it works:

- The card keeps a 15-minute mini-buffer of recent samples per entity,
  persisted to `localStorage` so the rate is available immediately
  after a hard reload.
- Rate is computed as `(latest − anchor) / (now − anchor)` using a
  sliding 3-sample anchor and a `now`-driven denominator. The
  denominator advances with wall-clock time even between sensor ticks,
  so the rate decays smoothly toward 0 during dry spells.
- Counter resets (midnight `*_rain_today` rollover, utility-meter
  resets, device reboots) are detected via monotonicity scan and the
  rate is computed only from the post-reset suffix.

The attribute-row **precipitation cell** (`show_precipitation: true`)
shows the derived value as `mm/h` with a rate-driven icon
(`water-off` / `weather-rainy` / `weather-pouring`). If you point
`sensors.precipitation` at a sensor whose unit *already* ends in `/h`
— e.g. a station-native rate channel or your own Derivative helper —
the card passes the value through unchanged, no derivation, no
buffering.

> **Manual override with the HA Derivative helper.** If you want
> server-side smoothing (e.g. your tipping bucket is coarser than
> 0.1 mm and the card-side buffer can't reach 3 samples within 15
> minutes during sparse drizzle), build a Derivative helper:
> Settings → Devices & services → Helpers → **Create helper** →
> **Derivative sensor**, source = your cumulative counter, Unit Time =
> `h`, Time Window = `00:05:00`. Wire the resulting
> `sensor.*_rain_rate` into `sensors.precipitation` and the card
> passes it through.

## Sunshine duration

Set `forecast.show_sunshine: true` and you're done. The card adds a
yellow half-bar on the right of every column (precipitation keeps the
left half) and a small "Xh" label at the top of the column. Sunshine
values come directly from
[Open-Meteo](https://open-meteo.com/)'s `daily=sunshine_duration`
endpoint — no extra sensors, no YAML, nothing to set up.

```yaml
forecast:
  show_sunshine: true
```

The card uses your Home Assistant location (`hass.config.latitude`
/ `longitude`) to query Open-Meteo, fetches once on first render, and
re-fetches at most once an hour. The response covers the past N days
plus the next N forecast days in a single call. The bar colour is
`forecast.sunshine_color` (default `#FFD700` yellow).

**Privacy note**: enabling sunshine sends your latitude / longitude to
`api.open-meteo.com` from each browser that renders the dashboard. The
data is fetched client-side, so it's not centralised on your HA server.
Open-Meteo's privacy policy is at
[open-meteo.com/en/terms](https://open-meteo.com/en/terms). If you'd
rather not have any browser call out, leave `show_sunshine` off
(default).

In hourly mode the bars are per-hour fractions (full bar = full hour
of sun, empty bar = night or fully overcast). The numeric "Xh" box is
suppressed at hourly because 168 narrow columns over a 7-day window
can't fit a label per bar — the bar height alone encodes the value.

### Limitations

- **Lux-derived sunshine** (use your own illuminance sensor instead of
  the Open-Meteo model) — calibration data in
  [issue #6](https://github.com/chriguschneider/weather-station-card/issues/6).
- **PV-output-derived sunshine** for users with a solar inverter — same
  issue.
- **Local-network-only operation** — the Open-Meteo path needs internet.

## Open-Meteo past block (no station sensors)

If you have a `weather_entity` but no weather station of your own, the
past (left) half of the chart is normally empty — there are no
`sensors.*` to draw history from. Set `forecast.openmeteo_history: true`
and the card fills that half from [Open-Meteo](https://open-meteo.com/)
instead: daily high/low temperature, precipitation, wind and condition
icons for the past days, sitting next to your weather entity's forecast.

```yaml
weather_entity: weather.home
forecast:
  type: daily
  openmeteo_history: true
```

What to know:

- It only kicks in when the card has **no** `sensors.*` configured.
  Wire even a single station sensor and the card uses that instead —
  the recorder is always preferred over the Open-Meteo model.
- It needs a `weather_entity` (which supplies the forecast half) and
  the station block left on (`show_station`, on by default).
- The values are Open-Meteo's model data for your location, not your
  own measurements. Humidity and pressure are not fetched, so those
  rows stay empty; the wind row shows the period's peak wind.
- Works in all three chart modes — daily, today and hourly.

**Privacy note**: same as the sunshine overlay — turning this on sends
your latitude / longitude to `api.open-meteo.com` from every browser
that renders the dashboard. The call is client-side, so nothing is
centralised on your Home Assistant server. If you would rather no
browser call out, leave `openmeteo_history` off (default). Open-Meteo's
privacy policy is at
[open-meteo.com/en/terms](https://open-meteo.com/en/terms).
