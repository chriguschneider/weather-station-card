import { describe, it, expect } from 'vitest';
import {
  extractSensorReadings,
  illuminanceUnit,
  stationUnits,
  weatherEntityUnits,
  isUnavailableState,
  unavailableSensors,
  precipRateReading,
  liveSourcesOf,
  LIVE_SOURCE_KEYS,
} from '../src/sensor-readings.js';

const sensor = (state, unit, extra = {}) => ({
  state,
  attributes: { ...(unit ? { unit_of_measurement: unit } : {}), ...extra },
});

const run = (sensors, states, weatherEntity = 'weather.home', lastGood = {}, extra = {}) =>
  extractSensorReadings({ sensors, states, weatherEntity, lastGood, ...extra });

const metricWeather = {
  state: 'sunny',
  attributes: {
    temperature: 20,
    humidity: 55,
    pressure: 1013,
    wind_speed: 36,
    wind_gust_speed: 54,
    wind_bearing: 270,
    dew_point: 10,
    uv_index: 3,
    temperature_unit: '°C',
    pressure_unit: 'hPa',
    wind_speed_unit: 'km/h',
  },
};

describe('stationUnits', () => {
  const units = (sensors, states, weatherEntity = undefined, unitSystem = undefined) =>
    stationUnits({ sensors, states, weatherEntity, unitSystem });

  it('gives a gust sensor without a unit the wind sensor unit', () => {
    const u = units({ wind_speed: 'sensor.w', gust_speed: 'sensor.g' }, {
      'sensor.w': sensor('15', 'km/h'),
      'sensor.g': sensor('31'),
    });
    expect([u.wind_speed, u.gust_speed]).toEqual(['km/h', 'km/h']);
  });

  it('takes the entity attributes for sensors without a unit', () => {
    const u = units({
      temperature: 'sensor.t', dew_point: 'sensor.d', pressure: 'sensor.p',
      wind_speed: 'sensor.w', gust_speed: 'sensor.g', precipitation: 'sensor.r',
    }, {
      'sensor.t': sensor('68'), 'sensor.d': sensor('50'), 'sensor.p': sensor('30'),
      'sensor.w': sensor('5'), 'sensor.g': sensor('9'), 'sensor.r': sensor('1'),
      'weather.home': {
        state: 'sunny',
        attributes: { temperature_unit: '°F', pressure_unit: 'inHg', wind_speed_unit: 'mph', precipitation_unit: 'in' },
      },
    }, 'weather.home');
    expect(u).toEqual({
      temperature: '°F', dew_point: '°F', pressure: 'inHg', wind_speed: 'mph', gust_speed: 'mph', precipitation: 'in',
    });
  });

  it('takes the unit system without sensor units or an entity', () => {
    const u = units({}, {}, undefined, {
      temperature: '°F', pressure: 'psi', wind_speed: 'mph', accumulated_precipitation: 'in',
    });
    expect(u).toEqual({
      temperature: '°F', dew_point: '°F', pressure: 'psi', wind_speed: 'mph', gust_speed: 'mph', precipitation: 'in',
    });
  });

  it('falls back to the canonical units', () => {
    expect(units({}, undefined)).toEqual({
      temperature: '°C', dew_point: '°C', pressure: 'hPa', wind_speed: 'm/s', gust_speed: 'm/s', precipitation: 'mm',
    });
  });

  it('gives a dew sensor without a unit the temperature sensor unit', () => {
    const u = units({ temperature: 'sensor.t', dew_point: 'sensor.d' }, {
      'sensor.t': sensor('68', '°F'),
      'sensor.d': sensor('50'),
    });
    expect(u.dew_point).toBe('°F');
  });

  it('keeps an unknown sensor unit as written', () => {
    expect(units({ wind_speed: 'sensor.w' }, { 'sensor.w': sensor('5', 'foo') }).wind_speed).toBe('foo');
  });
});

describe('weatherEntityUnits', () => {
  it('takes the entity attribute first, then the unit system, then canonical', () => {
    expect(weatherEntityUnits({ wind_speed_unit: 'kn' }, { temperature: '°F', wind_speed: 'mph' }))
      .toEqual({ temperature: '°F', pressure: 'hPa', wind_speed: 'kn', precipitation: 'mm' });
  });

  it('gives the canonical units without attributes', () => {
    expect(weatherEntityUnits(undefined))
      .toEqual({ temperature: '°C', pressure: 'hPa', wind_speed: 'm/s', precipitation: 'mm' });
  });
});

