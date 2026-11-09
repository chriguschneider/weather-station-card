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
  PRESSURE_CONVERSION,
  convertWindSpeed,
  toBeaufort,
  convertPressure,
  toMetersPerSecond,
  toCelsius,
  toMillimeters,
  isPrecipRateUnit,
  precipBaseUnit,
  convertPrecipLength,
  formatPrecipDisplay,
} from '../src/utils/unit-converters.js';

// ── WIND_CONVERSION / PRESSURE_CONVERSION tables ────────────────────

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

describe('PRESSURE_CONVERSION table', () => {
  it('round-trips hPa ↔ mmHg within 0.1% tolerance', () => {
    const v = 1013; // hPa
    const mmHg = v * PRESSURE_CONVERSION['mmHg->hPa'];
    const back = mmHg * PRESSURE_CONVERSION['hPa->mmHg'];
    expect(Math.abs(back - v)).toBeLessThan(v * 0.001);
  });

  it('round-trips hPa ↔ inHg within 0.1% tolerance', () => {
    const v = 1013;
    const inHg = v * PRESSURE_CONVERSION['inHg->hPa'];
    const back = inHg * PRESSURE_CONVERSION['hPa->inHg'];
    expect(Math.abs(back - v)).toBeLessThan(v * 0.001);
  });
});

// ── convertWindSpeed ────────────────────────────────────────────────

describe('convertWindSpeed', () => {
  it('rounds same-unit input', () => {
    expect(convertWindSpeed(12.7, 'km/h', 'km/h')).toBe(13);
  });

  it('converts km/h → m/s and rounds', () => {
    expect(convertWindSpeed(36, 'km/h', 'm/s')).toBe(10);
  });

  it('converts m/s → km/h and rounds', () => {
    expect(convertWindSpeed(10, 'm/s', 'km/h')).toBe(36);
  });

  it('converts km/h → mph and rounds', () => {
    expect(convertWindSpeed(50, 'km/h', 'mph')).toBe(31);
  });

  it('parses a numeric state string', () => {
    expect(convertWindSpeed('3.4', 'm/s', 'm/s')).toBe(3);
  });

  it('converts to Beaufort in the source unit', () => {
    // 20 km/h is force 4; the same number in m/s (72 km/h) is force 8.
    expect(convertWindSpeed(20, 'km/h', 'Bft')).toBe(4);
    expect(convertWindSpeed(20, 'm/s', 'Bft')).toBe(8);
  });

  it('returns input unchanged for an unknown unit pair', () => {
    expect(convertWindSpeed(15, 'knots', 'm/s')).toBe(15);
  });

  it('returns rounded input when source unit is undefined and target matches', () => {
    expect(convertWindSpeed(12.7, undefined, undefined)).toBe(13);
  });

  it('returns input unchanged when only source unit is undefined', () => {
    expect(convertWindSpeed(12.7, undefined, 'km/h')).toBe(12.7);
  });

  for (const raw of [undefined, null, '', 'unavailable', 'unknown', NaN]) {
    it(`returns undefined for a missing speed (${String(raw)})`, () => {
      expect(convertWindSpeed(raw, 'm/s', 'm/s')).toBeUndefined();
      expect(convertWindSpeed(raw, 'm/s', 'km/h')).toBeUndefined();
      expect(convertWindSpeed(raw, 'm/s', 'Bft')).toBeUndefined();
    });
  }
});

// ── toBeaufort ──────────────────────────────────────────────────────

