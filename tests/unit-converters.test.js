// Unit tests for src/utils/unit-converters.ts — extracted from
// main.ts in v1.10.1 so the conversion math gets direct coverage
// instead of riding only on the renderAttributes E2E baselines.
//
// Each function gets:
//   - identity (same source + target unit)
//   - cross-unit conversion against a hand-checked expected value
//   - undefined / unknown unit fallback (defensive HA-boundary path)
//   - edge cases (Beaufort, missing input, NaN, etc.)

import { describe, it, expect } from 'vitest';
import {
  WIND_CONVERSION,
  toMetersPerSecond,
  toCelsius,
  toMillimeters,
  convertPrecipLength,
} from '../src/utils/unit-converters.js';

// ── WIND_CONVERSION table ───────────────────────────────────────────

describe('WIND_CONVERSION table', () => {
  it('round-trips m/s ↔ km/h within 0.1% tolerance', () => {
    const v = 10; // m/s
    const kmh = v * WIND_CONVERSION['km/h->m/s'];
    const back = kmh * WIND_CONVERSION['m/s->km/h'];
    expect(Math.abs(back - v)).toBeLessThan(v * 0.001);
  });

  it('round-trips km/h ↔ mph within 0.1% tolerance', () => {
    const v = 50; // km/h
    const mph = v * WIND_CONVERSION['mph->km/h'];
    const back = mph * WIND_CONVERSION['km/h->mph'];
    expect(Math.abs(back - v)).toBeLessThan(v * 0.001);
  });

  it('m/s → km/h matches the textbook 3.6 factor', () => {
    expect(WIND_CONVERSION['km/h->m/s']).toBeCloseTo(3.6, 4);
  });
});

// ── toMetersPerSecond (classifier normalisation) ────────────────────

describe('toMetersPerSecond', () => {
  it('converts km/h → m/s', () => {
    // 31 km/h ≈ 8.61 m/s — well under the 24.5 m/s exceptional-gust
    // threshold, the regression at the heart of discussion #197.
    expect(toMetersPerSecond(31, 'km/h')).toBeCloseTo(8.61, 2);
  });

  it('keeps a km/h breeze below the exceptional-gust threshold (24.5 m/s)', () => {
    expect(toMetersPerSecond(31, 'km/h')).toBeLessThan(24.5);
  });

  it('converts mph → m/s', () => {
    // 20 mph ≈ 8.94 m/s
    expect(toMetersPerSecond(20, 'mph')).toBeCloseTo(8.94, 2);
  });

  it('passes m/s through unchanged (identity)', () => {
    expect(toMetersPerSecond(8.6, 'm/s')).toBe(8.6);
  });

  it('treats an undefined unit as already-m/s', () => {
    expect(toMetersPerSecond(8.6, undefined)).toBe(8.6);
  });

  it('passes an unknown unit through unchanged', () => {
    expect(toMetersPerSecond(15, 'knots')).toBe(15);
  });

  it('returns null for null / non-finite input', () => {
    expect(toMetersPerSecond(null, 'km/h')).toBeNull();
    expect(toMetersPerSecond(undefined, 'km/h')).toBeNull();
    expect(toMetersPerSecond(NaN, 'km/h')).toBeNull();
  });
});

// ── toCelsius (classifier normalisation) ────────────────────────────

describe('toCelsius', () => {
  it('converts °F → °C', () => {
    expect(toCelsius(32, '°F')).toBeCloseTo(0, 6);
    expect(toCelsius(50, '°F')).toBeCloseTo(10, 6);
  });

  it('keeps a freezing °F reading below the snow ceiling (3 °C)', () => {
    // 30 °F = −1.1 °C → snow, not rain (raw 30 would read as "warm").
    expect(toCelsius(30, '°F')).toBeLessThan(3);
  });

  it('accepts a bare "F" unit', () => {
    expect(toCelsius(212, 'F')).toBeCloseTo(100, 6);
  });

  it('passes °C through unchanged (identity)', () => {
    expect(toCelsius(-1, '°C')).toBe(-1);
  });

  it('treats an undefined / unknown unit as already-°C', () => {
    expect(toCelsius(-1, undefined)).toBe(-1);
    expect(toCelsius(-1, 'K')).toBe(-1);
  });

  it('returns null for null / non-finite input', () => {
    expect(toCelsius(null, '°F')).toBeNull();
    expect(toCelsius(NaN, '°F')).toBeNull();
  });
});

