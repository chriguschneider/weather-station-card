import { describe, it, expect } from 'vitest';
import {
  extractSensorReadings,
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

const run = (sensors, states, weatherEntity = 'weather.home', lastGood = {}) =>
  extractSensorReadings({ sensors, states, weatherEntity, lastGood });

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

describe('extractSensorReadings: value, unit and source decided together', () => {
  it('takes a live sensor with its own unit and records the station', () => {
    const r = run({ temperature: 'sensor.t' }, {
      'sensor.t': sensor('68', '°F'),
      'weather.home': metricWeather,
    });
    expect(r.temperature).toEqual({
      value: '68', unit: '°F', source: { kind: 'station', entityId: 'sensor.t' },
    });
  });

  it('keeps the last good value of an unavailable sensor as stale', () => {
    const lastGood = {};
    const states = { 'sensor.h': sensor('61', '%') };
    run({ humidity: 'sensor.h' }, states, undefined, lastGood);
    expect(lastGood['sensor.h']).toBe('61');
    const r = run({ humidity: 'sensor.h' }, { 'sensor.h': sensor('unavailable', '%') }, undefined, lastGood);
    expect(r.humidity).toEqual({ value: '61', unit: '%', source: { kind: 'stale', entityId: 'sensor.h' } });
  });

  it('rescales a weather value into the unavailable sensor unit and says so (#438)', () => {
    const r = run({ temperature: 'sensor.t', pressure: 'sensor.p', wind_speed: 'sensor.w' }, {
      'sensor.t': sensor('unavailable', '°F'),
      'sensor.p': sensor('unavailable', 'inHg'),
      'sensor.w': sensor('unavailable', 'm/s'),
      'weather.home': metricWeather,
    });
    expect(r.temperature.unit).toBe('°F');
    expect(parseFloat(r.temperature.value)).toBeCloseTo(68, 5);
    expect(r.temperature.source).toEqual({ kind: 'weather', entityId: 'weather.home', sensorId: 'sensor.t' });
    expect(r.pressure.unit).toBe('inHg');
    expect(parseFloat(r.pressure.value)).toBeCloseTo(29.91, 1);
    expect(r.wind_speed.unit).toBe('m/s');
    expect(parseFloat(r.wind_speed.value)).toBeCloseTo(10, 5);
    expect(r.gust_speed.unit).toBe('m/s');
    expect(parseFloat(r.gust_speed.value)).toBeCloseTo(15, 5);
  });

  it('takes the entity unit when no sensor is configured', () => {
    const r = run({}, { 'weather.home': metricWeather });
    expect(r.temperature).toEqual({
      value: '20', unit: '°C', source: { kind: 'weather', entityId: 'weather.home' },
    });
    expect(r.wind_speed.unit).toBe('km/h');
    expect(r.humidity.unit).toBe('%');
    expect(r.uv_index).toEqual({ value: '3', unit: undefined, source: { kind: 'weather', entityId: 'weather.home' } });
    expect(r.units).toEqual({ wind: 'km/h', pressure: 'hPa', temperature: '°C', precipBase: 'mm' });
  });

  it('falls back to the base units without sensor or entity', () => {
    const r = run({}, {}, undefined);
    expect(r.units).toEqual({ wind: 'm/s', pressure: 'hPa', temperature: '°C', precipBase: 'mm' });
    expect(r.temperature).toEqual({ value: undefined, unit: '°C', source: undefined });
    expect(r.wind_direction).toEqual({ value: undefined, unit: '°', source: undefined });
  });

  it('gives an entity dew point the temperature unit, a sensor dew point its own', () => {
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
    expect(viaSensor.dew_point).toEqual({
      value: '50', unit: '°F', source: { kind: 'station', entityId: 'sensor.d' },
    });
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
      value: 180, unit: '°', source: { kind: 'station', entityId: 'sensor.dir' },
    });
    const down = run({ wind_direction: 'sensor.dir' }, {
      'sensor.dir': sensor('unavailable', '°'),
      'weather.home': metricWeather,
    }, 'weather.home', lastGood);
    expect(down.wind_direction).toEqual({
      value: 270, unit: '°', source: { kind: 'weather', entityId: 'weather.home', sensorId: 'sensor.dir' },
    });
  });

  it('scales an irradiance sensor into lux', () => {
    const r = run({ illuminance: 'sensor.sol' }, { 'sensor.sol': sensor('100', 'W/m²') });
    expect(r.illuminance).toEqual({
      value: '12000', unit: 'lx', source: { kind: 'station', entityId: 'sensor.sol' },
    });
    const lux = run({ illuminance: 'sensor.lux' }, { 'sensor.lux': sensor('5000', 'lx') });
    expect(lux.illuminance.value).toBe('5000');
    expect(lux.illuminance.unit).toBe('lx');
  });

  it('never records a weather source for the sensor-only keys', () => {
    const r = run({ precipitation: 'sensor.rain', zero_degree_level: 'sensor.zdl' }, {
      'sensor.rain': sensor('', 'mm'),
      'sensor.zdl': sensor('2800', 'm'),
      'weather.home': metricWeather,
    });
    expect(r.precipitation).toEqual({ value: '', unit: 'mm', source: undefined });
    expect(r.zero_degree_level).toEqual({
      value: '2800', unit: 'm', source: { kind: 'station', entityId: 'sensor.zdl' },
    });
    expect(r.zero_degree_level_48h).toEqual({ value: undefined, unit: undefined, source: undefined });
  });

  it('takes the precip base unit from the rate sensor when there is no counter', () => {
    const r = run({ precipitation_rate: 'sensor.rr' }, { 'sensor.rr': sensor('0.1', 'in/h') });
    expect(r.units.precipBase).toBe('in');
  });
});

describe('precipRateReading', () => {
  it('converts a numeric rate into the display unit, source station', () => {
    // 25.4 mm/h; mm drops the decimal above 10 (formatPrecipDisplay).
    expect(precipRateReading('sensor.rr', sensor('1', 'in/h'), 'mm')).toEqual({
      value: '25', unit: 'mm/h', source: { kind: 'station', entityId: 'sensor.rr' },
    });
  });

  it('labels a bare base unit as a rate', () => {
    expect(precipRateReading('sensor.rr', sensor('2', 'mm'), 'mm').unit).toBe('mm/h');
  });

  it('is null without a sensor or a numeric state', () => {
    expect(precipRateReading(undefined, undefined, 'mm')).toBeNull();
    expect(precipRateReading('sensor.rr', sensor('unavailable', 'mm/h'), 'mm')).toBeNull();
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
