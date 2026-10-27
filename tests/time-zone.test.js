// @vitest-environment jsdom
// Per-card calendar math (#285, ADR-0030). Expectations are absolute UTC
// instants, so the suite means the same thing on any machine zone — a
// viewer in Zurich, the UTC CI runner, or a laptop in New York.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Calendar } from '../src/utils/time-zone.js';
import { getDateTimeFormat } from '../src/utils/intl-cache.js';
import { aggregateThreeHourCalendar, trimToWholeDayStart } from '../src/forecast-utils.js';
import '../src/main.js';

const iso = (d) => d.toISOString();

describe('Calendar', () => {
  it('accepts an IANA zone and falls back to the browser zone on junk', () => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(new Calendar('America/New_York').timeZone).toBe('America/New_York');
    expect(new Calendar('Not/AZone').timeZone).toBe(browser);
    expect(new Calendar(42).timeZone).toBe(browser);
    expect(new Calendar().timeZone).toBe(browser);
  });
});

describe('day boundaries in a remote zone', () => {
  it('cuts the day at the calendar’s midnight, not the viewer’s', () => {
    const ny = new Calendar('America/New_York');
    // 03:00 UTC on 8 Oct is still 7 Oct, 23:00 in New York (EDT, UTC-4).
    const t = Date.UTC(2026, 9, 8, 3, 0);
    expect(ny.dayKey(t)).toBe('2026-10-07');
    expect(iso(ny.startOfDay(t))).toBe('2026-10-07T04:00:00.000Z');
    expect(ny.hourOf(t)).toBe(23);

    const zurich = new Calendar('Europe/Zurich');
    expect(zurich.dayKey(t)).toBe('2026-10-08');
    expect(iso(zurich.startOfDay(t))).toBe('2026-10-07T22:00:00.000Z');
  });

  it('advances whole calendar days across a DST change', () => {
    const ny = new Calendar('America/New_York');
    // DST ends 1 Nov 2026: that day is 25 hours long.
    const oct31 = ny.startOfDay(Date.UTC(2026, 9, 31, 12));
    expect(iso(oct31)).toBe('2026-10-31T04:00:00.000Z');
    expect(iso(ny.addDays(oct31, 1))).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(ny.addDays(oct31, 2))).toBe('2026-11-02T05:00:00.000Z');
    expect(iso(ny.addDays(ny.addDays(oct31, 2), -2))).toBe(iso(oct31));
  });

  it('resolves a wall time skipped by spring-forward to the instant after', () => {
    const ny = new Calendar('America/New_York');
    // 8 Mar 2026, 02:30 does not exist; 03:30 EDT does.
    expect(iso(ny.zonedDate(2026, 3, 8, 2, 30))).toBe('2026-03-08T07:30:00.000Z');
  });

  it('handles half-hour offsets', () => {
    const kolkata = new Calendar('Asia/Kolkata');
    // 10:15 UTC = 15:45 IST (UTC+5:30).
    const t = Date.UTC(2026, 9, 8, 10, 15);
    expect(iso(kolkata.startOfHour(t))).toBe('2026-10-08T09:30:00.000Z');
    expect(iso(kolkata.withHour(t, 6))).toBe('2026-10-08T00:30:00.000Z');
    expect(kolkata.isSameDay(t, Date.UTC(2026, 9, 8, 18, 29))).toBe(true);
    expect(kolkata.isSameDay(t, Date.UTC(2026, 9, 8, 18, 30))).toBe(false);
  });

  it('counts the day of the year in the calendar’s zone', () => {
    // 31 Dec 12:00 UTC is already 1 Jan in Auckland.
    expect(new Calendar('Pacific/Auckland').dayOfYear(Date.UTC(2026, 11, 31, 12))).toBe(1);
  });
});

describe('two calendars on one page', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('compute their own day boundaries for the same instant', () => {
    const zurich = new Calendar('Europe/Zurich');
    const denver = new Calendar('America/Denver');
    // 05:00 UTC on 8 Oct: 07:00 in Zurich, still 7 Oct 23:00 in Denver.
    const t = Date.UTC(2026, 9, 8, 5, 0);
    expect(iso(zurich.startOfDay(t))).toBe('2026-10-07T22:00:00.000Z');
    expect(iso(denver.startOfDay(t))).toBe('2026-10-07T06:00:00.000Z');
    // Interleaving calls never leaks one zone into the other.
    expect(zurich.dayKey(t)).toBe('2026-10-08');
    expect(denver.dayKey(t)).toBe('2026-10-07');
    expect(zurich.dayKey(t)).toBe('2026-10-08');
  });

  it('a clock tick on one card does not change the other card’s output', () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T05:00:00Z') });
    const mount = (zone) => {
      const card = document.createElement('weather-station-card');
      card.setConfig({ show_main: true, show_time: true, use_12hour_format: false });
      card.language = 'en';
      const main = document.createElement('div');
      main.className = 'main';
      main.innerHTML = '<span id="digital-clock"></span>';
      (card.shadowRoot ?? card.attachShadow({ mode: 'open' })).appendChild(main);
      card._syncCalendar(zone);
      return card;
    };
    const clock = (card) => card.shadowRoot.querySelector('#digital-clock').textContent;
    const zurich = mount('Europe/Zurich');
    const denver = mount('America/Denver');

    zurich._updateClock();
    denver._updateClock();
    expect(clock(zurich)).toBe('07:00');
    expect(clock(denver)).toBe('23:00');
    const denverDay = denver.calendar.startOfDay(Date.now()).getTime();

    vi.advanceTimersByTime(60_000);
    zurich._updateClock();
    expect(clock(zurich)).toBe('07:01');
    expect(clock(denver)).toBe('23:00');
    expect(denver.calendar.startOfDay(Date.now()).getTime()).toBe(denverDay);
    expect(iso(new Date(denverDay))).toBe('2026-10-07T06:00:00.000Z');
  });
});

describe('consumers', () => {
  it('formats display times in the given zone', () => {
    const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
    const t = new Date(Date.UTC(2026, 9, 8, 15, 0));
    expect(getDateTimeFormat('en-GB', { ...opts, timeZone: 'Europe/Zurich' }).format(t)).toBe('17:00');
    expect(getDateTimeFormat('en-GB', { ...opts, timeZone: 'America/New_York' }).format(t)).toBe('11:00');
  });

  it('anchors 3-hour blocks to the calendar', () => {
    // Two hours of one Zurich day (8 Oct, 01:00 and 02:00 local).
    const entries = [
      { datetime: '2026-10-07T23:00:00.000Z', temperature: 10 },
      { datetime: '2026-10-08T00:00:00.000Z', temperature: 12 },
    ];
    const blocks = aggregateThreeHourCalendar(entries, new Calendar('Europe/Zurich'));
    expect(blocks).toHaveLength(8);
    expect(blocks[0].datetime).toBe('2026-10-07T22:00:00.000Z'); // 00:00 Zurich
    expect(blocks[0].temperature).toBe(12);
  });

  it('trims a partial first day by the calendar’s midnight', () => {
    const entries = [
      { datetime: '2026-10-07T21:00:00.000Z' }, // 23:00 on 7 Oct, Zurich
      { datetime: '2026-10-07T22:00:00.000Z' }, // 00:00 on 8 Oct
      { datetime: '2026-10-07T23:00:00.000Z' },
    ];
    expect(trimToWholeDayStart(entries, new Calendar('Europe/Zurich')).map((e) => e.datetime))
      .toEqual(['2026-10-07T22:00:00.000Z', '2026-10-07T23:00:00.000Z']);
  });
});
