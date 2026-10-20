// @vitest-environment jsdom
// forecast.openmeteo: false switches every Open-Meteo request off; the
// default (true) leaves the existing gating untouched.

import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/main.js';

const DAY = 24 * 3600 * 1000;
const days = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  datetime: new Date(Date.now() + (i + 1) * DAY).toISOString(),
  ...extra,
}));

function setup(config, forecastData) {
  const card = document.createElement('weather-station-card');
  card.setConfig({ weather_entity: 'weather.home', show_forecast: true, ...config });
  card._hass = { config: { latitude: 46.9, longitude: 7.4 } };
  card._forecastData = forecastData;
  return card;
}

afterEach(() => vi.unstubAllGlobals());

describe('forecast.openmeteo: false', () => {
  it('never creates the source or fetches, even with every feature on', () => {
    const fetchSpy = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchSpy);
    for (const type of ['daily', 'today', 'hourly']) {
      const card = setup({
        forecast: {
          openmeteo: false,
          type,
          show_sunshine: true,
          show_precip_probability: true,
          openmeteo_history: true,
        },
      }, days(5));
      card._ensureOpenMeteoSource(card.config);
      expect(card._openMeteoSource).toBe(null);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns every gate off', () => {
    const card = setup({
      forecast: {
        openmeteo: false, show_sunshine: true, show_precip_probability: true, openmeteo_history: true,
      },
    }, days(5));
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(false);
    expect(card._precipProbabilityNeedsOpenMeteo(card.config)).toBe(false);
    expect(card._openMeteoStationFallbackActive(card.config)).toBe(false);
  });

  it('drops and aborts an existing source', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const card = setup({ forecast: { show_sunshine: true } }, days(5));
    card._ensureOpenMeteoSource(card.config);
    const src = card._openMeteoSource;
    expect(src).not.toBe(null);
    const abort = vi.spyOn(src, 'abort');
    card.config = { ...card.config, forecast: { ...card.config.forecast, openmeteo: false } };
    card._ensureOpenMeteoSource(card.config);
    expect(abort).toHaveBeenCalled();
    expect(card._openMeteoSource).toBe(null);
  });

  it('has no past window without a source', () => {
    const card = setup({ forecast: { openmeteo: false, openmeteo_history: true } }, null);
    expect(card._openMeteoStationWindow()).toEqual([]);
  });
});

describe('forecast.openmeteo default', () => {
  it('is true and leaves the gates unchanged', () => {
    const card = setup({ forecast: { show_sunshine: true, show_precip_probability: true, openmeteo_history: true } }, days(5));
    expect(card.config.forecast.openmeteo).toBe(true);
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(true);
    expect(card._precipProbabilityNeedsOpenMeteo(card.config)).toBe(true);
    expect(card._openMeteoStationFallbackActive(card.config)).toBe(true);
  });
});
