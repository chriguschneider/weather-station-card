import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchPressure3hDelta } from '../src/data-source.js';
import { clearDedupeCaches } from '../src/utils/shared-requests.js';

// Build a hass-like mock with stubbable callWS + an entity-state map for
// unit-of-measurement lookup. Each test constructs the recorder fixture
// it wants by stubbing callWS.resolvedValueOnce.
function mockHass({ stateUnit = 'hPa', stats } = {}) {
  return {
    states: {
      'sensor.pressure': {
        state: '1015',
        attributes: { unit_of_measurement: stateUnit },
      },
    },
    callWS: vi.fn().mockResolvedValue(stats ?? {}),
  };
}

// Recorder buckets are labelled by their `start` ISO. Construct a 4-hour
// strip ending at `endMs` (exclusive); the newest finalized bucket
// starts at endMs - 1h, the oldest at endMs - 4h.
function strip(endMs, means) {
  const HOUR = 3600_000;
  return means.map((mean, i) => ({
    start: new Date(endMs - (4 - i) * HOUR).toISOString(),
    mean,
  }));
}

describe('fetchPressure3hDelta', () => {
  let now;
  beforeEach(() => {
    // Pin current time to a known hour so the function's window
    // computation is deterministic. Use a non-DST date to avoid hourly
    // boundary surprises on systems still on regional DST handling.
    now = new Date('2026-05-12T14:23:45Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    // The WS call is deduplicated module-wide (cross-card sharing in
    // production) — reset between tests so each case gets its own
    // roundtrip against its own mock.
    clearDedupeCaches();
  });

  it('returns null when hass is missing', async () => {
    expect(await fetchPressure3hDelta(null, 'sensor.pressure')).toBe(null);
  });

  it('returns null when entityId is missing', async () => {
    const hass = mockHass();
    expect(await fetchPressure3hDelta(hass, undefined)).toBe(null);
    expect(hass.callWS).not.toHaveBeenCalled();
  });

  it('computes newest - 3h-earlier delta in hPa (happy path)', async () => {
    // Newest bucket starts at 14:00 (mean 1018), 3h earlier at 11:00
    // (mean 1015). Delta = 1018 - 1015 = +3 hPa.
    const endMs = new Date('2026-05-12T14:00:00Z').getTime();
    const hass = mockHass({
      stats: { 'sensor.pressure': strip(endMs, [1015, 1016, 1017, 1018]) },
    });
    const delta = await fetchPressure3hDelta(hass, 'sensor.pressure');
    expect(delta).toBeCloseTo(3, 5);
  });

  it('returns null when fewer than the two required buckets are present', async () => {
    const endMs = new Date('2026-05-12T14:00:00Z').getTime();
    // Only the newest bucket — the 3h-earlier bucket is missing.
    const hass = mockHass({
      stats: { 'sensor.pressure': [
        { start: new Date(endMs - 3600_000).toISOString(), mean: 1018 },
      ] },
    });
    expect(await fetchPressure3hDelta(hass, 'sensor.pressure')).toBe(null);
  });

  it('returns null when the 3h-earlier bucket has a null mean', async () => {
    const endMs = new Date('2026-05-12T14:00:00Z').getTime();
    const hass = mockHass({
      stats: { 'sensor.pressure': strip(endMs, [null, 1016, 1017, 1018]) },
    });
    expect(await fetchPressure3hDelta(hass, 'sensor.pressure')).toBe(null);
  });

  it('returns null on fetch error (graceful degrade)', async () => {
    const hass = mockHass();
    hass.callWS = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await fetchPressure3hDelta(hass, 'sensor.pressure')).toBe(null);
  });

  it('converts an inHg source delta into hPa', async () => {
    // Newest bucket 30.00 inHg, 3h earlier 29.91 inHg → raw delta 0.09 inHg.
    // 0.09 inHg × 33.8639 ≈ 3.048 hPa.
    const endMs = new Date('2026-05-12T14:00:00Z').getTime();
    const hass = mockHass({
      stateUnit: 'inHg',
      stats: { 'sensor.pressure': strip(endMs, [29.91, 29.94, 29.97, 30.0]) },
    });
    const delta = await fetchPressure3hDelta(hass, 'sensor.pressure');
    expect(delta).toBeCloseTo(0.09 * 33.8639, 3);
  });

  it('reuses the cached value within the same hour bucket', async () => {
    const endMs = new Date('2026-05-12T14:00:00Z').getTime();
    const hass = mockHass({
      stats: { 'sensor.pressure': strip(endMs, [1015, 1016, 1017, 1018]) },
    });
    const cache = { bucketMs: null, value: null };
    const first = await fetchPressure3hDelta(hass, 'sensor.pressure', cache);
    const second = await fetchPressure3hDelta(hass, 'sensor.pressure', cache);
    expect(first).toBeCloseTo(3, 5);
    expect(second).toBe(first);
    // The second call must hit the cache — one WS roundtrip total.
    expect(hass.callWS).toHaveBeenCalledTimes(1);
  });

  it('re-fetches when the bucket key advances to the next hour', async () => {
    const endMs1 = new Date('2026-05-12T14:00:00Z').getTime();
    const hass = mockHass({
      stats: { 'sensor.pressure': strip(endMs1, [1015, 1016, 1017, 1018]) },
    });
    const cache = { bucketMs: null, value: null };
    await fetchPressure3hDelta(hass, 'sensor.pressure', cache);
    expect(hass.callWS).toHaveBeenCalledTimes(1);

    // Advance one hour — cache bucket no longer matches.
    vi.setSystemTime(new Date('2026-05-12T15:23:45Z'));
    const endMs2 = new Date('2026-05-12T15:00:00Z').getTime();
    hass.callWS.mockResolvedValueOnce({
      'sensor.pressure': strip(endMs2, [1016, 1017, 1018, 1019]),
    });
    await fetchPressure3hDelta(hass, 'sensor.pressure', cache);
    expect(hass.callWS).toHaveBeenCalledTimes(2);
  });
});
