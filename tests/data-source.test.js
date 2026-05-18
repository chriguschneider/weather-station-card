import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bucketPrecipitation, MeasuredDataSource, ForecastDataSource } from '../src/data-source.js';
import { WeatherEntityFeature } from '../src/const.js';

describe('bucketPrecipitation', () => {
  const day = (props) => ({ start: '2026-05-01T00:00:00', ...props });
  const series = (entries) => {
    const m = new Map();
    for (const [key, props] of Object.entries(entries)) {
      m.set(Number(key), day(props));
    }
    return m;
  };

  it('returns null when sensor has no map', () => {
    expect(bucketPrecipitation(undefined, 100, 99)).toBe(null);
    expect(bucketPrecipitation(null, 100, 99)).toBe(null);
  });

  it('returns null when today bucket missing', () => {
    expect(bucketPrecipitation(series({ 99: { max: 5 } }), 100, 99)).toBe(null);
  });

  it('uses `change` for total_increasing sensors', () => {
    expect(bucketPrecipitation(series({ 100: { change: 2.4, max: 30 } }), 100, 99)).toBe(2.4);
  });

  it('uses `sum` for total sensors when change absent', () => {
    expect(bucketPrecipitation(series({ 100: { sum: 1.7, max: 5 } }), 100, 99)).toBe(1.7);
  });

  it('falls back to today.max−prev.max for measurement sensors', () => {
    const s = series({ 100: { max: 30 }, 99: { max: 25 } });
    expect(bucketPrecipitation(s, 100, 99)).toBe(5);
  });

  it('returns today.max when previous bucket is missing (no baseline)', () => {
    expect(bucketPrecipitation(series({ 100: { max: 30 } }), 100, 99)).toBe(30);
  });

  it('returns today.max when delta is negative (counter reset)', () => {
    const s = series({ 100: { max: 5 }, 99: { max: 30 } });
    expect(bucketPrecipitation(s, 100, 99)).toBe(5);
  });

  it('returns null when today has no usable field', () => {
    expect(bucketPrecipitation(series({ 100: {} }), 100, 99)).toBe(null);
  });

  it('works for hourly buckets — change path', () => {
    // Hour keys: e.g. ms-since-epoch at the hour. Function is key-agnostic.
    const hourMs = 1716393600000;
    const prevHourMs = hourMs - 3600_000;
    const m = new Map();
    m.set(hourMs, { change: 0.3, max: 10 });
    expect(bucketPrecipitation(m, hourMs, prevHourMs)).toBe(0.3);
  });

  it('works for hourly buckets — measurement diff with reset', () => {
    const hourMs = 1716393600000;
    const prevHourMs = hourMs - 3600_000;
    const m = new Map();
    m.set(hourMs, { max: 2 });
    m.set(prevHourMs, { max: 25 }); // counter reset between hours
    expect(bucketPrecipitation(m, hourMs, prevHourMs)).toBe(2);
  });
});

