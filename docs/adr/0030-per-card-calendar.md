# 0030: Per-card calendar replaces the page-wide time zone

**Status:** Accepted

**Date:** 2026-10-27

## Context

[ADR-0026](0026-server-time-zone.md) put the HA server's time zone into
module state in `src/utils/time-zone.ts`. `set hass` set it, every
calendar helper read it implicitly, and `getDateTimeFormat` added it
when a caller named no `timeZone`. That was safe while every card on a
dashboard showed the same place.

v3.0 allows one card per location (#343, tracked in #358): a dashboard
can hold a card for home and a card for a remote place in a different
zone. With module state, whichever card ran `set hass` last decided the
zone for everyone. Clock ticks, fetch callbacks, chart plugins and
timers run asynchronously, so a card would compute its day columns,
3-hour blocks or clock in the other card's zone. You cannot add a
per-card zone on top of a singleton. It has to be passed explicitly.

## Decision

- **`Calendar` class** (`src/utils/time-zone.ts`). It holds one IANA
  zone and is immutable: a new zone means a new instance. Contract:
  - `new Calendar(tz)`: if `tz` is missing, not a string or unknown to
    the browser's Intl, the calendar uses the browser's own zone.
    `timeZone` is the resolved zone and is always set.
  - Methods with ADR-0026's semantics: `zonedParts`, `zonedDate`,
    `startOfDay`, `addDays`, `withHour`, `startOfHour`, `hourOf`,
    `minuteOf`, `dayKey`, `isSameDay`, `dayOfYear`.
  - When the zone equals the browser's, the methods use `Date`'s
    native getters. Otherwise they use `formatToParts` (cached
    formatter per zone).
  - `addDays` / `zonedDate` count calendar days, so 23- and 25-hour
    days still advance by exactly one day. The today-mode day pager
    ([ADR-0021](0021-today-mode-day-pager.md)) relies on this.
  - `validTimeZone` and `zonedPartsIn` stay free functions.
- **One calendar per card.** `WeatherStationCard.calendar` starts in
  the browser's zone and is resolved from `hass.config.time_zone` at
  the top of `set hass`, before phase 1
  ([ADR-0007](0007-set-hass-three-phase.md)). If the resolved zone
  changes, the card replaces the calendar and rebuilds the sources
  that captured the old one (recorder source, Open-Meteo source,
  per-mode station cache, pressure-delta cache).
- **Passed explicitly** as a constructor argument (`MeasuredDataSource`,
  `OpenMeteoSource` options), a trailing or positional parameter (pure
  helpers in `forecast-utils`, `sunshine-source`, `precip-probability`,
  `moon`, `next-rain`, `zero-degree-popup`, `orchestrator`), or an
  options field (chart label plugins, zero-degree format options, the
  scroll-UX card shape).
- **`getDateTimeFormat` requires `timeZone`.** It no longer injects
  one. The zone is part of the cache key, so two cards never share a
  formatter across zones.
- **Removed:** `setCardTimeZone`, `configuredTimeZone`, `cardTimeZone`
  and the module state. ESLint (`no-restricted-imports`) stops them
  from coming back in `src/` and `tests/`.
- **Caches carry the zone** (amends
  [ADR-0020](0020-cross-card-request-dedup-and-persistent-caches.md)):
  the `wsc_series_*` keys (schema v2), the `wsc_lux_days_*` keys
  (schema v2; the v1 slot is removed on the next save), and the
  recorder `stats:` / `history:` dedup keys. `wsc_sunshine_*` was
  versioned in #353.
- **Unchanged:** `condition-classifier.ts` still uses the
  solar-declination exception from ADR-0026. The resolution rule is
  still "server zone"; #357 extends it.

## Consequences

**Pros**

- Several cards in different zones on one dashboard each cut days and
  format times in their own zone, whatever order their async work runs
  in.
- The dependency is visible in signatures: the compiler flags a helper
  call without a calendar, and the tests no longer share global state.
- One card in the server zone behaves exactly as before: same helpers,
  same native fast path, same `formatToParts` path.

**Cons**

- The change touches about 60 call sites in 12 modules, and every
  future day / hour helper needs a calendar parameter.
- Cache schema bumps throw away one generation of persisted series and
  lux days. The next fetch refills them.

**Tradeoffs**

- Keeping module state and setting it before each card's work does
  not hold across async boundaries (timers, fetch callbacks, uPlot
  hooks).
- A zone argument on each free helper (instead of a class) would
  repeat the zone validation and the native/non-native branch at every
  call.
- **Half-hour zones.** `startOfHour` floors to the zone's own hour.
  In Asia/Kolkata that is :30 UTC, so the hour-bucket keys
  (pressure-delta cache, hourly bucket lookup) depend on the zone. HA's
  recorder buckets hourly statistics on UTC hours. In such a zone, the
  hourly alignment between recorder buckets and card hours is
  approximate (unchanged from ADR-0026). The zone in the cache keys
  stops two cards from sharing a misaligned entry.

## Related

- Issue #354 — this change; #343 / #358 — one card per location (v3.0)
- [ADR-0026](0026-server-time-zone.md) — superseded by this ADR
- [ADR-0020](0020-cross-card-request-dedup-and-persistent-caches.md) —
  amended: the zone is part of the cache and dedup keys
- [ADR-0007](0007-set-hass-three-phase.md) — the calendar is resolved
  before phase 1
- [ADR-0021](0021-today-mode-day-pager.md) — relies on exact
  `startOfDay` / `addDays`
