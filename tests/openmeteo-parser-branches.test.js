import { describe, it, expect, vi } from 'vitest';
import { Calendar } from '../src/utils/time-zone.js';
import {
  parseDailySunshine,
  parseHourlySunshine,
  parseDailyProbability,
  parseHourlyProbability,
  buildDailyForecast,
  buildHourlyForecast,
  OpenMeteoSource,
  readCachedAvailability,
} from '../src/openmeteo-source.js';

const cal = new Calendar('Europe/Zurich');
const T = Date.parse('2026-05-09T10:00:00Z') / 1000;
const MIDNIGHT_ZRH = Date.parse('2026-05-08T22:00:00Z') / 1000;

describe('daily parsers: missing arrays, null cells, mismatched lengths', () => {
  it('a daily section without value arrays yields no entries', () => {
    const r = { daily: { time: [MIDNIGHT_ZRH] } };
    expect(parseDailySunshine(r, cal)).toEqual([]);
    expect(parseDailyProbability(r, cal)).toEqual([]);
  });

  it('a daily section without a time array yields no entries', () => {
    const r = { daily: { sunshine_duration: [1], precipitation_probability_max: [5] } };
    expect(parseDailySunshine(r, cal)).toEqual([]);
    expect(parseDailyProbability(r, cal)).toEqual([]);
  });

  it('values shorter than time keep only the paired rows; null cells drop', () => {
    const r = {
      daily: {
        time: [MIDNIGHT_ZRH, MIDNIGHT_ZRH + 86400, MIDNIGHT_ZRH + 2 * 86400],
        sunshine_duration: [3600, null],
        precipitation_probability_max: [10, null],
      },
    };
    expect(parseDailySunshine(r, cal)).toEqual([{ date: '2026-05-09', value: 3600 }]);
    expect(parseDailyProbability(r, cal)).toEqual([{ date: '2026-05-09', value: 10 }]);
  });

  it('civil-string times pass through; junk times are dropped', () => {
    const r = {
      daily: {
        time: ['2026-05-09', 'garbage', NaN, undefined],
        sunshine_duration: [1, 2, 3, 4],
        precipitation_probability_max: [1, 2, 3, 4],
      },
    };
    expect(parseDailySunshine(r, cal)).toEqual([{ date: '2026-05-09', value: 1 }]);
    expect(parseDailyProbability(r, cal)).toEqual([{ date: '2026-05-09', value: 1 }]);
  });

  it('an unknown response timezone falls back to the card calendar', () => {
    const r = { timezone: 'Not/AZone', daily: { time: [MIDNIGHT_ZRH], sunshine_duration: [1] } };
    expect(parseDailySunshine(r, cal)).toEqual([{ date: '2026-05-09', value: 1 }]);
  });

  it('a response in another zone is read in that zone, not the card zone', () => {
    // Denver midnight of the 9th is 06:00Z; read in Zurich it would be the 9th too,
    // so the day key alone cannot tell the zones apart — the noon rule keeps it stable.
    const r = {
      timezone: 'America/Denver',
      daily: { time: [Date.parse('2026-05-09T06:00:00Z') / 1000], sunshine_duration: [1] },
    };
    expect(parseDailySunshine(r, cal)).toEqual([{ date: '2026-05-09', value: 1 }]);
  });
});

describe('hourly parsers: missing arrays, null cells, bad times', () => {
  it('missing time or value arrays yield no entries', () => {
    expect(parseHourlySunshine({ hourly: { time: [T] } }, cal)).toEqual([]);
    expect(parseHourlySunshine({ hourly: { sunshine_duration: [1] } }, cal)).toEqual([]);
    expect(parseHourlyProbability({ hourly: { time: [T] } }, cal)).toEqual([]);
    expect(parseHourlyProbability({ hourly: { precipitation_probability: [1] } }, cal)).toEqual([]);
  });

  it('non-numeric times are skipped and short value arrays stop early', () => {
    const r = {
      hourly: {
        time: ['2026-05-09T10:00', NaN, T, T + 3600],
        sunshine_duration: [1, 2, 3],
        precipitation_probability: [1, 2, 3],
      },
    };
    expect(parseHourlySunshine(r, cal)).toEqual([{ datetime: '2026-05-09T12:00', value: 3 }]);
    expect(parseHourlyProbability(r, cal)).toEqual([{ datetime: '2026-05-09T12:00', value: 3 }]);
  });
});

