# Next rain with MeteoSwiss Radar

Show when rain is next expected in the live panel, using the MeteoSwiss Radar integration's *Next rain* sensor.

→ Back to [README](../README.md)

The live panel can show when rain is next expected. The value comes from
the **Next rain** sensor of the
[MeteoSwiss Radar](https://github.com/chriguschneider/hass-meteoswiss-radar)
integration. That sensor in turn can draw on the hourly forecast of a
`weather.*` entity, for example from
[MeteoSwiss Weather](https://github.com/chriguschneider/hass-meteoswiss-weather):

```text
weather entity ──(hourly forecast)──▶ MeteoSwiss Radar ──(sensor …_next_rain)──▶ this card
```

Each link is an ordinary Home Assistant entity. The projects never call
each other directly, so any part can be swapped or left out.

## Setup

1. Install MeteoSwiss Radar and turn on *Rain sensors for my home* in its
   options (off by default). If the radar is installed but this is off,
   the card editor shows a hint pointing there.
2. Optional: in the same options, pick a *Weather entity for the hourly
   forecast*. Without one, "next rain" only looks as far as the radar
   does (2 h). If that entity is MeteoSwiss Weather, switch on its
   hourly forecast option; without it the forecast part has nothing
   to read.
3. In the card editor, pick the sensor under *Next rain* and switch on
   the *Next rain* attribute pill. New cards find the sensor
   automatically, even if the entity was renamed.

## What the row shows

| Situation | Row | Icon |
| --- | --- | --- |
| Radar sees rain coming within the hour | `in 12 min`, counting down live | radar |
| Radar or forecast answers further out | `17:00` (radar) or `~17:00` (forecast); weekday added beyond 24 h | radar / cloud-clock |
| It is raining — the radar says so, or your station's rain rate is above zero | `Now` | rain |
| Nothing in sight | `No rain` (hover to see how far the forecast was checked) | closed umbrella |

The tooltip names which source answered, so a forecast time is never
mistaken for a radar observation. Any other timestamp sensor works in
the same slot. See `sensors.next_rain` and `show_next_rain` in
[CONFIGURATION.md](CONFIGURATION.md).
