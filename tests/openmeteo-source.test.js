import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildOpenMeteoUrl,
  parseDailySunshine,
  parseHourlySunshine,
  buildDailyForecast,
  buildHourlyForecast,
  OpenMeteoSource,
  readCachedAvailability,
} from '../src/openmeteo-source.js';

describe('buildOpenMeteoUrl', () => {
  it('hits the forecast endpoint with daily=sunshine_duration', () => {
    const url = buildOpenMeteoUrl(46.91, 7.42, 7, 7);
    expect(url).toContain('https://api.open-meteo.com/v1/forecast');
    expect(url).toContain('daily=sunshine_duration');
    expect(url).toContain('timezone=auto');
    expect(url).toContain('latitude=46.91');
    expect(url).toContain('longitude=7.42');
    expect(url).toContain('past_days=7');
    expect(url).toContain('forecast_days=7');
  });

  it('omits the hourly param by default', () => {
    const url = buildOpenMeteoUrl(46.91, 7.42, 7, 7);
    expect(url).not.toContain('hourly=');
  });

  it('adds hourly=sunshine_duration alongside daily when includeHourly=true', () => {
    const url = buildOpenMeteoUrl(46.91, 7.42, 7, 7, true);
    expect(url).toContain('daily=sunshine_duration');
    expect(url).toContain('hourly=sunshine_duration');
  });

  it('requests the hourly station fields when includeHourly=true', () => {
    const url = buildOpenMeteoUrl(46.91, 7.42, 7, 7, true);
    const hourly = new URL(url).searchParams.get('hourly');
    expect(hourly).toContain('sunshine_duration');
    expect(hourly).toContain('temperature_2m');
    expect(hourly).toContain('precipitation');
    expect(hourly).toContain('weather_code');
    expect(hourly).toContain('wind_speed_10m');
    expect(hourly).toContain('wind_gusts_10m');
    expect(hourly).toContain('wind_direction_10m');
  });

  it('encodes coordinates as strings (decimal points preserved)', () => {
    const url = buildOpenMeteoUrl(-34.6, -58.38, 14, 8);
    // URLSearchParams encodes '-' as '-' (not URL-encoded)
    expect(url).toContain('latitude=-34.6');
    expect(url).toContain('longitude=-58.38');
  });

  it('requests the daily station fields and explicit metric units', () => {
    const url = buildOpenMeteoUrl(46.91, 7.42, 7, 7);
    // Daily field list — temp / precip / weather_code / wind alongside
    // sunshine_duration (feeds the no-station past block, ADR-0015).
    expect(url).toContain('temperature_2m_max');
    expect(url).toContain('temperature_2m_min');
    expect(url).toContain('precipitation_sum');
    expect(url).toContain('weather_code');
    expect(url).toContain('wind_speed_10m_max');
    // Units pinned so values are correct with no station sensor to
    // derive a source unit from.
    expect(url).toContain('temperature_unit=celsius');
    expect(url).toContain('precipitation_unit=mm');
    expect(url).toContain('wind_speed_unit=ms');
  });
});

describe('parseDailySunshine', () => {
  it('maps Open-Meteo two-array shape into {date, value} pairs', () => {
    const response = {
      daily: {
        time: ['2026-04-29', '2026-04-30', '2026-05-01'],
        sunshine_duration: [43296.27, 48214.79, 48495.05],
      },
    };
    expect(parseDailySunshine(response)).toEqual([
      { date: '2026-04-29', value: 43296.27 },
      { date: '2026-04-30', value: 48214.79 },
      { date: '2026-05-01', value: 48495.05 },
    ]);
  });

  it('skips null entries (missing data days from a partial response)', () => {
    const response = {
      daily: {
        time: ['2026-04-29', '2026-04-30', '2026-05-01'],
        sunshine_duration: [43296, null, 48495],
      },
    };
    expect(parseDailySunshine(response)).toEqual([
      { date: '2026-04-29', value: 43296 },
      { date: '2026-05-01', value: 48495 },
    ]);
  });

  it('returns [] for malformed / empty responses', () => {
    expect(parseDailySunshine(null)).toEqual([]);
    expect(parseDailySunshine({})).toEqual([]);
    expect(parseDailySunshine({ daily: null })).toEqual([]);
    expect(parseDailySunshine({ daily: { time: [] } })).toEqual([]);
  });
});

