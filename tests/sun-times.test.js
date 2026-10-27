// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/main.js';
import { sunTimes } from '../src/moon.js';
import { SUN_SUN, SUN_SUN_HOME } from './fixtures/sun-sun.js';

const HOUR = 3_600_000;
const TOL_MS = 60_000;

// Reference values: astral 3.x, refraction −0.833°, 2026-10-27 / 2026-12-21.
// Local times converted to UTC (Zurich +1, Denver −6, Oslo +1).
const ASTRAL = [
  { name: 'Bern', lat: 46.948, lon: 7.447, at: '2026-10-27T12:00:00Z',
    sunrise: '2026-10-27T06:05:27Z', sunset: '2026-10-27T16:21:56Z' },
  { name: 'Missoula', lat: 46.872, lon: -113.994, at: '2026-10-27T19:00:00Z',
    sunrise: '2026-10-27T14:11:34Z', sunset: '2026-10-28T00:27:18Z' },
  { name: 'Tromsø', lat: 69.649, lon: 18.956, at: '2026-10-27T12:00:00Z',
    sunrise: '2026-10-27T06:47:37Z', sunset: '2026-10-27T14:06:56Z' },
];

describe('sunTimes vs astral (±60 s)', () => {
  for (const p of ASTRAL) {
    it(p.name, () => {
      const { sunrise, sunset } = sunTimes(new Date(p.at), p.lat, p.lon);
      expect(Math.abs(sunrise - new Date(p.sunrise))).toBeLessThanOrEqual(TOL_MS);
      expect(Math.abs(sunset - new Date(p.sunset))).toBeLessThanOrEqual(TOL_MS);
    });
  }

  it('Tromsø polar night (2026-12-21) is null/null', () => {
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), 69.649, 18.956))
      .toEqual({ sunrise: null, sunset: null });
  });
});

// HA's sun integration (astral) applies the observer's elevation, which
// lowers the horizon and widens the day by a few minutes at a hill-top home;
// the fixture carries no elevation, so only a 5 min bound is asserted, and
// the sea-level astral cases above carry the ±60 s accuracy claim.
const SUN_SUN_TOL_MS = 5 * 60_000;

describe('sunTimes vs a real sun.sun payload', () => {
  it('lands within 5 min of next_setting today and next_rising tomorrow', () => {
    const { latitude, longitude } = SUN_SUN_HOME;
    const a = SUN_SUN.attributes;
    const today = sunTimes(new Date('2026-10-27T12:00:00Z'), latitude, longitude);
    const tomorrow = sunTimes(new Date('2026-10-28T12:00:00Z'), latitude, longitude);
    expect(Math.abs(today.sunset - new Date(a.next_setting))).toBeLessThanOrEqual(SUN_SUN_TOL_MS);
    expect(Math.abs(tomorrow.sunrise - new Date(a.next_rising))).toBeLessThanOrEqual(SUN_SUN_TOL_MS);
  });
});

describe('sunTimes properties', () => {
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
