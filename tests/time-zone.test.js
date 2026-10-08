// Server-zone calendar math (#285). Expectations are absolute UTC
// instants, so the suite means the same thing on any machine zone —
// a viewer in Zurich, the UTC CI runner, or a laptop in New York.
import { describe, it, expect, afterEach } from 'vitest';
import {
  setCardTimeZone,
  configuredTimeZone,
  cardTimeZone,
  zonedDate,
  startOfDay,
  addDays,
  withHour,
  startOfHour,
  hourOf,
  dayKey,
  isSameDay,
  dayOfYear,
} from '../src/utils/time-zone.js';
import { getDateTimeFormat } from '../src/utils/intl-cache.js';
import { aggregateThreeHourCalendar, trimToWholeDayStart } from '../src/forecast-utils.js';

const iso = (d) => d.toISOString();

afterEach(() => setCardTimeZone(undefined));

describe('setCardTimeZone', () => {
  it('accepts an IANA zone and rejects junk', () => {
    setCardTimeZone('America/New_York');
    expect(configuredTimeZone()).toBe('America/New_York');
    setCardTimeZone('Not/AZone');
    expect(configuredTimeZone()).toBeUndefined();
    setCardTimeZone(42);
    expect(configuredTimeZone()).toBeUndefined();
    expect(cardTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('day boundaries in a remote zone', () => {
  it('cuts the day at the server midnight, not the viewer’s', () => {
    setCardTimeZone('America/New_York');
    // 03:00 UTC on 8 Oct is still 7 Oct, 23:00 in New York (EDT, UTC-4).
    const t = Date.UTC(2026, 9, 8, 3, 0);
    expect(dayKey(t)).toBe('2026-10-07');
    expect(iso(startOfDay(t))).toBe('2026-10-07T04:00:00.000Z');
    expect(hourOf(t)).toBe(23);

    setCardTimeZone('Europe/Zurich');
    expect(dayKey(t)).toBe('2026-10-08');
    expect(iso(startOfDay(t))).toBe('2026-10-07T22:00:00.000Z');
  });

  it('advances whole calendar days across a DST change', () => {
    setCardTimeZone('America/New_York');
    // DST ends 1 Nov 2026: that day is 25 hours long.
    const oct31 = startOfDay(Date.UTC(2026, 9, 31, 12));
    expect(iso(oct31)).toBe('2026-10-31T04:00:00.000Z');
    expect(iso(addDays(oct31, 1))).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(addDays(oct31, 2))).toBe('2026-11-02T05:00:00.000Z');
    expect(iso(addDays(addDays(oct31, 2), -2))).toBe(iso(oct31));
  });

  it('resolves a wall time skipped by spring-forward to the instant after', () => {
    setCardTimeZone('America/New_York');
    // 8 Mar 2026, 02:30 does not exist; 03:30 EDT does.
    expect(iso(zonedDate(2026, 3, 8, 2, 30))).toBe('2026-03-08T07:30:00.000Z');
  });

  it('handles half-hour offsets', () => {
    setCardTimeZone('Asia/Kolkata');
    // 10:15 UTC = 15:45 IST (UTC+5:30).
    const t = Date.UTC(2026, 9, 8, 10, 15);
    expect(iso(startOfHour(t))).toBe('2026-10-08T09:30:00.000Z');
    expect(iso(withHour(t, 6))).toBe('2026-10-08T00:30:00.000Z');
    expect(isSameDay(t, Date.UTC(2026, 9, 8, 18, 29))).toBe(true);
    expect(isSameDay(t, Date.UTC(2026, 9, 8, 18, 30))).toBe(false);
  });

  it('counts the day of the year in the server zone', () => {
    setCardTimeZone('Pacific/Auckland');
    // 31 Dec 12:00 UTC is already 1 Jan in Auckland.
    expect(dayOfYear(Date.UTC(2026, 11, 31, 12))).toBe(1);
  });
});

describe('consumers', () => {
  it('formats display times in the server zone', () => {
    setCardTimeZone('Europe/Zurich');
    const fmt = getDateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    expect(fmt.format(new Date(Date.UTC(2026, 9, 8, 15, 0)))).toBe('17:00');
    setCardTimeZone('America/New_York');
    const ny = getDateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    expect(ny.format(new Date(Date.UTC(2026, 9, 8, 15, 0)))).toBe('11:00');
  });

  it('anchors 3-hour blocks to the server calendar', () => {
    setCardTimeZone('Europe/Zurich');
    // Two hours of one Zurich day (8 Oct, 01:00 and 02:00 local).
    const entries = [
      { datetime: '2026-10-07T23:00:00.000Z', temperature: 10 },
      { datetime: '2026-10-08T00:00:00.000Z', temperature: 12 },
    ];
    const blocks = aggregateThreeHourCalendar(entries);
    expect(blocks).toHaveLength(8);
    expect(blocks[0].datetime).toBe('2026-10-07T22:00:00.000Z'); // 00:00 Zurich
    expect(blocks[0].temperature).toBe(12);
  });

  it('trims a partial first day by the server midnight', () => {
    setCardTimeZone('Europe/Zurich');
    const entries = [
      { datetime: '2026-10-07T21:00:00.000Z' }, // 23:00 on 7 Oct, Zurich
      { datetime: '2026-10-07T22:00:00.000Z' }, // 00:00 on 8 Oct
      { datetime: '2026-10-07T23:00:00.000Z' },
    ];
    expect(trimToWholeDayStart(entries).map((e) => e.datetime))
      .toEqual(['2026-10-07T22:00:00.000Z', '2026-10-07T23:00:00.000Z']);
  });
});
