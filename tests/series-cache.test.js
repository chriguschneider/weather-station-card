// Unit tests for src/utils/series-cache.ts — the versioned
// localStorage stale-while-revalidate cache behind the instant first
// paint (ADR-0020).
//
// The vitest environment is 'node' (no window). The module reads
// `window.localStorage` defensively, so each test installs a minimal
// in-memory Storage stub on globalThis.window and removes it after.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seriesCacheKey, loadSeriesCache, saveSeriesCache } from '../src/utils/series-cache.js';

/** Minimal in-memory Storage: just what the module touches
 *  (getItem/setItem/removeItem/key/length). */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _map: map,
  };
}

const HOUR = 3600_000;
const NOW = 1_700_000_000_000;

describe('seriesCacheKey', () => {
  it('builds a namespaced key from kind and parts', () => {
    expect(seriesCacheKey('station', ['hour', 7, 'temperature=sensor.t']))
      .toBe('wsc_series_station_hour|7|temperature=sensor.t');
    expect(seriesCacheKey('forecast', ['hourly', 'weather.home']))
      .toBe('wsc_series_forecast_hourly|weather.home');
  });

  it('distinguishes role assignments (role=entity parts)', () => {
    const a = seriesCacheKey('station', ['hour', 7, 'dew_point=sensor.a', 'temperature=sensor.b']);
    const b = seriesCacheKey('station', ['hour', 7, 'dew_point=sensor.b', 'temperature=sensor.a']);
    expect(a).not.toBe(b);
  });
});

describe('save / load roundtrip', () => {
  let storage;
  beforeEach(() => {
    storage = memoryStorage();
    globalThis.window = { localStorage: storage };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('returns the saved series while fresh', () => {
    const series = [{ datetime: '2026-08-07T00:00:00.000Z', temperature: 21.5 }];
    saveSeriesCache('wsc_series_station_k', series, NOW);
    expect(loadSeriesCache('wsc_series_station_k', NOW + HOUR)).toEqual(series);
  });

  it('misses on an unknown key', () => {
    expect(loadSeriesCache('wsc_series_station_nope', NOW)).toBeNull();
  });

  it('misses once the payload is older than the max age (12 h)', () => {
    saveSeriesCache('wsc_series_station_k', [{ datetime: 'x' }], NOW);
    expect(loadSeriesCache('wsc_series_station_k', NOW + 13 * HOUR)).toBeNull();
  });

  it('misses on malformed JSON', () => {
    storage.setItem('wsc_series_station_k', '{not json');
    expect(loadSeriesCache('wsc_series_station_k', NOW)).toBeNull();
  });

  it('misses on an unknown schema version', () => {
    storage.setItem('wsc_series_station_k',
      JSON.stringify({ v: 999, ts: NOW, forecast: [{ datetime: 'x' }] }));
    expect(loadSeriesCache('wsc_series_station_k', NOW)).toBeNull();
  });

  it('misses when the stored forecast is not an array', () => {
    storage.setItem('wsc_series_station_k',
      JSON.stringify({ v: 1, ts: NOW, forecast: { datetime: 'x' } }));
    expect(loadSeriesCache('wsc_series_station_k', NOW)).toBeNull();
  });
});

describe('expired-slot pruning on save', () => {
  let storage;
  beforeEach(() => {
    storage = memoryStorage();
    globalThis.window = { localStorage: storage };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('sweeps expired and unreadable wsc_series_* slots, keeps fresh and foreign keys', () => {
    // Orphaned slot from an old config — 2 days stale.
    storage.setItem('wsc_series_station_old',
      JSON.stringify({ v: 1, ts: NOW - 48 * HOUR, forecast: [] }));
    // Corrupt slot.
    storage.setItem('wsc_series_forecast_bad', 'garbage');
    // Fresh sibling slot.
    saveSeriesCache('wsc_series_forecast_fresh', [{ datetime: 'x' }], NOW - HOUR);
    // Non-cache key must never be touched.
    storage.setItem('unrelated_key', 'keep me');

    saveSeriesCache('wsc_series_station_new', [{ datetime: 'y' }], NOW);

    expect(storage.getItem('wsc_series_station_old')).toBeNull();
    expect(storage.getItem('wsc_series_forecast_bad')).toBeNull();
    expect(loadSeriesCache('wsc_series_forecast_fresh', NOW)).toEqual([{ datetime: 'x' }]);
    expect(loadSeriesCache('wsc_series_station_new', NOW)).toEqual([{ datetime: 'y' }]);
    expect(storage.getItem('unrelated_key')).toBe('keep me');
  });
});

describe('hardened contexts', () => {
  it('load returns null and save is a no-op without window/localStorage', () => {
    delete globalThis.window;
    expect(loadSeriesCache('wsc_series_station_k', NOW)).toBeNull();
    expect(() => saveSeriesCache('wsc_series_station_k', [], NOW)).not.toThrow();
  });

  it('survives a storage whose setItem throws (quota / private mode)', () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    globalThis.window = { localStorage: storage };
    expect(() => saveSeriesCache('wsc_series_station_k', [{ datetime: 'x' }], NOW)).not.toThrow();
    delete globalThis.window;
  });
});