describe('toBeaufort', () => {
  it('maps the km/h band edges (exclusive upper bound)', () => {
    expect(toBeaufort(0, 'km/h')).toBe(0);
    expect(toBeaufort(0.9, 'km/h')).toBe(0);
    expect(toBeaufort(1, 'km/h')).toBe(1);
    expect(toBeaufort(5.9, 'km/h')).toBe(1);
    expect(toBeaufort(6, 'km/h')).toBe(2);
    expect(toBeaufort(38.9, 'km/h')).toBe(5);
    expect(toBeaufort(39, 'km/h')).toBe(6);
    expect(toBeaufort(117.9, 'km/h')).toBe(11);
    expect(toBeaufort(118, 'km/h')).toBe(12);
    expect(toBeaufort(250, 'km/h')).toBe(12);
  });

  it('converts m/s and mph before banding', () => {
    expect(toBeaufort(10, 'm/s')).toBe(5); // 36 km/h
    expect(toBeaufort(11, 'm/s')).toBe(6); // 39.6 km/h
    expect(toBeaufort(20, 'mph')).toBe(5); // 32.2 km/h
    expect(toBeaufort(25, 'mph')).toBe(6); // 40.2 km/h
  });

  it('reads a missing or unknown unit as m/s', () => {
    expect(toBeaufort(10, undefined)).toBe(toBeaufort(10, 'm/s'));
    expect(toBeaufort(10, 'knots')).toBe(toBeaufort(10, 'm/s'));
  });

  it('returns null for missing input', () => {
    expect(toBeaufort(null, 'm/s')).toBeNull();
    expect(toBeaufort(undefined, 'm/s')).toBeNull();
    expect(toBeaufort(NaN, 'm/s')).toBeNull();
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

// ── convertPressure ─────────────────────────────────────────────────

describe('convertPressure', () => {
  it('rounds same-unit hPa', () => {
    expect(convertPressure(1013.4, 'hPa', 'hPa')).toBe(1013);
  });

  it('rounds same-unit mmHg', () => {
    expect(convertPressure(760.6, 'mmHg', 'mmHg')).toBe(761);
  });

  it('leaves same-unit inHg unrounded', () => {
    expect(convertPressure(29.92, 'inHg', 'inHg')).toBe(29.92);
  });

  it('converts hPa → mmHg and rounds', () => {
    // 1013 hPa ≈ 759.8 mmHg → rounded 760
    expect(convertPressure(1013, 'hPa', 'mmHg')).toBe(760);
  });

  it('converts mmHg → hPa and rounds', () => {
    // 760 mmHg ≈ 1013.2 hPa → rounded 1013
    expect(convertPressure(760, 'mmHg', 'hPa')).toBe(1013);
  });

  it('converts hPa → inHg with 2-decimal precision', () => {
    // 1013 hPa ≈ 29.92 inHg
    const out = convertPressure(1013, 'hPa', 'inHg');
    expect(typeof out).toBe('number');
    expect(out).toBeCloseTo(29.92, 1);
    // 2-decimal precision: not 30 (integer rounding) and not 29.91923... (raw).
    expect(Math.round(out * 100)).toBe(out * 100);
  });

  it('returns input unchanged for an unknown unit pair', () => {
    expect(convertPressure(1013, 'bar', 'hPa')).toBe(1013);
  });

  it('handles undefined units as same-unit (no conversion)', () => {
    expect(convertPressure(1013.4, undefined, undefined)).toBe(1013.4);
  });
});

// ── isPrecipRateUnit ────────────────────────────────────────────────

describe('isPrecipRateUnit', () => {
  it('detects /h, /hr, /hour suffixes (case-insensitive)', () => {
    expect(isPrecipRateUnit('mm/h')).toBe(true);
    expect(isPrecipRateUnit('in/h')).toBe(true);
    expect(isPrecipRateUnit('mm/hr')).toBe(true);
    expect(isPrecipRateUnit('IN/HOUR')).toBe(true);
  });

  it('returns false for totals and missing units', () => {
    expect(isPrecipRateUnit('mm')).toBe(false);
    expect(isPrecipRateUnit('in')).toBe(false);
    expect(isPrecipRateUnit('%')).toBe(false);
    expect(isPrecipRateUnit(undefined)).toBe(false);
    expect(isPrecipRateUnit('')).toBe(false);
  });
});

// ── precipBaseUnit ──────────────────────────────────────────────────

describe('precipBaseUnit', () => {
  it('strips the rate suffix', () => {
    expect(precipBaseUnit('mm/h')).toBe('mm');
    expect(precipBaseUnit('in/h')).toBe('in');
  });

  it('normalises every inch spelling to "in"', () => {
    expect(precipBaseUnit('in')).toBe('in');
    expect(precipBaseUnit('inch')).toBe('in');
    expect(precipBaseUnit('inches')).toBe('in');
    expect(precipBaseUnit('"')).toBe('in');
    expect(precipBaseUnit('IN')).toBe('in');
  });

  it('defaults undefined to mm and passes unknown units through', () => {
    expect(precipBaseUnit(undefined)).toBe('mm');
    expect(precipBaseUnit('mm')).toBe('mm');
    expect(precipBaseUnit('%')).toBe('%');
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

// ── formatPrecipDisplay ─────────────────────────────────────────────

describe('formatPrecipDisplay', () => {
  it('keeps a mm rate in mm with legacy precision (1 decimal under 10)', () => {
    expect(formatPrecipDisplay(2.5, 'mm/h', 'mm')).toEqual({ value: '2.5', unit: 'mm/h' });
  });

  it('drops the decimal for a mm rate of 10 or more', () => {
    expect(formatPrecipDisplay(339.2, 'mm/h', 'mm')).toEqual({ value: '339', unit: 'mm/h' });
  });

  it('keeps an inch rate in in/h with two decimals', () => {
    // 0.1 in/h light rain stays meaningful at 2 decimals.
    expect(formatPrecipDisplay(0.1, 'in/h', 'in')).toEqual({ value: '0.10', unit: 'in/h' });
  });

  it('converts an inch rate to mm/h when mm is the target', () => {
    // 0.1 in/h = 2.54 mm/h.
    expect(formatPrecipDisplay(0.1, 'in/h', 'mm')).toEqual({ value: '2.5', unit: 'mm/h' });
  });

  it('converts a mm rate to in/h when in is the target', () => {
    // 25.4 mm/h = 1.00 in/h.
    expect(formatPrecipDisplay(25.4, 'mm/h', 'in')).toEqual({ value: '1.00', unit: 'in/h' });
  });

  it('falls back to the source base when target is unset or not mm/in', () => {
    expect(formatPrecipDisplay(0.1, 'in/h', undefined)).toEqual({ value: '0.10', unit: 'in/h' });
    expect(formatPrecipDisplay(2.5, 'mm/h', 'parsec')).toEqual({ value: '2.5', unit: 'mm/h' });
  });

  it('labels a total (non-rate) without the /h suffix', () => {
    expect(formatPrecipDisplay(12.7, 'mm', 'mm')).toEqual({ value: '13', unit: 'mm' });
    expect(formatPrecipDisplay(0.5, 'in', 'in')).toEqual({ value: '0.50', unit: 'in' });
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
