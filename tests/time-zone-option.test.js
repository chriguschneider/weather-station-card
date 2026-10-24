// @vitest-environment jsdom
// `time_zone` option: the live clock and the sun row format in the
// configured IANA zone; everything else stays on the server zone.

import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/main.js';
import { setCardTimeZone } from '../src/utils/time-zone.js';

const NOW = new Date('2026-07-01T16:30:00Z'); // 12:30 New York, 18:30 Zurich
const SUN = {
  attributes: {
    next_rising: '2026-07-02T03:45:00Z', // 23:45 New York, 05:45 Zurich
    next_setting: '2026-07-01T19:15:00Z', // 15:15 New York, 21:15 Zurich
  },
};

function makeCard(config) {
  const card = document.createElement('weather-station-card');
  card.setConfig({ show_main: true, show_time: true, ...config });
  card.language = 'en';
  const main = document.createElement('div');
  main.className = 'main';
  main.innerHTML = '<span id="digital-clock"></span>';
  (card.shadowRoot ?? card.attachShadow({ mode: 'open' })).appendChild(main);
  setCardTimeZone('Europe/Zurich');
  return card;
}

const clockText = (card) => card.shadowRoot.querySelector('#digital-clock').textContent;
const sunText = (card) =>
  card.renderSun({ sun: SUN, language: 'en' }).values.filter((v) => typeof v === 'string');

afterEach(() => {
  vi.useRealTimers();
  setCardTimeZone(undefined);
});

describe('time_zone option', () => {
  it('shows New York time in the clock and the sun row', () => {
    vi.useFakeTimers({ now: NOW });
    const card = makeCard({ time_zone: 'America/New_York', use_12hour_format: false });
    card._updateClock();
    expect(clockText(card)).toBe('12:30');
    expect(sunText(card)).toEqual(['23:45', '15:15']);
  });

  it('keeps the server zone without the option', () => {
    vi.useFakeTimers({ now: NOW });
    const card = makeCard({ use_12hour_format: false });
    card._updateClock();
    expect(clockText(card)).toBe('18:30');
    expect(sunText(card)).toEqual(['05:45', '21:15']);
  });

  it('falls back to the server zone on an invalid zone', () => {
    vi.useFakeTimers({ now: NOW });
    const card = makeCard({ time_zone: 'Mars/Base', use_12hour_format: false });
    expect(() => card._updateClock()).not.toThrow();
    expect(clockText(card)).toBe('18:30');
    expect(sunText(card)).toEqual(['05:45', '21:15']);
  });
});
