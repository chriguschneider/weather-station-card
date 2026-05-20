// Unit tests for src/chart/sanitize.ts — the render-path graceful
// degradation guards (v2.0 slice 4).
//
// The contract these helpers must hold: malformed or partial data —
// a null forecast entry, a NaN, an unexpected type, an empty array —
// NEVER throws. The card renders what it can or degrades to the error
// banner; it must never produce a blank/white card. Each helper is
// fed every malformed shape and asserted to (a) not throw and
// (b) return a sane, predictable value.

import { describe, it, expect } from 'vitest';
import {
  sanitizeForecastEntries,
  coerceNumeric,
  coerceNumericSeries,
} from '../src/chart/sanitize.js';

describe('sanitizeForecastEntries', () => {
  it('keeps well-formed entries unchanged', () => {
    const entries = [
      { datetime: '2026-05-20T00:00:00', temperature: 21 },
      { datetime: '2026-05-21T00:00:00', temperature: 19 },
    ];
    const out = sanitizeForecastEntries(entries);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(entries[0]);
  });

  it('returns [] for a non-array input (null, undefined, object, string)', () => {
    expect(sanitizeForecastEntries(null)).toEqual([]);
    expect(sanitizeForecastEntries(undefined)).toEqual([]);
    expect(sanitizeForecastEntries({})).toEqual([]);
    expect(sanitizeForecastEntries('nope')).toEqual([]);
    expect(sanitizeForecastEntries(42)).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(sanitizeForecastEntries([])).toEqual([]);
  });

  it('drops null and undefined entries', () => {
    const out = sanitizeForecastEntries([
      { datetime: '2026-05-20T00:00:00' },
      null,
      undefined,
      { datetime: '2026-05-21T00:00:00' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('drops primitive (non-object) entries', () => {
    const out = sanitizeForecastEntries([
      { datetime: '2026-05-20T00:00:00' },
      'string',
      42,
      true,
    ]);
    expect(out).toHaveLength(1);
  });

  it('drops entries missing a datetime', () => {
    const out = sanitizeForecastEntries([
      { datetime: '2026-05-20T00:00:00' },
      { temperature: 21 },
    ]);
    expect(out).toHaveLength(1);
  });

  it('drops entries whose datetime is the wrong type', () => {
    const out = sanitizeForecastEntries([
      { datetime: '2026-05-20T00:00:00' },
      { datetime: 1716163200000 },
      { datetime: null },
      { datetime: { iso: 'x' } },
    ]);
    expect(out).toHaveLength(1);
  });

  it('drops entries with an empty or whitespace-only datetime', () => {
    const out = sanitizeForecastEntries([
      { datetime: '2026-05-20T00:00:00' },
      { datetime: '' },
      { datetime: '   ' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('does not mutate the input array', () => {
    const entries = [{ datetime: '2026-05-20T00:00:00' }, null];
    sanitizeForecastEntries(entries);
    expect(entries).toHaveLength(2);
  });

  it('survives an all-malformed array without throwing', () => {
    expect(() =>
      sanitizeForecastEntries([null, undefined, 'x', 5, { temperature: 1 }]),
    ).not.toThrow();
    expect(sanitizeForecastEntries([null, undefined, 'x', 5])).toEqual([]);
  });
});

describe('coerceNumeric', () => {
  it('passes finite numbers through unchanged', () => {
    expect(coerceNumeric(21.4)).toBe(21.4);
    expect(coerceNumeric(0)).toBe(0);
    expect(coerceNumeric(-5)).toBe(-5);
  });

  it('returns null for null and undefined', () => {
    expect(coerceNumeric(null)).toBeNull();
    expect(coerceNumeric(undefined)).toBeNull();
  });

  it('returns null for NaN and Infinity', () => {
    expect(coerceNumeric(NaN)).toBeNull();
    expect(coerceNumeric(Infinity)).toBeNull();
    expect(coerceNumeric(-Infinity)).toBeNull();
  });

  it('parses numeric strings to numbers', () => {
    expect(coerceNumeric('21.4')).toBe(21.4);
    expect(coerceNumeric('  19  ')).toBe(19);
    expect(coerceNumeric('-3')).toBe(-3);
  });

  it('returns null for non-numeric strings (unavailable, unknown, empty)', () => {
    expect(coerceNumeric('unavailable')).toBeNull();
    expect(coerceNumeric('unknown')).toBeNull();
    expect(coerceNumeric('')).toBeNull();
    expect(coerceNumeric('   ')).toBeNull();
    expect(coerceNumeric('NaN')).toBeNull();
  });

  it('returns null for booleans, objects and arrays', () => {
    expect(coerceNumeric(true)).toBeNull();
    expect(coerceNumeric(false)).toBeNull();
    expect(coerceNumeric({})).toBeNull();
    expect(coerceNumeric([])).toBeNull();
    expect(coerceNumeric([1])).toBeNull();
  });

  it('never throws on any malformed input', () => {
    for (const v of [null, undefined, NaN, Infinity, '', 'x', {}, [], true, Symbol.iterator]) {
      expect(() => coerceNumeric(v)).not.toThrow();
    }
  });
});

describe('coerceNumericSeries', () => {
  it('coerces a mixed series, nulling out every bad cell', () => {
    const out = coerceNumericSeries([21, '19', null, NaN, 'unavailable', Infinity, 3]);
    expect(out).toEqual([21, 19, null, null, null, null, 3]);
  });

  it('returns [] for a non-array input', () => {
    expect(coerceNumericSeries(null)).toEqual([]);
    expect(coerceNumericSeries(undefined)).toEqual([]);
    expect(coerceNumericSeries('nope')).toEqual([]);
    expect(coerceNumericSeries({})).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(coerceNumericSeries([])).toEqual([]);
  });

  it('preserves length and position so the chart axis stays aligned', () => {
    const out = coerceNumericSeries([1, 'bad', 3]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBeNull();
  });

  it('survives an all-malformed series without throwing', () => {
    expect(() =>
      coerceNumericSeries([null, undefined, NaN, 'x', {}, []]),
    ).not.toThrow();
    expect(coerceNumericSeries([null, undefined, NaN, 'x', {}, []]))
      .toEqual([null, null, null, null, null, null]);
  });
});
