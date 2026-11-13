import { describe, it, expect } from 'vitest';
import { classifySunStrength, formatLux } from '../src/sun-strength.js';
import { clearSkyLuxAt } from '../src/condition-classifier.js';
import { isSunUp } from '../src/moon.js';
import { Calendar } from '../src/utils/time-zone.js';

// Most fixtures use null lat/lon so `clearSkyLuxAt` falls through to
// the 110 000 lx fallback constant — gives the test a deterministic
// reference regardless of wall-clock or date. The `clearsky === 0`
// branch is exercised with concrete coordinates + a UTC moment well
// after local sunset in Köniz (the reference site in CLAUDE.md).
const calendar = new Calendar();
const DAY = { lat: null, lon: null, calendar, now: new Date(Date.UTC(2026, 5, 21, 11, 0, 0)) };
const NIGHT_REAL = {
  calendar,
  lat: 46.91,
  lon: 7.42,
  now: new Date(Date.UTC(2026, 0, 15, 1, 0, 0)), // 02:00 local winter — sun below horizon
};

describe('classifySunStrength — day/clouds', () => {
  it('clear sky (ratio >= 0.70) → weather-sunny + day', () => {
    const out = classifySunStrength({ uv: 5, lux: 90000, ...DAY });
    expect(out.mode).toBe('day');
    expect(out.iconShape).toBe('weather-sunny');
    expect(out.cloudPct).toBe(82);
    expect(out.uv).toBe(5);
    expect(out.lux).toBe(90000);
  });

  it('partly cloudy (0.30 <= ratio < 0.70) → weather-partly-cloudy', () => {
    const out = classifySunStrength({ uv: 4, lux: 55000, ...DAY });
    expect(out.iconShape).toBe('weather-partly-cloudy');
    expect(out.cloudPct).toBe(50);
  });

  it('cloudy (ratio < 0.30) → weather-cloudy', () => {
    const out = classifySunStrength({ uv: 1, lux: 20000, ...DAY });
    expect(out.iconShape).toBe('weather-cloudy');
    expect(out.cloudPct).toBe(18);
  });

  it('ratio exactly 0.70 stays in sunny band', () => {
    const out = classifySunStrength({ uv: 5, lux: 77000, ...DAY });
    expect(out.iconShape).toBe('weather-sunny');
  });

  it('ratio exactly 0.30 stays in partly band', () => {
    const out = classifySunStrength({ uv: 2, lux: 33000, ...DAY });
    expect(out.iconShape).toBe('weather-partly-cloudy');
  });
});

describe('classifySunStrength — night triggers', () => {
  it('lux === 0 → night, moon icon, UV hidden', () => {
    const out = classifySunStrength({ uv: 0, lux: 0, ...DAY });
    expect(out.mode).toBe('night');
    expect(out.nightReason).toBe('lux_zero');
    expect(out.iconShape).toBe('weather-night');
    expect(out.uv).toBeNull();
    expect(out.lux).toBe(0);
    expect(out.band).toBeNull();
    expect(out.protectionAdvised).toBe(false);
    expect(out.cloudPct).toBeNull();
  });

  it('day/night follows the NOAA sun-up model, not the simple clear-sky model', () => {
    const site = { lat: 46.91, lon: 7.42, calendar };
    // Scan one winter morning in 1-min steps: wherever the two models
    // disagree, the mode must follow isSunUp.
    const base = Date.UTC(2026, 0, 15, 5, 0, 0);
    let disagreements = 0;
    for (let m = 0; m < 240; m++) {
      const now = new Date(base + m * 60_000);
      const out = classifySunStrength({ uv: 1, lux: 5000, ...site, now });
      expect(out.mode).toBe(isSunUp(now, site.lat, site.lon) ? 'day' : 'night');
      if ((clearSkyLuxAt(site.lat, site.lon, calendar, now) > 0) !== isSunUp(now, site.lat, site.lon)) {
        disagreements++;
      }
    }
    // The old model flipped minutes away from NOAA; the scan must cross it.
    expect(disagreements).toBeGreaterThan(0);
  });

  it('UV-sensor glitch (lux=0 AND uv>0) still flips to night — UV hidden', () => {
    const out = classifySunStrength({ uv: 4, lux: 0, ...DAY });
    expect(out.mode).toBe('night');
    expect(out.uv).toBeNull();
    expect(out.iconShape).toBe('weather-night');
  });

  it('porch-light edge case (lux>0 but clearSky===0) → night via clearsky_zero', () => {
    const out = classifySunStrength({ uv: null, lux: 12, ...NIGHT_REAL });
    expect(out.mode).toBe('night');
    expect(out.nightReason).toBe('clearsky_zero');
    expect(out.iconShape).toBe('weather-night');
    expect(out.lux).toBe(12);
  });
});

