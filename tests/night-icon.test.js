// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

// The real clear-sky model returns 0 at night, which makes the classifier
// answer 'cloudy'; pin it so the sky ratio alone decides the condition.
vi.mock('../src/condition-classifier.js', async (orig) => ({
  ...(await orig()),
  clearSkyLuxAt: () => 100000,
}));

import '../src/main.js';
import { isSunUp } from '../src/moon.js';

const DENVER = { latitude: 39.74, longitude: -104.99 };
const TROMSO = { latitude: 69.649, longitude: 18.956 };
const HOME = { latitude: 46.9, longitude: 7.4 };

function makeCard(config) {
  const card = document.createElement('weather-station-card');
  card.setConfig({ show_station: false, show_forecast: false, ...config });
  card._hass = { states: {}, config: HOME, language: 'en' };
  return card;
}

// Ratio lux / 100000: 'sunny' >= 0.70, 'partlycloudy' >= 0.30.
function live(card, lux, extra = {}) {
  card._liveConditionKey = undefined;
  const loc = card.config.location ?? HOME;
  const inputs = {
    ...card._resolveLiveClassifierInputs(card._hass),
    luxNow: lux, lat: loc.latitude, lon: loc.longitude, ...extra,
  };
  return card._pickLiveCondition(inputs);
}

afterEach(() => vi.useRealTimers());

describe('isSunUp', () => {
  it('follows the local day in Denver', () => {
    expect(isSunUp(new Date('2026-07-01T20:00:00Z'), DENVER.latitude, DENVER.longitude)).toBe(true); // 14:00 MDT
    expect(isSunUp(new Date('2026-07-02T05:00:00Z'), DENVER.latitude, DENVER.longitude)).toBe(false); // 23:00 MDT
  });

  it('answers at polar night and polar day', () => {
    expect(isSunUp(new Date('2026-12-21T12:00:00Z'), TROMSO.latitude, TROMSO.longitude)).toBe(false);
    expect(isSunUp(new Date('2026-06-21T00:00:00Z'), TROMSO.latitude, TROMSO.longitude)).toBe(true);
  });
});

describe('main live condition at night', () => {
  it('Denver card on a Zurich server: 14:00 sunny, 23:00 clear-night', () => {
    const card = makeCard({ location: DENVER, time_zone: 'location' });
    vi.useFakeTimers({ now: new Date('2026-07-01T20:00:00Z') });
    expect(live(card, 100000)).toBe('sunny');
    expect(card._liveNight).toBe(false);
    vi.setSystemTime(new Date('2026-07-02T05:00:00Z'));
    expect(live(card, 100000)).toBe('clear-night');
    expect(card._liveNight).toBe(true);
  });

  it('without `location` follows the home coordinates', () => {
    const card = makeCard({});
    vi.useFakeTimers({ now: new Date('2026-07-01T12:00:00Z') });
    expect(live(card, 100000)).toBe('sunny');
    vi.setSystemTime(new Date('2026-07-01T23:00:00Z'));
    expect(live(card, 100000)).toBe('clear-night');
  });

  it('Tromsø: polar night gives the night state, polar day the day state', () => {
    const card = makeCard({ location: TROMSO });
    vi.useFakeTimers({ now: new Date('2026-12-21T12:00:00Z') });
    expect(live(card, 100000)).toBe('clear-night');
    vi.setSystemTime(new Date('2026-06-21T00:00:00Z'));
    expect(live(card, 100000)).toBe('sunny');
  });

  it('partlycloudy gets the night glyph; rainy is unchanged', () => {
    const card = makeCard({ location: DENVER });
    vi.useFakeTimers({ now: new Date('2026-07-02T05:00:00Z') });
    expect(live(card, 50000)).toBe('partlycloudy');
    expect(card._mainIcon('partlycloudy')).toBe('mdi:weather-night-partly-cloudy');
    expect(live(card, 50000, { precipRateNow: 1, precipUnit: 'mm/h' })).toBe('rainy');
    expect(card._mainIcon('rainy')).toBe('hass:weather-rainy');
    vi.setSystemTime(new Date('2026-07-01T20:00:00Z'));
    expect(live(card, 50000)).toBe('partlycloudy');
    expect(card._mainIcon('partlycloudy')).toBe('hass:weather-partly-cloudy');
  });

  it('an entity-reported clear-night is unchanged', () => {
    const card = makeCard({ location: DENVER });
    vi.useFakeTimers({ now: new Date('2026-07-02T05:00:00Z') });
    expect(live(card, undefined, { sensors: {}, wxState: 'clear-night' })).toBe('clear-night');
    expect(card._liveNight).toBe(false);
  });

  it('entity condition without a lux sensor follows the sun at the card location', () => {
    const card = makeCard({ location: DENVER, time_zone: 'location' });
    const sensors = { temperature: 'sensor.t' };
    const fromEntity = (wxState) => live(card, undefined, { sensors, wxState, nowTemp: 15 });
    vi.useFakeTimers({ now: new Date('2026-07-01T20:00:00Z') });
    expect(fromEntity('partlycloudy')).toBe('partlycloudy');
    expect(card._mainIcon('partlycloudy')).toBe('hass:weather-partly-cloudy');
    vi.setSystemTime(new Date('2026-07-02T05:00:00Z'));
    expect(fromEntity('partlycloudy')).toBe('partlycloudy');
    expect(card._mainIcon('partlycloudy')).toBe('mdi:weather-night-partly-cloudy');
    expect(fromEntity('sunny')).toBe('clear-night');
    expect(fromEntity('clear-night')).toBe('clear-night');
    expect(card._liveNight).toBe(false);
    expect(fromEntity('cloudy')).toBe('cloudy');
  });

  it('entity rainy at night is unchanged', () => {
    const card = makeCard({ location: DENVER });
    vi.useFakeTimers({ now: new Date('2026-07-02T05:00:00Z') });
    const result = live(card, undefined, { sensors: { temperature: 'sensor.t' }, wxState: 'rainy', nowTemp: 15 });
    expect(result).not.toBe('clear-night');
    expect(card._mainIcon('rainy')).toBe('hass:weather-rainy');
  });
});