describe('extractSensorReadings: value, unit and source decided together', () => {
  it('takes a live sensor with its own unit and records the station', () => {
    const r = run({ temperature: 'sensor.t' }, {
      'sensor.t': sensor('68', '°F'),
      'weather.home': metricWeather,
    });
    expect(r.temperature).toEqual({
      value: '68', unit: '°F', canonical: 20, source: { kind: 'station', entityId: 'sensor.t' },
    });
  });

  it('keeps the last good value of an unavailable sensor as stale', () => {
    const lastGood = {};
    const states = { 'sensor.h': sensor('61', '%') };
    run({ humidity: 'sensor.h' }, states, undefined, lastGood);
    expect(lastGood['sensor.h']).toBe('61');
    const r = run({ humidity: 'sensor.h' }, { 'sensor.h': sensor('unavailable', '%') }, undefined, lastGood);
    expect(r.humidity).toEqual({
      value: '61', unit: '%', canonical: null, source: { kind: 'stale', entityId: 'sensor.h' },
    });
  });

  it('keeps a weather value in the entity unit behind an unavailable sensor (#438)', () => {
    const r = run({ temperature: 'sensor.t', pressure: 'sensor.p', wind_speed: 'sensor.w', gust_speed: 'sensor.g' }, {
      'sensor.t': sensor('unavailable', '°F'),
      'sensor.p': sensor('unavailable', 'inHg'),
      'sensor.w': sensor('unavailable', 'm/s'),
      'sensor.g': sensor('unavailable', 'm/s'),
      'weather.home': metricWeather,
    });
    expect([r.temperature.value, r.pressure.value, r.wind_speed.value, r.gust_speed.value])
      .toEqual(['20', '1013', '36', '54']);
    expect([r.temperature.unit, r.pressure.unit, r.wind_speed.unit, r.gust_speed.unit])
      .toEqual(['°C', 'hPa', 'km/h', 'km/h']);
    expect(r.temperature.canonical).toBeCloseTo(20, 9);
    expect(r.pressure.canonical).toBeCloseTo(1013, 9);
    expect(r.wind_speed.canonical).toBeCloseTo(10, 9);
    expect(r.gust_speed.canonical).toBeCloseTo(15, 9);
    expect(r.temperature.source).toEqual({ kind: 'weather', entityId: 'weather.home', sensorId: 'sensor.t' });
    expect(r.displayUnits).toEqual({ temperature: '°F', pressure: 'inHg', speed: 'm/s', precipitation: 'mm' });
  });

  it('gives a sensor with an unknown unit no canonical value', () => {
    const r = run({ wind_speed: 'sensor.w' }, { 'sensor.w': sensor('20', 'foo') }, undefined);
    expect(r.wind_speed).toEqual({
      value: '20', unit: 'foo', canonical: null, source: { kind: 'station', entityId: 'sensor.w' },
    });
  });

  it('reads a wind sensor without a unit in the assumed unit', () => {
    const states = { 'sensor.w': sensor('36') };
    const withEntity = run({ wind_speed: 'sensor.w' }, { ...states, 'weather.home': metricWeather });
    expect(withEntity.wind_speed.unit).toBe('km/h');
    expect(withEntity.wind_speed.canonical).toBeCloseTo(10, 9);
    const withSystem = run({ wind_speed: 'sensor.w' }, states, undefined, {}, { unitSystem: { wind_speed: 'mph' } });
    expect(withSystem.wind_speed.unit).toBe('mph');
    const bare = run({ wind_speed: 'sensor.w' }, states, undefined);
    expect(bare.wind_speed.unit).toBe('m/s');
    expect(bare.wind_speed.canonical).toBe(36);
  });

  it('takes the other wind sensor unit for a gust sensor without one', () => {
    const r = run({ wind_speed: 'sensor.w', gust_speed: 'sensor.g' }, {
      'sensor.w': sensor('10', 'kn'),
      'sensor.g': sensor('20'),
    }, undefined);
    expect(r.gust_speed.unit).toBe('kn');
  });

  it('reads a temperature sensor without a unit in the unit system', () => {
    const r = run({ temperature: 'sensor.t' }, { 'sensor.t': sensor('68') }, undefined, {}, {
      unitSystem: { temperature: '°F' },
    });
    expect(r.temperature.unit).toBe('°F');
    expect(r.temperature.canonical).toBeCloseTo(20, 9);
  });

  it('reads a dew sensor without a unit in the temperature sensor unit', () => {
    const r = run({ temperature: 'sensor.t', dew_point: 'sensor.d' }, {
      'sensor.t': sensor('68', '°F'),
      'sensor.d': sensor('50'),
    }, undefined);
    expect(r.dew_point.unit).toBe('°F');
    expect(r.dew_point.canonical).toBeCloseTo(10, 9);
  });

  it('reads a pressure sensor without a unit in the entity unit', () => {
    const r = run({ pressure: 'sensor.p' }, {
      'sensor.p': sensor('30'),
      'weather.home': { attributes: { pressure_unit: 'inHg' } },
    });
    expect(r.pressure.unit).toBe('inHg');
  });

  it('gives zero-degree levels a length and a counter none', () => {
    const r = run({ zero_degree_level: 'sensor.zdl', precipitation: 'sensor.rain' }, {
      'sensor.zdl': sensor('2800', 'm'),
      'sensor.rain': sensor('3.4', 'mm'),
    }, undefined);
    expect(r.zero_degree_level.canonical).toBe(2800);
    expect(r.precipitation.canonical).toBeNull();
    const rate = run({ precipitation: 'sensor.rain' }, { 'sensor.rain': sensor('3.4', 'mm/h') }, undefined);
    expect(rate.precipitation.canonical).toBe(3.4);
  });

  it('reads sensors without a unit in the assumed zero-degree and precipitation units', () => {
    const r = run({ zero_degree_level: 'sensor.zdl', precipitation: 'sensor.rain' }, {
      'sensor.zdl': sensor('2800'),
      'sensor.rain': sensor('1.2'),
    }, undefined, {}, { unitSystem: { accumulated_precipitation: 'in' } });
    expect(r.zero_degree_level.unit).toBe('m');
    expect(r.zero_degree_level.canonical).toBe(2800);
    expect(r.precipitation.unit).toBe('in');
    expect(r.precipitation.canonical).toBeNull();
  });

  it('resolves the display units from config, sensors, entity and unit system', () => {
    const r = run({ pressure: 'sensor.p', precipitation_rate: 'sensor.rr' }, {
      'sensor.p': sensor('29.9', 'inHg'),
      'sensor.rr': sensor('0.1', 'in/h'),
      'weather.home': metricWeather,
    }, 'weather.home', {}, { configUnits: { pressure: 'hPa' } });
    expect(r.displayUnits).toEqual({ temperature: '°C', pressure: 'hPa', speed: 'km/h', precipitation: 'in' });
    const fromSystem = run({}, {}, undefined, {}, {
      unitSystem: { temperature: '°F', pressure: 'psi', wind_speed: 'mph', accumulated_precipitation: 'in' },
    });
    expect(fromSystem.displayUnits).toEqual({ temperature: '°F', pressure: 'psi', speed: 'mph', precipitation: 'in' });
  });

  it('takes the entity unit when no sensor is configured', () => {
    const r = run({}, { 'weather.home': metricWeather });
    expect(r.temperature).toEqual({
      value: '20', unit: '°C', canonical: 20, source: { kind: 'weather', entityId: 'weather.home' },
    });
    expect(r.wind_speed.unit).toBe('km/h');
    expect(r.humidity.unit).toBe('%');
    expect(r.uv_index).toEqual({
      value: '3', unit: undefined, canonical: null, source: { kind: 'weather', entityId: 'weather.home' },
    });
  });

  it('falls back to the base units without sensor or entity', () => {
    const r = run({}, {}, undefined);
    expect(r.temperature).toEqual({ value: undefined, unit: '°C', canonical: null, source: undefined });
    expect(r.wind_direction).toEqual({ value: undefined, unit: '°', canonical: null, source: undefined });
  });

  it('gives an entity dew point the entity temperature unit, a sensor dew point its own', () => {
    const viaEntity = run({ temperature: 'sensor.t', dew_point: 'sensor.d' }, {
      'sensor.t': sensor('20', '°C'),
      'sensor.d': sensor('unavailable', '°F'),
      'weather.home': metricWeather,
    });
    expect(viaEntity.dew_point.unit).toBe('°C');
    expect(viaEntity.dew_point.source.kind).toBe('weather');
    const viaSensor = run({ temperature: 'sensor.t', dew_point: 'sensor.d' }, {
      'sensor.t': sensor('20', '°C'),
      'sensor.d': sensor('50', '°F'),
    });
    expect(viaSensor.dew_point).toMatchObject({
      value: '50', unit: '°F', source: { kind: 'station', entityId: 'sensor.d' },
    });
    expect(viaSensor.dew_point.canonical).toBeCloseTo(10, 9);
  });

  it('passes a non-numeric entity value through unscaled', () => {
    const r = run({ temperature: 'sensor.t' }, {
      'sensor.t': sensor('unavailable', '°F'),
      'weather.home': { attributes: { ...metricWeather.attributes, temperature: 'n/a' } },
    });
    expect(r.temperature.value).toBe('n/a');
  });

  it('reads the wind direction sensor only while numeric, without a last good value (#437)', () => {
    const lastGood = { 'sensor.dir': '90' };
    const live = run({ wind_direction: 'sensor.dir' }, { 'sensor.dir': sensor('180', '°') }, undefined, lastGood);
    expect(live.wind_direction).toEqual({
      value: 180, unit: '°', canonical: null, source: { kind: 'station', entityId: 'sensor.dir' },
    });
    const down = run({ wind_direction: 'sensor.dir' }, {
      'sensor.dir': sensor('unavailable', '°'),
      'weather.home': metricWeather,
    }, 'weather.home', lastGood);
    expect(down.wind_direction).toEqual({
      value: 270, unit: '°', canonical: null, source: { kind: 'weather', entityId: 'weather.home', sensorId: 'sensor.dir' },
    });
  });

  it('scales an irradiance sensor into lux', () => {
    const r = run({ illuminance: 'sensor.sol' }, { 'sensor.sol': sensor('100', 'W/m²') });
    expect(r.illuminance).toEqual({
      value: '12000', unit: 'lx', canonical: null, source: { kind: 'station', entityId: 'sensor.sol' },
    });
    const lux = run({ illuminance: 'sensor.lux' }, { 'sensor.lux': sensor('5000', 'lx') });
    expect(lux.illuminance.value).toBe('5000');
    expect(lux.illuminance.unit).toBe('lx');
  });

  it('scales a unitless irradiance sensor and every W/m² spelling into lux', () => {
    const byClass = run({ illuminance: 'sensor.sol' }, {
      'sensor.sol': sensor('100', undefined, { device_class: 'irradiance' }),
    });
    expect(byClass.illuminance.value).toBe('12000');
    expect(byClass.illuminance.unit).toBe('lx');
    const spelled = run({ illuminance: 'sensor.sol' }, { 'sensor.sol': sensor('100', 'w / m2') });
    expect(spelled.illuminance.value).toBe('12000');
    expect(spelled.illuminance.unit).toBe('lx');
  });

  it('leaves an illuminance sensor in an unknown unit as it is', () => {
    const r = run({ illuminance: 'sensor.lux' }, { 'sensor.lux': sensor('5', 'klx') });
    expect(r.illuminance.value).toBe('5');
    expect(r.illuminance.unit).toBe('klx');
    expect(r.illuminance.canonical).toBeNull();
  });

  it('keeps an unavailable irradiance sensor without a last good value undefined', () => {
    const r = run({ illuminance: 'sensor.sol' }, { 'sensor.sol': sensor('unavailable', 'W/m²') });
    expect(r.illuminance.value).toBeUndefined();
  });

  it('never records a weather source for the sensor-only keys', () => {
    const r = run({ precipitation: 'sensor.rain', zero_degree_level: 'sensor.zdl' }, {
      'sensor.rain': sensor('', 'mm'),
      'sensor.zdl': sensor('2800', 'm'),
      'weather.home': metricWeather,
    });
    expect(r.precipitation).toEqual({ value: '', unit: 'mm', canonical: null, source: undefined });
    expect(r.zero_degree_level).toEqual({
      value: '2800', unit: 'm', canonical: 2800, source: { kind: 'station', entityId: 'sensor.zdl' },
    });
    expect(r.zero_degree_level_48h).toEqual({ value: undefined, unit: undefined, canonical: null, source: undefined });
  });

  it('takes the precipitation display unit from the rate sensor when there is no counter', () => {
    const r = run({ precipitation_rate: 'sensor.rr' }, { 'sensor.rr': sensor('0.1', 'in/h') });
    expect(r.displayUnits.precipitation).toBe('in');
  });
});

