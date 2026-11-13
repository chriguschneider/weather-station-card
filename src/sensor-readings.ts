// Live sensor extraction (#451): one reader per live key that returns
// the value, the unit it is in and where it came from (ADR-0031).
//
// The source is decided before the value is taken: `resolveLiveSource`
// picks station / stale / weather, and the value follows from that
// pick. The info popup reads the same record, so the shown value and
// its provenance cannot disagree. Pure apart from `lastGood`, the
// caller's last-good map (#213), which the readers update in place.

import { resolveLiveSource, type LiveSource } from './live-source.js';
import {
  toCelsius,
  fromCelsius,
  WIND_CONVERSION,
  PRESSURE_CONVERSION,
  isPrecipRateUnit,
  precipBaseUnit,
  formatPrecipDisplay,
  luxScaleFor,
} from './utils/unit-converters.js';
import { parseNumericSafe } from './utils/numeric.js';

export interface StateLike {
  state: string;
  attributes?: Record<string, unknown>;
}

export type StatesLike = Record<string, StateLike | undefined> | undefined;

export interface Reading<T = string> {
  value: T | undefined;
  /** Unit `value` is in; for a rescaled weather value, the unit it was
   *  rescaled into. */
  unit: string | undefined;
  source: LiveSource | undefined;
}

/** Keys whose provenance the info popup lists (ADR-0031). */
export const LIVE_SOURCE_KEYS = [
  'temperature', 'humidity', 'pressure', 'uv_index', 'wind_speed',
  'dew_point', 'gust_speed', 'wind_direction', 'illuminance', 'precipitation',
] as const;
export type LiveSourceKey = typeof LIVE_SOURCE_KEYS[number];

export interface SensorReadings {
  temperature: Reading;
  humidity: Reading;
  pressure: Reading;
  uv_index: Reading;
  wind_speed: Reading;
  gust_speed: Reading;
  dew_point: Reading;
  wind_direction: Reading<number>;
  /** In lux; irradiance sensors are scaled at extraction. */
  illuminance: Reading;
  /** The raw `sensors.precipitation` state. The card turns it into the
   *  live rate (or swaps in the rate sensor, `precipRateReading`). */
  precipitation: Reading;
  zero_degree_level: Reading;
  zero_degree_level_48h: Reading;
  /** Source units of the station, shared by related quantities: wind
   *  speed + gust, temperature + (entity) dew point. */
  units: { wind: string; pressure: string; temperature: string; precipBase: string };
}

/** HA's placeholder states for a sensor without a value. The extraction
 *  (stale fallback) and the availability scan share this test. */
export function isUnavailableState(state: string | undefined): boolean {
  return state === 'unavailable' || state === 'unknown';
}

/** Configured sensors that are absent or unavailable, for the
 *  availability-grace scan (#213). */
export function unavailableSensors(
  sensors: Record<string, unknown>,
  states: StatesLike,
): Array<{ key: string; eid: string }> {
  const out: Array<{ key: string; eid: string }> = [];
  for (const [key, eid] of Object.entries(sensors)) {
    if (!eid || typeof eid !== 'string') continue;
    const s = states?.[eid];
    if (!s || isUnavailableState(s.state)) out.push({ key, eid });
  }
  return out;
}

const idOf = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw ? raw : undefined;

const unitOf = (s: StateLike | undefined): string | undefined => {
  const u = s?.attributes?.unit_of_measurement;
  return typeof u === 'string' && u ? u : undefined;
};

