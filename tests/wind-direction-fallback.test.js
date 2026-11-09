// @vitest-environment jsdom
// A configured wind-direction sensor that is unavailable used to parse
// to NaN and leave an empty wind-direction row, while every other live
// reading fell back to the weather entity. It now falls back too.

import { describe, it, expect } from 'vitest';
import '../src/main.js';

const makeHass = (states) => ({ states, config: { latitude: 60, longitude: 10 }, language: 'en' });
const weather = { state: 'cloudy', attributes: { wind_bearing: 26, wind_speed: 3, wind_speed_unit: 'km/h' } };

function makeCard() {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_station: false,
    show_forecast: false,
    weather_entity: 'weather.home',
    sensors: { wind_direction: 'sensor.wind_direction' },
  });
  return card;
}

describe('wind direction fallback', () => {
  it('uses the sensor when it holds a number', () => {
    const card = makeCard();
    card.hass = makeHass({ 'weather.home': weather, 'sensor.wind_direction': { state: '270', attributes: {} } });
    expect(card.windDirection).toBe(270);
  });

  it('falls back to the weather entity bearing while the sensor is unavailable', () => {
    for (const state of ['unavailable', 'unknown', '']) {
      const card = makeCard();
      card.hass = makeHass({ 'weather.home': weather, 'sensor.wind_direction': { state, attributes: {} } });
      expect(card.windDirection).toBe(26);
    }
  });

  it('is undefined, not NaN, when neither source has a bearing', () => {
    const card = makeCard();
    card.hass = makeHass({
      'weather.home': { state: 'cloudy', attributes: {} },
      'sensor.wind_direction': { state: 'unavailable', attributes: {} },
    });
    expect(card.windDirection).toBeUndefined();
  });
});
