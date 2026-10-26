# Open-Meteo fixtures

Real responses from `api.open-meteo.com/v1/forecast`, fetched 2026-10-26 with
`timeformat=unixtime`, `timezone=auto` and the card's `DAILY_FIELDS` /
`HOURLY_FIELDS`. Only the `daily` / `hourly` arrays were cut to a handful of
entries; every header field is untouched.

| File | Request | Trimming |
| --- | --- | --- |
| `openmeteo-zurich-dst-2026-10-25.json` | Zurich 47.37/8.54, `past_days=3`, `forecast_days=1` | hourly cut to 2026-10-23 21-23Z and 2026-10-24 21Z to 2026-10-25 03Z |
| `openmeteo-zurich-sun-dst-2026-10-25.json` | same place and days, `daily=sunrise,sunset` only | none |
| `openmeteo-denver.json` | Denver 39.74/-104.99, `past_days=1`, `forecast_days=2` | hourly cut around local midnight and 06:00 of 2026-10-26 |

Zurich `daily.time` carries one fixed `utc_offset_seconds: 3600` for all days,
so 23./24.10. arrive as 23:00Z although they are CEST days.
