// @vitest-environment jsdom
// Display zone of a card (#357): `time_zone` is `server`, `location` or an
// IANA name, resolved once into the card's Calendar. Everything the card
// shows follows that one calendar.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'lit';
import '../src/main.js';
import { resolveCardTimeZone } from '../src/location.js';
import { validateConfig } from '../src/config-validation.js';
import { nextMoonEvent, sunTimes } from '../src/moon.js';
import { Calendar } from '../src/utils/time-zone.js';

const SERVER = 'America/Los_Angeles';
const DENVER = 'America/Denver';
// 00:30 on 2 July in Denver, 23:30 on 1 July in Los Angeles.
const NOW = new Date('2026-07-02T06:30:00Z');
const MONTANA = { latitude: 46.87, longitude: -113.99 };

describe('resolveCardTimeZone', () => {
  const zoneOf = (config) => resolveCardTimeZone(config, SERVER);

  it('server (and unset / empty) use the server zone', () => {
    for (const time_zone of ['server', '', undefined, null]) {
      expect(zoneOf({ time_zone })).toEqual({ zone: SERVER, warning: null });
    }
  });

  it('location uses location.time_zone', () => {
    expect(zoneOf({ time_zone: 'location', location: { ...MONTANA, time_zone: DENVER } }))
      .toEqual({ zone: DENVER, warning: null });
  });

  it('location without a usable zone falls back to the server zone with a warning', () => {
    for (const location of [undefined, MONTANA, { ...MONTANA, time_zone: 'Mars/Base' }]) {
      const r = zoneOf({ time_zone: 'location', location });
      expect(r.zone).toBe(SERVER);
      expect(r.warning).toContain('location.time_zone');
    }
  });

  it('an IANA name applies, also the legacy #346 YAML', () => {
    expect(zoneOf({ time_zone: 'America/Denver' })).toEqual({ zone: DENVER, warning: null });
  });

  it('an invalid IANA name falls back to the server zone with a warning', () => {
    const r = zoneOf({ time_zone: 'Mars/Base' });
    expect(r.zone).toBe(SERVER);
    expect(r.warning).toContain('Mars/Base');
  });

  it('surfaces as a config warning', () => {
    expect(validateConfig({ time_zone: 'location' }).join(' ')).toContain('location.time_zone');
    expect(validateConfig({ time_zone: 'Mars/Base' }).join(' ')).toContain('Mars/Base');
    expect(validateConfig({ time_zone: 'location', location: { ...MONTANA, time_zone: DENVER } }))
      .toEqual([]);
  });
});

function makeCard(config) {
  const card = document.createElement('weather-station-card');
  card.setConfig({ show_main: true, show_time: true, use_12hour_format: false, ...config });
  card.language = 'en';
  card._hass = { config: { latitude: 34.05, longitude: -118.24, time_zone: SERVER } };
  const main = document.createElement('div');
  main.className = 'main';
  main.innerHTML = '<span id="digital-clock"></span>';
  (card.shadowRoot ?? card.attachShadow({ mode: 'open' })).appendChild(main);
  card._syncCalendar(SERVER);
  return card;
}

const hhmm = (d, timeZone) =>
  new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(d);
const textOf = (tpl) => {
  const div = document.createElement('div');
  render(tpl, div);
  return div.textContent.replace(/\s+/g, ' ').trim();
};

describe('a card for another place', () => {
  afterEach(() => vi.useRealTimers());

  const montana = { location: { ...MONTANA, time_zone: DENVER } };

  function shows(card) {
    const day = card.calendar.dayKey(NOW);
    card._updateClock();
    const forecasts = Array.from({ length: 30 }, (_, i) => ({
      datetime: new Date(NOW.getTime() + i * 3600e3).toISOString(),
    }));
    card.forecasts = forecasts;
    return {
      zone: card.calendar.timeZone,
      day,
      clock: card.shadowRoot.querySelector('#digital-clock').textContent,
      sun: textOf(card.renderSun('en')),
      moon: textOf(card._renderMoonLine('en')),
      timeline: textOf(card.renderScrollTimeline()),
    };
  }

  it('time_zone: location puts the whole card in the place\'s zone', () => {
    vi.useFakeTimers({ now: NOW });
    const card = makeCard({ ...montana, time_zone: 'location' });
    const out = shows(card);
    const { sunrise, sunset } = sunTimes(card.calendar.withHour(NOW, 12), MONTANA.latitude, MONTANA.longitude);
    const ev = nextMoonEvent(NOW, MONTANA.latitude, MONTANA.longitude, new Calendar(DENVER));

    expect(out.zone).toBe(DENVER);
    expect(out.day).toBe('2026-07-02');
    expect(out.clock).toBe('00:30');
    expect(out.sun).toContain(hhmm(sunrise, DENVER));
    expect(out.sun).toContain(hhmm(sunset, DENVER));
    expect(out.moon).toContain(hhmm(ev.time, DENVER));
    expect(out.timeline).toContain('Thu');
    expect(out.timeline).not.toContain('Wed');
  });

  it('time_zone: server puts the same card in the server zone', () => {
    vi.useFakeTimers({ now: NOW });
    const card = makeCard({ ...montana, time_zone: 'server' });
    const out = shows(card);
    // 23:30 local: today's sun is over, the row shows the next day's pair.
    const noon = card.calendar.addDays(card.calendar.withHour(NOW, 12), 1);
    const { sunrise, sunset } = sunTimes(noon, MONTANA.latitude, MONTANA.longitude);
    const ev = nextMoonEvent(NOW, MONTANA.latitude, MONTANA.longitude, new Calendar(SERVER));

    expect(out.zone).toBe(SERVER);
    expect(out.day).toBe('2026-07-01');
    expect(out.clock).toBe('23:30');
    expect(out.sun).toContain(hhmm(sunrise, SERVER));
    expect(out.sun).toContain(hhmm(sunset, SERVER));
    expect(out.moon).toContain(hhmm(ev.time, SERVER));
    expect(out.timeline).toContain('Wed');
  });

  it('a config change re-resolves the calendar without a hass push', () => {
    vi.useFakeTimers({ now: NOW });
    const card = makeCard({ ...montana, time_zone: 'server' });
    expect(card.calendar.timeZone).toBe(SERVER);
    card.setConfig({ ...montana, time_zone: 'location' });
    expect(card.calendar.timeZone).toBe(DENVER);
    card.setConfig({ ...montana, time_zone: 'server' });
    expect(card.calendar.timeZone).toBe(SERVER);
  });

  it('legacy IANA time_zone now drives the whole card', () => {
    const card = makeCard({ time_zone: DENVER });
    expect(card.calendar.timeZone).toBe(DENVER);
  });

  it('location without a zone keeps the server zone and warns', () => {
    const card = makeCard({ time_zone: 'location', location: MONTANA });
    expect(card.calendar.timeZone).toBe(SERVER);
    expect(card._configWarnings.join(' ')).toContain('location.time_zone');
  });
});