describe('parseHourlySunshine', () => {
  it('maps the hourly two-array shape into {datetime, value} pairs', () => {
    const response = {
      hourly: {
        time: ['2026-05-05T12:00', '2026-05-05T13:00', '2026-05-05T14:00'],
        sunshine_duration: [3600, 1800, 0],
      },
    };
    expect(parseHourlySunshine(response)).toEqual([
      { datetime: '2026-05-05T12:00', value: 3600 },
      { datetime: '2026-05-05T13:00', value: 1800 },
      { datetime: '2026-05-05T14:00', value: 0 },
    ]);
  });

  it('skips null hourly entries', () => {
    const response = {
      hourly: {
        time: ['2026-05-05T12:00', '2026-05-05T13:00'],
        sunshine_duration: [3600, null],
      },
    };
    expect(parseHourlySunshine(response)).toEqual([
      { datetime: '2026-05-05T12:00', value: 3600 },
    ]);
  });

  it('returns [] for malformed / missing hourly section', () => {
    expect(parseHourlySunshine(null)).toEqual([]);
    expect(parseHourlySunshine({})).toEqual([]);
    expect(parseHourlySunshine({ hourly: null })).toEqual([]);
    expect(parseHourlySunshine({ daily: { time: [] } })).toEqual([]);
  });
});

