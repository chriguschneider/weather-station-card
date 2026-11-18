# Installation

How to install Weather Station Card on Home Assistant 2026.11 or later (Marketplace), on older versions (HACS) or by hand, and what to do after an update.

→ Back to [README](../README.md)

> **Compatible with any** `weather.*` **integration that exposes a daily forecast** —
> Met.no, Open-Meteo, Pirateweather, AccuWeather, Buienradar, OpenWeatherMap (when configured for daily).
> The forecast block subscribes via Home Assistant's standard `weather.subscribe_forecast` API,
> so anything HA recognises as a weather entity should work.

**One-click**: [![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=chriguschneider&category=frontend&repository=weather-station-card)

The button opens the card in the Marketplace on Home Assistant 2026.11 and later, and in HACS on older versions.

## Home Assistant 2026.11 or later: Marketplace

From Home Assistant 2026.11, HACS is built in as the **Marketplace** under **Settings → Marketplace**. An existing HACS installation is migrated on the first start; installed cards stay and keep receiving updates. Buttons and links made for HACS still work and open the repository in the Marketplace. Sources: the [2026.11 release post](https://www.home-assistant.io/blog/2026/11/04/release-202611/) and the [Marketplace documentation](https://www.home-assistant.io/integrations/marketplace/).

The card is in the default store, no custom repository needed.

1. Open the card's page in the Marketplace (search for **Weather Station Card**, or use the button above) and select **Install**.
2. Review the version and select **Install** again.
3. Reload the browser so the new dashboard resource loads. The Marketplace adds the dashboard resource itself; only dashboards with YAML-managed resources need the entry by hand (see [Manual](#manual)).
4. [Add the card](#add-the-card).

### Pre-releases (betas)

The default is stable only. To get betas, enable the repository's **Pre-release** switch on its device page under **Settings → Devices & services → Marketplace**. The entity is disabled by default: enable it, then turn it on. **Install another version** in the three-dot menu still exists.

## Older Home Assistant: HACS

The card is in the HACS default store, no custom repository needed.

1. In HACS, search for **Weather Station Card** and open the entry.
2. Select **Download**.
3. Hard-refresh your browser (Ctrl-F5 or equivalent) so the new resource loads.
4. [Add the card](#add-the-card).

## Manual

1. Download **all** `*.js` files of the [latest release](https://github.com/chriguschneider/weather-station-card/releases/latest). A release ships the entry file `weather-station-card.js` plus content-hashed chunks (`main-….js`, one per language, the editor); the entry file alone does not work.
2. Copy them into `<config>/www/community/weather-station-card/`.
3. In Home Assistant, go to **Settings → Dashboards → Resources** and add `/local/community/weather-station-card/weather-station-card.js` as a **JavaScript module**.
4. Hard-refresh and [add the card](#add-the-card).

## Add the card

Add the card to your dashboard via the Lovelace UI (**Add card → Custom: Weather Station Card**). The editor pre-fills your most likely weather sensors via ranked auto-detect. Or start from this minimal YAML:

```yaml
type: custom:weather-station-card
weather_entity: weather.home
sensors:
  temperature: sensor.outdoor_temperature
```

Every other key is optional. See [CONFIGURATION.md](CONFIGURATION.md) for the full reference and more starting points.

## After an update

Reload the browser. In the Home Assistant companion app, clear the frontend cache or restart the app. If the card still shows the old version or looks empty, see [Troubleshooting](TROUBLESHOOTING.md#the-card-looks-empty--no-chart-appears).