describe('precipRateReading', () => {
  const station = { kind: 'station', entityId: 'sensor.rr' };

  it('keeps the sensor\'s own value and unit, with the rate in mm/h', () => {
    expect(precipRateReading('sensor.rr', sensor('1', 'in/h'))).toEqual({
      value: '1', unit: 'in/h', canonical: 25.4, source: station,
    });
    expect(precipRateReading('sensor.rr', sensor('24', 'mm/d')).canonical).toBe(1);
  });

  it('reads a bare depth unit per hour', () => {
    expect(precipRateReading('sensor.rr', sensor('2', 'mm'))).toEqual({
      value: '2', unit: 'mm', canonical: 2, source: station,
    });
  });

  it('has no canonical for a unit the table does not know', () => {
    expect(precipRateReading('sensor.rr', sensor('3', 'foo'))).toEqual({
      value: '3', unit: 'foo', canonical: null, source: station,
    });
  });

  it('reads a sensor without a unit in the assumed unit per hour', () => {
    expect(precipRateReading('sensor.rr', { state: '1.5' })).toEqual({
      value: '1.5', unit: 'mm/h', canonical: 1.5, source: station,
    });
    expect(precipRateReading('sensor.rr', { state: '0.1' }, 'in')).toMatchObject({ unit: 'in/h' });
    expect(precipRateReading('sensor.rr', { state: '0.1' }, 'in').canonical).toBeCloseTo(2.54, 9);
    // The rate table has no cm/h; the assumed depth still converts.
    expect(precipRateReading('sensor.rr', { state: '1' }, 'cm')).toMatchObject({ unit: 'cm/h', canonical: 10 });
  });

  it('is null without a sensor or a numeric state', () => {
    expect(precipRateReading(undefined, undefined)).toBeNull();
    expect(precipRateReading('sensor.rr', sensor('unavailable', 'mm/h'))).toBeNull();
  });
});

