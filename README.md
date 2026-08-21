<p align="center">
  <img src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/images/logo.svg" alt="Weather Station Card logo" width="160" />
</p>

<h1 align="center">Weather Station Card</h1>

<p align="center"><em>Weather station meets forecast.</em></p>

<p align="center">
  <a href="LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://hacs.xyz/"><img alt="HACS Default" src="https://img.shields.io/badge/HACS-Default-41BDF5.svg" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/releases/latest"><img alt="Latest release" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fchriguschneider%2Fweather-station-card%2Fbadges%2Frelease.json" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/actions/workflows/build.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/chriguschneider/weather-station-card/build.yml?label=build" /></a>
  <a href="https://sonarcloud.io/summary/new_code?id=chriguschneider_weather-station-card"><img alt="Quality Gate Status" src="https://sonarcloud.io/api/project_badges/measure?project=chriguschneider_weather-station-card&metric=alert_status" /></a>
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=chriguschneider&category=frontend&repository=weather-station-card"><img alt="HACS installs" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fchriguschneider%2Fweather-station-card%2Fbadges%2Finstalls.json" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/stargazers"><img alt="Stars" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fchriguschneider%2Fweather-station-card%2Fbadges%2Fstars.json" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/commits/master"><img alt="Last commit" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fchriguschneider%2Fweather-station-card%2Fbadges%2Flastcommit.json" /></a>
  <a href="https://buymeacoffee.com/chriguschneider"><img alt="Buy Me a Coffee" src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00.svg" /></a>
  <a href="#ai-assisted-development"><img alt="AI Assisted" src="https://img.shields.io/badge/AI-assisted-2196F3.svg" /></a>
</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=chriguschneider&category=frontend&repository=weather-station-card"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open in HACS" /></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/chriguschneider/weather-station-card/issues">Issues</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/chriguschneider/weather-station-card/discussions">Discussions</a>
  &nbsp;·&nbsp;
  <a href="ARCHITECTURE.md">Architecture</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
  &nbsp;·&nbsp;
  <a href="CHANGELOG.md">Changelog</a>
</p>

A Lovelace card that charts your own weather station's history alongside any
forecast — driven by sensor data, not a `weather.*` entity.

<details>
<summary><b>Table of contents</b></summary>