describe('buildDailyForecast', () => {
  const sample = {
    daily: {
      time: ['2026-05-18', '2026-05-19', '2026-05-20'],
      sunshine_duration: [43200, 0, 36000],
      temperature_2m_max: [21.4, 15.0, 19.8],
      temperature_2m_min: [9.1, 8.3, 10.2],
      precipitation_sum: [0, 12.6, 1.1],
      weather_code: [0, 65, 3],
      wind_speed_10m_max: [4.2, 9.7, 5.0],
      wind_gusts_10m_max: [8.1, 18.3, 11.0],
      wind_direction_10m_dominant: [270, 200, 310],
    },
  };

  it('maps daily arrays into station-shaped ForecastEntry objects', () => {
    const out = buildDailyForecast(sample);
    expect(out).toHaveLength(3);
    const e = out[1];
    expect(e.temperature).toBe(15.0); // daily HIGH
    expect(e.templow).toBe(8.3); // daily LOW
    expect(e.precipitation).toBe(12.6);
    expect(e.wind_speed).toBe(9.7); // daily MAX
    expect(e.wind_gust_speed).toBe(18.3);
    expect(e.wind_bearing).toBe(200);
  });

  it('derives condition from the WMO weather_code', () => {
    const out = buildDailyForecast(sample);
    expect(out[0].condition).toBe('sunny'); // code 0
    expect(out[1].condition).toBe('pouring'); // code 65, heavy rain
    expect(out[2].condition).toBe('cloudy'); // code 3, overcast
  });

  it('emits local-midnight ISO datetimes (MeasuredDataSource convention)', () => {
    const out = buildDailyForecast(sample);
    // Local midnight of the civil date — TZ-independent assertion.
    expect(out[2].datetime).toBe(new Date(2026, 4, 20).toISOString());
  });

  it('tags wind_speed_unit so the renderer can convert wind', () => {
    expect(buildDailyForecast(sample)[0].wind_speed_unit).toBe('m/s');
  });

  it('leaves sunshine unset and humidity/pressure/uv null', () => {
    const e = buildDailyForecast(sample)[0];
    // sunshine is filled later by the overlay, not by this builder.
    expect(e.sunshine).toBeUndefined();
    // Open-Meteo daily has no humidity / pressure / uv fields.
    expect(e.humidity).toBe(null);
    expect(e.pressure).toBe(null);
    expect(e.uv_index).toBe(null);
  });

  it('coerces null array cells to null fields', () => {
    const out = buildDailyForecast({
      daily: {
        time: ['2026-05-20'],
        temperature_2m_max: [null],
        temperature_2m_min: [null],
        precipitation_sum: [null],
        weather_code: [null],
        wind_speed_10m_max: [null],
        wind_gusts_10m_max: [null],
        wind_direction_10m_dominant: [null],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].temperature).toBe(null);
    expect(out[0].precipitation).toBe(null);
    expect(out[0].wind_speed).toBe(null);
    // Null weather_code falls back to a neutral condition.
    expect(out[0].condition).toBe('cloudy');
  });

  it('returns [] for malformed / empty responses', () => {
    expect(buildDailyForecast(null)).toEqual([]);
    expect(buildDailyForecast({})).toEqual([]);
    expect(buildDailyForecast({ daily: null })).toEqual([]);
    expect(buildDailyForecast({ daily: { time: [] } })).toEqual([]);
  });
});

describe('buildHourlyForecast', () => {
  const sample = {
    hourly: {
      time: ['2026-05-20T10:00', '2026-05-20T11:00', '2026-05-20T12:00'],
      sunshine_duration: [3600, 1800, 0],
      temperature_2m: [14.2, 15.8, 16.1],
      precipitation: [0, 0.3, 1.7],
      weather_code: [1, 3, 61],
      wind_speed_10m: [3.1, 4.5, 6.0],
      wind_gusts_10m: [7.0, 9.2, 12.4],
      wind_direction_10m: [180, 200, 220],
    },
  };

  it('maps hourly arrays into station-shaped ForecastEntry objects', () => {
    const out = buildHourlyForecast(sample);
    expect(out).toHaveLength(3);
    const e = out[1];
    expect(e.temperature).toBe(15.8); // single hourly mean — no high/low
    expect(e.templow).toBeUndefined();
    expect(e.precipitation).toBe(0.3);
    expect(e.wind_speed).toBe(4.5);
    expect(e.wind_gust_speed).toBe(9.2);
    expect(e.wind_bearing).toBe(200);
    expect(e.wind_speed_unit).toBe('m/s');
  });

  it('derives condition from the WMO weather_code', () => {
    const out = buildHourlyForecast(sample);
    expect(out[0].condition).toBe('sunny'); // code 1
    expect(out[2].condition).toBe('rainy'); // code 61
  });

  it('emits on-the-hour ISO datetimes (MeasuredDataSource convention)', () => {
    const out = buildHourlyForecast(sample);
    // On-the-hour local time — TZ-independent assertion.
    expect(out[2].datetime).toBe(new Date(2026, 4, 20, 12, 0).toISOString());
  });

  it('returns [] for malformed / missing hourly section', () => {
    expect(buildHourlyForecast(null)).toEqual([]);
    expect(buildHourlyForecast({})).toEqual([]);
    expect(buildHourlyForecast({ hourly: null })).toEqual([]);
    expect(buildHourlyForecast({ daily: { time: [] } })).toEqual([]);
  });
});

// Tiny in-memory localStorage stand-in. Has the .getItem / .setItem
// surface OpenMeteoSource needs; survives a single test run.
function makeStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

function makeFetchOk(response) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  }));
}

function makeFetchFail(status = 503) {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({ error: 'simulated' }),
  }));
}