export function extractSensorReadings(input: {
  sensors: Record<string, unknown>;
  states: StatesLike;
  weatherEntity: string | undefined;
  lastGood: Record<string, string>;
}): SensorReadings {
  const { sensors, states, lastGood } = input;
  const weatherEntity = input.weatherEntity || undefined;
  const stateOf = (eid: string | undefined): StateLike | undefined =>
    eid ? states?.[eid] : undefined;
  // `unavailable` / `unknown` keep the last good value (#213), so an HA
  // restart dims the panel instead of blanking it. In memory only.
  const sensorValue = (eid: string | undefined): string | undefined => {
    const s = stateOf(eid);
    if (!s || !eid) return undefined;
    if (isUnavailableState(s.state)) return lastGood[eid];
    lastGood[eid] = s.state;
    return s.state;
  };
  const sensorUnit = (key: string): string | undefined => unitOf(stateOf(idOf(sensors[key])));

  const wxAttrs = (weatherEntity ? stateOf(weatherEntity)?.attributes : undefined) ?? {};
  const wxUnit = (attr: string): string | undefined => {
    const u = wxAttrs[attr];
    return typeof u === 'string' && u ? u : undefined;
  };

  const sensorWindUnit = sensorUnit('wind_speed') || sensorUnit('gust_speed');
  const sensorTempUnit = sensorUnit('temperature');
  const sensorPressureUnit = sensorUnit('pressure');
  const units = sourceUnits(sensorUnit, wxUnit);

  // A weather value is in the entity's unit. When the station sensor of
  // the same quantity uses another unit (HA keeps unit_of_measurement
  // while a sensor is unavailable), rescale it into the sensor's unit:
  // otherwise a 20 °C entity reading behind an unavailable °F sensor
  // shows as 20 °F and the classifier sees frost (#438).
  const rescaleWind = factorRescale(WIND_CONVERSION, sensorWindUnit, wxUnit('wind_speed_unit'));
  const rescaleTemp = tempRescale(sensorTempUnit, wxUnit('temperature_unit'));
  const rescalePressure = factorRescale(PRESSURE_CONVERSION, sensorPressureUnit, wxUnit('pressure_unit'));

  // The sensor's value (live or last good) wins, else the weather
  // entity's current attribute. `unit` returns the unit for each side.
  const read = (
    key: string,
    wxKey: string | null,
    unit: (fromWeather: boolean) => string | undefined,
    rescale?: (v: number) => number,
  ): Reading => {
    const sensorId = idOf(sensors[key]);
    const value = sensorValue(sensorId);
    const wxRaw = wxKey ? wxAttrs[wxKey] : undefined;
    const source = resolveLiveSource({
      sensorId,
      sensorState: stateOf(sensorId)?.state,
      sensorValue: value,
      weatherEntity,
      weatherHasValue: wxRaw !== undefined && wxRaw !== null,
    });
    if (source?.kind === 'weather') {
      const num = Number(wxRaw);
      const wxValue = rescale && Number.isFinite(num) ? String(rescale(num)) : String(wxRaw);
      return { value: wxValue, unit: unit(true), source };
    }
    // A sensor-only key passes an empty state through as it is.
    return { value: source || !wxKey ? value : undefined, unit: unit(false), source };
  };

  const dewSensorUnit = sensorUnit('dew_point');
  // 'lx' is HA's illuminance unit (developers.home-assistant.io/docs/core/entity/sensor/).
  const illState = stateOf(idOf(sensors.illuminance));
  const illScale = luxScaleFor(illState?.attributes?.unit_of_measurement, illState?.attributes?.device_class);
  const illuminance = toLux(read('illuminance', null, () => (illScale !== 1 ? 'lx' : unitOf(illState))), illScale);
  return {
    temperature: read('temperature', 'temperature', () => units.temperature, rescaleTemp),
    // HA weather entities report humidity in % (developers.home-assistant.io/docs/core/entity/weather/).
    humidity: read('humidity', 'humidity', (wx) => (wx ? '%' : sensorUnit('humidity'))),
    pressure: read('pressure', 'pressure', () => units.pressure, rescalePressure),
    uv_index: read('uv_index', 'uv_index', (wx) => (wx ? undefined : sensorUnit('uv_index'))),
    wind_speed: read('wind_speed', 'wind_speed', () => units.wind, rescaleWind),
    gust_speed: read('gust_speed', 'wind_gust_speed', () => units.wind, rescaleWind),
    // An entity dew point is rescaled into the temperature unit, not the
    // dew sensor's; a sensor dew point keeps the sensor's own unit.
    dew_point: read('dew_point', 'dew_point', (wx) => (!wx && dewSensorUnit) || units.temperature, rescaleTemp),
    wind_direction: readWindDirection(idOf(sensors.wind_direction), stateOf, weatherEntity, wxAttrs.wind_bearing),
    illuminance,
    precipitation: read('precipitation', null, () => sensorUnit('precipitation')),
    zero_degree_level: read('zero_degree_level', null, () => sensorUnit('zero_degree_level')),
    zero_degree_level_48h: read('zero_degree_level_48h', null, () => sensorUnit('zero_degree_level_48h')),
    units,
  };
}

