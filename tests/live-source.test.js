import { describe, it, expect } from 'vitest';
import { resolveLiveSource, sourceLabel, isSensorProblem } from '../src/live-source.js';

const OVERDUE = new Set(['sensor.outdoor_temperature']);

const base = {
  sensorId: 'sensor.outdoor_temperature',
  sensorState: '-2.1',
  sensorValue: '-2.1',
  weatherEntity: 'weather.home',
  weatherHasValue: true,
};

describe('resolveLiveSource', () => {
  it('attributes a live sensor value to the station', () => {
    expect(resolveLiveSource(base)).toEqual({ kind: 'station', entityId: 'sensor.outdoor_temperature' });
  });

  it('marks the last good value of an unavailable sensor as stale, even with a weather entity', () => {
    // valueOf() returns the last good state while unavailable (#213),
    // and fromWxIfMissing keeps it — the weather entity is not used.
    for (const sensorState of ['unavailable', 'unknown']) {
      expect(resolveLiveSource({ ...base, sensorState })).toEqual({
        kind: 'stale',
        entityId: 'sensor.outdoor_temperature',
      });
    }
  });

  it('falls back to the weather entity when the sensor yields no value', () => {
    // A configured sensor is down, so the fallback is a sensor problem.
    const down = { kind: 'weather', entityId: 'weather.home', sensorId: 'sensor.outdoor_temperature' };
    expect(resolveLiveSource({ ...base, sensorState: 'unavailable', sensorValue: undefined })).toEqual(down);
    expect(resolveLiveSource({ ...base, sensorValue: '' })).toEqual(down);
    expect(isSensorProblem(down, OVERDUE)).toBe(true);
    // Still inside the grace window: neutral.
    expect(isSensorProblem(down, new Set())).toBe(false);
  });

  it('uses the weather entity when no sensor is configured', () => {
    expect(resolveLiveSource({ ...base, sensorId: undefined, sensorState: undefined, sensorValue: undefined }))
      .toEqual({ kind: 'weather', entityId: 'weather.home' });
    // By design, not a problem.
    expect(isSensorProblem({ kind: 'weather', entityId: 'weather.home' }, OVERDUE)).toBe(false);
  });

  it('only overdue stale values and fallbacks for configured sensors are problems', () => {
    expect(isSensorProblem(resolveLiveSource(base), OVERDUE)).toBe(false);
    expect(isSensorProblem(resolveLiveSource({ ...base, sensorState: 'unavailable' }), OVERDUE)).toBe(true);
    expect(isSensorProblem(resolveLiveSource({ ...base, sensorState: 'unavailable' }), new Set())).toBe(false);
    expect(isSensorProblem(undefined, OVERDUE)).toBe(false);
  });

  it('returns undefined when neither source has a value', () => {
    expect(resolveLiveSource({ ...base, sensorValue: undefined, weatherHasValue: false })).toBeUndefined();
    expect(resolveLiveSource({ ...base, sensorValue: undefined, weatherEntity: undefined })).toBeUndefined();
  });

  it('ignores a sensor value when no sensor id is configured', () => {
    expect(resolveLiveSource({ ...base, sensorId: undefined, weatherEntity: undefined })).toBeUndefined();
  });
});

describe('sourceLabel', () => {
  const defaults = { station: 'Station', weather: 'Forecast', computed: 'Calculated' };

  it('returns the localized default per kind; stale reuses the station label', () => {
    expect(sourceLabel('station', undefined, defaults)).toBe('Station');
    expect(sourceLabel('stale', undefined, defaults)).toBe('Station');
    expect(sourceLabel('weather', undefined, defaults)).toBe('Forecast');
    expect(sourceLabel('computed', undefined, defaults)).toBe('Calculated');
  });

  it('prefers user labels and trims them', () => {
    const labels = { station: ' Netatmo ', weather: 'met.no', computed: 'calc' };
    expect(sourceLabel('station', labels, defaults)).toBe('Netatmo');
    expect(sourceLabel('stale', labels, defaults)).toBe('Netatmo');
    expect(sourceLabel('weather', labels, defaults)).toBe('met.no');
    expect(sourceLabel('computed', labels, defaults)).toBe('calc');
  });

  it('falls back to the default for an empty user label', () => {
    expect(sourceLabel('weather', { weather: '' }, defaults)).toBe('Forecast');
  });

  it('ignores non-string YAML values instead of throwing', () => {
    expect(sourceLabel('station', { station: 123 }, defaults)).toBe('Station');
    expect(sourceLabel('weather', { weather: { a: 1 } }, defaults)).toBe('Forecast');
    expect(sourceLabel('computed', { computed: true }, defaults)).toBe('Calculated');
  });
});