describe('forecast builders: missing arrays and null cells', () => {
  it('daily: no arrays at all gives entries with null fields', () => {
    const out = buildDailyForecast({ daily: { time: [MIDNIGHT_ZRH] } }, cal);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ temperature: null, templow: null, precipitation: null, wind_speed: null });
  });

  it('daily: a daily section without time yields []', () => {
    expect(buildDailyForecast({ daily: { temperature_2m_max: [1] } }, cal)).toEqual([]);
  });

  it('daily: unparseable times are skipped', () => {
    const out = buildDailyForecast({ daily: { time: ['garbage', MIDNIGHT_ZRH], temperature_2m_max: [1, 2] } }, cal);
    expect(out.map((e) => e.temperature)).toEqual([2]);
  });

  it('hourly: no arrays at all gives entries with null fields', () => {
    const out = buildHourlyForecast({ hourly: { time: [T] } }, cal);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ temperature: null, precipitation: null, wind_speed: null });
  });

  it('hourly: a section without time yields [] and bad times are skipped', () => {
    expect(buildHourlyForecast({ hourly: { temperature_2m: [1] } }, cal)).toEqual([]);
    const out = buildHourlyForecast({ hourly: { time: ['x', T], temperature_2m: [1, 2] } }, cal);
    expect(out.map((e) => e.temperature)).toEqual([2]);
  });
});

describe('cache reads and source options', () => {
  const body = { daily: { time: [MIDNIGHT_ZRH], sunshine_duration: [3600] } };

  it('a non-object cache payload is ignored', () => {
    const storage = { getItem: () => '42', setItem: () => {} };
    expect(readCachedAvailability(46.9, 7.4, cal, storage)).toBeNull();
    const src = new OpenMeteoSource({ calendar: cal, latitude: 46.9, longitude: 7.4, fetchImpl: vi.fn(), storage });
    expect(src.getDailyValues()).toEqual([]);
  });

  it('a null storage means no availability', () => {
    expect(readCachedAvailability(46.9, 7.4, cal, null)).toBeNull();
  });

  it('a cache without a daily array or fetch time reports zeros', () => {
    const storage = { getItem: () => JSON.stringify({ lastFetchMs: 'x' }), setItem: () => {} };
    expect(readCachedAvailability(46.9, 7.4, cal, storage)).toEqual({ pastDays: 0, forecastDays: 0, lastFetchMs: 0 });
  });

  it('a non-array cached section is ignored on construction', () => {
    const storage = {
      getItem: () => JSON.stringify({ daily: 'x', hourly: 1, dailyForecast: {}, hourlyForecast: null, lastFetchMs: 1 }),
      setItem: () => {},
    };
    const src = new OpenMeteoSource({ calendar: cal, latitude: 46.9, longitude: 7.4, fetchImpl: vi.fn(), storage });
    expect(src.getDailyValues()).toEqual([]);
    expect(src.getHourlyValues()).toEqual([]);
    expect(src.getDailyStationForecast()).toEqual([]);
  });

  it('an HTTP error without a response object reports a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(undefined);
    const listener = vi.fn();
    const src = new OpenMeteoSource({ calendar: cal, latitude: 46.9, longitude: 7.4, fetchImpl, storage: null });
    src.setListener(listener);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await src.ensureFresh();
    warn.mockRestore();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('an error answer without a reason still fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: true }) });
    const listener = vi.fn();
    const src = new OpenMeteoSource({ calendar: cal, latitude: 46.9, longitude: 7.4, fetchImpl, storage: null });
    src.setListener(listener);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await src.ensureFresh();
    warn.mockRestore();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('works without AbortController or AbortSignal.timeout', async () => {
    vi.stubGlobal('AbortController', undefined);
    vi.stubGlobal('AbortSignal', undefined);
    try {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
      const src = new OpenMeteoSource({ calendar: cal, latitude: 46.9, longitude: 7.4, fetchImpl, storage: null });
      await src.ensureFresh();
      expect(fetchImpl.mock.calls[0][1]).toBeUndefined();
      expect(src.getDailyValues()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a null fetchImpl never fetches', async () => {
    const src = new OpenMeteoSource({ calendar: cal, latitude: 46.9, longitude: 7.4, fetchImpl: null, storage: null });
    await expect(src.ensureFresh()).resolves.toBeUndefined();
    expect(src.getDailyValues()).toEqual([]);
  });
});
