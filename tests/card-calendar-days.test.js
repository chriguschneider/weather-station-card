// #355: day boundaries follow the card's calendar — recorder hour
// buckets reduced to card days, daily forecast entries read as
// calendar days.
import { describe, it, expect, vi } from 'vitest';
import { reduceHourlyToDays, sunshineDailyTotals } from '../src/data-source.js';
import {
  anchorDailyDatetime,
  normalizeDailyEntry,
  normalizeHourlyDatetime,
} from '../src/forecast-utils.js';
import { Calendar } from '../src/utils/time-zone.js';
import sunshineStats from './fixtures/sunshine-duration-today-statistics.json';

const zurich = new Calendar('Europe/Zurich');

const HOUR_MS = 3600_000;

/** `n` UTC-aligned hour buckets from `startIso`; `fill(i)` gives the
 *  fields of hour `i`. */
function hours(startIso, n, fill) {
  const t0 = Date.parse(startIso);
  return Array.from({ length: n }, (_, i) => ({
    start: new Date(t0 + i * HOUR_MS).toISOString(),
    ...fill(i),
  }));
}

const byKey = (days, cal) => Object.fromEntries(days.map((d) => [cal.dayKey(new Date(d.start)), d]));

describe('reduceHourlyToDays', () => {
  it('cuts Denver days from the hour buckets of a Los Angeles server', () => {
    // Three Los Angeles days, 2026-10-20..22 (PDT, UTC-7): the server's
    // midnight is 07:00Z. Hour i carries value i and 1 mm of rain.
    const series = hours('2026-10-20T07:00:00Z', 72, (i) => ({ min: i, max: i, mean: i, change: 1 }));
    const denver = new Calendar('America/Denver');
    const days = byKey(reduceHourlyToDays(series, denver), denver);

    // Denver (MDT, UTC-6) days start at 06:00Z. The first server hour
    // is 01:00 MDT, and 23:00 PDT (i = 23, 71) is already 00:00 MDT of
    // the NEXT Denver day.
    expect(Object.keys(days)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(days['2026-10-20']).toMatchObject({ hours: 23, min: 0, max: 22, change: 23, mean: 11 });
    expect(days['2026-10-21']).toMatchObject({ hours: 24, min: 23, max: 46, change: 24, mean: 34.5 });
    expect(days['2026-10-22']).toMatchObject({ hours: 24, min: 47, max: 70, change: 24, mean: 58.5 });
    expect(days['2026-10-23']).toMatchObject({ hours: 1, min: 71, max: 71, change: 1 });
    expect(days['2026-10-21'].start).toBe('2026-10-21T06:00:00.000Z');

    // The same buckets in the server's own calendar give its days.
    const la = new Calendar('America/Los_Angeles');
    const laDays = byKey(reduceHourlyToDays(series, la), la);
    expect(laDays['2026-10-21']).toMatchObject({ hours: 24, min: 24, max: 47, change: 24 });
  });

  it('gives 23 and 25 hours on the 2026 US DST days', () => {
    const denver = new Calendar('America/Denver');
    // 2026-03-07 00:00 MST = 07:00Z; 3 days.
    const spring = byKey(reduceHourlyToDays(
      hours('2026-03-07T07:00:00Z', 71, () => ({ change: 0.5, max: 1 })), denver,
    ), denver);
    expect(spring['2026-03-07'].hours).toBe(24);
    expect(spring['2026-03-08'].hours).toBe(23);
    expect(spring['2026-03-08'].change).toBe(11.5);
    expect(spring['2026-03-09'].hours).toBe(24);

    // 2026-10-31 00:00 MDT = 06:00Z; 3 days.
    const fall = byKey(reduceHourlyToDays(
      hours('2026-10-31T06:00:00Z', 73, () => ({ change: 0.5 })), denver,
    ), denver);
    expect(fall['2026-10-31'].hours).toBe(24);
    expect(fall['2026-11-01'].hours).toBe(25);
    expect(fall['2026-11-01'].change).toBe(12.5);
    expect(fall['2026-11-02'].hours).toBe(24);
  });

  it('assigns the hour straddling an Asia/Kolkata midnight to the day it starts in', () => {
    // IST is UTC+5:30: midnight of 2026-10-22 is 18:30Z on the 21st,
    // inside the UTC hour 18:00–19:00Z.
    const kolkata = new Calendar('Asia/Kolkata');
    const series = hours('2026-10-21T16:00:00Z', 4, (i) => ({ max: i }));
    let days;
    expect(() => { days = byKey(reduceHourlyToDays(series, kolkata), kolkata); }).not.toThrow();
    // 16:00Z = 21:30, 17:00Z = 22:30, 18:00Z = 23:30 → the 21st;
    // 19:00Z = 00:30 → the 22nd.
    expect(days['2026-10-21']).toMatchObject({ hours: 3, max: 2 });
    expect(days['2026-10-22']).toMatchObject({ hours: 1, max: 3 });
    expect(days['2026-10-22'].start).toBe('2026-10-21T18:30:00.000Z');
  });

  it("takes the last hour's running `sum`, leaves absent fields absent", () => {
    const cal = new Calendar('UTC');
    const [day] = reduceHourlyToDays([
      { start: '2026-05-01T02:00:00Z', sum: 12, mean: null },
      { start: '2026-05-01T00:00:00Z', sum: 10, mean: 4 },
      { start: '2026-05-01T01:00:00Z', sum: null, mean: 6 },
      { start: 'not a date', sum: 99 },
    ], cal);
    expect(day.sum).toBe(12);
    expect(day.mean).toBe(5);
    expect(day.hours).toBe(3);
    expect('min' in day).toBe(false);
    expect('change' in day).toBe(false);
    expect(reduceHourlyToDays(undefined, cal)).toEqual([]);
  });
});

describe('sunshineDailyTotals', () => {
  it('follows the sensor reset at the server midnight while summing card days', () => {
    // A Zurich server (CEST, UTC+2): the counter resets at 22:00Z. The
    // card is in UTC, two hours behind.
    const zurich = new Calendar('Europe/Zurich');
    const utc = new Calendar('UTC');
    const series = [
      { start: '2026-07-01T20:00:00Z', min: 5, max: 6 }, // 22:00 Zurich, day 1 total 6
      { start: '2026-07-01T22:00:00Z', min: 0, max: 6 }, // 00:00 Zurich: carry-over in max
      { start: '2026-07-02T08:00:00Z', min: 1, max: 2 },
      { start: '2026-07-02T21:00:00Z', min: 4, max: 4 }, // 23:00 Zurich, day 2 total 4
    ];
    const map = sunshineDailyTotals(series, utc, zurich);
    // UTC day 1 gets 6 h (everything before the 22:00Z reset); UTC day 2 the 4 h after it.
    expect(map.get('2026-07-01')).toBe(6);
    expect(map.get('2026-07-02')).toBe(4);
    // In the server's own calendar it is the server day's maximum.
    const own = sunshineDailyTotals(series, zurich, zurich);
    expect(own.get('2026-07-01')).toBe(6);
    expect(own.get('2026-07-02')).toBe(4);
  });

  it('reads the final value of each day from a real recorder export (#370)', () => {
    // recorder/statistics_during_period, hourly, Europe/Zurich (CET since
    // 2026-10-25). The 27.10. 00:00 bucket carries 2.52 over from 26.10.
    const rows = sunshineStats['sensor.kleine_scheidegg_sunshine_duration_today'];
    const map = sunshineDailyTotals(rows, zurich, zurich);
    expect(map.get('2026-10-26')).toBe(2.52);
    expect(map.get('2026-10-27')).toBe(6.12);
  });

  // Synthetic hourly buckets for one UTC day; `values[h]` is the hour's
  // max (the 00:00 bucket also gets the min). Shape follows the table
  // in #370.
  const utc = new Calendar('UTC');
  const hourly = (date, values, { skip = [] } = {}) =>
    values.map((max, h) => ({ start: `${date}T${String(h).padStart(2, '0')}:00:00Z`, min: h === 0 ? 0 : max, max }))
      .filter((_, h) => !skip.includes(h));
  // A forecast total revised up and down; ends at 2.52 after peaking at 3.65.
  const revised = [3.38, 3.4, 3.5, 3.65, 3.6, 3.5, 3.4, 3.3, 3.2, 3.1, 3.0, 2.9, 2.9, 2.8, 2.8, 2.7, 2.7, 2.6, 2.6, 2.55, 2.55, 2.52, 2.52, 2.52];

  it('takes a revised forecast total at the end of the day, not its peak', () => {
    const series = hourly('2026-10-26', revised);
    expect(sunshineDailyTotals(series, utc, utc).get('2026-10-26')).toBe(2.52);
  });

  it('is unchanged for a monotonic counter', () => {
    const counter = Array.from({ length: 24 }, (_, h) => Math.min(h, 12) * 0.5);
    const series = hourly('2026-10-26', counter);
    expect(sunshineDailyTotals(series, utc, utc).get('2026-10-26')).toBe(6);
  });

  it('ignores the 00:00 carry-over of the previous day', () => {
    const series = [
      ...hourly('2026-10-24', [0.07, ...Array(22).fill(1), 1.32]),
      { start: '2026-10-25T00:00:00Z', min: 0, max: 1.32 },
      ...hourly('2026-10-25', [0, 0, 0, 0.5, 0.48, ...Array(18).fill(0.5), 0.5]).slice(1),
    ];
    const map = sunshineDailyTotals(series, utc, utc);
    expect(map.get('2026-10-24')).toBe(1.32);
    expect(map.get('2026-10-25')).toBe(0.5);
  });

  it('uses the latest known value when the last hour is missing', () => {
    const series = hourly('2026-10-26', revised, { skip: [23] });
    expect(sunshineDailyTotals(series, utc, utc).get('2026-10-26')).toBeCloseTo(2.52, 9);
  });

  // Tokyo is UTC+9: its day starts at 15:00Z.
  const tokyo = new Calendar('Asia/Tokyo');

  it('splits a counter by hour across card days east of the server', () => {
    const counter = Array.from({ length: 24 }, (_, h) => h * 0.5);
    const map = sunshineDailyTotals(hourly('2026-10-26', counter), tokyo, utc);
    // 00:00Z-14:00Z are Oct 26 in Tokyo, 15:00Z-23:00Z are Oct 27.
    expect(map.get('2026-10-26')).toBeCloseTo(7, 9);
    expect(map.get('2026-10-27')).toBeCloseTo(4.5, 9);
  });

  it('clamps a card day at 0 when a downward revision lands in it', () => {
    const map = sunshineDailyTotals(hourly('2026-10-26', revised), tokyo, utc);
    expect(map.get('2026-10-26')).toBeCloseTo(2.8, 9);
    expect(map.get('2026-10-27')).toBe(0);
  });
});

describe('normalizeDailyEntry', () => {
  // Each provider's way of writing 2026-10-22, per issue #355.
  const forms = {
    'Europe/Zurich': [
      '2026-10-22T00:00:00+00:00', // core Open-Meteo: UTC midnight
      '2026-10-22', // MeteoSwiss: bare date
      '2026-10-21T22:00:00+00:00', // AccuWeather: Zurich midnight (CEST) in UTC
      '2026-10-22T07:00:00+02:00', // local offset
    ],
    'America/Denver': [
      '2026-10-22T00:00:00+00:00',
      '2026-10-22',
      '2026-10-22T06:00:00+00:00', // Denver midnight (MDT) in UTC
      '2026-10-22T06:00:00-06:00', // NWS: local offset
    ],
  };

  for (const [zone, list] of Object.entries(forms)) {
    it(`yields the provider's date for a card in ${zone}`, () => {
      const card = new Calendar(zone);
      for (const dt of list) {
        expect(normalizeDailyEntry(dt, zone)).toBe('2026-10-22');
        const anchored = anchorDailyDatetime(dt, zone, card);
        expect(card.dayKey(new Date(anchored))).toBe('2026-10-22');
        expect(card.hourOf(new Date(anchored))).toBe(0);
      }
    });
  }

  it('keeps the provider date when the card is in another zone than the server', () => {
    const denver = new Calendar('America/Denver');
    for (const dt of forms['Europe/Zurich']) {
      const anchored = anchorDailyDatetime(dt, 'Europe/Zurich', denver);
      expect(anchored).toBe('2026-10-22T06:00:00.000Z');
    }
  });

  it('reads Z and offsets without a colon', () => {
    expect(normalizeDailyEntry('2026-10-22T00:00:00Z', 'America/Denver')).toBe('2026-10-22');
    expect(normalizeDailyEntry('2026-10-22T00:00:00.000Z', 'America/Denver')).toBe('2026-10-22');
    expect(normalizeDailyEntry('2026-10-22T12:00:00-0600', 'Europe/Zurich')).toBe('2026-10-22');
    // UTC, not midnight → server-zone date.
    expect(normalizeDailyEntry('2026-10-22T03:00:00Z', 'America/Denver')).toBe('2026-10-21');
    // No offset → server-zone wall time, i.e. the written date.
    expect(normalizeDailyEntry('2026-10-22T23:00:00', 'Asia/Tokyo')).toBe('2026-10-22');
  });

  it('falls back to Date parsing, null for garbage', () => {
    expect(normalizeDailyEntry('Thu, 22 Oct 2026 12:00:00 GMT', 'Europe/Zurich')).toBe('2026-10-22');
    expect(normalizeDailyEntry('not a date', 'Europe/Zurich')).toBe(null);
    expect(anchorDailyDatetime('not a date', 'Europe/Zurich', new Calendar('UTC'))).toBe(null);
  });
});

describe('normalizeHourlyDatetime', () => {
  it('passes instants through and reads a bare string in the server zone, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeHourlyDatetime('2026-10-22T13:00:00+00:00', 'Asia/Tokyo')).toBe('2026-10-22T13:00:00+00:00');
    expect(normalizeHourlyDatetime('garbage', 'Asia/Tokyo')).toBe('garbage');
    expect(normalizeHourlyDatetime('2026-10-22T13:00:00', 'Asia/Tokyo')).toBe('2026-10-22T04:00:00.000Z');
    expect(normalizeHourlyDatetime('2026-10-22T14:00', 'Asia/Tokyo')).toBe('2026-10-22T05:00:00.000Z');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
