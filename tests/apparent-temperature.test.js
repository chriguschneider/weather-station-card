import { describe, it, expect } from 'vitest';
import { apparentTemperature } from '../src/utils/apparent-temperature.js';
import { extractSensorReadings, liveSourcesOf } from '../src/sensor-readings.js';

const sensor = (state, unit) => ({ state, attributes: { unit_of_measurement: unit } });
const wx = (extra = {}) => ({ state: 'cloudy', attributes: { temperature: 3, temperature_unit: '°C', ...extra } });
const run = (sensors, states) =>
  extractSensorReadings({ sensors, states, weatherEntity: 'weather.home', lastGood: {} });

describe('apparentTemperature (BoM)', () => {
  it.each([
    [0, 80, 5, -5.89],
    [30, 60, 1, 33.67],
    [15, 50, 3, 11.71],
    [-5, 90, 10, -14.75],
  ])('(%s °C, %s %%, %s m/s) → %s', (ta, rh, ws, expected) => {
    expect(apparentTemperature(ta, rh, ws)).toBeCloseTo(expected, 2);
  });

  it('is null for a non-finite input', () => {
    expect(apparentTemperature(NaN, 50, 1)).toBeNull();
  });
});

describe('computed apparent_temperature reading', () => {
  const sensors = { temperature: 'sensor.t', humidity: 'sensor.h', wind_speed: 'sensor.w' };
  const base = {
    'weather.home': wx(),
    'sensor.t': sensor('0', '°C'),
    'sensor.h': sensor('80', '%'),
    'sensor.w': sensor('18', 'km/h'),
  };

  it('computes from station sensors, converting km/h, source computed → temperature sensor', () => {
    const r = run(sensors, base).apparent_temperature;
    expect(r.canonical).toBeCloseTo(-5.89, 2);
    expect(r.source).toEqual({ kind: 'computed', entityId: 'sensor.t' });
    expect(liveSourcesOf(run(sensors, base)).apparent_temperature.kind).toBe('computed');
  });

  it('converts a °F temperature', () => {
    const r = run(sensors, { ...base, 'sensor.t': sensor('32', '°F') }).apparent_temperature;
    expect(r.canonical).toBeCloseTo(-5.89, 2);
  });

  it('the sensor wins over the computation', () => {
    const r = run({ ...sensors, apparent_temperature: 'sensor.a' }, { ...base, 'sensor.a': sensor('-7', '°C') }).apparent_temperature;
    expect(r.value).toBe('-7');
    expect(r.source.kind).toBe('station');
  });

  it('computation wins over the weather attribute', () => {
    const r = run(sensors, { ...base, 'weather.home': wx({ apparent_temperature: 9 }) }).apparent_temperature;
    expect(r.source.kind).toBe('computed');
  });

  it.each(['sensor.t', 'sensor.h', 'sensor.w'])('does not compute with %s unavailable; weather attribute is used', (id) => {
    const states = { ...base, [id]: sensor('unavailable', '°C'), 'weather.home': wx({ apparent_temperature: 9, humidity: 50, wind_speed: 3 }) };
    const r = run(sensors, states).apparent_temperature;
    expect(r.source.kind).toBe('weather');
    expect(r.value).toBe('9');
  });

  it('does not compute with an input missing; no attribute → no value', () => {
    const r = run({ temperature: 'sensor.t', humidity: 'sensor.h' }, base).apparent_temperature;
    expect(r.value).toBeUndefined();
    expect(r.source).toBeUndefined();
  });
});
