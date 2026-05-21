// Per-section config-key inventories for the reset-to-defaults
// buttons. Each entry lists the FULL possible set of keys the section
// owns — including conditionally-rendered ones. _resetSection
// iterates the list and deletes each key from this._config (lets DEFAULTS
// take over on the next render).
//
// Keys use dot-notation for nested paths (e.g. `forecast.show_sunshine`
// addresses cfg.forecast.show_sunshine). The reset implementation walks
// the dot-path and prunes empty parent objects after deletion.
//
// Drift guard: tests/editor-schema.test.js asserts every schema field
// returned by each section's render is present in this map (or in the
// per-section SCHEMA_KEY_SKIPLIST) — adding a new field to a schema
// without updating SECTION_KEYS will fail CI.

export type SectionKey =
  | 'card_setup'
  | 'weather_forecast'
  | 'sensors'
  | 'chart'
  | 'live_panel'
  | 'units'
  | 'actions';

export const SECTION_KEYS: Record<SectionKey, ReadonlyArray<string>> = {
  card_setup: [
    // mode is a UI-only abstraction backed by show_station + show_forecast.
    'show_station',
    'show_forecast',
    'forecast.type',
  ],
  weather_forecast: [
    'weather_entity',
  ],
  sensors: [
    'sensors',
    // The Open-Meteo no-station past-block opt-in (ADR-0015) is shown
    // as a toggle in this section, so resetting the section clears it.
    'forecast.openmeteo_history',
  ],
  chart: [
    'title',
    'days',
    'forecast_days',
    'forecast.number_of_forecasts',
    'forecast.condition_icons',
    'forecast.show_wind_arrow',
    'forecast.show_wind_speed',
    'forecast.show_date',
    'forecast.show_sunshine',
    'forecast.style',
    'forecast.round_temp',
    'forecast.disable_animation',
  ],
  live_panel: [
    'show_main',
    'show_temperature',
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
    'show_sunshine_duration',
    'show_wind_direction',
    'show_wind_speed',
    'show_wind_gust_speed',
    'show_sun',
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
