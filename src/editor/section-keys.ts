// Per-section key inventories for the reset buttons: every key a section
// owns, including conditionally rendered ones, as dot-paths.
// Drift guard: tests/defaults.test.js fails when a schema field is missing
// here or in the per-section SCHEMA_KEY_SKIPLIST.
// `basics` has no reset button (it holds the card's identity), but stays
// listed so the drift guards cover it.

export type SectionKey =
  | 'basics'
  | 'sensors'
  | 'chart'
  | 'live_panel'
  | 'location'
  | 'units'
  | 'actions';

export const SECTION_KEYS: Record<SectionKey, ReadonlyArray<string>> = {
  basics: [
    // mode is backed by show_station + show_forecast.
    'show_station',
    'show_forecast',
    'forecast.type',
    'title',
    'weather_entity',
  ],
  sensors: [
    'sensors',
    // The Open-Meteo no-station past-block opt-in (ADR-0015), driven by
    // the past-source dropdown in this section.
    'forecast.openmeteo_history',
  ],
  chart: [
    'days',
    'forecast_days',
    'forecast.number_of_forecasts',
    'forecast.chart_height',
    'forecast.condition_icons',
    'forecast.show_wind_arrow',
    'forecast.show_wind_speed',
    'forecast.show_date',
    'forecast.show_sunshine',
    'forecast.show_precip_probability',
    'forecast.show_mode_toggle',
    'forecast.show_jump_to_now',
    'forecast.style',
    'forecast.round_temp',
    'forecast.disable_animation',
  ],
  live_panel: [
    'show_main',
    'show_temperature',
    'show_apparent_temperature',
    'show_current_condition',
    'show_time',
    'show_time_seconds',
    'use_12hour_format',
    'show_day',
    'show_date',
    'show_attributes',
    'show_humidity',
    'show_pressure',
    'show_dew_point',
    'show_precipitation',
    'show_uv_index',
    'show_illuminance',
    'show_wind_direction',
    'show_wind_speed',
    'show_wind_gust_speed',
    'show_sun',
    'show_moon',
    'show_zero_degree_level',
    'show_zero_degree_level_48h',
    'show_next_rain',
    'show_dew_point_humidity',
    'show_uv_illuminance',
    'show_sources',
    // YAML-only source names of the info popup, reset with its toggle.
    'source_labels',
    // YAML-only row arrangement (ADR-0025); the attribute pills write
    // into it when set, so a section reset must clear it too.
    'attributes_layout',
  ],
  location: [
    // The place of the card and the zone its times are shown in (#357, #372).
    'location',
    'time_zone',
    // Legacy top-level site elevation; the editor writes `location.elevation`.
    'elevation',
  ],
  units: [
    'units',
  ],
  actions: [
    'tap_action',
    'hold_action',
    'double_tap_action',
  ],
};