describe('MeasuredDataSource._buildForecast', () => {
  // Build a stable wall-clock so dayKey alignment between fixture and code
  // is deterministic across timezones (we only care about local midnight).
  const startDay = new Date(2026, 4, 1, 0, 0, 0, 0); // May 1, local midnight
  const dayMs = (offsetDays) => {
    const d = new Date(startDay);
    d.setDate(startDay.getDate() + offsetDays);
    return { date: d, key: d.getTime() };
  };

  const fakeHass = {
    config: { latitude: 47.4 },
    callWS: vi.fn(),
  };

  const sensors = {
    temperature: 'sensor.temp',
    humidity: 'sensor.hum',
    illuminance: 'sensor.lux',
    precipitation: 'sensor.rain',
    pressure: 'sensor.pres',
    wind_speed: 'sensor.wind',
    gust_speed: 'sensor.gust',
    wind_direction: 'sensor.dir',
    uv_index: 'sensor.uv',
    dew_point: 'sensor.dew',
  };

  it('produces one entry per requested day, in chronological order', () => {
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 3 });
    // Fixture: stats start at startDay (offset 0). Loop in _buildForecast
    // iterates i=1..days, so day starts come from offsets 1..3.
    const stats = {
      'sensor.temp': [
        { start: dayMs(1).date.toISOString(), max: 20, min: 10, mean: 15 },
        { start: dayMs(2).date.toISOString(), max: 22, min: 12, mean: 17 },
        { start: dayMs(3).date.toISOString(), max: 18, min: 8, mean: 13 },
      ],
    };
    const out = ds._buildForecast(stats, sensors, startDay, 3);
    expect(out).toHaveLength(3);
    expect(out[0].temperature).toBe(20);
    expect(out[1].temperature).toBe(22);
    expect(out[2].temperature).toBe(18);
    expect(out[0].templow).toBe(10);
  });

  it('returns null fields for days without data, never throws', () => {
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 3 });
    const stats = {
      'sensor.temp': [
        { start: dayMs(1).date.toISOString(), max: 20, min: 10, mean: 15 },
        // no entry for offset 2 → sensor offline that day
        { start: dayMs(3).date.toISOString(), max: 18, min: 8, mean: 13 },
      ],
    };
    const out = ds._buildForecast(stats, sensors, startDay, 3);
    expect(out).toHaveLength(3);
    expect(out[1].temperature).toBe(null);
    expect(out[1].templow).toBe(null);
    // Condition still gets classified — should fall through to 'cloudy'
    // (no precip / wind / fog / lux) without throwing.
    expect(typeof out[1].condition).toBe('string');
  });

  it('emits the canonical forecast shape', () => {
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 1 });
    const stats = {
      'sensor.temp': [{ start: dayMs(1).date.toISOString(), max: 20, min: 10, mean: 15 }],
    };
    const [entry] = ds._buildForecast(stats, sensors, startDay, 1);
    expect(entry).toEqual(expect.objectContaining({
      datetime: expect.any(String),
      temperature: expect.any(Number),
      templow: expect.any(Number),
      precipitation: null,
      condition: expect.any(String),
    }));
    expect('wind_speed' in entry).toBe(true);
    expect('humidity' in entry).toBe(true);
  });

  it("emits the recorder daily-max for today's sunshine bucket (#37 reverts the #16 substitution)", () => {
    const sensorsWithSunshine = { ...sensors, sunshine_duration: 'sensor.sun' };
    const ds = new MeasuredDataSource(fakeHass, { sensors: sensorsWithSunshine, days: 3 });
    // 3-day window starting at today's midnight: index 0 is "tomorrow" (skipped
    // by the loop's i=1 start), so out[0]..out[2] cover days+1..days+3.
    // We're verifying the today-bucket via the per-day loop reaching the
    // "today" key — which is the entry whose dayKey equals startDay's local
    // midnight + 1 day == dayMs(1).date in this fixture's timeline.
    const todayStart = dayMs(1).date;
    const stats = {
      'sensor.sun': [
        // Pretend "today" is the value at offset 1 with a partial value
        // (e.g. 0.4 h at 10 am — sunshine-so-far).
        { start: todayStart.toISOString(), max: 1440 }, // 1440 s = 0.4 h
      ],
    };
    const out = ds._buildForecast(stats, sensorsWithSunshine, startDay, 3);
    // The first emitted day uses the recorder running daily-max for sunshine,
    // not null (the previous behaviour from #16). #37 reverts that — empirical
    // truth even when small early in the day.
    expect(out[0].sunshine).toBe(1440);
  });

  it('falls back to the lux-derivation map when no sunshine_duration sensor is set (#66 B2)', () => {
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 3 });
    const stats = {};
    // Pre-computed lux-derivation result (as if `_fetchLuxSunshine`
    // returned this map). Keys are local-date YYYY-MM-DD.
    const dayStart = dayMs(1).date;
    const dayKey = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
    const luxByDate = new Map([[dayKey, 7.5]]); // 7.5 h of sunshine
    const out = ds._buildForecast(stats, sensors, startDay, 3, luxByDate);
    expect(out[0].sunshine).toBe(7.5);
  });

  it('recorder sunshine_duration sensor still wins over the lux-derivation map (#66 precedence)', () => {
    const sensorsWithSunshine = { ...sensors, sunshine_duration: 'sensor.sun' };
    const ds = new MeasuredDataSource(fakeHass, { sensors: sensorsWithSunshine, days: 3 });
    const todayStart = dayMs(1).date;
    const stats = {
      'sensor.sun': [{ start: todayStart.toISOString(), max: 999 }],
    };
    const dayKey = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;
    const luxByDate = new Map([[dayKey, 7.5]]);
    const out = ds._buildForecast(stats, sensorsWithSunshine, startDay, 3, luxByDate);
    // Method C (recorder sensor) wins — 999, not 7.5.
    expect(out[0].sunshine).toBe(999);
  });

  it('emits 0 (not null) when an illuminance source is configured but resolves no value — the source is authoritative', () => {
    // A configured station sunshine source (here: illuminance, driving
    // the lux derivation) owns the station columns. A day it finds no
    // sunshine for is 0 h measured, NOT "no data" — otherwise the
    // Open-Meteo overlay (attachSunshine) overwrites the station column
    // with a forecast value. That is the overcast-morning bug: the lux
    // derivation finds no above-threshold interval, emits no entry, and
    // the station-today column borrows the full-day forecast.
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 3 });
    const out = ds._buildForecast({}, sensors, startDay, 3, new Map());
    expect(out[0].sunshine).toBe(0);
  });

  it('emits 0 when a sunshine_duration sensor is configured but the recorder has no bucket for the day', () => {
    const sensorsWithSunshine = { ...sensors, sunshine_duration: 'sensor.sun' };
    const ds = new MeasuredDataSource(fakeHass, { sensors: sensorsWithSunshine, days: 3 });
    // Empty stats → at(sensors.sunshine_duration, 'max') resolves null.
    // The sensor is configured, so the column is still 0 h, not forecast.
    const out = ds._buildForecast({}, sensorsWithSunshine, startDay, 3);
    expect(out[0].sunshine).toBe(0);
  });

  it('emits null sunshine only when NO station sunshine source is configured (overlay then fills it)', () => {
    // No illuminance, no sunshine_duration → the card has no measured
    // source for these columns, so null is correct: the Open-Meteo
    // overlay is the only data available and SHOULD fill them.
    const sensorsNoSun = { temperature: 'sensor.temp', precipitation: 'sensor.rain' };
    const ds = new MeasuredDataSource(fakeHass, { sensors: sensorsNoSun, days: 3 });
    const out = ds._buildForecast({}, sensorsNoSun, startDay, 3, null);
    expect(out[0].sunshine).toBeNull();
  });
});

