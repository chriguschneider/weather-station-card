import { describe, it, expect } from 'vitest';
import {
  dayLengthHours,
  normalizeSunshineValue,
  localDateString,
  localHourString,
  findInDateArray,
  findInHourArray,
  attachSunshine,
  overlayFromOpenMeteo,
  sunshineFractions,
  sunshineFromLuxHistory,
} from '../src/sunshine-source.js';

describe('dayLengthHours', () => {
  it('returns 12 hours at the equator (any date)', () => {
    expect(dayLengthHours(0, new Date(2026, 5, 21))).toBeCloseTo(12, 1);
    expect(dayLengthHours(0, new Date(2026, 11, 21))).toBeCloseTo(12, 1);
  });

  it('returns ~15.7 h at Zürich on summer solstice (canonical reference)', () => {
    // Issue #6 plan §7 cites this as a verification anchor.
    const zurich = 47.37;
    const summerSolstice = new Date(2026, 5, 21); // 21 Jun 2026
    expect(dayLengthHours(zurich, summerSolstice)).toBeCloseTo(15.7, 0);
  });

  it('returns ~8.5 h at Zürich on winter solstice', () => {
    const zurich = 47.37;
    const winterSolstice = new Date(2026, 11, 21);
    expect(dayLengthHours(zurich, winterSolstice)).toBeCloseTo(8.5, 0);
  });

  it('handles polar night (24-hour darkness) with 0 hours', () => {
    // 80°N at winter solstice — sun never rises.
    const result = dayLengthHours(80, new Date(2026, 11, 21));
    expect(result).toBe(0);
  });

  it('handles midnight sun (24-hour daylight) with 24 hours', () => {
    const result = dayLengthHours(80, new Date(2026, 5, 21));
    expect(result).toBe(24);
  });

  it('falls back to 12 h for non-finite latitude', () => {
    expect(dayLengthHours(NaN, new Date())).toBe(12);
    expect(dayLengthHours(undefined, new Date())).toBe(12);
  });

  it('falls back to 12 h for invalid date', () => {
    expect(dayLengthHours(47, new Date('invalid'))).toBe(12);
  });

  it('northern and southern hemispheres are mirrored', () => {
    const summer = new Date(2026, 5, 21);
    const north = dayLengthHours(47, summer);
    const south = dayLengthHours(-47, summer);
    expect(north + south).toBeCloseTo(24, 0);
  });
});

describe('normalizeSunshineValue', () => {
  it('returns null for nullish / non-numeric / NaN', () => {
    expect(normalizeSunshineValue(null)).toBe(null);
    expect(normalizeSunshineValue(undefined)).toBe(null);
    expect(normalizeSunshineValue('not-a-number')).toBe(null);
    expect(normalizeSunshineValue('')).toBe(null);
    expect(normalizeSunshineValue(NaN)).toBe(null);
  });

  it('treats values < 30 as hours (already)', () => {
    expect(normalizeSunshineValue(0)).toBe(0);
    expect(normalizeSunshineValue(7.5)).toBe(7.5);
    expect(normalizeSunshineValue(15.7)).toBe(15.7);
    expect(normalizeSunshineValue(24)).toBe(24);
    expect(normalizeSunshineValue(29.9)).toBe(29.9);
  });

  it('treats values ≥ 30 as seconds and converts to hours', () => {
    // Open-Meteo daily=sunshine_duration emits seconds.
    expect(normalizeSunshineValue(30)).toBeCloseTo(30 / 3600, 4);
    expect(normalizeSunshineValue(3600)).toBe(1);
    expect(normalizeSunshineValue(28800)).toBe(8);
    // Round-trip a typical clear summer day's seconds total → ~14h.
    expect(normalizeSunshineValue(50400)).toBeCloseTo(14, 4);
  });

  it('parses numeric strings (sensor.state is always a string)', () => {
    expect(normalizeSunshineValue('7.5')).toBe(7.5);
    expect(normalizeSunshineValue('28800')).toBe(8);
  });

  it('clamps negative values to zero (sensor noise / bad template)', () => {
    expect(normalizeSunshineValue(-0.1)).toBe(0);
    expect(normalizeSunshineValue(-3600)).toBe(0);
  });
});

