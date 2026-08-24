// @vitest-environment jsdom
// Editor → config → card round-trip for the attribute toggles.
//
// The reported break (community, 2026-08-24): a user switched HUMIDITY
// on and PRESSURE disappeared. Nothing in either row's rendering is
// coupled — the damage happened in between. `_applyTogglePaths`
// rewrites the whole attribute bag on any toggle and DELETES each key
// that sits on the editor's declared default. `show_pressure` was
// `true` there and `false` in DEFAULTS, so the explicit
// `show_pressure: true` a UI-created card carries was dropped and the
// card fell through to the runtime default of off.
//
// tests/editor-defaults-drift.test.js guards the underlying invariant
// key by key; this one walks the whole path a user actually takes, so a
// future regression fails as the symptom that was reported.

import { describe, it, expect } from 'vitest';
import '../src/main.js';
import '../src/weather-station-card-editor.js';
import { ATTRIBUTE_PATHS } from '../src/editor/render-live-panel.js';

const hass = {
  states: {
    'sensor.t': { state: '19.4', attributes: { unit_of_measurement: '°C' } },
    'sensor.hum': { state: '75', attributes: { unit_of_measurement: '%' } },
    'sensor.pres': { state: '946.4', attributes: { unit_of_measurement: 'mbar' } },
    'sun.sun': { state: 'above_horizon', attributes: {} },
  },
  config: { latitude: 46.9, longitude: 7.4 },
  language: 'en',
};

// Flatten a lit TemplateResult far enough to assert on rendered values.
const flat = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(flat).join('');
  if (v.strings && 'values' in v) return v.strings.reduce((a, s, i) => a + s + flat(v.values[i]), '');
  return String(v);
};

const SENSORS = { temperature: 'sensor.t', humidity: 'sensor.hum', pressure: 'sensor.pres' };

function renderCard(config) {
  const card = document.createElement('weather-station-card');
  card.setConfig(config);
  card.hass = hass;
  return flat(card.renderAttributes());
}

// What the pill row would emit after switching `turnOn` on, given the
// editor's own notion of which paths are currently selected.
function selectionAfterEnabling(cfg, turnOn) {
  return ATTRIBUTE_PATHS
    .filter(({ path, def }) =>
      (path === turnOn ? true : (def ? cfg[path] !== false : cfg[path] === true)))
    .map(({ path }) => path);
}

function applyInEditor(cfg, selection) {
  const editor = document.createElement('weather-station-card-editor');
  let written = null;
  editor.setConfig(cfg);
  editor.addEventListener('config-changed', (e) => { written = e.detail.config; });
  editor._applyTogglePaths(ATTRIBUTE_PATHS, selection);
  return written;
}

describe('attribute toggles survive a round-trip through the editor', () => {
  // getStubConfig writes every default explicitly, so a UI-added card
  // starts with show_pressure: true in its YAML.
  const stubLike = {
    show_station: false, show_forecast: false, show_attributes: true,
    show_pressure: true, show_humidity: false,
    sensors: SENSORS,
  };

  it('keeps pressure when humidity is switched on', () => {
    expect(renderCard(stubLike)).toContain('946');

    const written = applyInEditor(stubLike, selectionAfterEnabling(stubLike, 'show_humidity'));
    expect(written).not.toBeNull();

    const html = renderCard({ ...written, sensors: SENSORS });
    expect(html).toContain('75 %');
    expect(html).toContain('946');
  });

  it('keeps pressure on a card that never carried the key at all', () => {
    const keyless = { ...stubLike };
    delete keyless.show_pressure;
    const written = applyInEditor(keyless, selectionAfterEnabling(keyless, 'show_humidity'));
    expect(renderCard({ ...written, sensors: SENSORS })).toContain('946');
  });

  it('still honours an explicit opt-out', () => {
    const off = { ...stubLike, show_pressure: false };
    expect(renderCard(off)).not.toContain('946');

    const written = applyInEditor(off, selectionAfterEnabling(off, 'show_humidity'));
    expect(renderCard({ ...written, sensors: SENSORS })).not.toContain('946');
  });
});
