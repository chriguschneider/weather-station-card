// Chance-of-rain overlay (#288, ADR-0027): entity value first,
// Open-Meteo fills the gaps, measured entries are never touched
// (callers pass the forecast slice only).

import { describe, it, expect } from 'vitest';
import {
  attachPrecipProbability,
  forecastHasProbability,
  normalizeProbability,
  overlayPrecipProbability,
} from '../src/precip-probability.js';

describe('normalizeProbability', () => {
  it('rounds and clamps finite numbers to an integer 0..100', () => {
    expect(normalizeProbability(84.6)).toBe(85);
    expect(normalizeProbability(-3)).toBe(0);
    expect(normalizeProbability(140)).toBe(100);
    expect(normalizeProbability(0)).toBe(0);
  });

  it('accepts numeric strings (HA attributes sometimes arrive as text)', () => {
    expect(normalizeProbability('60')).toBe(60);
  });

  it('returns null for null, undefined, NaN, booleans and junk strings', () => {
    expect(normalizeProbability(null)).toBe(null);
    expect(normalizeProbability(undefined)).toBe(null);
    expect(normalizeProbability(NaN)).toBe(null);
    expect(normalizeProbability(true)).toBe(null);
    expect(normalizeProbability('unavailable')).toBe(null);
  });
});

describe('attachPrecipProbability — daily', () => {
  const day = (iso) => ({ datetime: iso, precipitation: 1 });
  // Local midnights (vitest runs with the default TZ of the machine;
  // dayKey resolves the civil date in the card's zone, so build the
  // ISO strings from local Date objects).
  const d1 = new Date(2026, 4, 6).toISOString();
  const d2 = new Date(2026, 4, 7).toISOString();

  it('matches Open-Meteo daily values by civil date', () => {
    const out = attachPrecipProbability([day(d1), day(d2)], {
      dailyValues: [{ date: '2026-05-06', value: 85 }, { date: '2026-05-07', value: 60 }],
      granularity: 'daily',
    });
    expect(out.map((e) => e.precipitation_probability)).toEqual([85, 60]);
  });

  it('keeps an entity-provided value and only normalizes it', () => {
    const out = attachPrecipProbability([{ ...day(d1), precipitation_probability: 72.4 }], {
      dailyValues: [{ date: '2026-05-06', value: 10 }],
      granularity: 'daily',
    });
    expect(out[0].precipitation_probability).toBe(72);
  });

  it('sets null when nothing matches and when there is no source at all', () => {
    const withSource = attachPrecipProbability([day(d1)], {
      dailyValues: [{ date: '2026-05-09', value: 40 }],
      granularity: 'daily',
    });
    expect(withSource[0].precipitation_probability).toBe(null);
    const noSource = attachPrecipProbability([day(d1)], null);
    expect(noSource[0].precipitation_probability).toBe(null);
  });

  it('does not mutate the input entries', () => {
    const input = [day(d1)];
    attachPrecipProbability(input, { dailyValues: [{ date: '2026-05-06', value: 85 }] });
    expect(input[0].precipitation_probability).toBeUndefined();
  });

  it('returns [] for a non-array input', () => {
    expect(attachPrecipProbability(null)).toEqual([]);
  });
});

describe('attachPrecipProbability — hourly', () => {
  it('matches Open-Meteo hourly values on the hour, tolerating :MM drift', () => {
    const h = new Date(2026, 4, 6, 14, 0).toISOString();
    const out = attachPrecipProbability([{ datetime: h, precipitation: 0 }], {
      hourlyValues: [{ datetime: '2026-05-06T14:00', value: 70 }],
      granularity: 'hourly',
    });
    expect(out[0].precipitation_probability).toBe(70);
  });

  it('ignores the daily array at hourly granularity', () => {
    const h = new Date(2026, 4, 6, 14, 0).toISOString();
    const out = attachPrecipProbability([{ datetime: h }], {
      dailyValues: [{ date: '2026-05-06', value: 85 }],
      granularity: 'hourly',
    });
    expect(out[0].precipitation_probability).toBe(null);
  });

  it('skips malformed source items without throwing', () => {
    const h = new Date(2026, 4, 6, 14, 0).toISOString();
    const out = attachPrecipProbability([{ datetime: h }], {
      hourlyValues: [null, 'junk', { datetime: 42, value: 5 }, { datetime: '2026-05-06T14:00', value: 'x' }],
      granularity: 'hourly',
    });
    expect(out[0].precipitation_probability).toBe(null);
  });
});

describe('overlayPrecipProbability', () => {
  it('reads the two getters off a source object', () => {
    const d1 = new Date(2026, 4, 6).toISOString();
    const source = {
      getDailyProbability: () => [{ date: '2026-05-06', value: 55 }],
      getHourlyProbability: () => [],
    };
    const out = overlayPrecipProbability([{ datetime: d1 }], source, 'daily');
    expect(out[0].precipitation_probability).toBe(55);
  });

  it('tolerates a missing source (entity values still normalize)', () => {
    const out = overlayPrecipProbability([{ datetime: 'x', precipitation_probability: '33' }], null);
    expect(out[0].precipitation_probability).toBe(33);
  });
});

describe('forecastHasProbability', () => {
  it('is true when any entry carries a usable value', () => {
    expect(forecastHasProbability([{ datetime: 'a' }, { datetime: 'b', precipitation_probability: 0 }])).toBe(true);
  });

  it('is false for empty, non-array and all-null inputs', () => {
    expect(forecastHasProbability([])).toBe(false);
    expect(forecastHasProbability(null)).toBe(false);
    expect(forecastHasProbability([{ datetime: 'a', precipitation_probability: null }])).toBe(false);
  });
});
