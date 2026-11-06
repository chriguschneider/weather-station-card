import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeasuredDataSource } from '../src/data-source.js';
import { clearDedupeCaches } from '../src/utils/shared-requests.js';
import { Calendar } from '../src/utils/time-zone.js';

beforeEach(() => clearDedupeCaches());

describe('lux day cache: hit, miss, zone change, expiry', () => {
  const sensors = { illuminance: 'sensor.lux' };
  const NOW = new Date('2026-10-26T15:00:00Z');
  let storage;
  let hass;
  let removed;

  const mkCal = (zone) => new Calendar(zone);
  const windowFor = (c, days) => {
    const end = c.addDays(c.startOfDay(Date.now()), 1);
    return { start: c.addDays(end, -(days + 1)), end };
  };
  const keyFor = (zone) => `wsc_lux_days_${zone}_sensor.lux`;
  const run = async (c, days = 2, cfg = {}) => {
    clearDedupeCaches();
    const { start, end } = windowFor(c, days);
    const ds = new MeasuredDataSource(hass, { sensors, ...cfg }, c);
    const out = await ds._fetchLuxSunshine(sensors, start, end);
    return { out, start };
  };
  const seed = (zone, over = {}) => {
    const c = mkCal(zone);
    const { start } = windowFor(c, 2);
    const days = {};
    for (let d = c.startOfDay(start); d < c.startOfDay(Date.now()); d = c.addDays(d, 1)) days[c.dayKey(d)] = 5;
    storage.set(keyFor(zone), JSON.stringify({ v: 2, threshold: 0.6, lat: 47, lon: 8, scale: 1, days, ...over }));
    return days;
  };
  const expectFullRefetch = async () => {
    const { start } = await run(mkCal('Europe/Zurich'));
    expect(hass.callWS.mock.calls[0][0].start_time).toBe(start.toISOString());
  };

  beforeEach(() => {
    storage = new Map();
    removed = [];
    globalThis.window = {
      localStorage: {
        getItem: (k) => storage.get(k) ?? null,
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => { removed.push(k); storage.delete(k); },
      },
    };
    vi.useFakeTimers({ now: NOW });
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    hass = {
      config: { latitude: 47, longitude: 8 },
      callWS: vi.fn(async () => ({
        'sensor.lux': [
          { s: '1000', lu: (Date.now() - 2 * 3600_000) / 1000 },
          { s: '1000', lu: (Date.now() - 3600_000) / 1000 },
        ],
      })),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.window;
  });

  it('miss: an empty cache fetches the full window and writes it', async () => {
    const { start } = await run(mkCal('Europe/Zurich'));
    expect(hass.callWS.mock.calls[0][0].start_time).toBe(start.toISOString());
    expect(JSON.parse(storage.get(keyFor('Europe/Zurich'))).days).toBeTypeOf('object');
    // The legacy entity-only slot is dropped on every write.
    expect(removed).toContain('wsc_lux_days_sensor.lux');
  });

  it('hit: a complete cache fetches only today and returns the cached hours', async () => {
    const days = seed('Europe/Zurich');
    const { out } = await run(mkCal('Europe/Zurich'));
    expect(hass.callWS.mock.calls[0][0].start_time).toBe(mkCal('Europe/Zurich').startOfDay(Date.now()).toISOString());
    for (const k of Object.keys(days)) expect(out.get(k)).toBe(5);
  });

  it('hit: a failed fetch still serves the cached completed days', async () => {
    const days = seed('Europe/Zurich');
    hass.callWS.mockRejectedValue(new Error('recorder offline'));
    const { out } = await run(mkCal('Europe/Zurich'));
    expect([...out.keys()].sort()).toEqual(Object.keys(days).sort());
  });

  it('hit: too few samples still serve the cached days', async () => {
    seed('Europe/Zurich');
    hass.callWS.mockResolvedValue({ 'sensor.lux': [] });
    const { out } = await run(mkCal('Europe/Zurich'));
    expect(out.size).toBe(2);
  });

  it('miss: a failed fetch with a cache holding none of the needed days gives null', async () => {
    seed('Europe/Zurich', { days: { '2020-01-01': 3 } });
    hass.callWS.mockRejectedValue(new Error('offline'));
    const { out } = await run(mkCal('Europe/Zurich'));
    expect(out).toBeNull();
  });

  it('partial hit: a gap in the cache refetches the full window', async () => {
    const days = seed('Europe/Zurich');
    delete days[Object.keys(days).sort()[0]];
    seed('Europe/Zurich', { days });
    await expectFullRefetch();
  });

  it('zone change: another zone neither reads nor overwrites the first zone slot', async () => {
    seed('Europe/Zurich');
    const before = storage.get(keyFor('Europe/Zurich'));
    const { start } = await run(mkCal('America/New_York'));
    expect(hass.callWS.mock.calls[0][0].start_time).toBe(start.toISOString());
    expect(storage.get(keyFor('Europe/Zurich'))).toBe(before);
    expect(storage.has(keyFor('America/New_York'))).toBe(true);
  });

  it('expiry: a v1 payload is discarded', async () => {
    seed('Europe/Zurich', { v: 1 });
    await expectFullRefetch();
  });

  it('expiry: a changed threshold is discarded', async () => {
    seed('Europe/Zurich');
    const { start } = await run(mkCal('Europe/Zurich'), 2, { condition_mapping: { sunshine_lux_ratio: 0.4 } });
    expect(hass.callWS.mock.calls[0][0].start_time).toBe(start.toISOString());
  });

  it('expiry: a changed irradiance scale (unit change) is discarded', async () => {
    seed('Europe/Zurich', { scale: 120 });
    await expectFullRefetch();
  });

  it('expiry: a payload without scale counts as scale 1 and stays valid', async () => {
    const days = seed('Europe/Zurich');
    seed('Europe/Zurich', { scale: undefined, days });
    await run(mkCal('Europe/Zurich'));
    expect(hass.callWS.mock.calls[0][0].start_time).toBe(mkCal('Europe/Zurich').startOfDay(Date.now()).toISOString());
  });

  it('expiry: a moved location (lat or lon) is discarded', async () => {
    seed('Europe/Zurich', { lat: 48 });
    await expectFullRefetch();
    hass.callWS.mockClear();
    seed('Europe/Zurich', { lon: 9 });
    await expectFullRefetch();
  });

  it('expiry: corrupt JSON, a null payload and a missing days map are discarded', async () => {
    storage.set(keyFor('Europe/Zurich'), '{not json');
    await expectFullRefetch();
    hass.callWS.mockClear();
    storage.set(keyFor('Europe/Zurich'), 'null');
    await expectFullRefetch();
    hass.callWS.mockClear();
    seed('Europe/Zurich', { days: 'x' });
    await expectFullRefetch();
  });

  it('prunes the cache to the newest 120 days', async () => {
    const c = mkCal('Europe/Zurich');
    const { out } = await run(c, 130);
    expect(out).not.toBeNull();
    const keys = Object.keys(JSON.parse(storage.get(keyFor('Europe/Zurich'))).days).sort();
    expect(keys).toHaveLength(120);
    expect(keys[keys.length - 1]).toBe(c.dayKey(c.addDays(c.startOfDay(Date.now()), -1)));
  });

  it('survives a storage whose setItem throws', async () => {
    globalThis.window.localStorage.setItem = () => { throw new Error('quota'); };
    const { out } = await run(mkCal('Europe/Zurich'));
    expect(out).toBeInstanceOf(Map);
  });

  it('works without any storage', async () => {
    delete globalThis.window;
    const { out } = await run(mkCal('Europe/Zurich'));
    expect(out).toBeInstanceOf(Map);
  });

  it('works when reading window.localStorage throws', async () => {
    globalThis.window = { get localStorage() { throw new Error('denied'); } };
    const { out } = await run(mkCal('Europe/Zurich'));
    expect(out).toBeInstanceOf(Map);
  });
});

describe('MeasuredDataSource.notifyVisible', () => {
  const sensors = { temperature: 'sensor.temp' };
  const cal = new Calendar();
  let callWS;
  let ds;

  beforeEach(() => {
    vi.useFakeTimers();
    callWS = vi.fn().mockResolvedValue({});
    ds = new MeasuredDataSource({ config: { latitude: 47.4 }, callWS }, { sensors, days: 3 }, cal);
  });
  afterEach(() => {
    ds.unsubscribe();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does nothing when no poll was skipped', async () => {
    ds.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    callWS.mockClear();
    ds.notifyVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(callWS).not.toHaveBeenCalled();
  });

  it('skips interval polls while hidden and runs one deferred poll when visible again', async () => {
    vi.stubGlobal('document', { hidden: true });
    ds.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(callWS).toHaveBeenCalledTimes(1); // the initial poll always runs
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(callWS).toHaveBeenCalledTimes(1);

    vi.stubGlobal('document', { hidden: false });
    ds.notifyVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(callWS).toHaveBeenCalledTimes(2);

    // The deferred flag is consumed: repeated calls poll nothing more.
    ds.notifyVisible();
    ds.notifyVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(callWS).toHaveBeenCalledTimes(2);
  });

  it('a poll without hass is a no-op', async () => {
    ds.setHass(null);
    ds.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(callWS).not.toHaveBeenCalled();
  });
});
