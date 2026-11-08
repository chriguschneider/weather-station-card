// Issue #439: blocked localStorage, half-hour zone hour keys, window-aware
// Open-Meteo cache, shared-fetch abort and request timeouts.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Calendar } from '../src/utils/time-zone.js';
import { safeLocalStorage } from '../src/utils/safe-storage.js';
import { withTimeout, abandonOnAbort } from '../src/utils/fetch-signal.js';
import { clearDedupeCaches } from '../src/utils/shared-requests.js';
import { loadBuffer, saveBuffer } from '../src/precip-rate.js';
import { loadSeriesCache, saveSeriesCache } from '../src/utils/series-cache.js';
import {
  OpenMeteoSource,
  readCachedAvailability,
  parseHourlySunshine,
  parseHourlyProbability,
  buildHourlyForecast,
} from '../src/openmeteo-source.js';

const LAT = 46.91;
const LON = 7.42;
const KEY = `wsc_sunshine_v3_${LAT.toFixed(2)}_${LON.toFixed(2)}_UTC`;
const utcCal = new Calendar('UTC');

function makeStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

const body = {
  timezone: 'UTC',
  daily: { time: [Date.parse('2026-05-20T00:00:00Z') / 1000], sunshine_duration: [3600], temperature_2m_max: [20] },
};
const okResponse = () => ({ ok: true, status: 200, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('blocked localStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('SecurityError'); } });
  });

  it('safeLocalStorage returns null instead of throwing', () => {
    expect(safeLocalStorage()).toBeNull();
  });

  it('OpenMeteoSource and readCachedAvailability fall back to no storage', () => {
    expect(() => new OpenMeteoSource({ calendar: utcCal, latitude: LAT, longitude: LON, fetchImpl: null })).not.toThrow();
    expect(readCachedAvailability(LAT, LON, utcCal)).toBeNull();
  });

  it('precip-rate buffer read / write do not throw', () => {
    expect(loadBuffer('sensor.rain')).toEqual([]);
    expect(() => saveBuffer('sensor.rain', [{ t: 1, v: 1 }])).not.toThrow();
  });

  it('series cache read / write do not throw', () => {
    expect(loadSeriesCache('k')).toBeNull();
    expect(() => saveSeriesCache('k', [])).not.toThrow();
  });
});

describe('cached payload shape validation', () => {
  it('drops malformed entries and fields', () => {
    const storage = makeStorage({
      [KEY]: JSON.stringify({
        daily: [{ date: '2026-05-20', value: 3600 }, { date: 5, value: 1 }, 'x', { date: '2026-05-21', value: 'oops' }],
        hourly: 'not an array',
        dailyForecast: [{ datetime: '2026-05-20T00:00:00.000Z' }, { temperature: 1 }],
        probabilityFetched: 'yes',
        lastFetchMs: 'yesterday',
      }),
    });
    const src = new OpenMeteoSource({ calendar: utcCal, latitude: LAT, longitude: LON, storage, fetchImpl: null });
    expect(src.getDailyValues()).toEqual([{ date: '2026-05-20', value: 3600 }]);
    expect(src.getHourlyValues()).toEqual([]);
    expect(src.getDailyStationForecast()).toHaveLength(1);
    expect(src.isStale(0)).toBe(true);
  });

  it('a non-object payload is a miss', () => {
    const storage = makeStorage({ [KEY]: JSON.stringify([1, 2, 3]) });
    expect(readCachedAvailability(LAT, LON, utcCal, storage)).toBeNull();
  });
});

describe('hour keys in half-hour and quarter-hour zones', () => {
  // Open-Meteo with timezone=auto returns hourly instants on the
  // location's full local hours, i.e. on :30 / :45 UTC in these zones.
  const cases = [
    { tz: 'Asia/Kolkata', instant: '2026-05-20T04:30:00Z', key: '2026-05-20T10:00' },
    { tz: 'Asia/Kathmandu', instant: '2026-05-20T04:15:00Z', key: '2026-05-20T10:00' },
    { tz: 'Australia/Adelaide', instant: '2026-05-20T00:30:00Z', key: '2026-05-20T10:00' },
    { tz: 'America/St_Johns', instant: '2026-05-20T12:30:00Z', key: '2026-05-20T10:00' },
  ];
  for (const { tz, instant, key } of cases) {
    it(`${tz}: local ${key} keys to its own hour`, () => {
      const cal = new Calendar(tz);
      const t = Date.parse(instant) / 1000;
      const response = { hourly: { time: [t], sunshine_duration: [1800], precipitation_probability: [40], temperature_2m: [12] } };
      expect(parseHourlySunshine(response, cal)).toEqual([{ datetime: key, value: 1800 }]);
      expect(parseHourlyProbability(response, cal)).toEqual([{ datetime: key, value: 40 }]);
      const [entry] = buildHourlyForecast(response, cal);
      // Same instant MeasuredDataSource buckets the hour under.
      expect(entry.datetime).toBe(cal.startOfHour(Date.parse(instant)).toISOString());
      expect(entry.datetime).toBe(new Date(instant).toISOString());
      expect(cal.hourKey(Date.parse(entry.datetime))).toBe(key);
    });
  }
});