describe('availability', () => {
  it('treats unavailable and unknown as no value', () => {
    expect(isUnavailableState('unavailable')).toBe(true);
    expect(isUnavailableState('unknown')).toBe(true);
    expect(isUnavailableState('0')).toBe(false);
    expect(isUnavailableState(undefined)).toBe(false);
  });

  it('lists configured sensors that are absent or unavailable', () => {
    const out = unavailableSensors(
      { temperature: 'sensor.t', humidity: 'sensor.h', pressure: 'sensor.p', dew_point: '', uv_index: 7 },
      { 'sensor.t': sensor('20'), 'sensor.h': sensor('unknown') },
    );
    expect(out).toEqual([
      { key: 'humidity', eid: 'sensor.h' },
      { key: 'pressure', eid: 'sensor.p' },
    ]);
  });
});

describe('liveSourcesOf', () => {
  it('lists every live key plus the computed sun and moon', () => {
    const r = run({ temperature: 'sensor.t' }, { 'sensor.t': sensor('20', '°C') }, undefined);
    const sources = liveSourcesOf(r);
    for (const key of LIVE_SOURCE_KEYS) expect(key in sources).toBe(true);
    expect(sources.temperature).toEqual({ kind: 'station', entityId: 'sensor.t' });
    expect(sources.humidity).toBeUndefined();
    expect(sources.sun).toEqual({ kind: 'computed' });
    expect(sources.moon).toEqual({ kind: 'computed' });
  });
});

describe('illuminanceUnit', () => {
  it('reads irradiance by device class over the unit, else the own unit, else lx', () => {
    expect(illuminanceUnit({ unit_of_measurement: 'lx' })).toBe('lx');
    expect(illuminanceUnit({ unit_of_measurement: 'W/m²' })).toBe('W/m²');
    expect(illuminanceUnit({ device_class: 'irradiance' })).toBe('W/m²');
    expect(illuminanceUnit({ device_class: 'irradiance', unit_of_measurement: 'lx' })).toBe('W/m²');
    expect(illuminanceUnit({})).toBe('lx');
    expect(illuminanceUnit(undefined)).toBe('lx');
    expect(illuminanceUnit({ unit_of_measurement: 'klx' })).toBe('klx');
  });
});
