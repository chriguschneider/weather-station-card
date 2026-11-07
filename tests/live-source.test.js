import { describe, it, expect } from 'vitest';
import { resolveLiveSource, sourceLabel, groupSources } from '../src/live-source.js';

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
    expect(resolveLiveSource({ ...base, sensorState: 'unavailable', sensorValue: undefined }))
      .toEqual({ kind: 'weather', entityId: 'weather.home' });
    expect(resolveLiveSource({ ...base, sensorValue: '' }))
      .toEqual({ kind: 'weather', entityId: 'weather.home' });
  });

  it('uses the weather entity when no sensor is configured', () => {
    expect(resolveLiveSource({ ...base, sensorId: undefined, sensorState: undefined, sensorValue: undefined }))
      .toEqual({ kind: 'weather', entityId: 'weather.home' });
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
});

describe('groupSources', () => {
  const st = { kind: 'station', entityId: 'sensor.a' };
  const wx = { kind: 'weather', entityId: 'weather.home' };

  it('collapses identical sources of a combined row into one group', () => {
    expect(groupSources([st, { ...st }])).toEqual([{ kind: 'station', entityIds: ['sensor.a'] }]);
  });

  it('merges two station sensors into one group listing both entities', () => {
    expect(groupSources([st, { kind: 'station', entityId: 'sensor.b' }]))
      .toEqual([{ kind: 'station', entityIds: ['sensor.a', 'sensor.b'] }]);
  });

  it('keeps different kinds in display order and skips missing ones', () => {
    expect(groupSources([wx, undefined, st])).toEqual([
      { kind: 'weather', entityIds: ['weather.home'] },
      { kind: 'station', entityIds: ['sensor.a'] },
    ]);
  });

  it('keeps entity-less computed sources', () => {
    expect(groupSources([{ kind: 'computed' }])).toEqual([{ kind: 'computed', entityIds: [] }]);
  });

  it('returns an empty list when nothing is known', () => {
    expect(groupSources([undefined, undefined])).toEqual([]);
  });
});
