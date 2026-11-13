import { describe, it, expect } from 'vitest';
import { classifyDay, clearSkyNoonLux, clearSkyLuxAt } from '../src/condition-classifier.js';
import { Calendar } from '../src/utils/time-zone.js';

const cal = new Calendar();

// Sea-level perpendicular-sun reference used by the classifier when no lat
// is supplied — keeps the cloudRatio math stable across tests.
const CLEAR = 110000;

describe('classifyDay — exceptional', () => {
  it('emits exceptional on Beaufort-10 gust (≥ 24.5 m/s)', () => {
    expect(classifyDay({ gust_max: 24.5 })).toBe('exceptional');
    expect(classifyDay({ gust_max: 30 })).toBe('exceptional');
  });

  it('does not emit exceptional just below the gust threshold', () => {
    expect(classifyDay({ gust_max: 24.4, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toBe('exceptional');
  });

  it('emits exceptional on NWS daily heavy-rain (≥ 50 mm)', () => {
    expect(classifyDay({ precip_total: 50 })).toBe('exceptional');
  });
});

describe('classifyDay — precipitation', () => {
  it('snowy when temp_max ≤ 0 °C and precip ≥ 0.5 mm', () => {
    expect(classifyDay({ precip_total: 1, temp_max: -1 })).toBe('snowy');
    expect(classifyDay({ precip_total: 1, temp_max: 0 })).toBe('snowy');
  });

  it('snowy-rainy when 0 < temp_max ≤ 3 °C and precip ≥ 0.5 mm', () => {
    expect(classifyDay({ precip_total: 1, temp_max: 1 })).toBe('snowy-rainy');
    expect(classifyDay({ precip_total: 1, temp_max: 3 })).toBe('snowy-rainy');
  });

  it('pouring when precip ≥ 10 mm and temp_max > 3 °C', () => {
    expect(classifyDay({ precip_total: 10, temp_max: 10 })).toBe('pouring');
  });

  it('rainy for 0.5 ≤ precip < 10 mm at warm temperatures', () => {
    expect(classifyDay({ precip_total: 0.5, temp_max: 10 })).toBe('rainy');
    expect(classifyDay({ precip_total: 5, temp_max: 10 })).toBe('rainy');
    expect(classifyDay({ precip_total: 9.99, temp_max: 10 })).toBe('rainy');
  });

  it('does not emit precipitation conditions below the rainy threshold', () => {
    expect(classifyDay({ precip_total: 0.4, temp_max: 10, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toMatch(/^(rainy|pouring|snowy)/);
  });

  it('exceptional precipitation outranks pouring/snowy', () => {
    expect(classifyDay({ precip_total: 50, temp_max: -5 })).toBe('exceptional');
  });
});

describe('classifyDay — fog', () => {
  it('emits fog at 95 % humidity, ≤ 1 °C dew-point spread, calm wind', () => {
    expect(classifyDay({
      humidity: 95, temp_min: 5, dew_point_mean: 4, wind_mean: 2,
    })).toBe('fog');
  });

  it('does not emit fog when wind ≥ 3 m/s', () => {
    expect(classifyDay({
      humidity: 95, temp_min: 5, dew_point_mean: 4, wind_mean: 3,
      lux_max: CLEAR, clearsky_lux: CLEAR,
    })).not.toBe('fog');
  });

  it('does not emit fog without humidity or dew_point sensors', () => {
    expect(classifyDay({ humidity: 95, temp_min: 5, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toBe('fog');
    expect(classifyDay({ dew_point_mean: 4, temp_min: 5, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toBe('fog');
  });
});

describe('classifyDay — wind', () => {
  it('windy when gust ≥ 10.8 m/s and clouds ≥ 0.70', () => {
    expect(classifyDay({ gust_max: 11, lux_max: CLEAR, clearsky_lux: CLEAR })).toBe('windy');
  });

  it('windy-variant when gust ≥ 10.8 m/s and clouds < 0.70', () => {
    expect(classifyDay({ gust_max: 11, lux_max: 10000, clearsky_lux: CLEAR })).toBe('windy-variant');
  });

  it('windy when wind_mean ≥ 8.0 m/s', () => {
    expect(classifyDay({ wind_mean: 8, lux_max: CLEAR, clearsky_lux: CLEAR })).toBe('windy');
  });
});

describe('classifyDay — cloud cover', () => {
  it('sunny when cloudRatio ≥ 0.70', () => {
    expect(classifyDay({ lux_max: 90000, clearsky_lux: CLEAR })).toBe('sunny');
  });

  it('partlycloudy when 0.30 ≤ cloudRatio < 0.70', () => {
    expect(classifyDay({ lux_max: 50000, clearsky_lux: CLEAR })).toBe('partlycloudy');
  });

  it('cloudy when cloudRatio < 0.30', () => {
    expect(classifyDay({ lux_max: 20000, clearsky_lux: CLEAR })).toBe('cloudy');
  });

  it('cloudy when illuminance sensor missing', () => {
    expect(classifyDay({})).toBe('cloudy');
  });
});

describe('classifyDay — overrides', () => {
  it('honours condition_mapping overrides', () => {
    expect(classifyDay(
      { precip_total: 0.4, temp_max: 10 },
      { rainy_threshold_mm: 0.3 },
    )).toBe('rainy');
  });
});

describe('clearSkyNoonLux', () => {
  it('returns 110 000 lx fallback for non-finite latitude', () => {
    expect(clearSkyNoonLux(NaN, 80)).toBe(110000);
  });

  it('peaks near the equator at equinox', () => {
    expect(clearSkyNoonLux(0, 80)).toBeCloseTo(110000, -2);
  });

  it('is zero when zenith ≥ 90°', () => {
    // 80°N at winter solstice (dec 21 ≈ day 355): declination ≈ -23.45°,
    // |80 - (-23.45)| = 103.45° → cos < 0 → 0.
    expect(clearSkyNoonLux(80, 355)).toBe(0);
  });
});

describe('classifyDay — hourly period (precipitation thresholds rescaled)', () => {
  // Reference scale used in HOURLY_PRECIP_OVERRIDES:
  //   rainy ≥ 0.1 mm/h, pouring ≥ 4 mm/h, exceptional ≥ 30 mm/h.

  it('emits rainy at 0.1 mm/h (sub-daily-threshold)', () => {
    expect(classifyDay({ precip_total: 0.1 }, {}, 'hour')).toBe('rainy');
  });

  it('does NOT emit rainy below 0.1 mm/h', () => {
    expect(classifyDay({ precip_total: 0.05, lux_max: CLEAR, clearsky_lux: CLEAR }, {}, 'hour'))
      .not.toBe('rainy');
  });

  it('emits pouring at 4 mm/h (well below daily 10 mm threshold)', () => {
    expect(classifyDay({ precip_total: 4 }, {}, 'hour')).toBe('pouring');
  });

  it('does not emit pouring at 3 mm/h', () => {
    expect(classifyDay({ precip_total: 3 }, {}, 'hour')).toBe('rainy');
  });

  it('emits exceptional at 30 mm/h (cloudburst)', () => {
    expect(classifyDay({ precip_total: 30 }, {}, 'hour')).toBe('exceptional');
  });

  it('does not emit exceptional at 29 mm/h', () => {
    expect(classifyDay({ precip_total: 29 }, {}, 'hour')).toBe('pouring');
  });

  it('hourly: 0.5 mm/h is light rain, not the daily-style "trace drizzle"', () => {
    // Same input value that triggers exactly rainy at daily — at hourly
    // 0.5 mm/h is moderate, still rainy (4 mm/h is the next tier).
    expect(classifyDay({ precip_total: 0.5 }, {}, 'hour')).toBe('rainy');
    expect(classifyDay({ precip_total: 0.5 }, {}, 'day')).toBe('rainy');
  });

  it('user condition_mapping override applies on top of hourly defaults', () => {
    // User pins rainy lower; should still trip at 0.05 mm/h hourly.
    expect(classifyDay(
      { precip_total: 0.05 },
      { rainy_threshold_mm: 0.04 },
      'hour',
    )).toBe('rainy');
  });

  it('non-precipitation thresholds (gust, fog, cloud) unchanged at hourly', () => {
    // Beaufort 10 still 24.5 m/s either way.
    expect(classifyDay({ gust_max: 24.5 }, {}, 'hour')).toBe('exceptional');
    // Cloud-ratio rules use the same lux-based thresholds.
    expect(classifyDay(
      { lux_max: 90000, clearsky_lux: 110000 }, {}, 'hour',
    )).toBe('sunny');
  });

  it('default period is day when omitted (backwards-compatible)', () => {
    // 0.5 mm at daily = rainy, at hourly = also rainy (above 0.1).
    // 0.3 mm at daily = NOT rainy (below 0.5), at hourly = rainy.
    // So 0.3 mm with no period arg should follow daily semantics.
    expect(classifyDay({ precip_total: 0.3, lux_max: CLEAR, clearsky_lux: CLEAR }))
      .not.toBe('rainy');
    expect(classifyDay({ precip_total: 0.3 }, {}, 'hour')).toBe('rainy');
  });
});

describe('clearSkyLuxAt', () => {
  it('returns 0 when sun is below horizon', () => {
    // Midnight UTC at lat 47, lon 8 (Switzerland) → sun far below horizon
    const midnight = new Date(Date.UTC(2026, 5, 1, 0, 0, 0));
    expect(clearSkyLuxAt(47, 8, cal, midnight)).toBe(0);
  });

  it('returns the noon-lux fallback when lat or lon is non-finite', () => {
    expect(clearSkyLuxAt(NaN, 8, cal, new Date())).toBe(110000);
    expect(clearSkyLuxAt(47, NaN, cal, new Date())).toBe(110000);
  });
});
