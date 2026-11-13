# 0008: DEFAULTS as the single source of truth (`src/defaults.ts`)

**Status:** Accepted

**Date:** 2026-05-09

## Context

The card has two paths that need to know "what does a default
configuration look like":

1. **`setConfig(config)`** — invoked by HA when YAML lands. Merges
   user keys onto the card's defaults, then applies mode-aware
   validation. Run on every config change.
2. **`getStubConfig(hass, _, allEntities)`** — invoked once when the
   user adds the card via the visual picker. Synthesizes a starting
   configuration with auto-detected sensors, then fills in any
   remaining defaults so the editor opens against a complete object.

Through v1.4 each path constructed defaults inline. The two went
through several iterations in parallel (the v1.0 `setConfig` defaults
diverged from the v1.0.2 `getStubConfig` defaults; both got new keys
between v1.2 and v1.4) and **drifted**:

- A user adding the card via the picker would land on a different
  default config than a user typing the minimal YAML
  (`type: custom:weather-station-card`).
- Issue #83 (filed v1.8.x) flagged the divergence — `getStubConfig`
  shipped `forecast.show_wind_arrow: true` while `setConfig` had no
  default for that key, so the editor would render the toggle as on
  but a YAML user setting `show_forecast: true` got the toggle off
  unless they explicitly set the field.

Alternatives considered:

- **Status quo.** Two duplicated default objects. Cheap until they
  drift; expensive to detect when they do.
- **Generate one from the other at runtime.** `setConfig` could call
  `getStubConfig` for its default base. Rejected because
  `getStubConfig` does sensor auto-detection — it depends on `hass`
  state and runs in the wrong order for `setConfig`'s flow.
- **Extract a `DEFAULTS` constant both paths import.** The standard
  configuration-merge pattern. Removes drift by construction.
- **Schema-driven defaults (issue #87 / deferred).** Defaults derived
  from a JSON schema. Promising but tangled with the schema-driven
  editor work; defer to a later cycle.

## Decision

`src/defaults.ts` exports three frozen objects that are the **single
source of truth** for the card's defaults:

- `DEFAULTS_FORECAST` — chart-pipeline defaults (`condition_icons`,
  `show_wind_arrow`, `show_wind_speed`, colour fallbacks, sizing,
  `style`, `round_temp`, `disable_animation` etc.).
- `DEFAULTS_UNITS` — display-unit defaults (`pressure: 'hPa'`).
- `DEFAULTS` — top-level card defaults
  (`show_station: true`, `show_forecast: true`, all `show_*`
  toggles, sizing, `tap_action` / `hold_action` /
  `double_tap_action`, sub-objects pointing at the two above).

Both `setConfig` and `getStubConfig` import this module and merge user
input onto the same object via spread:

```ts
const cardConfig = {
  ...DEFAULTS,
  ...config,
  forecast: {
    ...DEFAULTS_FORECAST,
    ...(config.forecast || {}),
  },
  units: {
    ...DEFAULTS_UNITS,
    ...(config.units || {}),
  },
  sensors: {
    ...(config.sensors || {}),
  },
};
```

The schema-drift CI test (issue #93) walks every key in DEFAULTS at
build time and asserts that the editor's render-* partials reference
each key (or the key is explicitly listed as YAML-only). Adding a
DEFAULTS key without surfacing it in the editor — or removing a key
that the editor still references — fails CI.

## Consequences

**Pros**

- `setConfig` and `getStubConfig` cannot drift. Adding a default
  requires touching one file; both consumers pick it up automatically.
- The schema-drift test catches both directions: a key that exists in
  DEFAULTS but not in the editor (orphan default) and a key the editor
  references but that has no DEFAULTS entry (missing default).
- Type-safe at compile time: TypeScript verifies that
  `cardConfig.forecast` has all the expected keys.
- Theme-aware colour defaults (the `var(--token, fallback)` strings)
  live in one place — adding a new theme-tokenised key is a
  single-line change to `DEFAULTS_FORECAST`.

**Cons**

- One extra import on both paths. Trivial.
- Adding a default that's intentionally only meaningful for one of the
  paths (e.g. a `getStubConfig`-only auto-detection nudge) needs a
  workaround — either a separate constant or a layered merge in
  `getStubConfig`. So far this hasn't come up.

**Tradeoffs**

- A schema-driven approach (defaults as part of the editor schema)
  was rejected at this stage as too entangled with issue #87. The
  current `defaults.ts` extraction is a strict improvement on the
  drift problem and doesn't preclude a future schema migration.
- Generating one path's defaults from the other was rejected because
  `getStubConfig` depends on `hass`; reversing the dependency would
  force `setConfig` to re-run sensor detection on every config change
  (defeats the point of stable defaults).

## Amendment 2026-11-13 (#450): typed, normalised config

`setConfig` merges through `normalizeConfig` (`src/card-config.ts`),
whose `CardConfig` type is derived from `DEFAULTS`. It also normalises
the values several modules parse: `days` becomes a positive integer
(the default otherwise) and `forecast_days` one too (`days`
otherwise), so no reader re-parses them with its own fallback.
DEFAULTS stays the one source of the values. Decided by: owner (#450).

## Related

- [`../../src/defaults.ts`](../../src/defaults.ts) — DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS
- [`../../src/main.ts`](../../src/main.ts) — `setConfig` and `getStubConfig` consumers
- Issue #83 — drift between `setConfig` and `getStubConfig`
- Issue #93 — schema-drift CI test