describe('MeasuredDataSource._fetchLuxSunshine (#56 + #66)', () => {
  // Köniz / Bern (lat 46.91°N, lon 7.42°E) — well above the equator,
  // so clearsky_lux at noon in summer is ≈ 100 000 lx.
  const LAT = 46.91;
  const LON = 7.42;
  const HOUR_MS = 3600 * 1000;
  function summerNoonUTC() {
    return new Date('2026-06-21T10:00:00Z').getTime(); // ≈ 12:00 local in CH
  }

  function makeHass(callWSImpl) {
    return {
      config: { latitude: LAT, longitude: LON },
      callWS: vi.fn(callWSImpl),
    };
  }

  it('returns null when no illuminance sensor is configured', async () => {
    const ds = new MeasuredDataSource(makeHass(async () => ({})), { sensors: {} });
    const result = await ds._fetchLuxSunshine({}, new Date(0), new Date(1));
    expect(result).toBeNull();
  });

  it('returns null when sunshine_duration sensor is configured (Method C wins)', async () => {
    const sensors = { illuminance: 'sensor.lux', sunshine_duration: 'sensor.sun' };
    const ds = new MeasuredDataSource(makeHass(async () => ({})), { sensors });
    const result = await ds._fetchLuxSunshine(sensors, new Date(0), new Date(1));
    expect(result).toBeNull();
  });

  it('returns null when latitude / longitude are missing', async () => {
    const sensors = { illuminance: 'sensor.lux' };
    const hass = { config: {}, callWS: vi.fn() };
    const ds = new MeasuredDataSource(hass, { sensors });
    const result = await ds._fetchLuxSunshine(sensors, new Date(0), new Date(1));
    expect(result).toBeNull();
    expect(hass.callWS).not.toHaveBeenCalled();
  });

  it('returns null when the WS call rejects (recorder unavailable)', async () => {
    const sensors = { illuminance: 'sensor.lux' };
    const hass = makeHass(async () => { throw new Error('recorder offline'); });
    const ds = new MeasuredDataSource(hass, { sensors });
    const result = await ds._fetchLuxSunshine(sensors, new Date(0), new Date(1));
    expect(result).toBeNull();
  });

  it('returns null when fewer than 2 valid samples come back', async () => {
    const sensors = { illuminance: 'sensor.lux' };
    const hass = makeHass(async () => ({ 'sensor.lux': [{ s: '50000', lu: summerNoonUTC() / 1000 }] }));
    const ds = new MeasuredDataSource(hass, { sensors });
    const result = await ds._fetchLuxSunshine(sensors, new Date(0), new Date(1));
    expect(result).toBeNull();
  });

  it('aggregates above-threshold samples into a per-day map', async () => {
    const sensors = { illuminance: 'sensor.lux' };
    const t0 = summerNoonUTC();
    const samples = [];
    // 30-minute window of 80 000 lx at solar noon — well above the 0.6 ratio.
    for (let i = 0; i <= 30; i++) {
      samples.push({ s: '80000', lu: (t0 + i * 60 * 1000) / 1000 });
    }
    const hass = makeHass(async () => ({ 'sensor.lux': samples }));
    const ds = new MeasuredDataSource(hass, { sensors });
    const result = await ds._fetchLuxSunshine(sensors, new Date(t0 - HOUR_MS), new Date(t0 + HOUR_MS));
    expect(result).not.toBeNull();
    expect(result.size).toBeGreaterThanOrEqual(1);
    const totalHours = Array.from(result.values()).reduce((s, h) => s + h, 0);
    expect(totalHours).toBeGreaterThan(0);
  });

  it('honours the configured sunshine_lux_ratio threshold', async () => {
    const sensors = { illuminance: 'sensor.lux' };
    const t0 = summerNoonUTC();
    const samples = [];
    // 50 000 lx at noon — ratio ~0.5. Below default 0.6, above 0.4.
    for (let i = 0; i <= 30; i++) {
      samples.push({ s: '50000', lu: (t0 + i * 60 * 1000) / 1000 });
    }
    const hass = makeHass(async () => ({ 'sensor.lux': samples }));

    const dsDefault = new MeasuredDataSource(hass, { sensors });
    const r1 = await dsDefault._fetchLuxSunshine(sensors, new Date(t0 - HOUR_MS), new Date(t0 + HOUR_MS));
    // Default threshold 0.6 — 0.5 ratio doesn't qualify; empty per-day map.
    expect(r1?.size ?? 0).toBe(0);

    const dsLower = new MeasuredDataSource(hass, {
      sensors,
      condition_mapping: { sunshine_lux_ratio: 0.4 },
    });
    const r2 = await dsLower._fetchLuxSunshine(sensors, new Date(t0 - HOUR_MS), new Date(t0 + HOUR_MS));
    // Lower threshold 0.4 — qualifies.
    expect(r2).not.toBeNull();
    expect(r2.size).toBeGreaterThanOrEqual(1);
  });

  it('filters out malformed sample rows (non-string state, non-number lu)', async () => {
    const sensors = { illuminance: 'sensor.lux' };
    const t0 = summerNoonUTC();
    const samples = [
      { s: 'unavailable', lu: t0 / 1000 }, // parseFloat('unavailable') = NaN — filtered
      { s: '80000', lu: 'not-a-number' }, // typeof !== 'number' — filtered
      { s: '80000', lu: t0 / 1000 },       // valid
      { s: '80000', lu: (t0 + 60 * 1000) / 1000 }, // valid
    ];
    const hass = makeHass(async () => ({ 'sensor.lux': samples }));
    const ds = new MeasuredDataSource(hass, { sensors });
    // Only 2 valid samples — gives one interval, may or may not bucket
    // a non-zero day depending on timing — but no throw.
    await expect(ds._fetchLuxSunshine(sensors, new Date(t0 - HOUR_MS), new Date(t0 + HOUR_MS))).resolves.not.toThrow();
  });
});

