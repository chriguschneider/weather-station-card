// Single source of truth for the card's configuration defaults (ADR-0008);
// `setConfig`, `getStubConfig` and the editor all read it.

export const DEFAULTS_FORECAST = {
  labels_font_size: 11,
  chart_height: 180,
  precip_bar_size: 100,
  // 'style2': temperature labels as plain text; 'style1' draws boxes.
  style: 'style2',
  // Literal RGBA on purpose: HA has no theme token that means "sunshine" or
  // "cold". Users can still pass `var(...)` in YAML.
  temperature1_color: 'rgba(255, 152, 0, 1.0)',
  temperature2_color: 'rgba(68, 115, 158, 1.0)',
  precipitation_color: 'rgba(132, 209, 253, 1.0)',
  show_sunshine: false,
  sunshine_color: 'rgba(255, 215, 0, 1.0)',
  // Chance of rain next to the amount in the precip pill. Read from the
  // weather entity's forecast, else from Open-Meteo (ADR-0027). Opt-in
  // because the fallback sends the HA location to Open-Meteo (#288).
  show_precip_probability: false,
  // Backfill the past chart block from Open-Meteo history when there is a
  // weather entity but no station sensor (ADR-0015). Opt-in: it sends the
  // HA location to Open-Meteo. Any configured sensor wins.
  openmeteo_history: false,
  // Master switch: false never contacts Open-Meteo. YAML only.
  openmeteo: true,
  condition_icons: true,
  // Deprecated: only an explicit `false` still switches the forecast wind
  // rows off (live-panel/wind-rows.ts, render/forecast-block.ts).
  show_wind_forecast: true,
  show_wind_arrow: true,
  show_wind_speed: true,
  show_date: true,
  round_temp: true,
  type: 'daily',
  number_of_forecasts: 8,
  disable_animation: false,
  // false locks the card to its configured forecast.type.
  show_mode_toggle: true,
  // false leaves out the button that scrolls the chart back to now.
  show_jump_to_now: true,
  '12hourformat': false,
} as const;

export const DEFAULTS_UNITS = {
  pressure: 'hPa',
} as const;

export const DEFAULTS = {
  // Opt-out for headline rows, opt-in for detail rows: render code reads
  // `false !== cfg.x` or `true === cfg.x` to match. New cards land in
  // combination mode; station-only / forecast-only is picked in the editor.
  show_station: true,
  show_forecast: true,
  show_main: false,
  show_temperature: true,
  show_apparent_temperature: false,
  show_current_condition: false,
  show_attributes: false,
  show_time: false,
  show_time_seconds: false,
  show_day: false,
  show_date: false,
  show_humidity: false,
  show_pressure: true,
  show_wind_direction: true,
  show_wind_speed: true,
  show_sun: false,
  // Computed moon line (ADR-0022); needs no entity or Moon integration.
  show_moon: true,
  show_dew_point: false,
  show_wind_gust_speed: false,
  // UV index defaults to true so a wired sensor keeps showing.
  show_uv_index: true,
  show_illuminance: false,
  show_precipitation: true,
  // Zero-degree level (0 °C isotherm altitude, e.g. from the MeteoSwiss
  // integration); needs `sensors.zero_degree_level`, no entity fallback.
  show_zero_degree_level: false,
  // 48 h ahead; needs `sensors.zero_degree_level_48h`.
  show_zero_degree_level_48h: false,
  // Next rain (MeteoSwiss radar nowcast or any timestamp sensor); needs
  // `sensors.next_rain`.
  show_next_rain: false,
  // Combined lines (ADR-0025): dew point + humidity and UV + illuminance
  // share one line when on, so YAML can express what the layout does.
  show_dew_point_humidity: false,
  show_uv_illuminance: false,
  // Attribute-row layout (ADR-0025): columns of row tokens (the show_* keys
  // without the prefix). Empty = automatic arrangement filtered by the
  // show_* toggles; a non-empty list wins and those toggles are ignored.
  attributes_layout: [] as ReadonlyArray<ReadonlyArray<string>>,
  // Info popup naming the source of each live value (ADR-0031);
  // `source_labels: { station, weather, computed }` overrides the names.
  show_sources: true,
  use_12hour_format: false,
  // Zone of the whole card: 'server' (HA's zone), 'location'
  // (`location.time_zone`) or an IANA name (#357, ADR-0030).
  time_zone: 'server',

  icons_size: 25,
  current_temp_size: 28,
  time_size: 26,
  day_date_size: 15,
  // 0 = inherit the card text size (no declaration emitted).
  attributes_size: 0,
  condition_size: 18,

  days: 7,

  weather_entity: '',
  forecast_days: 7,
  forecast: DEFAULTS_FORECAST,

  units: DEFAULTS_UNITS,

  // Filled by getStubConfig auto-detection or user YAML.
  sensors: {},

  tap_action: { action: 'none' },
  hold_action: { action: 'none' },
  double_tap_action: { action: 'none' },

  // Appends a collapsible debug panel (resolved sensors, render mode,
  // data-source status). YAML only, no editor row.
  debug: false,
} as const;
