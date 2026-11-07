// @vitest-environment jsdom
// show_sources: the card records where each live value came from and
// renders a provenance tag after it, only when the option is on.

import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import '../src/main.js';

const makeHass = (states) => ({
  states,
  config: { latitude: 60.16, longitude: 10.24 },
  language: 'en',
});

const metNo = {
  state: 'partlycloudy',
  attributes: {
    temperature: -2.3,
    temperature_unit: '°C',
    humidity: 91,
    pressure: 1029,
    pressure_unit: 'hPa',
    wind_speed: 3.6,
    wind_bearing: 26,
    wind_speed_unit: 'km/h',
  },
};

const sensor = (state, unit) => ({ state, attributes: { unit_of_measurement: unit } });

function makeCard(extra = {}) {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_station: false,
    show_forecast: false,
    show_main: true,
    show_attributes: true,
    show_humidity: true,
    weather_entity: 'weather.forecast_home',
    sensors: {
      temperature: 'sensor.outdoor_temperature',
      humidity: 'sensor.outdoor_humidity',
      wind_speed: 'sensor.wind_speed',
      wind_direction: 'sensor.wind_direction',
    },
    ...extra,
  });
  return card;
}

const states = {
  'weather.forecast_home': metNo,
  'sensor.outdoor_temperature': sensor('-2.1', '°C'),
  'sensor.outdoor_humidity': sensor('90', '%'),
  // The anemometer is offline: no last good value in this session.
  'sensor.wind_speed': sensor('unavailable', 'km/h'),
  'sensor.wind_direction': sensor('unavailable', '°'),
};

function renderedTags(card, tpl) {
  const host = document.createElement('div');
  render(tpl, host);
  return [...host.querySelectorAll('.wsc-source-tag')].map((el) => ({
    text: el.textContent.trim(),
    kind: [...el.classList].find((c) => c.startsWith('wsc-source-') && c !== 'wsc-source-tag'),
    title: el.getAttribute('title'),
  }));
}

describe('live-source recording', () => {
  it('attributes sensor values to the station and fallbacks to the weather entity', () => {
    const card = makeCard();
    card.hass = makeHass(states);
    expect(card._liveSources.temperature).toEqual({ kind: 'station', entityId: 'sensor.outdoor_temperature' });
    expect(card._liveSources.humidity).toEqual({ kind: 'station', entityId: 'sensor.outdoor_humidity' });
    // No sensor wired for pressure → weather entity.
    expect(card._liveSources.pressure).toEqual({ kind: 'weather', entityId: 'weather.forecast_home' });
    // Wired but unavailable with no last good value → weather entity,
    // not the configured sensor (which _attrEntity would still name).
    expect(card._liveSources.wind_speed).toEqual({ kind: 'weather', entityId: 'weather.forecast_home' });
    expect(card._liveSources.wind_direction).toEqual({ kind: 'weather', entityId: 'weather.forecast_home' });
    expect(card._liveSources.sun).toEqual({ kind: 'computed' });
  });

  it('keeps a sensor as source while it serves its last good value', () => {
    const card = makeCard();
    card.hass = makeHass(states);
    card.hass = makeHass({ ...states, 'sensor.outdoor_temperature': sensor('unavailable', '°C') });
    expect(card._liveSources.temperature).toEqual({ kind: 'stale', entityId: 'sensor.outdoor_temperature' });
  });
});

describe('source tags', () => {
  it('renders no tags while show_sources is off (the default)', () => {
    const card = makeCard();
    card.hass = makeHass(states);
    expect(renderedTags(card, card.renderMain())).toEqual([]);
    expect(renderedTags(card, card.renderAttributes())).toEqual([]);
  });

  it('tags the temperature and attribute rows with their source', () => {
    const card = makeCard({ show_sources: true });
    card.hass = makeHass(states);
    expect(renderedTags(card, card.renderMain())).toEqual([
      { text: 'Station', kind: 'wsc-source-station', title: 'Measured by your station (sensor.outdoor_temperature)' },
    ]);
    const attrTags = renderedTags(card, card.renderAttributes());
    expect(attrTags.map((t) => t.text)).toContain('Forecast');
    expect(attrTags.find((t) => t.kind === 'wsc-source-weather').title)
      .toBe('From the weather entity (weather.forecast_home), no station value available');
  });

  it('uses source_labels to rename the tags', () => {
    const card = makeCard({ show_sources: true, source_labels: { station: 'Netatmo', weather: 'met.no' } });
    card.hass = makeHass(states);
    expect(renderedTags(card, card.renderMain()).map((t) => t.text)).toEqual(['Netatmo']);
    expect(renderedTags(card, card.renderAttributes()).map((t) => t.text)).toContain('met.no');
  });
});
