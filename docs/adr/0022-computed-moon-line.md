# 0022: Computed moon line — in-card astronomy instead of the Moon integration

**Status:** Accepted

**Date:** 2026-08-21

## Context

Since v2.2 the sun cell carried a moon-phase line fed by HA's official
Moon integration (`sensor.moon_phase` / legacy `sensor.moon`). That
integration exposes only an 8-step enum — no illumination percentage,
no moonrise/moonset — and the community feature requests for richer
data have sat unanswered for years. The line also silently vanished
for every user who hadn't installed the integration.

Alternatives on the table:

- **Extend HA core** — possible (core already ships `astral`), but the
  FR process is slow and outside this project's control.
- **Depend on a HACS custom integration** (`lunar-phase`,
  `moon-phase`) — richer data, but pushes an install burden onto every
  card user and couples the card to third-party maintenance.
- **Compute in-card** — moon illumination is geocentric closed-form
  math; rise/set need only the site coordinates, which
  `hass.config.latitude/longitude` already provides (the sun-strength
  row reads them the same way).

A second, related decision: the 8 static MDI phase icons made
waxing vs. waning nearly indistinguishable (the gibbous silhouettes
especially), which was the user-facing complaint that triggered the
rework.

## Decision

Compute everything in-card and drop the entity dependency entirely.

- **`src/moon.ts`** — pure module, no dependency: Meeus low-precision
  series as popularized by the BSD-2 suncalc library. Exports
  `moonIllumination` (fraction + waxing), `moonTimes` /
  `nextMoonEvent` (parabola-fit horizon crossings, next-event scan
  over 3 days), and `litMoonPath` (SVG terminator geometry).
- **Dynamically drawn disc** instead of static icons: a 24×24 inline
  SVG whose terminator is the exact illuminated fraction — stepless (a
  78 % gibbous looks different from 60 %) and mirrored for
  southern-hemisphere latitudes. Colours are true to nature in BOTH
  themes: lit side white, shadow black, plus a thin `currentColor`
  outline so the disc edge reads on any background. (A first
  iteration filled the lit side with `currentColor`, which rendered
  "lit = black" on light themes — exactly backwards.)
- **Line content:** disc + illumination percentage + next
  moonrise/moonset (`mdi:weather-moonset-up/-down` + time), mirroring
  the sun line's then next-event-only policy (v2.3 shows both sun
  times on one line again; the moon line stays next-event-only, since
  only the next crossing is computed). Deliberately text-free — no
  locale strings needed.
- **Freshness without a timer:** the card already re-renders on
  `sun.sun`'s attribute tick (~1/min via the ADR-0017 delta gate);
  that cadence keeps the percentage and event time current, so the
  moon line adds no watched entity and no `setInterval`.
- **Config:** `show_moon` (default `true`, opt-out) gates the line
  inside the sun cell; `sensors.moon_phase` is deprecated — still
  typed and still excluded from the recorder fetch so ≤v2.2 configs
  neither fail validation nor poison the stats request.

## Consequences

**Pros**

- The line works for every install out of the box — no integration,
  no entity, no configuration.
- Exact illumination replaces an 8-step enum; the lit side plus the
  trend make waxing/waning visible at a glance.
- Deterministic and unit-testable: eclipses (exact new/full moons)
  anchor the fraction curve in `tests/moon.test.js`; the e2e clock
  pin (`2026-05-06T13:30`) keeps visual baselines stable.
- No bundle dependency (~200 lines of trigonometry) and no locale
  work (the line renders numbers and icons only).

**Cons**

- The line is no longer clickable (there is no entity to open a
  more-info dialog for), and HA's localized phase *names* are gone —
  accepted in the compact-layout decision.
- Rise/set times are approximations: the port is bit-identical to
  suncalc 1.9 (120-day differential test), which itself sits within
  ~5 min of modern ephemerides typically (worst ~15 min near a
  midnight crossing; illumination within ±2 %). The times also
  disappear entirely when HA has no configured location.
- The card now owns astronomy code it must trust its tests on, rather
  than delegating correctness to an upstream integration.

**Tradeoffs**

- A hybrid (prefer the entity when present, compute otherwise) was
  considered and rejected: two code paths, phase-boundary
  disagreements between the entity enum and the computed fraction,
  and no user-visible gain once the phase name was dropped from the
  layout.
- Meteocons and other icon sets were evaluated for the disc; fixed
  colours (not theme-aware) and 20 px legibility ruled them out in
  favour of drawing the disc from the computed fraction.

## Related

- [ADR-0017](0017-entity-delta-gate-in-set-hass.md) — the render tick
  the moon line piggybacks on.
- [ADR-0018](0018-inline-svg-sprite-for-forecast-rows.md) — the
  `.wsc-icon` box contract the disc's `.wsc-moon` class mirrors.
- suncalc (BSD-2): <https://github.com/mourner/suncalc> — formula
  lineage for `src/moon.ts`.
- HA feature requests left unanswered: moon illumination percentage
  (community #681346), moonrise/moonset (community #898228).