describe('window-aware cache', () => {
  const NOW = Date.parse('2026-05-20T12:00:00Z');
  const fullPayload = (extra) => JSON.stringify({
    daily: [{ date: '2026-05-20', value: 3600 }],
    dailyForecast: [{ datetime: '2026-05-20T00:00:00.000Z' }],
    probabilityFetched: true,
    lastFetchMs: NOW - 60_000,
    ...extra,
  });
  const make = (storage, pastDays, forecastDays) => new OpenMeteoSource({
    calendar: utcCal, latitude: LAT, longitude: LON, storage, fetchImpl: null, pastDays, forecastDays, now: () => NOW,
  });

  it('a fresh cache that covers the window is not stale', () => {
    const storage = makeStorage({ [KEY]: fullPayload({ pastDays: 30, forecastDays: 8 }) });
    expect(make(storage, 7, 7).isStale()).toBe(false);
  });

  it('a fresh cache for a shorter window is stale', () => {
    const storage = makeStorage({ [KEY]: fullPayload({ pastDays: 7, forecastDays: 8 }) });
    expect(make(storage, 30, 8).isStale()).toBe(true);
    expect(make(storage, 7, 14).isStale()).toBe(true);
  });

  it('a cache without a recorded window is stale once', () => {
    const storage = makeStorage({ [KEY]: fullPayload({}) });
    expect(make(storage, 7, 7).isStale()).toBe(true);
  });

  it('a fetch records its window in the cache', async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const src = new OpenMeteoSource({ calendar: utcCal, latitude: LAT, longitude: LON, storage, fetchImpl, pastDays: 30, forecastDays: 10, now: () => NOW });
    await src.ensureFresh();
    expect(JSON.parse(storage._data[KEY])).toMatchObject({ pastDays: 30, forecastDays: 10 });
    expect(src.isStale()).toBe(false);
  });
});

describe('shared fetch survives one card going away', () => {
  beforeEach(() => clearDedupeCaches());

  it('aborting the first card does not abort the second card\'s data', async () => {
    let resolveFetch;
    const fetchMock = vi.fn((_url, init) => new Promise((resolve, reject) => {
      resolveFetch = resolve;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const a = new OpenMeteoSource({ calendar: utcCal, latitude: LAT, longitude: LON, storage: null });
    const b = new OpenMeteoSource({ calendar: utcCal, latitude: LAT, longitude: LON, storage: null });
    const listenerA = vi.fn();
    a.setListener(listenerA);
    const pa = a.ensureFresh();
    const pb = b.ensureFresh();
    a.abort();
    resolveFetch(okResponse());
    await Promise.all([pa, pb]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    expect(b.getDailyValues()).toHaveLength(1);
    // The torn-down card neither applies the data nor reports a failure.
    expect(a.getDailyValues()).toEqual([]);
    expect(listenerA).not.toHaveBeenCalled();
  });
});

describe('request timeout', () => {
  it('withTimeout aborts with TimeoutError after the limit', async () => {
    const s = withTimeout(undefined, 10);
    await new Promise((r) => setTimeout(r, 40));
    expect(s.aborted).toBe(true);
    expect(s.reason.name).toBe('TimeoutError');
  });

  it('withTimeout follows the caller\'s signal', () => {
    const c = new AbortController();
    const s = withTimeout(c.signal, 60_000);
    expect(s.aborted).toBe(false);
    c.abort();
    expect(s.aborted).toBe(true);
  });

  it('withTimeout falls back when AbortSignal helpers are missing', () => {
    const c = new AbortController();
    vi.stubGlobal('AbortSignal', undefined);
    expect(withTimeout(undefined)).toBeUndefined();
    expect(withTimeout(c.signal)).toBe(c.signal);
  });

  it('a timed-out Open-Meteo fetch reports a failure', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new OpenMeteoSource({ calendar: utcCal, latitude: LAT, longitude: LON, storage: null, fetchImpl });
    const listener = vi.fn();
    src.setListener(listener);
    await src.ensureFresh();
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

});

describe('abandonOnAbort', () => {
  it('rejects at once for an already-aborted signal and passes results through otherwise', async () => {
    const c = new AbortController();
    c.abort();
    await expect(abandonOnAbort(Promise.resolve(1), c.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(abandonOnAbort(Promise.resolve(2), new AbortController().signal)).resolves.toBe(2);
    await expect(abandonOnAbort(Promise.reject(new Error('x')), new AbortController().signal)).rejects.toThrow('x');
    await expect(abandonOnAbort(Promise.resolve(3), undefined)).resolves.toBe(3);
  });
});