- [What this card does](#what-this-card-does)
- [Modes and chart resolutions](#modes-and-chart-resolutions)
- [Installation](#installation)
- [Configuration](#configuration) → [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- [Conditions, sensors, sunshine](#conditions-sensors-and-sunshine) → [docs/CONDITIONS.md](docs/CONDITIONS.md), [docs/SENSORS.md](docs/SENSORS.md)
- [Contributing & architecture](#contributing--architecture)
- [AI-assisted development](#ai-assisted-development)
- [Community](#community)
- [Attribution & licence](#attribution--licence)

</details>

<table>
<tr>
<td><img alt="Daily combination with sunshine, light theme" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-combination-sunshine.png"></td>
<td><img alt="Daily combination with sunshine, dark theme" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-combination-sunshine-dark.png"></td>
</tr>
</table>

## What this card does

Most Lovelace weather cards visualise a forecast served by a `weather.*`
entity. If you actually run a weather station on-site (Shelly Plus H&T,
BTHome, ESPHome, Pirateweather receiver, …), the more interesting view is
*what happened over the past N days* — and the most useful "now" panel
reflects the live readings of those same sensors. This card does both:

- A **past chart** with high / low temperature curves and daily
  precipitation bars, plus an icon row of the worst-of-day weather
  condition for each column. Today's column is highlighted. The number
  of days is configurable (`days:`, 1–14).
- An optional **forecast block** driven by a `weather.*` entity, drawn
  in the same per-day layout next to the past chart. Forecast
  temperature lines are dashed and forecast precipitation bars render
  semi-transparent so predicted values read distinctly from measured
  ones. Span is configurable separately (`forecast_days:`).
- A **live main panel** showing the current temperature, condition icon,
  and (optionally) clock, weather attributes, next sun event and the
  moon — exact illumination percentage on a dynamically drawn disc plus
  the next moonrise/moonset, computed in-card with no Moon integration
  needed. All values derive from current sensor states, not from a
  forecast; every sensor-backed value is clickable and opens its
  more-info dialog.

Conditions are derived by a deterministic, meteorologically-grounded
classifier (see [docs/CONDITIONS.md](docs/CONDITIONS.md#how-conditions-are-determined)
— every threshold is tied to a WMO / NWS / AMS / IES source).

## Modes and chart resolutions

The card has two independent axes: which **blocks** render
(combination / station / forecast) and which time **resolution**
the chart uses (daily / today / hourly). All nine combinations are
supported; you cycle resolutions live with the chart's mode-toggle
button.

<table>
<tr>
<th></th>
<th>Daily (default)</th>
<th>Today (day pager)</th>
<th>Hourly (7 days)</th>
</tr>
<tr>
<th>Combination</th>
<td><img alt="Combination, daily" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-combination-sunshine.png" /></td>
<td><img alt="Combination, today" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/today-combination-sunshine.png" /></td>
<td><img alt="Combination, hourly" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/hourly-combination-sunshine.png" /></td>
</tr>
<tr>
<th>Station</th>
<td><img alt="Station, daily" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-station-sunshine.png" /></td>
<td><img alt="Station, today" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/today-station-sunshine.png" /></td>
<td><img alt="Station, hourly" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/hourly-station-sunshine.png" /></td>
</tr>
<tr>
<th>Forecast</th>
<td><img alt="Forecast, daily" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-forecast-sunshine.png" /></td>
<td><img alt="Forecast, today" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/today-forecast-sunshine.png" /></td>
<td><img alt="Forecast, hourly" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/hourly-forecast-sunshine.png" /></td>
</tr>
</table>

<!-- Dark-theme matrix as a collapsible block. Deliberately NOT the
     <picture>/prefers-color-scheme mechanism: the HACS info-panel
     sanitizer drops <picture>/<source> (see the README-image rule in
     the repo conventions), while <details> with plain <img> children
     survives both GitHub and HACS. -->
<details>
<summary>🌙 <b>Same matrix in a dark theme</b> (click to expand)</summary>
<table>
<tr>
<th></th>
<th>Daily (default)</th>
<th>Today (day pager)</th>
<th>Hourly (7 days)</th>
</tr>
<tr>
<th>Combination</th>
<td><img alt="Combination, daily, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-combination-sunshine-dark.png" /></td>
<td><img alt="Combination, today, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/today-combination-sunshine-dark.png" /></td>
<td><img alt="Combination, hourly, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/hourly-combination-sunshine-dark.png" /></td>
</tr>
<tr>
<th>Station</th>
<td><img alt="Station, daily, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-station-sunshine-dark.png" /></td>
<td><img alt="Station, today, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/today-station-sunshine-dark.png" /></td>
<td><img alt="Station, hourly, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/hourly-station-sunshine-dark.png" /></td>
</tr>
<tr>
<th>Forecast</th>
<td><img alt="Forecast, daily, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-forecast-sunshine-dark.png" /></td>
<td><img alt="Forecast, today, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/today-forecast-sunshine-dark.png" /></td>
<td><img alt="Forecast, hourly, dark" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/hourly-forecast-sunshine-dark.png" /></td>
</tr>
</table>
</details>

**Modes** (rows):

- **Combination** — past sensor history + today as a doubled column
  (measured + predicted) + forecast from a `weather.*` entity. Forecast
  temperature lines are dashed and forecast precipitation bars draw at
  ~45 % opacity so predicted values read distinctly from measured ones.
- **Station** — past sensor history only, no forecast block. No
  `weather.*` entity needed.
- **Forecast** — forecast-only, no station-history block. Useful when
  another sensor-history visualisation lives elsewhere on the
  dashboard.

**Chart resolutions** (columns):

- **Daily** (default) — one column per day across the past + forecast
  window. The classic view.
- **Today** — a day pager: the viewport frames exactly one calendar
  day as 8 × 3-hour blocks and pages day-wise through the whole
  `days:` window. Chevrons step one day at a time, free scrolling
  snaps to day boundaries, and the view opens on the current day
  (measured hours solid, forecast hours dashed).
- **Hourly** — one column per hour over 7 days, scrollable. 168
  columns; the jump-to-now button snaps the viewport to the present
  hour, and a slim day timeline below the chart shows where you are
  (click or scrub it to navigate).

## Installation

> **Compatible with any** `weather.*` **integration that exposes a daily forecast** —
> Met.no, Open-Meteo, Pirateweather, AccuWeather, Buienradar, OpenWeatherMap (when configured for daily).
> The forecast block subscribes via Home Assistant's standard `weather.subscribe_forecast` API,
> so anything HA recognises as a weather entity should work.

### HACS (recommended)

The card is in the HACS default store — no custom repository needed.

**One-click**: [![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=chriguschneider&category=frontend&repository=weather-station-card)

Or manually:

1. In HACS, search for **Weather Station Card** and open the entry.
2. Click **Download**.
3. Hard-refresh your browser (Ctrl-F5 or equivalent) so the new resource
   loads.
4. Add the card to your dashboard via the Lovelace UI ("Add Card → Custom:
   Weather Station Card") or paste the YAML below.

### Manual

1. Download `weather-station-card.js` from the [latest release](https://github.com/chriguschneider/weather-station-card/releases/latest).
2. Copy it to `<config>/www/community/weather-station-card/`.
3. In Home Assistant, go to **Settings → Dashboards → Resources** and add
   `/local/community/weather-station-card/weather-station-card.js` as a
   JavaScript module.
4. Hard-refresh and add the card.

## Configuration

New cards default to **combination mode** — past station history on
the left, forecast on the right — pre-populated with your most likely
weather sensors via ranked auto-detect. Want station-only or
forecast-only? Switch the mode in section 1 of the editor.

The visual editor groups options into seven sections, clustered by
user intent:

1. **Karte einrichten** / Card setup — mode, chart type, title
2. **Wettervorhersage** / Weather forecast — `weather_entity` picker
3. **Sensoren** / Sensors — your station's sensors + past-data window
4. **Diagramm** / Chart — time range, chart rows, appearance
5. **Live-Anzeige** / Live panel — "now" panel + attributes row
6. **Einheiten** / Units — pressure / wind-speed / precipitation display units
7. **Aktionen** / Actions — tap, hold, and double-tap behaviour

Every YAML key is documented in **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**
with type, default, and effect.

## Conditions, sensors, and sunshine

The card derives weather conditions (sunny / cloudy / rainy / fog / windy / …)
deterministically from your sensors, with thresholds tied to WMO / NWS / AMS / IES
sources. Conditions `lightning`, `lightning-rainy`, and `hail` are never emitted
because reliable detection requires dedicated hardware.

For the full classifier rules, the live "now"-condition mechanic, sensor setup
(precipitation rates vs. cumulative counters, sunshine duration via Open-Meteo),
and customisation:

- **[docs/CONDITIONS.md](docs/CONDITIONS.md)** — decision tree, live-vs-daily classifier, day/night-aware icons.
- **[docs/SENSORS.md](docs/SENSORS.md)** — precipitation sensor wiring, sunshine duration setup, privacy notes.
- **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — error banners, common gotchas (recorder warm-up, HACS cache), known limitations.

## Contributing & architecture

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the build flow.
For a tour of how the card is wired internally (data sources, the merge
model, the chart-plugin contract), read [ARCHITECTURE.md](ARCHITECTURE.md).
For doc-writing conventions (length targets, voice, cross-linking), see
[docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md).

**Translations** are a well-bounded first contribution. Strings live in
`src/locale.ts`; English and German ship with a complete editor block,
other languages fall through to English at runtime. Add yours via a PR —
see CONTRIBUTING.md.

## AI-assisted development

This card is built by Chrigu & Claude — a human and an LLM working
together. Architecture decisions, design trade-offs, the
meteorological grounding of the condition classifier, and the
"what should this actually do?" calls are mine. A large share of
the typing, refactors, test scaffolding, and tedious chart-plugin
plumbing was done by [Claude Code](https://claude.com/claude-code).

Every line is reviewed, tested (`npm run build` runs lint + 80%+
coverage tests + visual regression on every push), and shipped
consciously. The badge is here because transparency about how
software is made matters more than pretending otherwise.

If the card has earned a spot on your dashboard, [buying me a coffee](https://buymeacoffee.com/chriguschneider)
is the nicest way to say thanks ❤️ *(Claude doesn't drink coffee.
More for me.)*

## Community

- 💬 **Have a question or idea?** Open a [Discussion](https://github.com/chriguschneider/weather-station-card/discussions) — better than an issue if you're not sure whether something's a bug or just an unfamiliar config knob.
- 🐛 **Found a bug or want a specific feature?** [Open an issue](https://github.com/chriguschneider/weather-station-card/issues/new/choose).
- 🔧 **Want to contribute?** See [CONTRIBUTING.md](CONTRIBUTING.md) — adding a translation or a small fix is a well-bounded first PR.

### Contributors

<a href="https://github.com/chriguschneider/weather-station-card/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=chriguschneider/weather-station-card" alt="Contributors" />
</a>

## Attribution & licence

This project is a fork of [`mlamberts78/weather-chart-card`](https://github.com/mlamberts78/weather-chart-card)
(forked from upstream v1.0.1, October 2024). The chart UI, icons, and
renderer come from the upstream — what's new here is the sensor-history
data layer (`src/data-source.ts`), the meteorological condition
classifier (`src/condition-classifier.ts`), the live-condition wiring,
and a visual editor reorganised around how users actually think about
weather cards (mode → forecast → sensors → chart → live panel).

Released under the MIT licence — same as upstream. See [LICENSE.md](LICENSE.md).
