// Live sensor extraction (#451): one reader per live key that returns
// the value, the unit it is in, the value in its canonical unit and
// where it came from (ADR-0031, ADR-0035).
//
// The source is decided before the value is taken: `resolveLiveSource`
// picks station / stale / weather, and the value follows from that
// pick. The info popup reads the same record, so the shown value and
// its provenance cannot disagree. Pure apart from `lastGood`, the
// caller's last-good map (#213), which the readers update in place.

import { resolveLiveSource, type LiveSource } from './live-source.js';
import { resolveDisplayUnits, type DisplayUnits } from './display-units.js';
import { CANONICAL_UNIT, parseUnit, toCanonical, type Quantity } from './utils/units.js';
import { parseNumericSafe } from './utils/numeric.js';
import { apparentTemperature } from './utils/apparent-temperature.js';

export interface StateLike {
  state: string;
  attributes?: Record<string, unknown>;
}

export type StatesLike = Record<string, StateLike | undefined> | undefined;

export interface Reading<T = string> {
  /** The supplying side's own value: the sensor state or the weather
   *  attribute, unconverted. */
  value: T | undefined;
  /** Unit `value` is in. A sensor without a unit gets the assumed unit
   *  of its quantity. */
  unit: string | undefined;
  /** `value` in its quantity's canonical unit (ADR-0035); null for a key
   *  without a quantity, a non-numeric value or a unit the table does
   *  not know. */
  canonical: number | null;
  source: LiveSource | undefined;
}

/** Keys whose provenance the info popup lists (ADR-0031). */
export const LIVE_SOURCE_KEYS = [
  'temperature', 'humidity', 'pressure', 'uv_index', 'wind_speed',
  'dew_point', 'apparent_temperature', 'gust_speed', 'wind_direction', 'illuminance', 'precipitation',
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
  apparent_temperature: Reading;
  wind_direction: Reading<number>;
  /** In lux; irradiance sensors are scaled at extraction. */
  illuminance: Reading;
  /** The raw `sensors.precipitation` state. The card turns it into the
   *  live rate (or swaps in the rate sensor, `precipRateReading`). */
  precipitation: Reading;
  zero_degree_level: Reading;
  zero_degree_level_48h: Reading;
  /** The card's display units, one per quantity (ADR-0035). */
  displayUnits: DisplayUnits;
  /** The units a sensor without `unit_of_measurement` is read in. */
  assumed: { pressure: string; precipitation: string };
}

/** `hass.config.unit_system`, keys as in Home Assistant's
 *  `UnitSystem.as_dict` (homeassistant/util/unit_system.py). */
export interface UnitSystemLike {
  temperature?: unknown;
  pressure?: unknown;
  wind_speed?: unknown;
  accumulated_precipitation?: unknown;
}

