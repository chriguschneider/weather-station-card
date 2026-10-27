// @vitest-environment jsdom
// `location` option: Open-Meteo requests and the sunshine day length
// follow the card's place instead of Home Assistant's home location.

import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/main.js';
import { parseLocation, resolveLocation } from '../src/location.js';
import { validateConfig } from '../src/config-validation.js';
import { overlayFromOpenMeteo, dayLengthHours, localDateString } from '../src/sunshine-source.js';
import { Calendar } from '../src/utils/time-zone.js';

const cal = new Calendar();

const HA = { config: { latitude: 46.92, longitude: 7.41 } };
const SKI = { latitude: 46.5853, longitude: 7.9611 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveLocation', () => {
  it('uses the configured location when valid', () => {
    expect(resolveLocation({ location: SKI }, HA)).toEqual(SKI);
  });

  it('falls back to the HA location when absent', () => {
    expect(resolveLocation({}, HA)).toEqual({ latitude: 46.92, longitude: 7.41 });
  });

  it('returns null when neither is usable', () => {
    expect(resolveLocation({}, { config: {} })).toBeNull();
    expect(resolveLocation({}, null)).toBeNull();
  });

  it.each([
    [{ latitude: 91, longitude: 0 }],
    [{ latitude: 0, longitude: -181 }],
    [{ latitude: '46.5', longitude: 7 }],
    [{ latitude: NaN, longitude: 7 }],
    [{ latitude: 46.5 }],
    [[46.5, 7]],
    ['46.5,7'],
  ])('ignores an invalid location %j and uses HA', (location) => {
    expect(parseLocation(location)).toBeNull();
    expect(resolveLocation({ location }, HA)).toEqual({ latitude: 46.92, longitude: 7.41 });
  });
});

describe('validateConfig — location', () => {
  it('accepts a valid location', () => {
    expect(validateConfig({ location: SKI })).toEqual([]);
  });

  it('warns, without throwing, on a malformed location', () => {
    const out = validateConfig({ location: { latitude: 100, longitude: 7 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('`location`');
    expect(validateConfig({ location: 'Bern' })).toHaveLength(1);
  });
});

describe('overlayFromOpenMeteo — day length', () => {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const forecasts = [{ datetime: day.toISOString() }];
  const source = {
    getDailyValues: () => [{ date: localDateString(day, cal), value: 5 }],
    getHourlyValues: () => null,
  };

  it('uses the configured latitude', () => {
    const out = overlayFromOpenMeteo(forecasts, HA, source, cal, 'daily', null, { latitude: 70, longitude: 20 });
    expect(out[0].day_length).toBeCloseTo(dayLengthHours(70, day, cal), 6);
  });

  it('uses the HA latitude without a location, and for an invalid one', () => {
    const expected = dayLengthHours(46.92, day, cal);
    expect(overlayFromOpenMeteo(forecasts, HA, source, cal)[0].day_length).toBeCloseTo(expected, 6);
    const bad = overlayFromOpenMeteo(forecasts, HA, source, cal, 'daily', null, { latitude: 99, longitude: 0 });
    expect(bad[0].day_length).toBeCloseTo(expected, 6);
  });
});

describe('card — Open-Meteo source coordinates', () => {
  function makeCard(extra = {}) {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const card = document.createElement('weather-station-card');
    card.setConfig({
      show_station: true,
      show_forecast: false,
      sensors: { temperature: 'sensor.t' },
      forecast: { show_sunshine: true, type: 'daily' },
      ...extra,
    });
    card._hass = { ...HA, states: {}, language: 'en' };
    return card;
  }

  it('builds the source from the configured location', () => {
    const card = makeCard({ location: SKI });
    card._ensureOpenMeteoSource(card.config);
    expect(card._openMeteoSource.latitude).toBe(SKI.latitude);
    expect(card._openMeteoSource.longitude).toBe(SKI.longitude);
  });

  it('uses the HA location without the option', () => {
    const card = makeCard();
    card._ensureOpenMeteoSource(card.config);
    expect(card._openMeteoSource.latitude).toBe(46.92);
    expect(card._openMeteoSource.longitude).toBe(7.41);
  });

  it('rebuilds the source when the location changes', () => {
    const card = makeCard();
    card._ensureOpenMeteoSource(card.config);
    const first = card._openMeteoSource;
    card.setConfig({ ...card.config, location: SKI });
    card._ensureOpenMeteoSource(card.config);
    expect(card._openMeteoSource).not.toBe(first);
    expect(card._openMeteoSource.latitude).toBe(SKI.latitude);
  });

  it('puts the configured coordinates into the request URL', async () => {
    // Coordinates no other test uses: the module-level request dedup
    // would otherwise hand back an earlier test's pending request.
    const card = makeCard({ location: { latitude: 46.1234, longitude: 8.4321 } });
    card._ensureOpenMeteoSource(card.config);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toContain('latitude=46.1234');
      expect(u).toContain('longitude=8.4321');
      expect(u).not.toContain('46.92');
    }
  });
});