describe('OpenMeteoSource', () => {
  const lat = 46.91;
  const lon = 7.42;
  const sampleResponse = {
    daily: {
      time: ['2026-04-29', '2026-04-30', '2026-05-01'],
      sunshine_duration: [43296, 48214, 48495],
    },
  };

  let nowMs;
  beforeEach(() => { nowMs = 1_700_000_000_000; });
  const now = () => nowMs;

  it('starts with empty values when no cache and no fetch yet', () => {
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: makeFetchOk(sampleResponse),
      storage: makeStorage(),
      now,
    });
    expect(src.getDailyValues()).toEqual([]);
    expect(src.getHourlyValues()).toEqual([]);
  });

  it('exposes hourly values when includeHourly:true', async () => {
    const fetchSpy = makeFetchOk({
      ...sampleResponse,
      hourly: {
        time: ['2026-05-05T12:00', '2026-05-05T13:00'],
        sunshine_duration: [3600, 1800],
      },
    });
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon, includeHourly: true,
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    await src.ensureFresh();
    // Only one HTTP call — Open-Meteo returns daily + hourly together.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toContain('hourly=sunshine_duration');
    expect(src.getDailyValues()).toHaveLength(3);
    expect(src.getHourlyValues()).toHaveLength(2);
  });

  it('does not request hourly when includeHourly:false', async () => {
    const fetchSpy = makeFetchOk(sampleResponse);
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon, // includeHourly defaults false
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    await src.ensureFresh();
    const url = fetchSpy.mock.calls[0][0];
    expect(url).not.toContain('hourly=');
    expect(src.getHourlyValues()).toEqual([]);
  });

  it('populates values via ensureFresh and reports via listener', async () => {
    const fetchSpy = makeFetchOk(sampleResponse);
    const listener = vi.fn();
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    src.setListener(listener);
    await src.ensureFresh();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(src.getDailyValues()).toHaveLength(3);
    expect(listener).toHaveBeenCalledWith({ ok: true });
  });

  it('does not refire when a fetch is already in flight (de-dup)', async () => {
    let resolveFetch;
    const fetchSpy = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    const p1 = src.ensureFresh();
    const p2 = src.ensureFresh();
    // Both calls hit the same in-flight pipeline — fetch only fires once.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true, status: 200, json: async () => sampleResponse });
    await Promise.all([p1, p2]);
  });

  it('skips refresh when cache is fresh (within TTL)', async () => {
    const fetchSpy = makeFetchOk(sampleResponse);
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    await src.ensureFresh();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Time has not advanced — should be a no-op.
    await src.ensureFresh();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes again once TTL has elapsed (1h)', async () => {
    const fetchSpy = makeFetchOk(sampleResponse);
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    await src.ensureFresh();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    nowMs += 60 * 60 * 1000 + 1; // tick past 1h
    await src.ensureFresh();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('persists to storage and rehydrates on a fresh instance', async () => {
    const storage = makeStorage();
    const fetchSpy = makeFetchOk(sampleResponse);
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy, storage, now,
    });
    await src.ensureFresh();
    // Second instance — should pick up the stored cache without fetching.
    const fetchSpy2 = makeFetchOk(sampleResponse);
    const src2 = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy2, storage, now,
    });
    expect(src2.getDailyValues()).toHaveLength(3);
    expect(src2.isStale()).toBe(false);
    await src2.ensureFresh();
    expect(fetchSpy2).not.toHaveBeenCalled();
  });

  it('persists hourly values too and rehydrates them', async () => {
    const storage = makeStorage();
    const fetchSpy = makeFetchOk({
      ...sampleResponse,
      hourly: {
        time: ['2026-05-05T12:00', '2026-05-05T13:00'],
        sunshine_duration: [3600, 1800],
      },
    });
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon, includeHourly: true,
      fetchImpl: fetchSpy, storage, now,
    });
    await src.ensureFresh();
    const src2 = new OpenMeteoSource({
      latitude: lat, longitude: lon, includeHourly: true,
      fetchImpl: vi.fn(), storage, now,
    });
    expect(src2.getDailyValues()).toHaveLength(3);
    expect(src2.getHourlyValues()).toHaveLength(2);
    expect(src2.isStale()).toBe(false);
  });

  it('considers cache stale when hourly is requested but not in cache', async () => {
    const storage = makeStorage();
    // Warm the cache without hourly first.
    const dailyOnly = new OpenMeteoSource({
      latitude: lat, longitude: lon, includeHourly: false,
      fetchImpl: makeFetchOk(sampleResponse), storage, now,
    });
    await dailyOnly.ensureFresh();
    // New instance now requests hourly — the daily-only cache is
    // insufficient, must re-fetch.
    const fetchSpy = makeFetchOk({
      ...sampleResponse,
      hourly: {
        time: ['2026-05-05T12:00'],
        sunshine_duration: [3600],
      },
    });
    const withHourly = new OpenMeteoSource({
      latitude: lat, longitude: lon, includeHourly: true,
      fetchImpl: fetchSpy, storage, now,
    });
    expect(withHourly.isStale()).toBe(true);
    await withHourly.ensureFresh();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(withHourly.getHourlyValues()).toHaveLength(1);
  });

  it('keeps the previous cache and notifies listener on HTTP failure', async () => {
    const storage = makeStorage();
    // First call: warm the cache.
    const ok = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: makeFetchOk(sampleResponse), storage, now,
    });
    await ok.ensureFresh();
    // Second source with a different fetch that fails — should not
    // wipe the on-disk cache, and should notify the listener.
    nowMs += 60 * 60 * 1000 + 1;
    const fetchSpy = makeFetchFail(503);
    const fail = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy, storage, now,
    });
    const listener = vi.fn();
    fail.setListener(listener);
    await fail.ensureFresh();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    // Old values still readable.
    expect(fail.getDailyValues()).toHaveLength(3);
  });

  it('skips fetch when latitude / longitude are non-finite', async () => {
    const fetchSpy = makeFetchOk(sampleResponse);
    const src = new OpenMeteoSource({
      latitude: NaN, longitude: undefined,
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    await src.ensureFresh();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('abort() cancels the in-flight fetch and the listener does NOT see ok:false', async () => {
    let receivedSignal = null;
    const fetchSpy = vi.fn((url, opts) => {
      receivedSignal = opts && opts.signal;
      return new Promise((_, reject) => {
        if (receivedSignal) {
          receivedSignal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    });
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: fetchSpy, storage: makeStorage(), now,
    });
    const listener = vi.fn();
    src.setListener(listener);
    const p = src.ensureFresh();
    src.abort();
    await p;
    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a getItem that throws (corrupted-storage path, #56 coverage)', () => {
    // Storage that always throws on read — covers the loadFromStorage
    // catch branch.
    const throwingStorage = {
      getItem: () => { throw new Error('storage corrupted'); },
      setItem: () => {},
    };
    expect(() => new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: vi.fn(() => Promise.reject(new Error('no fetch'))),
      storage: throwingStorage, now,
    })).not.toThrow();
  });

  it('survives a setItem that throws (quota / private-mode path, #56 coverage)', async () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); },
    };
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      daily: { time: ['2026-05-21'], sunshine_duration: [50000] },
    })));
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon, fetchImpl: fetchSpy, storage: throwingStorage, now,
    });
    src.setListener(vi.fn());
    await expect(src.ensureFresh()).resolves.not.toThrow();
  });

  it('abort() is safe when AbortController.abort() throws (older-polyfill path, #56 coverage)', () => {
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: vi.fn(() => new Promise(() => {})), // never-resolving
      storage: makeStorage(), now,
    });
    src.setListener(vi.fn());
    void src.ensureFresh();
    // Stub the in-flight controller so its abort() throws.
    src._abort = { abort: () => { throw new Error('double abort'); } };
    expect(() => src.abort()).not.toThrow();
  });
});

