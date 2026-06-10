// Single source of truth for the card's configuration defaults.
// Both `setConfig` (user YAML merge) and `getStubConfig` (visual editor
// "first add" path) consume this object, so the two cannot drift.

export const DEFAULTS_FORECAST = {
  labels_font_size: 11,
  chart_height: 180,
  precip_bar_size: 100,
  // Default chart style: temperature labels rendered as plain text
  // beside the lines (no boxes around each value). 'style1' was the
  // legacy default with bordered boxes — kept as an opt-in.
  style: 'style2',
  // Concept-colour defaults are literal RGBA strings.
  //
  // Theme tokens were tried (--warning-color for sunshine, --info-color
  // for low temp, --state-sensor-*-color for the rest), but two failure
  // modes surfaced. The "warning"-shaped tokens are semantic mismatches
  // — --warning-color is HA's alert orange/red, not "sunshine";
  // --info-color is for info banners, not "cold" — and the
  // --state-sensor-*-color tokens we picked don't actually exist in HA's
  // frontend at all (verified via home-assistant/frontend code search),
  // so the var() wrapper was dead weight that only obscured the literal.
  //
  // Users who want theme-driven colours can still pass their own
  // var(...) string in YAML — resolveCssVar resolves user input the
  // same way it always did. The defaults are predictable; bespoke
  // theming stays opt-in.
  temperature1_color: 'rgba(255, 152, 0, 1.0)',
  temperature2_color: 'rgba(68, 115, 158, 1.0)',
  precipitation_color: 'rgba(132, 209, 253, 1.0)',
  show_sunshine: false,
  sunshine_color: 'rgba(255, 215, 0, 1.0)',
  // Opt-in: when the card has a weather entity but NO station sensors,
  // backfill the past/station chart block from Open-Meteo's historical
  // model data (temperature, precipitation, wind, condition) instead of
  // leaving it empty (ADR-0015). Off by default — it adds a network
  // call and sends the HA location to Open-Meteo. No effect when any
  // station sensor is configured (the recorder wins) or when there is
  // no weather entity.
  openmeteo_history: false,
  condition_icons: true,
  // Deprecated — see renderWind in main.ts. Kept as a hard master-off
  // shim for YAML configs that explicitly set show_wind_forecast:
  // false; new installs should not set it.
  show_wind_forecast: true,
  show_wind_arrow: true,
  show_wind_speed: true,
  show_date: true,
  round_temp: true,
  type: 'daily',
  number_of_forecasts: 8,
  disable_animation: false,
  // In-card daily/today/hourly view-switch button. On by default; set
  // to false to lock the card to its configured forecast.type.
  show_mode_toggle: true,
  '12hourformat': false,
} as const;

export const DEFAULTS_UNITS = {
  pressure: 'hPa',
} as const;

export const DEFAULTS = {
  // Layout master toggles — opt-out for headline rows, opt-in for the
  // detail rows. Render code reads these as `true === cfg.x` (opt-in)
  // or `false !== cfg.x` (opt-out); explicit defaults match that intent.
  // Combination is the most common use-case (station + forecast side-
  // by-side) and showcases the card's strength. New cards land in
  // combination mode; users opt into station-only / forecast-only via
  // the editor radio.
  show_station: true,
  show_forecast: true,
  show_main: false,
  show_temperature: true,
  show_current_condition: false,
  show_attributes: false,
  show_time: false,
  show_time_seconds: false,
  show_day: false,
  show_date: false,
  show_humidity: false,
  show_pressure: false,
  show_wind_direction: true,
  show_wind_speed: true,
  show_sun: false,
  show_dew_point: false,
  show_wind_gust_speed: false,
  // UV index defaults to true to preserve the original behaviour where
  // UV was always shown if a sensor was wired. The other three attribute
  // cells default to false so existing layouts don't suddenly grow.
  show_uv_index: true,
  show_illuminance: false,
  show_precipitation: true,
  show_sunshine_duration: false,
  use_12hour_format: false,

  // Sizing
  icons_size: 25,
  current_temp_size: 28,
  time_size: 26,
  day_date_size: 15,

  // Past-data window
  days: 7,

  // Forecast
  weather_entity: '',
  forecast_days: 7,
  forecast: DEFAULTS_FORECAST,

  // Units
  units: DEFAULTS_UNITS,

  // Sensors — populated by getStubConfig auto-detection or by user YAML
  sensors: {},

  // Tap actions — opt-in
  tap_action: { action: 'none' },
  hold_action: { action: 'none' },
  double_tap_action: { action: 'none' },

  // Diagnostics — opt-in. When true, render() appends a collapsible
  // debug panel exposing the card's detected internal state (resolved
  // sensors, render mode, data-source status). YAML-only by design:
  // no editor row, so the visual editor stays uncluttered.
  debug: false,
} as const;
