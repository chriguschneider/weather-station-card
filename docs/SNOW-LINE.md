# Snow line

Two attribute rows show where the zero-degree level, and with it the snow line, is.

→ Back to [README](../README.md)

Both rows read ordinary sensors, so they need the
[MeteoSwiss Weather](https://github.com/chriguschneider/hass-meteoswiss-weather)
integration's *Zero-degree level* and *Zero-degree level, lowest in 48 h*
sensors (both disabled by default there: enable them in the entity
settings) or any sensor of your own. Wire them as
`sensors.zero_degree_level` and `sensors.zero_degree_level_48h` and
switch on `show_zero_degree_level` / `show_zero_degree_level_48h`.

- **Zero-degree level (now).** The icon tells how close the snow line is
  to your site. The snow line is estimated 300 m below the zero-degree
  level, an estimate only. The icon changes when it comes within 300 m
  of your site and again when it reaches it.
- **Zero-degree level in 48 h (trend row).** An arrow shows direction
  and pace (rises fast · rises · stays · falls · falls fast), followed
  by the next low or high with weekday and time. The tooltip adds the
  turn after it ("then up to …"). If that low brings the snow line down
  to your site, the value takes the chart's precipitation colour and a
  ❄ is put in front of it.
- **Popup on tap.** Tapping either zero-degree row opens the forecast curve with
  day separators, the low point marked and a *History* button. Any
  sensor with a `forecast` attribute of `{datetime, level}` points
  works for the popup.

## Site elevation

Your site's elevation comes from, in this order: `location.elevation`,
the card's top-level `elevation:` option (deprecated, move it to
`location.elevation`; removal is planned for 4.0), the sensor's
`elevation` attribute, and last Home Assistant's settings
(Settings → System → General). With a `location`, Home Assistant's
elevation is not used (it describes another place).

Thresholds and details: [CONFIGURATION.md](CONFIGURATION.md#zero-degree-rows).