describe('classifySunStrength — sensor-wired degrade', () => {
  it('UV-only (no lux sensor) → default sunny icon, no cloud-%', () => {
    const out = classifySunStrength({ uv: 5, lux: null, ...DAY });
    expect(out.mode).toBe('day');
    expect(out.iconShape).toBe('weather-sunny');
    expect(out.cloudPct).toBeNull();
    expect(out.uv).toBe(5);
    expect(out.lux).toBeNull();
    expect(out.band).toBe('moderate');
  });

  it('Lux-only (no UV sensor) → cloud-shape from lux, no UV band', () => {
    const out = classifySunStrength({ uv: null, lux: 90000, ...DAY });
    expect(out.iconShape).toBe('weather-sunny');
    expect(out.uv).toBeNull();
    expect(out.band).toBeNull();
    expect(out.protectionAdvised).toBe(false);
  });

  it('unknown lat/lon (clearSky fallback to 110k) still yields a sensible ratio', () => {
    // 80000 / 110000 = 0.727 → still sunny band
    const out = classifySunStrength({ uv: 5, lux: 80000, lat: null, lon: null, calendar });
    expect(out.iconShape).toBe('weather-sunny');
    expect(out.cloudPct).toBe(73);
  });
});

describe('classifySunStrength — UV bands (WHO 5-tier)', () => {
  it('UV < 3 → low, no protection', () => {
    const out = classifySunStrength({ uv: 2.999, lux: 50000, ...DAY });
    expect(out.band).toBe('low');
    expect(out.bandLocaleKey).toBe('sun_strength_band_low');
    expect(out.protectionAdvised).toBe(false);
  });

  it('UV = 3 (boundary) → moderate, protection advised', () => {
    const out = classifySunStrength({ uv: 3, lux: 50000, ...DAY });
    expect(out.band).toBe('moderate');
    expect(out.protectionAdvised).toBe(true);
  });

  it('UV = 6 (boundary) → high', () => {
    const out = classifySunStrength({ uv: 6, lux: 50000, ...DAY });
    expect(out.band).toBe('high');
  });

  it('UV = 8 (boundary) → very_high', () => {
    const out = classifySunStrength({ uv: 8, lux: 50000, ...DAY });
    expect(out.band).toBe('very_high');
  });

  it('UV = 11 (boundary) → extreme', () => {
    const out = classifySunStrength({ uv: 11, lux: 50000, ...DAY });
    expect(out.band).toBe('extreme');
  });

  it('UV = 0 daytime → low band, no protection', () => {
    const out = classifySunStrength({ uv: 0, lux: 50000, ...DAY });
    expect(out.band).toBe('low');
    expect(out.protectionAdvised).toBe(false);
  });
});

describe('formatLux', () => {
  it('< 1000 → raw integer', () => {
    expect(formatLux(0)).toBe('Lux 0');
    expect(formatLux(12)).toBe('Lux 12');
    expect(formatLux(980)).toBe('Lux 980');
    expect(formatLux(999.4)).toBe('Lux 999');
    expect(formatLux(999.9)).toBe('Lux 999'); // truncates — band boundary is hard
  });

  it('1000 .. 9999 → 1-decimal k', () => {
    expect(formatLux(1000)).toBe('Lux 1.0k');
    expect(formatLux(1500)).toBe('Lux 1.5k');
    expect(formatLux(9999)).toBe('Lux 9.9k');
  });

  it('>= 10 000 → integer k', () => {
    expect(formatLux(10000)).toBe('Lux 10k');
    expect(formatLux(51234)).toBe('Lux 51k');
    expect(formatLux(100000)).toBe('Lux 100k');
  });

  it('handles null / non-finite gracefully', () => {
    expect(formatLux(null)).toBe('Lux -');
    expect(formatLux(NaN)).toBe('Lux -');
    expect(formatLux(Infinity)).toBe('Lux -');
  });
});