describe('readCachedAvailability', () => {
  const lat = 46.91;
  const lon = 7.42;
  // Pin a Today so the past/forecast split is deterministic.
  const today = new Date(2026, 4, 5, 12, 0, 0); // 2026-05-05 noon
  const todayMidnightMs = (() => {
    const d = new Date(today); d.setHours(0, 0, 0, 0); return d.getTime();
  })();

  it('returns null when nothing is cached for that location', () => {
    expect(readCachedAvailability(lat, lon, makeStorage())).toBe(null);
  });

  it('returns null on non-finite coordinates or no storage', () => {
    expect(readCachedAvailability(NaN, lon, makeStorage())).toBe(null);
    expect(readCachedAvailability(lat, lon, null)).toBe(null);
  });

  it('counts past + forecast days from a cached daily array', () => {
    const storage = makeStorage({
      [`wsc_sunshine_${lat.toFixed(2)}_${lon.toFixed(2)}`]: JSON.stringify({
        daily: [
          { date: '2026-05-03', value: 28800 }, // -2 (past)
          { date: '2026-05-04', value: 30000 }, // -1 (past)
          { date: '2026-05-05', value: 32000 }, // today (forecast bucket)
          { date: '2026-05-06', value: 25000 }, // +1 (forecast)
          { date: '2026-05-07', value: 18000 }, // +2 (forecast)
        ],
        hourly: [],
        lastFetchMs: todayMidnightMs,
      }),
    });
    const result = readCachedAvailability(lat, lon, storage, today.getTime());
    expect(result.pastDays).toBe(2);
    expect(result.forecastDays).toBe(3);
    expect(result.lastFetchMs).toBe(todayMidnightMs);
  });

  it('handles a daily array with malformed / undated entries', () => {
    const storage = makeStorage({
      [`wsc_sunshine_${lat.toFixed(2)}_${lon.toFixed(2)}`]: JSON.stringify({
        daily: [
          null,
          { value: 100 }, // no date
          { date: 'not-a-date', value: 200 },
          { date: '2026-05-06', value: 25000 },
        ],
        lastFetchMs: 0,
      }),
    });
    const result = readCachedAvailability(lat, lon, storage, today.getTime());
    expect(result.pastDays).toBe(0);
    expect(result.forecastDays).toBe(1);
  });

  it('returns zeros for an empty cached payload (post-failure fallback)', () => {
    const storage = makeStorage({
      [`wsc_sunshine_${lat.toFixed(2)}_${lon.toFixed(2)}`]: JSON.stringify({
        daily: [],
        hourly: [],
        lastFetchMs: 0,
      }),
    });
    const result = readCachedAvailability(lat, lon, storage, today.getTime());
    expect(result.pastDays).toBe(0);
    expect(result.forecastDays).toBe(0);
  });
});

