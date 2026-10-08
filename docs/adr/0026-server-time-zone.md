# 0026: Calendar math and displayed times follow the HA server's time zone

**Status:** Accepted

**Date:** 2026-10-08

## Context

Until v2.6 the card did every day and hour computation with `Date`'s
local getters and setters (`setHours(0, 0, 0, 0)`, `getDate()`,
`getHours()`), and formatted every time with `Intl.DateTimeFormat`
without a `timeZone` — both in the **browser's** zone.

Issue #285 reported the visible half: a user in the US with their HA
server in Switzerland saw US times on a card about Swiss weather. The
invisible half was worse. HA buckets `recorder/statistics_during_period`
with `period: 'day'` by the **server's** midnight, Open-Meteo answers
`timezone=auto` in the HA location's civil dates, and HA's own
forecasts carry server-local midnights. The card then sliced those
series by the viewer's midnight, so a remote viewer's day columns could
be shifted by a day, and `new Date("YYYY-MM-DD")` (parsed as UTC) made
the Open-Meteo day count off by one west of Greenwich.

Options considered:

1. **Follow HA's profile setting** (`hass.locale.time_zone`: local or
   server), like the built-in history and logbook cards. HA defaults it
   to *local*, so the reporter would have to find and flip a profile
   switch, and the default would keep the day-bucket mismatch.
2. **Always use the server zone** (`hass.config.time_zone`).
3. Keep the browser zone, fix only the display.

## Decision

Option 2. Everything the card shows is about the HA location — station
sensors, the home forecast, the recorder's server-midnight statistics —
so its calendar is the server's.

- `src/utils/time-zone.ts` holds the zone as module state, set on every
  `set hass` from `hass.config.time_zone` (missing or unknown to Intl →
  browser zone). One zone per page is safe: all cards on a dashboard
  talk to the same HA instance.
- It exports the calendar primitives the codebase needs — `startOfDay`,
  `addDays`, `withHour`, `startOfHour`, `hourOf`, `minuteOf`, `dayKey`,
  `isSameDay`, `dayOfYear`, `zonedDate`, `zonedParts` — implemented with
  `Intl.DateTimeFormat#formatToParts`, no date library. `addDays` and
  `zonedDate` are calendar-based, so 23- and 25-hour DST days advance
  exactly one day.
- When the server zone equals the browser's (the common case) the
  helpers take `Date`'s native path, so behaviour there is identical to
  v2.6.
- `getDateTimeFormat` (`src/utils/intl-cache.ts`) adds the zone as
  `timeZone` unless a caller names one, so every displayed time follows
  without touching call sites.
- **Rule:** new day / hour logic uses these helpers. A bare
  `setHours(0, 0, 0, 0)`, `getDate()`, `getHours()` or `new Date(y, m, d)`
  in `src/` is a bug unless it is solar geometry.
- **Exception:** `condition-classifier.ts`'s clear-sky model derives the
  day of year from local `getFullYear()` for the solar declination. It
  already works in UTC for the hour angle; a one-day drift in the
  declination is ~0.4° and invisible at its resolution.

## Consequences

**Pros**

- A remote viewer sees the HA location's clock, sunrise, moon times and
  next-rain time, and day columns cut at the same midnight as HA's own
  statistics.
- No configuration — and nothing changes for viewers in the server's
  zone.
- Fixes the Open-Meteo past/forecast day count west of Greenwich as a
  side effect.

**Cons**

- Deviates from HA's per-user "local / server" profile setting; a
  travelling user sees home time. For a card about the weather at home
  that is the expected reading, and a YAML override can follow if
  anyone asks.
- The non-native path costs a `formatToParts` call per helper call;
  the loops it runs in are a few hundred entries.
- Module state: a page with cards from two HA instances (not a thing
  HA supports) would share one zone.

**Tradeoffs**

- Threading a zone argument through every helper would avoid module
  state but touch dozens of signatures across data sources, chart
  plugins and render code for no practical gain.
- A date library (Luxon, date-fns-tz) would cost 20–70 KB for what
  ~150 lines of `Intl` do.

## Related

- Issue #285 — No TimeZone Used
- [ADR-0007](0007-set-hass-three-phase.md) — `set hass` phases; the zone
  is set at the top, before phase 1
- [ADR-0020](0020-cross-card-request-dedup-and-persistent-caches.md) —
  the same "one page, one HA instance" assumption behind shared caches
