// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../src/main.js';

// The mode toggle re-enters setConfig. Feeding it the merged config
// (every show_* default spelled out) made validateConfig list a dozen
// "ignored" toggles next to attributes_layout the moment the user
// switched daily → today.
describe('mode toggle re-validates the raw config', () => {
  function mount() {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      type: 'custom:weather-station-card',
      weather_entity: 'weather.home',
      sensors: { temperature: 'sensor.t' },
      attributes_layout: [['pressure', 'dew_point']],
      forecast: { type: 'daily' },
    });
    return card;
  }

  it('keeps the layout warning away across the three modes', () => {
    const card = mount();
    expect(card._configWarnings).toEqual([]);
    card._onModeToggleClick();
    expect(card.config.forecast.type).toBe('today');
    expect(card._configWarnings).toEqual([]);
    card._onModeToggleClick();
    expect(card.config.forecast.type).toBe('hourly');
    expect(card._configWarnings).toEqual([]);
    card._onModeToggleClick();
    expect(card.config.forecast.type).toBe('daily');
  });

  it('cycles from the default type when the raw config sets none', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({ weather_entity: 'weather.home', sensors: { temperature: 'sensor.t' } });
    card._onModeToggleClick();
    expect(card.config.forecast.type).toBe('today');
    // The raw config is still what the user wrote, plus the new type.
    expect(Object.keys(card._rawConfig).sort()).toEqual(['forecast', 'sensors', 'weather_entity']);
  });
});
