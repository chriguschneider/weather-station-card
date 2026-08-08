// Type definitions for the E2E fake-hass.
//
// The runtime implementation lives in `tests-e2e/pages/hass-mock.js`
// (a plain JS module — the harness page imports it via the static
// http-server). This file is consumed by the spec layer and the
// fixture generators for compile-time typing only.
//
// The card consumes a few well-defined Home Assistant frontend APIs:
//
//   - `hass.config.{latitude, longitude, language, unit_system}` — read
//     synchronously in setHass / drawChart.
//   - `hass.states[entity_id]` — per-entity live state used for the
//     "now" current-condition rendering and for the live-fill in the
//     last hourly bucket.
//   - `hass.callService(domain, service, data, target)` — for the
//     `toggle` / `perform-action` action paths.
//   - `hass.callWS({ type: 'recorder/statistics_during_period', … })`
//     — daily/hourly aggregates feeding `MeasuredDataSource`.
//   - `hass.connection.subscribeMessage(cb, { type:
//     'weather/subscribe_forecast', … })` — daily/hourly forecasts
//     feeding `ForecastDataSource`.

export interface UnitSystem {
  temperature: '°C' | '°F';
  length: 'km' | 'mi';
  pressure?: string;
  wind_speed?: string;
  volume?: string;
  mass?: string;
}

export interface HassConfig {
  latitude: number;
  longitude: number;
  language?: string;
  unit_system: UnitSystem;
}

/** Minimal HA state record. Shape matches what the live frontend
 *  emits via ws/get_states (relevant subset only). */
export interface HassState {
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  entity_id?: string;
}

export interface RecorderStatBucket {
  start: string;
  end?: string;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  change?: number | null;
  sum?: number | null;
}

/** Fixture envelope — each spec composes one of these and feeds it to
 *  `createHassMock`. */
export interface FixtureBag {
  config?: Partial<HassConfig>;
  language?: string;
  states?: Record<string, HassState>;
  recorderDaily?: Record<string, RecorderStatBucket[]>;
  recorderHourly?: Record<string, RecorderStatBucket[]>;
  forecastDaily?: Array<Record<string, unknown>>;
  forecastHourly?: Array<Record<string, unknown>>;
  /** `history/history_during_period` payload per entity — compact
   *  recorder-history rows ({ s: state string, lu: unix seconds }).
   *  Feeds the B2 lux-sunshine derivation for the daily station
   *  columns. */
  luxHistory?: Record<string, Array<{ s: string; lu: number }>>;
}

