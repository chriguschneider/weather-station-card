// @vitest-environment jsdom
// Unit coverage for the `debug: true` diagnostic panel (v2 Slice 5).
//
// The panel is YAML-only — no editor row — and renders only when the
// resolved config carries `debug: true`. These tests drive the card's
// `renderDebugPanel()` directly and assert the rendered text reflects
// the card's detected internal state (render mode, sensors, data-source
// status, empty-column reasons).

import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import '../src/main.js';
import { DEFAULTS } from '../src/defaults.js';

const Card = customElements.get('weather-station-card');

// Render the card's renderDebugPanel() output into a detached div and
// return the container so tests can query text / structure.
function renderPanel(card) {
  const container = document.createElement('div');
  render(card.renderDebugPanel(), container);
  return container;
}

describe('debug default', () => {
  it('DEFAULTS carries debug:false so the panel is off by default', () => {
    expect(DEFAULTS).toHaveProperty('debug', false);
  });

  it('setConfig without debug leaves config.debug falsey', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    expect(card.config.debug).toBe(false);
  });

  it('setConfig with debug:true propagates the flag', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      debug: true,
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    expect(card.config.debug).toBe(true);
  });
});

describe('renderDebugPanel — content', () => {
  it('reports combination render mode when both blocks are on', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      debug: true,
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    card._hass = { states: {}, config: { version: '2026.5.0' } };
    const container = renderPanel(card);
    const text = container.textContent;
    expect(text).toContain('weather-station-card diagnostics');
    expect(text).toContain('combination');
    expect(text).toContain('2026.5.0');
  });

  it('reports station-only mode when forecast block is off', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      debug: true,
      show_forecast: false,
      sensors: { temperature: 'sensor.t' },
    });
    card._hass = { states: {}, config: {} };
    const text = renderPanel(card).textContent;
    expect(text).toContain('station-only');
  });

  it('reports forecast-only mode when station block is off', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      debug: true,
      show_station: false,
      weather_entity: 'weather.test',
    });
    card._hass = { states: {}, config: {} };
    const text = renderPanel(card).textContent;
    expect(text).toContain('forecast-only');
  });

  it('lists resolved sensors and flags missing entities', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      debug: true,
      sensors: { temperature: 'sensor.outdoor_temp', humidity: 'sensor.gone' },
      weather_entity: 'weather.test',
    });
    card._hass = {
      states: { 'sensor.outdoor_temp': { state: '12', attributes: {} } },
      config: {},
    };
    const text = renderPanel(card).textContent;
    expect(text).toContain('sensor.outdoor_temp');
    expect(text).toContain('in HA');
    expect(text).toContain('sensor.gone');
    expect(text).toContain('not found in HA');
  });

  it('explains an empty past chart when temperature sensor is unset', () => {
    const card = document.createElement('weather-station-card');
    // Station mode on with no temperature sensor — setConfig hard-throws
    // on this, so set config directly to exercise the diagnostic path.
    card.config = {
      ...DEFAULTS, debug: true, show_station: true, show_forecast: false,
      sensors: {},
    };
    card._hass = { states: {}, config: {} };
    const text = renderPanel(card).textContent;
    expect(text).toContain('sensors.temperature is unset');
  });

  it('explains a missing forecast block when weather_entity is unset', () => {
    const card = document.createElement('weather-station-card');
    // show_forecast true but no weather_entity — the validator path
    // tolerates it; the debug panel must still name the cause.
    card.config = { ...DEFAULTS, debug: true, show_forecast: true, weather_entity: '' };
    card._hass = { states: {}, config: {} };
    const text = renderPanel(card).textContent;
    expect(text).toContain('weather_entity is unset');
  });

  it('reports no empty-column issues for a well-formed config', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      debug: true,
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    card._hass = {
      states: { 'sensor.t': { state: '12', attributes: {} } },
      config: {},
    };
    const text = renderPanel(card).textContent;
    expect(text).toContain('No empty-column issues detected');
  });
});

describe('render — debug panel gating', () => {
  it('omits the panel from the card body when debug is off', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    card._hass = { states: {}, config: {} };
    card.weather = { state: 'sunny', attributes: {} };
    const container = document.createElement('div');
    render(card.render(), container);
    expect(container.querySelector('.ws-debug-panel')).toBeNull();
  });

  it('includes the panel in the card body when debug is on', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      debug: true,
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    card._hass = { states: {}, config: {} };
    card.weather = { state: 'sunny', attributes: {} };
    const container = document.createElement('div');
    render(card.render(), container);
    expect(container.querySelector('.ws-debug-panel')).not.toBeNull();
  });
});
