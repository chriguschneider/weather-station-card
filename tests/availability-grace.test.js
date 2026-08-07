// Unit tests for src/utils/availability-grace.ts — the grace-period
// bookkeeping behind the subtle unavailable-sensor handling (#213).

import { describe, it, expect } from 'vitest';
import {
  UNAVAILABLE_GRACE_MS,
  updateMissingSince,
  overdueMissing,
  nextExpiryDelay,
} from '../src/utils/availability-grace.js';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

describe('updateMissingSince', () => {
  it('stamps newly missing entities with now', () => {
    const next = updateMissingSince({}, ['sensor.a', 'sensor.b'], T0);
    expect(next).toEqual({ 'sensor.a': T0, 'sensor.b': T0 });
  });

  it('keeps the original stamp for persistently missing entities', () => {
    const first = updateMissingSince({}, ['sensor.a'], T0);
    const later = updateMissingSince(first, ['sensor.a'], T0 + 2 * MIN);
    expect(later['sensor.a']).toBe(T0);
  });

  it('drops recovered entities', () => {
    const first = updateMissingSince({}, ['sensor.a', 'sensor.b'], T0);
    const later = updateMissingSince(first, ['sensor.b'], T0 + MIN);
    expect(later).toEqual({ 'sensor.b': T0 });
  });

  it('returns the SAME reference when nothing changed (render-inert)', () => {
    const first = updateMissingSince({}, ['sensor.a'], T0);
    const same = updateMissingSince(first, ['sensor.a'], T0 + MIN);
    expect(same).toBe(first);
  });

  it('empty scan on empty map stays the same reference', () => {
    const empty = {};
    expect(updateMissingSince(empty, [], T0)).toBe(empty);
  });
});

describe('overdueMissing', () => {
  it('splits at the grace boundary', () => {
    const map = { 'sensor.old': T0, 'sensor.fresh': T0 + 4 * MIN };
    const overdue = overdueMissing(map, 5 * MIN, T0 + 5 * MIN);
    expect(overdue).toEqual(['sensor.old']);
  });

  it('default grace covers a typical restart', () => {
    const map = updateMissingSince({}, ['sensor.a'], T0);
    // 2 minutes in — still in grace under the 5-minute default.
    expect(overdueMissing(map, UNAVAILABLE_GRACE_MS, T0 + 2 * MIN)).toEqual([]);
    expect(overdueMissing(map, UNAVAILABLE_GRACE_MS, T0 + 6 * MIN)).toEqual(['sensor.a']);
  });
});

describe('nextExpiryDelay', () => {
  it('returns the earliest pending expiry', () => {
    const map = { 'sensor.a': T0, 'sensor.b': T0 + 2 * MIN };
    expect(nextExpiryDelay(map, 5 * MIN, T0 + 4 * MIN)).toBe(MIN);
  });

  it('returns null when everything is overdue or the map is empty', () => {
    expect(nextExpiryDelay({}, 5 * MIN, T0)).toBeNull();
    expect(nextExpiryDelay({ 'sensor.a': T0 }, 5 * MIN, T0 + 10 * MIN)).toBeNull();
  });
});