// ── ensureFresh error / no-op paths (v1.10.1 coverage uplift) ─────────

describe('OpenMeteoSource.ensureFresh edge cases', () => {
  const lat = 46.91;
  const lon = 7.42;
  const future = Date.now() + 1000 * 60 * 60 * 24 * 365; // far future

  function makeStorage(initial = {}) {
    const store = { ...initial };
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    };
  }

  it('returns early when no fetch implementation is available', async () => {
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl: null, // explicit no-fetch
      storage: makeStorage(),
      now: () => 0,
    });
    // staleness check forces the path to ensureFresh's early-return for !_fetch
    const result = await src.ensureFresh();
    expect(result).toBeUndefined();
  });

  it('returns early when latitude / longitude are non-finite', async () => {
    const fetchImpl = vi.fn();
    const src = new OpenMeteoSource({
      latitude: NaN, longitude: lon,
      fetchImpl,
      storage: makeStorage(),
      now: () => 0,
    });
    await src.ensureFresh();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('notifies the listener with ok:false when fetch returns a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
    });
    const listener = vi.fn();
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl,
      storage: makeStorage(),
      now: () => 0,
    });
    src.setListener(listener);
    // Silence the expected console.warn from the failure path.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await src.ensureFresh();
    warnSpy.mockRestore();
    expect(fetchImpl).toHaveBeenCalled();
    const calls = listener.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c?.ok === false)).toBe(true);
  });

  it('does NOT notify the listener when fetch is aborted (AbortError)', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn().mockRejectedValue(abortError);
    const listener = vi.fn();
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl,
      storage: makeStorage(),
      now: () => 0,
    });
    src.setListener(listener);
    listener.mockClear();
    await src.ensureFresh();
    const errorCalls = listener.mock.calls.filter((c) => c[0]?.ok === false);
    expect(errorCalls.length).toBe(0);
  });

  it('notifies the listener with ok:true on a successful fetch', async () => {
    const json = vi.fn().mockResolvedValue({
      daily: { time: ['2026-05-09'], sunshine_duration: [36000] },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json });
    const listener = vi.fn();
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl,
      storage: makeStorage(),
      now: () => 1_000_000,
    });
    src.setListener(listener);
    listener.mockClear();
    await src.ensureFresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ ok: true });
  });

  it('coalesces concurrent ensureFresh calls (one fetch for two waiters)', async () => {
    let resolveFetch;
    const fetchImpl = vi.fn().mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const src = new OpenMeteoSource({
      latitude: lat, longitude: lon,
      fetchImpl,
      storage: makeStorage(),
      now: () => 0,
    });
    const p1 = src.ensureFresh();
    const p2 = src.ensureFresh();
    resolveFetch({ ok: true, json: () => Promise.resolve({ daily: { time: [], sunshine_duration: [] } }) });
    await Promise.all([p1, p2]);
    // Both calls collapsed into a single fetch.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