// Source units come from the sensors; a quantity with no sensor unit
// takes the weather entity's own unit (#253: PirateWeather mph read as
// m/s), then the card's base unit.
function sourceUnits(
  sensorUnit: (key: string) => string | undefined,
  wxUnit: (attr: string) => string | undefined,
): SensorReadings['units'] {
  return {
    wind: sensorUnit('wind_speed') || sensorUnit('gust_speed') || wxUnit('wind_speed_unit') || 'm/s',
    pressure: sensorUnit('pressure') || wxUnit('pressure_unit') || 'hPa',
    temperature: sensorUnit('temperature') || wxUnit('temperature_unit') || '°C',
    // Counter first, rate sensor second: a rate-only config must still
    // default its display unit to the station's own base (in/h stays in).
    precipBase: precipBaseUnit(sensorUnit('precipitation') || sensorUnit('precipitation_rate')),
  };
}

// The weather entity's value expressed in the sensor's unit; undefined
// when the units agree or the pair is not in the table.
function factorRescale(
  table: Readonly<Partial<Record<string, number>>>,
  sensorUnit: string | undefined,
  wxUnit: string | undefined,
): ((v: number) => number) | undefined {
  if (!sensorUnit || !wxUnit || sensorUnit === wxUnit) return undefined;
  const factor = table[`${sensorUnit}->${wxUnit}`];
  return factor !== undefined ? (v: number) => v * factor : undefined;
}

function tempRescale(sensorUnit: string | undefined, wxUnit: string | undefined): ((v: number) => number) | undefined {
  if (!sensorUnit || !wxUnit || sensorUnit === wxUnit) return undefined;
  return (v: number) => fromCelsius(toCelsius(v, wxUnit) ?? v, sensorUnit);
}

// Irradiance (W/m²) scales into lux here, so every consumer sees lux.
function toLux(reading: Reading, scale: number): Reading {
  const num = reading.value !== undefined ? parseFloat(reading.value) : NaN;
  if (scale === 1 || !Number.isFinite(num)) return reading;
  return { ...reading, value: String(Math.round(num * scale)) };
}

// Wind direction takes the sensor only while its state is numeric and
// otherwise the entity's bearing, without a last-good value (#437): an
// unavailable direction sensor reads as a weather-service fallback.
function readWindDirection(
  sensorId: string | undefined,
  stateOf: (eid: string | undefined) => StateLike | undefined,
  weatherEntity: string | undefined,
  wxBearing: unknown,
): Reading<number> {
  const state = stateOf(sensorId)?.state;
  const bearing = sensorId ? parseFloat(String(state)) : NaN;
  const source = resolveLiveSource({
    sensorId,
    sensorState: state,
    sensorValue: Number.isFinite(bearing) ? state : undefined,
    weatherEntity,
    weatherHasValue: wxBearing !== undefined && wxBearing !== null,
  });
  if (source?.kind === 'weather') return { value: parseFloat(String(wxBearing)), unit: '°', source };
  return { value: source ? bearing : undefined, unit: '°', source };
}

/** A dedicated `sensors.precipitation_rate` (#253) as the live
 *  precipitation reading, converted into the display unit. Null when
 *  its state is not numeric, so the counter paths take over. */
export function precipRateReading(
  sensorId: string | undefined,
  state: StateLike | undefined,
  displayUnit: string | undefined,
): Reading | null {
  if (!sensorId) return null;
  const num = parseNumericSafe(state?.state);
  if (num == null) return null;
  const rawUnit = unitOf(state);
  // The slot's contract is a rate, so a bare `mm` from an integration
  // that forgot the `/h` still gets the rate label.
  const sourceUnit = isPrecipRateUnit(rawUnit) ? rawUnit : `${precipBaseUnit(rawUnit)}/h`;
  const { value, unit } = formatPrecipDisplay(num, sourceUnit, displayUnit);
  return { value, unit, source: { kind: 'station', entityId: sensorId } };
}

/** The per-key provenance record the info popup reads, plus the
 *  in-card sun and moon (ADR-0022). */
export function liveSourcesOf(readings: SensorReadings): Record<string, LiveSource | undefined> {
  const out: Record<string, LiveSource | undefined> = {};
  for (const key of LIVE_SOURCE_KEYS) out[key] = readings[key].source;
  out.sun = { kind: 'computed' };
  out.moon = { kind: 'computed' };
  return out;
}
