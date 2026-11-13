import { describe, it, expect } from 'vitest';
import { SENSOR_MATCHERS, AUTO_PICK_KEYS, sensorCandidates, autoPickSensor } from '../src/sensor-match.js';

const st = (attributes = {}, extra = {}) => ({ state: '1', attributes, ...extra });

// A mixed station, shaped like the entity ids and attributes HA
// integrations expose (Ecowitt, MeteoSwiss, Pirateweather naming).
const states = {
  'sensor.garden_temperature': st({ device_class: 'temperature', friendly_name: 'Garden temperature' }),
  'sensor.kitchen_temperature': st({ device_class: 'temperature', friendly_name: 'Kitchen temperature' }),
  'sensor.ws_dew_point': st({ device_class: 'temperature' }),
  'sensor.ws_pressure': st({ device_class: 'pressure' }),
  'sensor.ws_humidity': st({ device_class: 'humidity' }),
  'sensor.ws_precipitation_today': st({ device_class: 'precipitation' }),
  'sensor.ws_precipitation': st({ device_class: 'precipitation' }),
  'sensor.home_precipitation_rate': st({ unit_of_measurement: 'mm/h' }),
  'sensor.ws_wind_speed': st({ device_class: 'wind_speed' }),
  'sensor.ws_wind_gust': st({ device_class: 'wind_speed' }),
  'sensor.ws_wind_direction': st({ unit_of_measurement: '°' }),
  'sensor.ws_solar_radiation': st({ device_class: 'irradiance' }),
  'sensor.ws_uv_index': st({}),
  'sensor.meteoswiss_zero_degree_level': st({}),
  'sensor.meteoswiss_zero_degree_level_48h': st({}),
  'sensor.radar_next_rain': st({}),
  'weather.home': st({}),
};
const ids = Object.keys(states);
const hass = { states };

describe('autoPickSensor', () => {
  it('picks one sensor per slot', () => {
    const picks = Object.fromEntries(AUTO_PICK_KEYS.map((k) => [k, autoPickSensor(k, ids, hass, 0)]));
    expect(picks).toEqual({
      temperature: 'sensor.garden_temperature',
      pressure: 'sensor.ws_pressure',
      humidity: 'sensor.ws_humidity',
      dew_point: 'sensor.ws_dew_point',
      precipitation: 'sensor.ws_precipitation_today',
      precipitation_rate: 'sensor.home_precipitation_rate',
      wind_speed: expect.stringMatching(/^sensor\.ws_wind_(speed|gust)$/),
      gust_speed: 'sensor.ws_wind_gust',
      wind_direction: 'sensor.ws_wind_direction',
      illuminance: 'sensor.ws_solar_radiation',
      uv_index: 'sensor.ws_uv_index',
      zero_degree_level: 'sensor.meteoswiss_zero_degree_level',
      zero_degree_level_48h: 'sensor.meteoswiss_zero_degree_level_48h',
      next_rain: 'sensor.radar_next_rain',
    });
  });

  it('every pick is offered by the editor picker of its slot', () => {
    for (const key of AUTO_PICK_KEYS) {
      const pick = autoPickSensor(key, ids, hass, 0);
      if (pick) expect(sensorCandidates(key, ids, hass)).toContain(pick);
    }
  });

  it('tries the tiers in order (atmospheric_pressure before pressure)', () => {
    const s = {
      'sensor.a': st({ device_class: 'pressure' }),
      'sensor.b': st({ device_class: 'atmospheric_pressure' }),
    };
    expect(autoPickSensor('pressure', Object.keys(s), { states: s })).toBe('sensor.b');
  });

  it('ranks outdoor names, garden areas and recent activity', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    const s = {
      'sensor.t1': st({ device_class: 'temperature', friendly_name: 'Living room' }),
      'sensor.t2': st({ device_class: 'temperature', area_id: 'garden' }),
      'sensor.t3': st({ device_class: 'temperature' }, { last_changed: '2026-11-13T11:30:00Z' }),
    };
    expect(autoPickSensor('temperature', Object.keys(s), { states: s }, now)).toBe('sensor.t2');
    delete s['sensor.t2'];
    expect(autoPickSensor('temperature', Object.keys(s), { states: s }, now)).toBe('sensor.t3');
  });

  it('works on ids alone and ignores non-sensor entities', () => {
    expect(autoPickSensor('gust_speed', ['weather.gust', 'sensor.x_gust'], null)).toBe('sensor.x_gust');
    expect(autoPickSensor('temperature', ['sensor.t'], { states: {} })).toBe('');
    expect(autoPickSensor('sunshine_duration', ids, hass)).toBe('');
  });

  it('prefers the radar registry entry for next rain', () => {
    const h = {
      states: { 'sensor.renamed': st({}) },
      entities: { 'sensor.renamed': { platform: 'meteoswiss_radar', translation_key: 'next_rain' } },
    };
    expect(autoPickSensor('next_rain', ['sensor.renamed'], h)).toBe('sensor.renamed');
    expect(sensorCandidates('next_rain', ['sensor.renamed'], h)).toEqual(['sensor.renamed']);
    expect(autoPickSensor('next_rain', [], { states: {} })).toBe('');
  });
});

describe('sensorCandidates', () => {
  it('widens a slot with its list-only predicates', () => {
    const c = sensorCandidates('dew_point', ids, hass);
    expect(c).toContain('sensor.ws_dew_point');
    expect(c).toContain('sensor.garden_temperature');
    expect(sensorCandidates('precipitation_rate', ids, hass)).toEqual(['sensor.home_precipitation_rate']);
    expect(sensorCandidates('uv_index', ['sensor.x'], { states: { 'sensor.x': st({ friendly_name: 'UV Index' }) } }))
      .toEqual(['sensor.x']);
  });

  it('is empty for a slot without a matcher', () => {
    expect(SENSOR_MATCHERS.sunshine_duration).toBeUndefined();
    expect(sensorCandidates('sunshine_duration', ids, hass)).toEqual([]);
  });
});
