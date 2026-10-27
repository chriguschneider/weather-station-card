// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/main.js';
import { sunTimes } from '../src/moon.js';

const HOUR = 3_600_000;

// Properties that hold for any correct sunrise/sunset implementation;
// reference-table values (NOAA / astral) are tracked in the PR.
describe('sunTimes', () => {
  it('Bern, midsummer: ~16 h day centred on local solar noon', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-06-21T12:00:00Z'), 46.95, 7.45);
    const lenH = (sunset - sunrise) / HOUR;
    expect(lenH).toBeGreaterThan(15.5);
    expect(lenH).toBeLessThan(16.5);
    const noonUtcH = (sunrise.valueOf() + sunset.valueOf()) / 2 / HOUR % 24;
    // 12:00 UTC − lon/15 h, within the equation of time (±17 min).
    expect(Math.abs(noonUtcH - (12 - 7.45 / 15))).toBeLessThan(0.3);
  });

  it('Missoula, midwinter: short day, noon on the western side', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-12-21T19:00:00Z'), 46.87, -113.99);
    const lenH = (sunset - sunrise) / HOUR;
    expect(lenH).toBeGreaterThan(8);
    expect(lenH).toBeLessThan(9);
    const noonUtcH = (sunrise.valueOf() + sunset.valueOf()) / 2 / HOUR % 24;
    expect(Math.abs(noonUtcH - (12 + 113.99 / 15))).toBeLessThan(0.3);
  });

  it('returns null at polar night and polar day without throwing', () => {
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), 69.65, 18.96))
      .toEqual({ sunrise: null, sunset: null });
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), 69.65, 18.96))
      .toEqual({ sunrise: null, sunset: null });
  });

  it('southern hemisphere has the long day in December', () => {
    const dec = sunTimes(new Date('2026-12-21T12:00:00Z'), -33.87, 151.21);
    const jun = sunTimes(new Date('2026-06-21T12:00:00Z'), -33.87, 151.21);
    expect(dec.sunset - dec.sunrise).toBeGreaterThan(jun.sunset - jun.sunrise);
  });
});

const NOW = new Date('2026-07-01T18:00:00Z');
const MONTANA = { latitude: 46.87, longitude: -113.99 };

function makeCard(config, hassConfig, tz) {
  const card = document.createElement('weather-station-card');
  card.setConfig({ ...config });
  card._hass = { config: hassConfig };
  card._syncCalendar(tz);
  return card;
}
const text = (tpl) => tpl.values.filter((v) => typeof v === 'string').map((s) => s.trim());
const fmt = (d, timeZone) =>
  new Intl.DateTimeFormat('en', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone })
    .format(d);

afterEach(() => vi.useRealTimers());

describe('sun row', () => {
  it('shows the card location’s times in the calendar zone', () => {
    vi.useFakeTimers({ now: NOW });
    const home = { latitude: 46.95, longitude: 7.45 };
    const card = makeCard({ location: MONTANA, use_12hour_format: false }, home, 'America/Denver');
    const { sunrise, sunset } = sunTimes(new Date('2026-07-01T18:00:00Z'), MONTANA.latitude, MONTANA.longitude);
    expect(text(card.renderSun('en'))).toEqual([
      fmt(sunrise, 'America/Denver'),
      fmt(sunset, 'America/Denver'),
    ]);
  });

  it('formats the same instants in the server zone', () => {
    vi.useFakeTimers({ now: NOW });
    const card = makeCard({ location: MONTANA, use_12hour_format: false },
      { latitude: 46.95, longitude: 7.45 }, 'Europe/Zurich');
    const { sunrise, sunset } = sunTimes(new Date('2026-07-01T18:00:00Z'), MONTANA.latitude, MONTANA.longitude);
    const out = text(card.renderSun('en'));
    expect(out[0]).toBe(fmt(sunrise, 'Europe/Zurich'));
    expect(out[1]).toBe(fmt(sunset, 'Europe/Zurich'));
  });

  it('falls back to the Home Assistant location without `location`', () => {
    vi.useFakeTimers({ now: NOW });
    const home = { latitude: 46.95, longitude: 7.45 };
    const card = makeCard({ use_12hour_format: false }, home, 'Europe/Zurich');
    const { sunrise, sunset } = sunTimes(new Date('2026-07-01T12:00:00Z'), home.latitude, home.longitude);
    expect(text(card.renderSun('en'))).toEqual([
      fmt(sunrise, 'Europe/Zurich'),
      fmt(sunset, 'Europe/Zurich'),
    ]);
  });

  it('shows tomorrow’s pair once both events are past', () => {
    vi.useFakeTimers({ now: new Date('2026-07-01T23:30:00Z') });
    const home = { latitude: 46.95, longitude: 7.45 };
    const card = makeCard({ use_12hour_format: false }, home, 'UTC');
    const t = sunTimes(new Date('2026-07-02T12:00:00Z'), home.latitude, home.longitude);
    expect(text(card.renderSun('en'))).toEqual([fmt(t.sunrise, 'UTC'), fmt(t.sunset, 'UTC')]);
  });

  it('renders nothing without any location or at polar night', () => {
    vi.useFakeTimers({ now: NOW });
    expect(makeCard({}, {}, 'UTC').renderSun('en')).toBeNull();
    vi.useFakeTimers({ now: new Date('2026-12-21T12:00:00Z') });
    const polar = makeCard({ location: { latitude: 69.65, longitude: 18.96 } }, {}, 'UTC');
    expect(polar.renderSun('en')).toBeNull();
  });
});
