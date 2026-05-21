import { describe, it, expect } from 'vitest';
import { wmoToCondition, WMO_CONDITION } from '../src/weather-code-map.js';

describe('wmoToCondition', () => {
  it('maps clear / cloud codes', () => {
    expect(wmoToCondition(0)).toBe('sunny');
    expect(wmoToCondition(1)).toBe('sunny');
    expect(wmoToCondition(2)).toBe('partlycloudy');
    expect(wmoToCondition(3)).toBe('cloudy');
  });

  it('maps fog codes', () => {
    expect(wmoToCondition(45)).toBe('fog');
    expect(wmoToCondition(48)).toBe('fog');
  });

  it('maps rain by intensity', () => {
    expect(wmoToCondition(61)).toBe('rainy'); // slight
    expect(wmoToCondition(63)).toBe('rainy'); // moderate
    expect(wmoToCondition(65)).toBe('pouring'); // heavy
    expect(wmoToCondition(82)).toBe('pouring'); // violent showers
  });

  it('maps freezing precipitation to snowy-rainy', () => {
    expect(wmoToCondition(56)).toBe('snowy-rainy');
    expect(wmoToCondition(66)).toBe('snowy-rainy');
  });

  it('maps snow codes', () => {
    expect(wmoToCondition(71)).toBe('snowy');
    expect(wmoToCondition(75)).toBe('snowy');
    expect(wmoToCondition(86)).toBe('snowy');
  });

  it('maps thunderstorm codes to pouring, never lightning/hail', () => {
    // The card's classifier never emits lightning/hail conditions;
    // the Open-Meteo map stays inside the same vocabulary.
    for (const code of [95, 96, 99]) {
      const c = wmoToCondition(code);
      expect(c).toBe('pouring');
      expect(c).not.toMatch(/lightning|hail/);
    }
  });

  it('never produces a lightning or hail condition for any mapped code', () => {
    for (const condition of Object.values(WMO_CONDITION)) {
      expect(condition).not.toMatch(/lightning|hail/);
    }
  });

  it('falls back to cloudy for unknown / non-numeric input', () => {
    expect(wmoToCondition(7)).toBe('cloudy'); // not in the table
    expect(wmoToCondition(null)).toBe('cloudy');
    expect(wmoToCondition(undefined)).toBe('cloudy');
    expect(wmoToCondition(NaN)).toBe('cloudy');
  });
});