/** The card config's `units` block. */
export interface ConfigUnitsLike {
  pressure?: unknown;
  speed?: unknown;
  precipitation?: unknown;
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

export const unitOf = (s: StateLike | undefined): string | undefined => {
  const u = s?.attributes?.unit_of_measurement;
  return typeof u === 'string' && u ? u : undefined;
};

// The quantity each key's value converts as; keys not listed have none.
const QUANTITY_OF: Readonly<Partial<Record<string, Quantity>>> = {
  temperature: 'temperature',
  dew_point: 'temperature',
  apparent_temperature: 'temperature',
  pressure: 'pressure',
  wind_speed: 'speed',
  gust_speed: 'speed',
  // A counter in `mm` is no rate, so it gets no canonical value.
  precipitation: 'precipitation_rate',
  zero_degree_level: 'length',
  zero_degree_level_48h: 'length',
};

// The first candidate the units table knows, as written.
function knownUnit(quantity: Quantity, ...candidates: unknown[]): string | undefined {
  const hit = candidates.find((c) => parseUnit(quantity, c) !== null);
  return typeof hit === 'string' ? hit : undefined;
}

export function extractSensorReadings(input: {
  sensors: Record<string, unknown>;
  states: StatesLike;
  weatherEntity: string | undefined;
  lastGood: Record<string, string>;
  configUnits?: ConfigUnitsLike;
  unitSystem?: UnitSystemLike;
}): SensorReadings {
  const { sensors, states, lastGood } = input;
  const configUnits = input.configUnits ?? {};
  const unitSystem = input.unitSystem ?? {};
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
  const { sensorUnit, wxAttrs, wxUnit } = unitLookups(sensors, states, weatherEntity);
  const assumed = assumedUnits(sensorUnit, wxUnit, unitSystem);
  const sided = (key: string, sensorDefault: string, wx: string) => (fromWeather: boolean): string =>
    fromWeather ? wx : sensorUnit(key) ?? sensorDefault;

  // The sensor's value (live or last good) wins, else the weather
  // entity's current attribute. `unit` returns the unit for each side;
  // neither side is converted into the other's unit.
  const read = (
    key: string,
    wxKey: string | null,
    unit: (fromWeather: boolean) => string | undefined,
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
    const fromWeather = source?.kind === 'weather';
    // A sensor-only key passes an empty state through as it is.
    let shown = source || !wxKey ? value : undefined;
    if (fromWeather) shown = String(wxRaw);
    const shownUnit = unit(fromWeather);
    const quantity = QUANTITY_OF[key];
    const canonical = quantity ? toCanonical(quantity, parseNumericSafe(shown), shownUnit) : null;
    return { value: shown, unit: shownUnit, canonical, source };
  };

  // 'lx' is HA's illuminance unit (developers.home-assistant.io/docs/core/entity/sensor/).
  const illState = stateOf(idOf(sensors.illuminance));
  const illUnit = illuminanceUnit(illState?.attributes);
  const illuminance = parseUnit('illuminance', illUnit) === 'W/m²'
    ? toLux(read('illuminance', null, () => 'lx'), illUnit)
    : read('illuminance', null, () => unitOf(illState));
  const zeroDegree = (key: string): Reading =>
    read(key, null, () => (stateOf(idOf(sensors[key])) ? sensorUnit(key) ?? 'm' : undefined));
  const temperature = read('temperature', 'temperature', sided('temperature', assumed.temperature, assumed.wxTemperature));
  // HA weather entities report humidity in % (developers.home-assistant.io/docs/core/entity/weather/).
  const humidity = read('humidity', 'humidity', (wx) => (wx ? '%' : sensorUnit('humidity')));
  const windSpeed = read('wind_speed', 'wind_speed', sided('wind_speed', assumed.wind, assumed.wxWind));
  // Order: the feels-like sensor, then computed from the station's own
  // temperature, humidity and wind, then the weather attribute.
  let apparent = read(
    'apparent_temperature', 'apparent_temperature',
    sided('apparent_temperature', assumed.dewPoint, assumed.wxTemperature),
  );
  if (apparent.source?.kind !== 'station' && apparent.source?.kind !== 'stale') {
    apparent = computeApparent(temperature, humidity, windSpeed) ?? apparent;
  }
  return {
    temperature,
    humidity,
    pressure: read('pressure', 'pressure', sided('pressure', assumed.pressure, assumed.wxPressure)),
    uv_index: read('uv_index', 'uv_index', (wx) => (wx ? undefined : sensorUnit('uv_index'))),
    wind_speed: windSpeed,
    gust_speed: read('gust_speed', 'wind_gust_speed', sided('gust_speed', assumed.gust, assumed.wxWind)),
    // An entity dew point is in the entity's temperature unit.
    dew_point: read('dew_point', 'dew_point', sided('dew_point', assumed.dewPoint, assumed.wxTemperature)),
    apparent_temperature: apparent,
    wind_direction: readWindDirection(idOf(sensors.wind_direction), stateOf, weatherEntity, wxAttrs.wind_bearing),
    illuminance,
    precipitation: read('precipitation', null, () => sensorUnit('precipitation') ?? assumed.precipitation),
    zero_degree_level: zeroDegree('zero_degree_level'),
    zero_degree_level_48h: zeroDegree('zero_degree_level_48h'),
    assumed: { pressure: assumed.pressure, precipitation: assumed.precipitation },
    displayUnits: resolveDisplayUnits({
      temperature: [sensorUnit('temperature'), wxUnit('temperature_unit'), unitSystem.temperature],
      pressure: [configUnits.pressure, sensorUnit('pressure'), wxUnit('pressure_unit'), unitSystem.pressure],
      speed: [
        configUnits.speed, sensorUnit('wind_speed'), sensorUnit('gust_speed'),
        wxUnit('wind_speed_unit'), unitSystem.wind_speed,
      ],
      precipitation: [
        configUnits.precipitation, sensorUnit('precipitation'), sensorUnit('precipitation_rate'),
        wxUnit('precipitation_unit'), unitSystem.accumulated_precipitation,
      ],
    }),
  };
}

// Computed only from live station readings: a stale or weather-entity
// input would present an old or a provider's number as the station's.
function computeApparent(temperature: Reading, humidity: Reading, wind: Reading): Reading | undefined {
  if (temperature.source?.kind !== 'station' || humidity.source?.kind !== 'station'
    || wind.source?.kind !== 'station') return undefined;
  const rh = parseNumericSafe(humidity.value);
  if (temperature.canonical === null || wind.canonical === null || rh === null) return undefined;
  const at = apparentTemperature(temperature.canonical, rh, wind.canonical);
  if (at === null) return undefined;
  const rounded = Math.round(at * 100) / 100;
  return {
    value: String(rounded), unit: CANONICAL_UNIT.temperature, canonical: rounded,
    source: { kind: 'computed', entityId: temperature.source.entityId },
  };
}

// The sensor's own non-empty unit and the weather entity's attributes,
// shared by the live readings and `stationUnits`.
function unitLookups(
  sensors: Partial<Record<string, unknown>>,
  states: StatesLike,
  weatherEntity: string | undefined,
) {
  const sensorUnit = (key: string): string | undefined => {
    const eid = idOf(sensors[key]);
    return eid ? unitOf(states?.[eid]) : undefined;
  };
  const wxAttrs = (weatherEntity ? states?.[weatherEntity]?.attributes : undefined) ?? {};
  const wxUnit = (attr: string): string | undefined => {
    const u = wxAttrs[attr];
    return typeof u === 'string' && u ? u : undefined;
  };
  return { sensorUnit, wxAttrs, wxUnit };
}

/** The unit each station sensor's statistics and states are in. */
export interface StationUnits {
  temperature: string;
  dew_point: string;
  pressure: string;
  wind_speed: string;
  gust_speed: string;
  precipitation: string;
}

/** Per key the sensor's own unit as written (an unknown one too, which
 *  then converts to null), else the unit a sensor without one is read in
 *  (ADR-0035, amendment of 2026-11-16). */
export function stationUnits(input: {
  sensors: Partial<Record<keyof StationUnits, unknown>>;
  states: StatesLike;
  weatherEntity: string | undefined;
  unitSystem?: UnitSystemLike;
}): StationUnits {
  const { sensorUnit, wxUnit } = unitLookups(input.sensors, input.states, input.weatherEntity || undefined);
  const assumed = assumedUnits(sensorUnit, wxUnit, input.unitSystem ?? {});
  return {
    temperature: sensorUnit('temperature') ?? assumed.temperature,
    dew_point: sensorUnit('dew_point') ?? assumed.dewPoint,
    pressure: sensorUnit('pressure') ?? assumed.pressure,
    wind_speed: sensorUnit('wind_speed') ?? assumed.wind,
    gust_speed: sensorUnit('gust_speed') ?? assumed.gust,
    precipitation: sensorUnit('precipitation') ?? assumed.precipitation,
  };
}

/** The units of a weather entity's attributes and forecast. */
export interface WeatherUnits {
  temperature: string;
  pressure: string;
  wind_speed: string;
  precipitation: string;
}

/** Per quantity the entity's own unit attribute as written, else Home
 *  Assistant's unit system when the table knows it, else canonical. An
 *  entity states its units in these attributes and delivers its forecast
 *  in them (Home Assistant, homeassistant/components/weather/__init__.py). */
export function weatherEntityUnits(
  attributes: Record<string, unknown> | undefined,
  unitSystem: UnitSystemLike = {},
): WeatherUnits {
  const attr = (key: string): string | undefined => {
    const u = attributes?.[key];
    return typeof u === 'string' && u ? u : undefined;
  };
  return {
    temperature: attr('temperature_unit')
      ?? knownUnit('temperature', unitSystem.temperature) ?? CANONICAL_UNIT.temperature,
    pressure: attr('pressure_unit') ?? knownUnit('pressure', unitSystem.pressure) ?? CANONICAL_UNIT.pressure,
    wind_speed: attr('wind_speed_unit') ?? knownUnit('speed', unitSystem.wind_speed) ?? CANONICAL_UNIT.speed,
    precipitation: attr('precipitation_unit')
      ?? knownUnit('precipitation', unitSystem.accumulated_precipitation) ?? CANONICAL_UNIT.precipitation,
  };
}

// A sensor without a unit is read in the unit Home Assistant would give
// its quantity, not as an unknown unit (ADR-0035, amendment of
// 2026-11-16): template sensors often carry none. A weather entity
// without its unit attribute falls back to the unit system.
function assumedUnits(
  sensorUnit: (key: string) => string | undefined,
  wxUnit: (attr: string) => string | undefined,
  unitSystem: UnitSystemLike,
) {
  const temperature = knownUnit('temperature', wxUnit('temperature_unit'), unitSystem.temperature) ?? '°C';
  const pressure = knownUnit('pressure', wxUnit('pressure_unit'), unitSystem.pressure) ?? 'hPa';
  const wind = (otherKey: string): string =>
    knownUnit('speed', sensorUnit(otherKey), wxUnit('wind_speed_unit'), unitSystem.wind_speed) ?? 'm/s';
  const wx = weatherEntityUnits({
    temperature_unit: wxUnit('temperature_unit'),
    pressure_unit: wxUnit('pressure_unit'),
    wind_speed_unit: wxUnit('wind_speed_unit'),
  }, unitSystem);
  return {
    temperature,
    dewPoint: knownUnit('temperature', sensorUnit('temperature')) ?? temperature,
    pressure,
    wind: wind('gust_speed'),
    gust: wind('wind_speed'),
    precipitation: knownUnit(
      'precipitation', wxUnit('precipitation_unit'), unitSystem.accumulated_precipitation,
    ) ?? 'mm',
    wxTemperature: wx.temperature,
    wxPressure: wx.pressure,
    wxWind: wx.wind_speed,
  };
}

/** The unit an illuminance sensor's value is read in: `W/m²` for
 *  `device_class: irradiance` whatever its unit says, else its own unit,
 *  and `lx` for a sensor without one (its assumed unit, ADR-0035). */
export function illuminanceUnit(attributes: Record<string, unknown> | undefined): string {
  if (attributes?.device_class === 'irradiance') return 'W/m²';
  return unitOf({ state: '', attributes }) ?? 'lx';
}

// Irradiance (W/m²) enters as lux here (ADR-0035, point 7), so every
// consumer sees lux. A non-numeric value is left alone.
function toLux(reading: Reading, unit: string): Reading {
  const lux = toCanonical('illuminance', parseNumericSafe(reading.value), unit);
  return lux === null ? reading : { ...reading, value: String(Math.round(lux)) };
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
  if (source?.kind === 'weather') return { value: parseFloat(String(wxBearing)), unit: '°', canonical: null, source };
  return { value: source ? bearing : undefined, unit: '°', canonical: null, source };
}

/** A dedicated `sensors.precipitation_rate` (#253) as the live
 *  precipitation reading, in the sensor's own unit with its mm/h
 *  canonical. A sensor without a unit is read in `assumedUnit` per hour
 *  (ADR-0035, amendment of 2026-11-16). Null when its state is not
 *  numeric, so the counter paths take over. */
export function precipRateReading(
  sensorId: string | undefined,
  state: StateLike | undefined,
  assumedUnit = 'mm',
): Reading | null {
  if (!sensorId) return null;
  const num = parseNumericSafe(state?.state);
  if (num == null) return null;
  const ownUnit = unitOf(state);
  const unit = ownUnit ?? `${assumedUnit}/h`;
  // The slot's contract is a rate, so a bare `mm` from an integration
  // that forgot the `/h` is read per hour (the rate table has no `cm/h`,
  // so the assumed unit converts as a depth too).
  const canonical = toCanonical('precipitation_rate', num, unit)
    ?? toCanonical('precipitation', num, ownUnit ?? assumedUnit);
  return { value: state?.state, unit, canonical, source: { kind: 'station', entityId: sensorId } };
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