describe('localDateString', () => {
  it('returns YYYY-MM-DD for a Date', () => {
    expect(localDateString(new Date(2026, 4, 5))).toBe('2026-05-05');
    expect(localDateString(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(localDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('parses ISO strings', () => {
    // Use a non-UTC-midnight time so timezones don't flip the date.
    const noon = new Date(2026, 4, 5, 12, 0, 0);
    expect(localDateString(noon.toISOString())).toBe('2026-05-05');
  });

  it('returns null for invalid dates', () => {
    expect(localDateString('garbage')).toBe(null);
    expect(localDateString(new Date('invalid'))).toBe(null);
  });
});

describe('localHourString', () => {
  it('returns YYYY-MM-DDTHH:00 for a Date', () => {
    expect(localHourString(new Date(2026, 4, 5, 14, 0, 0))).toBe('2026-05-05T14:00');
    expect(localHourString(new Date(2026, 4, 5, 0, 0, 0))).toBe('2026-05-05T00:00');
    expect(localHourString(new Date(2026, 4, 5, 23, 0, 0))).toBe('2026-05-05T23:00');
  });

  it('rounds the minutes off (drift on the entry datetime is fine)', () => {
    expect(localHourString(new Date(2026, 4, 5, 14, 30, 15))).toBe('2026-05-05T14:00');
  });

  it('returns null for invalid dates', () => {
    expect(localHourString('garbage')).toBe(null);
  });
});

describe('findInHourArray', () => {
  it('matches by YYYY-MM-DDTHH (Open-Meteo emits :MM, we slice to :HH)', () => {
    const arr = [
      { datetime: '2026-05-05T12:00', value: 3600 },
      { datetime: '2026-05-05T13:00', value: 1800 },
    ];
    expect(findInHourArray(arr, '2026-05-05T12:00')).toBe(1); // 3600 s = 1 h
    expect(findInHourArray(arr, '2026-05-05T13:00')).toBe(0.5);
  });

  it('returns null for unmatched / malformed lookups', () => {
    expect(findInHourArray(null, '2026-05-05T12:00')).toBe(null);
    expect(findInHourArray([], '2026-05-05T12:00')).toBe(null);
    expect(findInHourArray([{ datetime: '2026-05-05T12:00', value: 3600 }], null)).toBe(null);
    expect(findInHourArray([{ datetime: '2026-05-05T12:00', value: 3600 }], '2026-05-06T12:00')).toBe(null);
  });

  it('handles malformed entries without throwing', () => {
    const arr = [null, 'string', { /* no datetime */ }, { datetime: '2026-05-05T12:00', value: 1800 }];
    expect(findInHourArray(arr, '2026-05-05T12:00')).toBe(0.5);
  });
});

describe('findInDateArray', () => {
  it('returns null for missing array / date', () => {
    expect(findInDateArray(null, '2026-05-05')).toBe(null);
    expect(findInDateArray([{ date: '2026-05-05', value: 7 }], null)).toBe(null);
  });

  it('matches the canonical {date, value} shape', () => {
    const arr = [
      { date: '2026-05-04', value: 6 },
      { date: '2026-05-05', value: 7.2 },
      { date: '2026-05-06', value: 5 },
    ];
    expect(findInDateArray(arr, '2026-05-05')).toBe(7.2);
    expect(findInDateArray(arr, '2026-05-99')).toBe(null);
  });

  it('matches {datetime, value} (ISO timestamp prefix)', () => {
    const arr = [
      { datetime: '2026-05-05T00:00:00+02:00', value: 8.1 },
      { datetime: '2026-05-06T00:00:00+02:00', value: 4.0 },
    ];
    expect(findInDateArray(arr, '2026-05-05')).toBe(8.1);
  });

  it('matches the [date, value] tuple form', () => {
    const arr = [
      ['2026-05-05', 9],
      ['2026-05-06', 3],
    ];
    expect(findInDateArray(arr, '2026-05-05')).toBe(9);
  });

  it('matches an object-map {YYYY-MM-DD: value}', () => {
    const obj = { '2026-05-05': 7, '2026-05-06': 4 };
    expect(findInDateArray(obj, '2026-05-05')).toBe(7);
    expect(findInDateArray(obj, '2026-05-07')).toBe(null);
  });

  it('unwraps a {history: [...]} envelope', () => {
    const arr = { history: [{ date: '2026-05-05', value: 6 }] };
    expect(findInDateArray(arr, '2026-05-05')).toBe(6);
  });

  it('unwraps a {forecast: [...]} envelope (HA weather-shape symmetry)', () => {
    const arr = { forecast: [{ date: '2026-05-05', value: 6 }] };
    expect(findInDateArray(arr, '2026-05-05')).toBe(6);
  });

  it('honours alternate value-key names (sunshine, duration, sunshine_duration)', () => {
    expect(findInDateArray([{ date: '2026-05-05', sunshine: 7 }], '2026-05-05')).toBe(7);
    expect(findInDateArray([{ date: '2026-05-05', duration: 7 }], '2026-05-05')).toBe(7);
    expect(findInDateArray([{ date: '2026-05-05', sunshine_duration: 7 }], '2026-05-05')).toBe(7);
  });

  it('normalizes seconds → hours via normalizeSunshineValue when matched', () => {
    // 28800 s = 8 h
    expect(findInDateArray([{ date: '2026-05-05', value: 28800 }], '2026-05-05')).toBe(8);
  });

  it('skips malformed entries without throwing', () => {
    const arr = [
      null,
      undefined,
      'string',
      { date: '2026-05-05', value: 7 },
      { /* no date */ value: 99 },
    ];
    expect(findInDateArray(arr, '2026-05-05')).toBe(7);
  });
});

describe('attachSunshine', () => {
  // Pin "today" to a specific local date so the past/future split is
  // deterministic across when the test happens to run.
  const today = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const dayMs = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d;
  };
  const iso = (date) => date.toISOString();

  it('returns [] for non-array input', () => {
    expect(attachSunshine(null, {})).toEqual([]);
    expect(attachSunshine(undefined, {})).toEqual([]);
  });

  it('passes through forecasts with sunshine=null when no opts given', () => {
    const fc = [{ datetime: iso(dayMs(-1)), temperature: 15 }];
    const result = attachSunshine(fc);
    expect(result).toHaveLength(1);
    expect(result[0].temperature).toBe(15);
  });

  it('attaches day_length for each entry', () => {
    const fc = [
      { datetime: iso(dayMs(-1)) },
      { datetime: iso(dayMs(0)) },
      { datetime: iso(dayMs(1)) },
    ];
    const result = attachSunshine(fc, { latitude: 47.37 });
    expect(result.every((e) => Number.isFinite(e.day_length))).toBe(true);
    expect(result[0].day_length).toBeGreaterThan(0);
    expect(result[0].day_length).toBeLessThanOrEqual(24);
  });

  it('sets sunshine=null and day_length=null for entries with invalid datetime', () => {
    const fc = [{ datetime: 'not-a-date' }];
    const [out] = attachSunshine(fc, { latitude: 47, dailyValues: [] });
    expect(out.sunshine).toBe(null);
    expect(out.day_length).toBe(null);
  });

  it('uses dailyValues for past + today + forecast columns alike', () => {
    const fc = [
      { datetime: iso(dayMs(-2)) }, // past
      { datetime: iso(dayMs(-1)) }, // past
      { datetime: iso(dayMs(0)) },  // today
      { datetime: iso(dayMs(1)) },  // forecast
      { datetime: iso(dayMs(2)) },  // forecast
    ];
    const dailyValues = [
      { date: localDateString(dayMs(-2)), value: 3.1 },
      { date: localDateString(dayMs(-1)), value: 5.9 },
      { date: localDateString(dayMs(0)), value: 7.0 },
      { date: localDateString(dayMs(1)), value: 9.1 },
      { date: localDateString(dayMs(2)), value: 4.0 },
    ];
    const result = attachSunshine(fc, { dailyValues, latitude: 47 });
    expect(result.map((r) => r.sunshine)).toEqual([3.1, 5.9, 7.0, 9.1, 4.0]);
  });

  it('omits columns silently when no dailyValues given (sunshine stays null)', () => {
    const fc = [{ datetime: iso(dayMs(0)) }, { datetime: iso(dayMs(1)) }];
    const result = attachSunshine(fc, { latitude: 47 });
    expect(result[0].sunshine).toBe(null);
    expect(result[1].sunshine).toBe(null);
  });

  it('caps each value at the day length (no 26-hour days)', () => {
    const fc = [{ datetime: iso(dayMs(-1)) }];
    // 99 hours of sun in a single day — clearly bogus.
    const dailyValues = [{ date: localDateString(dayMs(-1)), value: 99 }];
    const result = attachSunshine(fc, { dailyValues, latitude: 47 });
    expect(result[0].sunshine).toBeLessThanOrEqual(result[0].day_length);
  });

  it('clamps negative values to zero', () => {
    const fc = [{ datetime: iso(dayMs(-1)) }];
    const dailyValues = [{ date: localDateString(dayMs(-1)), value: -1 }];
    const result = attachSunshine(fc, { dailyValues, latitude: 47 });
    expect(result[0].sunshine).toBe(0);
  });

  it('returns a new array — does not mutate the input forecasts', () => {
    const original = [{ datetime: iso(dayMs(-1)), temperature: 10 }];
    const result = attachSunshine(original, { latitude: 47 });
    expect(result).not.toBe(original);
    expect(result[0]).not.toBe(original[0]);
    expect(original[0].sunshine).toBeUndefined();
  });

  it('normalizes seconds → hours via the same auto-detect as scalar sensors', () => {
    // 28800 s = 8 h. Open-Meteo emits sunshine_duration in seconds.
    const fc = [{ datetime: iso(dayMs(0)) }];
    const dailyValues = [{ date: localDateString(dayMs(0)), value: 28800 }];
    const result = attachSunshine(fc, { dailyValues, latitude: 47 });
    expect(result[0].sunshine).toBe(8);
  });

  describe('upstream-value preservation (issue #16)', () => {
    // _buildForecast (data-source) now emits a `sunshine` value for
    // station entries from a configured sensors.sunshine_duration
    // recorder source — but emits null for today's entry because the
    // recorder's daily-max-so-far is a partial running total. The
    // overlay attaches Open-Meteo's daily forecast value where the
    // upstream is null, and PRESERVES the recorder value where it's
    // present.

    it('preserves a numeric upstream sunshine value (e.g. recorder daily-max from yesterday)', () => {
      const fc = [{ datetime: iso(dayMs(-1)), sunshine: 6.5 }];
      // Open-Meteo would also have a value for that date; the
      // overlay must NOT overwrite the recorder's measured number.
      const dailyValues = [{ date: localDateString(dayMs(-1)), value: 28800 }]; // 8h forecast
      const result = attachSunshine(fc, { dailyValues, latitude: 47 });
      expect(result[0].sunshine).toBe(6.5);
    });

    it('overlays the Open-Meteo value when upstream is null (today substitution)', () => {
      const fc = [{ datetime: iso(dayMs(0)), sunshine: null }];
      // Open-Meteo's daily-forecast for today: 8h.
      const dailyValues = [{ date: localDateString(dayMs(0)), value: 28800 }];
      const result = attachSunshine(fc, { dailyValues, latitude: 47 });
      expect(result[0].sunshine).toBe(8);
    });

    it('overlays when upstream is undefined (no sensors.sunshine_duration configured)', () => {
      const fc = [{ datetime: iso(dayMs(0)) }];
      const dailyValues = [{ date: localDateString(dayMs(0)), value: 28800 }];
      const result = attachSunshine(fc, { dailyValues, latitude: 47 });
      expect(result[0].sunshine).toBe(8);
    });

    it('mixed-source array: past days from recorder, today from overlay', () => {
      const fc = [
        { datetime: iso(dayMs(-2)), sunshine: 4.2 },
        { datetime: iso(dayMs(-1)), sunshine: 6.5 },
        { datetime: iso(dayMs(0)), sunshine: null }, // today — recorder skipped
      ];
      const dailyValues = [
        { date: localDateString(dayMs(-2)), value: 18000 }, // would have been 5h
        { date: localDateString(dayMs(-1)), value: 28800 }, // would have been 8h
        { date: localDateString(dayMs(0)), value: 32400 },  // 9h forecast for today
      ];
      const result = attachSunshine(fc, { dailyValues, latitude: 47 });
      expect(result[0].sunshine).toBe(4.2); // recorder preserved
      expect(result[1].sunshine).toBe(6.5); // recorder preserved
      expect(result[2].sunshine).toBe(9);   // today filled from overlay
    });
  });

  describe('hourly granularity', () => {
    // Build a Date at a specific hour today.
    const hourAt = (h) => {
      const d = new Date(today);
      d.setHours(h, 0, 0, 0);
      return d;
    };
    const hourIso = (h) => hourAt(h).toISOString();
    const hourKey = (h) => localHourString(hourAt(h));

    it('matches each hourly entry against hourlyValues by hour key', () => {
      const fc = [
        { datetime: hourIso(12) },
        { datetime: hourIso(13) },
        { datetime: hourIso(23) },
      ];
      const hourlyValues = [
        { datetime: hourKey(12), value: 3600 }, // full hour of sun
        { datetime: hourKey(13), value: 1800 }, // half hour
        // 23:00 absent — night
      ];
      const result = attachSunshine(fc, {
        hourlyValues, latitude: 47, granularity: 'hourly',
      });
      expect(result[0].sunshine).toBe(1);
      expect(result[1].sunshine).toBe(0.5);
      expect(result[2].sunshine).toBe(null);
    });

    it('sets day_length to 1h for every hourly entry', () => {
      const fc = [{ datetime: hourIso(12) }, { datetime: hourIso(0) }];
      const hourlyValues = [];
      const result = attachSunshine(fc, {
        hourlyValues, latitude: 47, granularity: 'hourly',
      });
      expect(result[0].day_length).toBe(1);
      expect(result[1].day_length).toBe(1);
    });

    it('caps over-1h hourly values (defensive — should never happen in practice)', () => {
      const fc = [{ datetime: hourIso(12) }];
      const hourlyValues = [{ datetime: hourKey(12), value: 7200 }]; // 2h in 1h bucket
      const result = attachSunshine(fc, {
        hourlyValues, latitude: 47, granularity: 'hourly',
      });
      expect(result[0].sunshine).toBe(1);
    });

    it('does NOT match daily entries when granularity is hourly', () => {
      const fc = [{ datetime: hourIso(12) }];
      const dailyValues = [{ date: localDateString(today), value: 28800 }];
      const result = attachSunshine(fc, {
        dailyValues, latitude: 47, granularity: 'hourly',
      });
      // No hourlyValues → null even though daily would match.
      expect(result[0].sunshine).toBe(null);
    });

    it('does NOT match hourly entries when granularity is daily (default)', () => {
      const fc = [{ datetime: hourIso(12) }];
      const hourlyValues = [{ datetime: hourKey(12), value: 3600 }];
      const result = attachSunshine(fc, {
        hourlyValues, latitude: 47, // granularity defaults daily
      });
      // Daily lookup falls through — would need dailyValues.
      expect(result[0].sunshine).toBe(null);
    });
  });
});

describe('overlayFromOpenMeteo', () => {
  const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const dayMs = (off) => {
    const d = new Date(today); d.setDate(d.getDate() + off); return d;
  };
  const iso = (d) => d.toISOString();

  // Stand-in for OpenMeteoSunshineSource — only getDailyValues is
  // exercised, so we don't need the full lifecycle for these tests.
  const makeSource = (values) => ({ getDailyValues: () => values });

  it('plumbs the source\'s daily values onto matching past + future entries', () => {
    const forecasts = [
      { datetime: iso(dayMs(-1)) },
      { datetime: iso(dayMs(0)) },
      { datetime: iso(dayMs(1)) },
    ];
    const source = makeSource([
      { date: localDateString(dayMs(-1)), value: 5.5 },
      { date: localDateString(dayMs(0)), value: 7.2 },
      { date: localDateString(dayMs(1)), value: 9.1 },
    ]);
    const hass = { config: { latitude: 46.91 } };
    const out = overlayFromOpenMeteo(forecasts, hass, source);
    expect(out.map((r) => r.sunshine)).toEqual([5.5, 7.2, 9.1]);
  });

  it('returns sunshine=null for entries the source has no value for', () => {
    const forecasts = [
      { datetime: iso(dayMs(0)) },
      { datetime: iso(dayMs(7)) },
    ];
    const source = makeSource([
      { date: localDateString(dayMs(0)), value: 7 },
      // Day +7 not in source.
    ]);
    const out = overlayFromOpenMeteo(forecasts, { config: { latitude: 47 } }, source);
    expect(out[0].sunshine).toBe(7);
    expect(out[1].sunshine).toBe(null);
  });

  it('handles a hass object with no config gracefully', () => {
    const forecasts = [{ datetime: iso(dayMs(0)) }];
    const source = makeSource([{ date: localDateString(dayMs(0)), value: 5 }]);
    const out = overlayFromOpenMeteo(forecasts, {}, source);
    expect(out[0].sunshine).toBe(5);
    // day_length falls back to 12h equinox default when no latitude.
    expect(out[0].day_length).toBe(12);
  });

  it('survives a null / undefined source (empty cache state)', () => {
    const forecasts = [{ datetime: iso(dayMs(0)) }];
    const out = overlayFromOpenMeteo(forecasts, { config: { latitude: 47 } }, null);
    expect(out[0].sunshine).toBe(null);
    expect(out[0].day_length).toBeGreaterThan(0);
  });

  it('normalizes Open-Meteo seconds → hours through the source', () => {
    // Open-Meteo emits seconds; parseDailySunshine doesn't normalize,
    // attachSunshine does at lookup time.
    const forecasts = [{ datetime: iso(dayMs(0)) }];
    const source = makeSource([{ date: localDateString(dayMs(0)), value: 28800 }]);
    const out = overlayFromOpenMeteo(forecasts, { config: { latitude: 47 } }, source);
    expect(out[0].sunshine).toBe(8);
  });

  it('plumbs hourly values when granularity is hourly', () => {
    const hourAt = (h) => { const d = new Date(today); d.setHours(h, 0, 0, 0); return d; };
    const forecasts = [
      { datetime: hourAt(12).toISOString() },
      { datetime: hourAt(23).toISOString() },
    ];
    const sourceWithHourly = {
      getDailyValues: () => [],
      getHourlyValues: () => [
        { datetime: localHourString(hourAt(12)), value: 3600 },
      ],
    };
    const out = overlayFromOpenMeteo(
      forecasts, { config: { latitude: 47 } }, sourceWithHourly, 'hourly',
    );
    expect(out[0].sunshine).toBe(1);
    expect(out[1].sunshine).toBe(null); // 23:00 missing → no sun
  });
});

describe('sunshineFractions', () => {
  it('returns 0..1 fractions of day length', () => {
    expect(sunshineFractions([6, 12, 9], [12, 14, 10])).toEqual([
      0.5,
      12 / 14,
      0.9,
    ]);
  });

  it('clamps over-1 values (defensive — attachSunshine already caps)', () => {
    expect(sunshineFractions([15], [12])).toEqual([1]);
  });

  it('clamps below-0 values to zero', () => {
    expect(sunshineFractions([-1], [12])).toEqual([0]);
  });

  it('preserves null in the sunshine array (Chart.js draws a gap)', () => {
    expect(sunshineFractions([null, 5], [12, 12])).toEqual([null, 5 / 12]);
  });

  it('returns null when day length is missing / zero / non-finite', () => {
    expect(sunshineFractions([5, 5, 5, 5], [null, 0, NaN, undefined])).toEqual([
      null, null, null, null,
    ]);
  });

  it('handles empty / non-array input', () => {
    expect(sunshineFractions(null, null)).toEqual([]);
    expect(sunshineFractions(undefined, undefined)).toEqual([]);
    expect(sunshineFractions([], [])).toEqual([]);
  });

  it('does not throw when dayLength array is shorter than sunshine array', () => {
    // Defensive — call sites should always pass aligned arrays, but
    // a length mismatch shouldn't crash the chart.
    expect(sunshineFractions([5, 6, 7], [12])).toEqual([5 / 12, null, null]);
  });

  it('nulls out malformed sunshine values (NaN, string, object) — no NaN bars', () => {
    // A malformed value must come out as a gap, not as a NaN bar
    // height that would poison the SunshineAxis scale.
    expect(sunshineFractions([NaN, 'unavailable', {}, 6], [12, 12, 12, 12]))
      .toEqual([null, null, null, 0.5]);
  });
});

describe('sunshineFromLuxHistory (#66 Method B2)', () => {
  // Köniz / Bern (CLAUDE.md location): 46.91°N, 7.42°E.
  const LAT = 46.91;
  const LON = 7.42;
  const MIN = 60 * 1000;

  // Build a deterministic local-noon timestamp for a known summer day —
  // far from sunrise / sunset so the clearsky_lux is well above 0.
  function summerNoon() {
    const d = new Date(2026, 5, 21, 12, 0, 0, 0); // June 21 local
    return d.getTime();
  }

  it('returns [] for empty / single-sample input', () => {
    expect(sunshineFromLuxHistory([], LAT, LON)).toEqual([]);
    expect(sunshineFromLuxHistory([{ ts: 0, lux: 50000 }], LAT, LON)).toEqual([]);
  });

  it('returns [] for missing lat / lon', () => {
    const samples = [
      { ts: summerNoon(), lux: 80000 },
      { ts: summerNoon() + MIN, lux: 80000 },
    ];
    expect(sunshineFromLuxHistory(samples, NaN, LON)).toEqual([]);
    expect(sunshineFromLuxHistory(samples, LAT, NaN)).toEqual([]);
  });

  it('counts an above-threshold interval at solar noon as sunshine', () => {
    // 10 minutes of constant 80 000 lx at noon — clearsky ≈ 100 000 lx.
    // Ratio 0.8 ≥ 0.6 default → all 10 min counted.
    const start = summerNoon();
    const samples = [];
    for (let i = 0; i <= 10; i++) {
      samples.push({ ts: start + i * MIN, lux: 80000 });
    }
    const result = sunshineFromLuxHistory(samples, LAT, LON);
    expect(result).toHaveLength(1);
    expect(result[0].hours).toBeCloseTo(10 / 60, 5);
  });

  it('skips intervals below threshold (overcast)', () => {
    const start = summerNoon();
    const samples = [];
    for (let i = 0; i <= 10; i++) {
      // 20 000 lx at noon is ~0.2 ratio — well below default 0.6.
      samples.push({ ts: start + i * MIN, lux: 20000 });
    }
    expect(sunshineFromLuxHistory(samples, LAT, LON)).toEqual([]);
  });

  it('respects a custom threshold (lower → more sunshine counted)', () => {
    const start = summerNoon();
    // 50 000 lx at noon ≈ 0.5 ratio — below default 0.6, above 0.4.
    const samples = [];
    for (let i = 0; i <= 10; i++) {
      samples.push({ ts: start + i * MIN, lux: 50000 });
    }
    expect(sunshineFromLuxHistory(samples, LAT, LON, 0.6)).toEqual([]);
    const out = sunshineFromLuxHistory(samples, LAT, LON, 0.4);
    expect(out).toHaveLength(1);
    expect(out[0].hours).toBeGreaterThan(0);
  });

  it('skips pathological gaps longer than maxIntervalMs (default 10 min)', () => {
    const start = summerNoon();
    const samples = [
      { ts: start, lux: 80000 },
      { ts: start + 30 * MIN, lux: 80000 }, // 30-min gap — skip
      { ts: start + 31 * MIN, lux: 80000 }, // 1-min gap right after — count
    ];
    const result = sunshineFromLuxHistory(samples, LAT, LON);
    expect(result).toHaveLength(1);
    // Only the second pair (1 min) counts, not the 30-min skip.
    expect(result[0].hours).toBeCloseTo(1 / 60, 5);
  });

  it('returns 0 sunshine at night even with bright lux readings (clearsky=0 path)', () => {
    // 03:00 in summer — sun below horizon at 46.91°N: clearsky_lux is 0.
    const night = new Date(2026, 5, 21, 3, 0, 0, 0).getTime();
    const samples = [
      { ts: night, lux: 80000 }, // anomalous bright reading at 03:00 (e.g. headlights)
      { ts: night + MIN, lux: 80000 },
    ];
    expect(sunshineFromLuxHistory(samples, LAT, LON)).toEqual([]);
  });

  it('buckets samples by local date — multiple days in one history pull', () => {
    const day1Noon = new Date(2026, 5, 21, 12, 0, 0, 0).getTime();
    const day2Noon = new Date(2026, 5, 22, 12, 0, 0, 0).getTime();
    const samples = [
      { ts: day1Noon, lux: 80000 },
      { ts: day1Noon + MIN, lux: 80000 },
      { ts: day2Noon, lux: 80000 },
      { ts: day2Noon + MIN, lux: 80000 },
    ];
    const result = sunshineFromLuxHistory(samples, LAT, LON);
    expect(result).toHaveLength(2);
    expect(result[0].date < result[1].date).toBe(true);
    expect(result[0].hours).toBeCloseTo(1 / 60, 5);
    expect(result[1].hours).toBeCloseTo(1 / 60, 5);
  });

  it('is robust to malformed samples (non-finite, negative, out-of-order)', () => {
    const start = summerNoon();
    const samples = [
      { ts: NaN, lux: 80000 },
      { ts: start + MIN, lux: 80000 },
      { ts: start, lux: 80000 },
      { ts: start + 2 * MIN, lux: -50 }, // negative — filtered
      { ts: start + 3 * MIN, lux: 80000 },
    ];
    expect(() => sunshineFromLuxHistory(samples, LAT, LON)).not.toThrow();
    const result = sunshineFromLuxHistory(samples, LAT, LON);
    // After filtering NaN and negative, valid samples are at start, +1m,
    // and +3m. The first interval (1 min) is sunshine; the second
    // interval (2 min) — but second sample paired with the +3m bumps
    // up against the maxIntervalMs default still under 10 min so it
    // counts.
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