// ── toMillimeters (classifier normalisation) ────────────────────────

describe('toMillimeters', () => {
  it('converts inches → mm', () => {
    expect(toMillimeters(1, 'in')).toBeCloseTo(25.4, 6);
    expect(toMillimeters(0.5, 'inch')).toBeCloseTo(12.7, 6);
  });

  it('strips a rate suffix before the unit check (in/h)', () => {
    expect(toMillimeters(0.5, 'in/h')).toBeCloseTo(12.7, 6);
  });

  it('handles the inch double-quote symbol', () => {
    expect(toMillimeters(1, '"')).toBeCloseTo(25.4, 6);
  });

  it('passes mm and mm/h through unchanged', () => {
    expect(toMillimeters(12.7, 'mm')).toBe(12.7);
    expect(toMillimeters(12.7, 'mm/h')).toBe(12.7);
  });

  it('treats undefined / unknown units as already-mm', () => {
    expect(toMillimeters(12.7, undefined)).toBe(12.7);
    expect(toMillimeters(12.7, 'l/m2')).toBe(12.7);
  });

  it('returns null for null / non-finite input', () => {
    expect(toMillimeters(null, 'in')).toBeNull();
    expect(toMillimeters(NaN, 'in')).toBeNull();
  });
});

// ── convertPrecipLength ─────────────────────────────────────────────

describe('convertPrecipLength', () => {
  it('converts in → mm with the 25.4 factor', () => {
    expect(convertPrecipLength(1, 'in', 'mm')).toBeCloseTo(25.4, 6);
  });

  it('converts mm → in', () => {
    expect(convertPrecipLength(25.4, 'mm', 'in')).toBeCloseTo(1, 6);
  });

  it('round-trips mm → in → mm', () => {
    const back = convertPrecipLength(convertPrecipLength(12.7, 'mm', 'in'), 'in', 'mm');
    expect(back).toBeCloseTo(12.7, 6);
  });

  it('passes same-base and unknown-base values through unchanged', () => {
    expect(convertPrecipLength(5, 'mm', 'mm')).toBe(5);
    expect(convertPrecipLength(5, '%', 'mm')).toBe(5);
  });

  it('returns non-finite input unchanged', () => {
    expect(convertPrecipLength(NaN, 'in', 'mm')).toBeNaN();
  });
});

// ── irradiance → lux (community post 15, point 5) ───────────────────

import { isIrradianceUnit, luxScaleFor, DAYLIGHT_EFFICACY_LM_PER_W } from '../src/utils/unit-converters.js';

describe('isIrradianceUnit', () => {
  it('recognises common W/m² spellings', () => {
    expect(isIrradianceUnit('W/m²')).toBe(true);
    expect(isIrradianceUnit('W/m2')).toBe(true);
    expect(isIrradianceUnit('w/m²')).toBe(true);
    expect(isIrradianceUnit('W / m²')).toBe(true);
  });

  it('rejects illuminance and unrelated units', () => {
    expect(isIrradianceUnit('lx')).toBe(false);
    expect(isIrradianceUnit('lux')).toBe(false);
    expect(isIrradianceUnit('')).toBe(false);
    expect(isIrradianceUnit(undefined)).toBe(false);
    expect(isIrradianceUnit(42)).toBe(false);
  });
});

describe('luxScaleFor', () => {
  it('returns the daylight efficacy for irradiance by unit or device_class', () => {
    expect(luxScaleFor('W/m²')).toBe(DAYLIGHT_EFFICACY_LM_PER_W);
    expect(luxScaleFor('lx', 'irradiance')).toBe(DAYLIGHT_EFFICACY_LM_PER_W);
    expect(luxScaleFor(undefined, 'irradiance')).toBe(DAYLIGHT_EFFICACY_LM_PER_W);
  });

  it('returns 1 for plain illuminance sensors', () => {
    expect(luxScaleFor('lx')).toBe(1);
    expect(luxScaleFor('lx', 'illuminance')).toBe(1);
    expect(luxScaleFor(undefined, undefined)).toBe(1);
  });

  it('maps full sun (~1000 W/m²) into the clear-sky-noon lux range', () => {
    expect(1000 * luxScaleFor('W/m²')).toBe(120000);
  });
});