describe('MeasuredDataSource hourly mode', () => {
  // Round to the next full hour, matching what _fetchAggregates does.
  const HOUR_MS = 3600_000;
  const startHour = (() => {
    const d = new Date(2026, 4, 1, 12, 0, 0, 0); // May 1, noon local
    return d;
  })();
  const hourMs = (offsetHours) => {
    const d = new Date(startHour.getTime() + offsetHours * HOUR_MS);
    return { date: d, key: d.getTime() };
  };

  const fakeHass = {
    config: { latitude: 47.4, longitude: 8.5 },
    callWS: vi.fn(),
  };

  const sensors = {
    temperature: 'sensor.temp',
    humidity: 'sensor.hum',
    illuminance: 'sensor.lux',
    precipitation: 'sensor.rain',
    pressure: 'sensor.pres',
    wind_speed: 'sensor.wind',
    gust_speed: 'sensor.gust',
    wind_direction: 'sensor.dir',
    uv_index: 'sensor.uv',
    dew_point: 'sensor.dew',
  };

  it('produces one entry per hour, in chronological order', () => {
    const ds = new MeasuredDataSource(fakeHass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    // _buildHourlyForecast iterates i=1..hours from `start`.
    const stats = {
      'sensor.temp': [
        { start: hourMs(1).date.toISOString(), max: 21, min: 19, mean: 20 },
        { start: hourMs(2).date.toISOString(), max: 22, min: 20, mean: 21 },
        { start: hourMs(3).date.toISOString(), max: 23, min: 21, mean: 22 },
      ],
    };
    const out = ds._buildHourlyForecast(stats, sensors, startHour, 3);
    expect(out).toHaveLength(3);
    // mean — single line at hourly
    expect(out[0].temperature).toBe(20);
    expect(out[1].temperature).toBe(21);
    expect(out[2].temperature).toBe(22);
  });

  it('omits templow on hourly entries (chart layer derives via rolling window)', () => {
    // Hourly station data-source emits only `temperature`. The
    // dual-line look for hourly / today comes from a 3-hour rolling
    // window over consecutive entries, computed in
    // hourlyTempSeries(...) with windowMode: true — keeps the
    // data-source layer focused on per-bucket extraction and lets
    // the chart layer handle the visual presentation.
    const ds = new MeasuredDataSource(fakeHass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    const stats = {
      'sensor.temp': [{ start: hourMs(1).date.toISOString(), max: 21, min: 19, mean: 20 }],
    };
    const [entry] = ds._buildHourlyForecast(stats, sensors, startHour, 1);
    expect(entry.temperature).toBe(20);
    expect('templow' in entry).toBe(false);
  });

  it('uses bucketPrecipitation for hourly precipitation', () => {
    const ds = new MeasuredDataSource(fakeHass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    const stats = {
      'sensor.rain': [
        { start: hourMs(1).date.toISOString(), change: 0.4 },
      ],
    };
    const [entry] = ds._buildHourlyForecast(stats, sensors, startHour, 1);
    expect(entry.precipitation).toBe(0.4);
  });

  it('returns null fields for hours without data, never throws', () => {
    const ds = new MeasuredDataSource(fakeHass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    // Stats only carries hour 1; hour 2 is missing entirely.
    const stats = {
      'sensor.temp': [{ start: hourMs(1).date.toISOString(), max: 21, min: 19, mean: 20 }],
    };
    const out = ds._buildHourlyForecast(stats, sensors, startHour, 2);
    expect(out).toHaveLength(2);
    expect(out[1].temperature).toBe(null);
    expect(typeof out[1].condition).toBe('string');
  });

  it('falls back to live state for the last hour when recorder bucket is missing', () => {
    // Recorder hourly stats lag — the still-in-progress current hour
    // typically has no entry. For the last hour we read the entity's
    // current state instead of leaving fields null.
    const hass = {
      config: { latitude: 47.4, longitude: 8.5 },
      states: {
        'sensor.temp': { state: '13.4' },
        'sensor.hum': { state: '78' },
        'sensor.wind': { state: '5.5' },
      },
      callWS: vi.fn(),
    };
    const ds = new MeasuredDataSource(hass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    // 3 hours requested. Recorder only has data for the first two
    // hours. The third (last) entry must be live-filled.
    const stats = {
      'sensor.temp': [
        { start: hourMs(1).date.toISOString(), max: 12, min: 11, mean: 11.5 },
        { start: hourMs(2).date.toISOString(), max: 13, min: 12, mean: 12.5 },
        // hour 3 missing — current partial hour
      ],
    };
    const out = ds._buildHourlyForecast(stats, sensors, startHour, 3);
    expect(out[0].temperature).toBe(11.5);
    expect(out[1].temperature).toBe(12.5);
    expect(out[2].temperature).toBe(13.4); // live state
    expect(out[2].humidity).toBe(78);
    expect(out[2].wind_speed).toBe(5.5);
  });

  it('falls back to live state for precipitation in the last hour', () => {
    const hass = {
      config: { latitude: 47.4, longitude: 8.5 },
      states: {
        'sensor.rain': { state: '721.3' }, // lifetime cumulative reading
      },
      callWS: vi.fn(),
    };
    const ds = new MeasuredDataSource(hass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    // Two hours requested. Hour 1 has a complete bucket; hour 2 (last,
    // current) has no bucket yet. The live state stands in for the
    // synthetic "current.max" so we can still compute the diff.
    const stats = {
      'sensor.rain': [
        { start: hourMs(1).date.toISOString(), max: 720.8 },
        // hour 2 missing — current partial hour
      ],
    };
    const out = ds._buildHourlyForecast(stats, sensors, startHour, 2);
    // 721.3 − 720.8 = 0.5 mm rain so far in the in-progress hour
    expect(out[1].precipitation).toBeCloseTo(0.5, 5);
  });

  it('historic missing hours stay null (no live-fill leak)', () => {
    const hass = {
      config: { latitude: 47.4, longitude: 8.5 },
      states: { 'sensor.temp': { state: '13.4' } },
      callWS: vi.fn(),
    };
    const ds = new MeasuredDataSource(hass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    // Historic hour 1 is missing; the LAST hour (2) is the only one
    // that should benefit from the live-fill.
    const stats = {
      'sensor.temp': [
        { start: hourMs(2).date.toISOString(), max: 13, min: 12, mean: 12.5 },
      ],
    };
    const out = ds._buildHourlyForecast(stats, sensors, startHour, 2);
    expect(out[0].temperature).toBe(null); // historic gap stays null
    expect(out[1].temperature).toBe(12.5); // recorder data wins over live state
  });

  it('emits the canonical forecast shape (no templow, has condition)', () => {
    const ds = new MeasuredDataSource(fakeHass, {
      sensors, days: 1, forecast: { type: 'hourly' },
    });
    const stats = {
      'sensor.temp': [{ start: hourMs(1).date.toISOString(), max: 21, min: 19, mean: 20 }],
    };
    const [entry] = ds._buildHourlyForecast(stats, sensors, startHour, 1);
    expect(entry).toEqual(expect.objectContaining({
      datetime: expect.any(String),
      temperature: expect.any(Number),
      precipitation: null,
      condition: expect.any(String),
    }));
    expect('wind_speed' in entry).toBe(true);
    expect('humidity' in entry).toBe(true);
  });

  it('_fetchAggregates requests period:hour with days*24 slots when hourly', async () => {
    const hass = {
      config: { latitude: 47.4, longitude: 8.5 },
      callWS: vi.fn().mockResolvedValue({}), // empty stats — we only check the request
    };
    const ds = new MeasuredDataSource(hass, {
      sensors, days: 2, forecast: { type: 'hourly' },
    });
    await ds._fetchAggregates();
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    const [msg] = hass.callWS.mock.calls[0];
    expect(msg.type).toBe('recorder/statistics_during_period');
    expect(msg.period).toBe('hour');
    // window: end - start should span (days*24 + 1) hours = 49 hours
    const startMs = new Date(msg.start_time).getTime();
    const endMs = new Date(msg.end_time).getTime();
    expect(Math.round((endMs - startMs) / HOUR_MS)).toBe(2 * 24 + 1);
  });

  it('_fetchAggregates falls back to period:day at default forecast.type', async () => {
    const hass = {
      config: { latitude: 47.4 },
      callWS: vi.fn().mockResolvedValue({}),
    };
    const ds = new MeasuredDataSource(hass, { sensors, days: 3 });
    await ds._fetchAggregates();
    const [msg] = hass.callWS.mock.calls[0];
    expect(msg.period).toBe('day');
  });

  // 'today' mode introduced in v1.4 (#17). The 12 h station / 12 h
  // forecast split applies when both blocks are visible — in
  // station-only the station expands to fill the full 24 h so the
  // user still sees a one-day view with no forecast block. Tests
  // verify the recorder window is sized correctly per branch.
  it("_fetchAggregates 'today' + combination → 13 h window (12+1 baseline)", async () => {
    const hass = {
      config: { latitude: 47.4, longitude: 8.5 },
      callWS: vi.fn().mockResolvedValue({}),
    };
    const ds = new MeasuredDataSource(hass, {
      sensors,
      forecast: { type: 'today' },
      show_forecast: true,
      show_station: true,
    });
    await ds._fetchAggregates();
    const [msg] = hass.callWS.mock.calls[0];
    expect(msg.period).toBe('hour');
    const startMs = new Date(msg.start_time).getTime();
    const endMs = new Date(msg.end_time).getTime();
    // 12 station hours + 1 baseline hour for cumulative-precipitation
    // diff = 13 hours total.
    expect(Math.round((endMs - startMs) / HOUR_MS)).toBe(13);
  });

  it("_fetchAggregates 'today' + station-only → 25 h window (24+1 baseline)", async () => {
    const hass = {
      config: { latitude: 47.4, longitude: 8.5 },
      callWS: vi.fn().mockResolvedValue({}),
    };
    const ds = new MeasuredDataSource(hass, {
      sensors,
      forecast: { type: 'today' },
      show_forecast: false,
      show_station: true,
    });
    await ds._fetchAggregates();
    const [msg] = hass.callWS.mock.calls[0];
    expect(msg.period).toBe('hour');
    const startMs = new Date(msg.start_time).getTime();
    const endMs = new Date(msg.end_time).getTime();
    // 24 hours back + 1 baseline = 25 hours.
    expect(Math.round((endMs - startMs) / HOUR_MS)).toBe(25);
  });

  it("_fetchAggregates 'today' ignores cfg days (always single-day horizon)", async () => {
    // User has days: 7 in their config but switches to 'today' — the
    // recorder fetch should still use the 12 h / 24 h horizon, not
    // 7 × 24 = 168.
    const hass = {
      config: { latitude: 47.4, longitude: 8.5 },
      callWS: vi.fn().mockResolvedValue({}),
    };
    const ds = new MeasuredDataSource(hass, {
      sensors,
      days: 7,
      forecast: { type: 'today' },
      show_forecast: true,
    });
    await ds._fetchAggregates();
    const [msg] = hass.callWS.mock.calls[0];
    const startMs = new Date(msg.start_time).getTime();
    const endMs = new Date(msg.end_time).getTime();
    // Combination = 12 + 1 = 13 h regardless of cfg days: 7
    expect(Math.round((endMs - startMs) / HOUR_MS)).toBe(13);
  });
});

describe('ForecastDataSource', () => {
  let unsub;
  let conn;
  let hass;

  beforeEach(() => {
    unsub = vi.fn();
    conn = {
      subscribeMessage: vi.fn().mockResolvedValue(unsub),
    };
    hass = {
      connection: conn,
      states: {
        'weather.home': { attributes: { supported_features: WeatherEntityFeature.FORECAST_DAILY } },
        'weather.no_daily': { attributes: { supported_features: WeatherEntityFeature.FORECAST_HOURLY } },
        'weather.broken': { attributes: {} },
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits an error event when weather_entity is not configured', async () => {
    const ds = new ForecastDataSource(hass, {});
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toEqual([{ forecast: [], error: 'weather_entity not configured' }]);
    expect(conn.subscribeMessage).not.toHaveBeenCalled();
  });

  it('emits an error event when entity is missing from hass.states', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.ghost' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events[0].error).toMatch(/not found/);
    expect(conn.subscribeMessage).not.toHaveBeenCalled();
  });

  it('emits an error event when entity does not support daily forecast', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.no_daily' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events[0].error).toMatch(/does not support daily forecasts/);
  });

  it('subscribes to weather/subscribe_forecast for a supported entity', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home', forecast: { type: 'daily' } });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(conn.subscribeMessage).toHaveBeenCalledTimes(1);
    const [, msg] = conn.subscribeMessage.mock.calls[0];
    expect(msg).toEqual({
      type: 'weather/subscribe_forecast',
      forecast_type: 'daily',
      entity_id: 'weather.home',
    });
  });

  // v0.8 reactivation of forecast.type=hourly: pin that the config flag flows
  // through to the WebSocket subscription. The render-side support for the
  // hourly data shape is added separately (forecast-utils + tick plugin); this
  // test guards the data layer entry point.
  it('subscribes with forecast_type "hourly" when configured for an hourly-capable entity', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.no_daily', forecast: { type: 'hourly' } });
    ds.subscribe(() => {});
    await Promise.resolve();
    expect(conn.subscribeMessage).toHaveBeenCalledTimes(1);
    const [, msg] = conn.subscribeMessage.mock.calls[0];
    expect(msg).toEqual({
      type: 'weather/subscribe_forecast',
      forecast_type: 'hourly',
      entity_id: 'weather.no_daily',
    });
  });

  it('emits an error when hourly is requested but entity only supports daily', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home', forecast: { type: 'hourly' } });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events[0].error).toMatch(/does not support hourly forecasts/);
    expect(conn.subscribeMessage).not.toHaveBeenCalled();
  });

  it('forwards forecast events to the listener', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    const [callback] = conn.subscribeMessage.mock.calls[0];
    callback({ forecast: [{ datetime: '2026-05-01T00:00:00Z', temperature: 20 }] });
    expect(events.at(-1)).toEqual({ forecast: [{ datetime: '2026-05-01T00:00:00Z', temperature: 20 }] });
  });

  // Bug fix: the renderer's _convertWindSpeed defaults the source unit
  // to the synthetic-weather attribute, which mirrors the station
  // sensor's unit. When the weather entity's unit differs (e.g. station
  // m/s + MeteoSwiss km/h), forecast wind got mis-converted by ~3.6×.
  // Tagging each entry with the weather entity's wind_speed_unit lets
  // the renderer pick the right source unit per-entry.
  it('tags forecast entries with the weather entity wind_speed_unit when available', async () => {
    hass.states['weather.home'].attributes.wind_speed_unit = 'km/h';
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    const [callback] = conn.subscribeMessage.mock.calls[0];
    callback({
      forecast: [
        { datetime: '2026-05-01T00:00:00Z', wind_speed: 20 },
        { datetime: '2026-05-02T00:00:00Z', wind_speed: 15 },
      ],
    });
    expect(events.at(-1).forecast).toEqual([
      { datetime: '2026-05-01T00:00:00Z', wind_speed: 20, wind_speed_unit: 'km/h' },
      { datetime: '2026-05-02T00:00:00Z', wind_speed: 15, wind_speed_unit: 'km/h' },
    ]);
  });

  it('does not tag forecast entries when the weather entity exposes no wind_speed_unit', async () => {
    // weather.home fixture has supported_features only — no wind_speed_unit.
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    const [callback] = conn.subscribeMessage.mock.calls[0];
    callback({ forecast: [{ datetime: '2026-05-01T00:00:00Z', wind_speed: 20 }] });
    const entry = events.at(-1).forecast[0];
    expect(entry.wind_speed_unit).toBeUndefined();
  });

  it('unsubscribe disposes the underlying subscription', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home' });
    const cleanup = ds.subscribe(() => {});
    await Promise.resolve();
    await cleanup();
    expect(unsub).toHaveBeenCalled();
  });
});

// ── MeasuredDataSource lifecycle / failure handling (v1.10.1 coverage uplift) ──

describe('MeasuredDataSource lifecycle', () => {
  const sensors = { temperature: 'sensor.temp' };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeHass(callWS) {
    return { config: { latitude: 47.4 }, callWS };
  }

  it('subscribe → unsubscribe clears the polling timer', () => {
    const callWS = vi.fn().mockResolvedValue({});
    const ds = new MeasuredDataSource(makeHass(callWS), { sensors, days: 3 });
    const unsub = ds.subscribe(() => {});
    expect(callWS).toHaveBeenCalledTimes(1); // initial poll
    unsub();
    // Advance past one poll interval — no further calls because timer was cleared.
    vi.advanceTimersByTime(60 * 1000);
    expect(callWS).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe is idempotent (second call is a no-op)', () => {
    const ds = new MeasuredDataSource(makeHass(vi.fn().mockResolvedValue({})), { sensors, days: 3 });
    const unsub = ds.subscribe(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('surfaces an error event after 3 consecutive fetch failures', async () => {
    const callWS = vi.fn().mockRejectedValue(new Error('recorder down'));
    const ds = new MeasuredDataSource(makeHass(callWS), { sensors, days: 3 });
    const events = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsub = ds.subscribe((e) => events.push(e));
    // Wait for the initial fire-and-forget poll's promise to settle.
    await vi.advanceTimersByTimeAsync(0);
    // Two more polls via the interval (POLL_INTERVAL_MS = 1 hour).
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    unsub(); // stop the interval before assertions
    errSpy.mockRestore();
    const errorEvents = events.filter((e) => e.error);
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].error).toMatch(/recorder down/);
    expect(callWS).toHaveBeenCalledTimes(3);
  });

  it('resets the failure counter after a successful poll', async () => {
    let calls = 0;
    const callWS = vi.fn().mockImplementation(() => {
      calls += 1;
      // Fail on the first 2 calls, succeed thereafter.
      if (calls <= 2) return Promise.reject(new Error('hiccup'));
      return Promise.resolve({});
    });
    const ds = new MeasuredDataSource(makeHass(callWS), { sensors, days: 3 });
    const events = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsub = ds.subscribe((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    unsub();
    errSpy.mockRestore();
    // Failure threshold is 3 consecutive — third call succeeded so the
    // counter reset and no error event was emitted.
    const errorEvents = events.filter((e) => e.error);
    expect(errorEvents.length).toBe(0);
  });
});
