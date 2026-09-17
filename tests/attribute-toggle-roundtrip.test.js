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
    'sensor.wdir': { state: '225', attributes: { unit_of_measurement: '°' } },
    'sensor.wspd': { state: '12.5', attributes: { unit_of_measurement: 'km/h' } },
    'sensor.zero': { state: '2450.4', attributes: { unit_of_measurement: 'm' } },
    'sensor.dew': { state: '12.3', attributes: { unit_of_measurement: '°C' } },
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

// ADR-0025: an explicit `attributes_layout` decides which rows render
// and where; the pills then edit the layout instead of the show_* keys.
describe('attributes_layout round-trip', () => {
  const WIND_SENSORS = {
    ...SENSORS, wind_direction: 'sensor.wdir', wind_speed: 'sensor.wspd', zero_degree_level: 'sensor.zero',
    dew_point: 'sensor.dew',
  };

  // Column order in the rendered markup — each layout column is one
  // <div> of line <div>s inside .attributes, so a column starts with
  // `<div><div>` and the index of a value tells its column.
  const columnsOf = (markup) =>
    markup.slice(markup.indexOf('class="attributes"')).split('<div><div>').slice(1);
  const columnOf = (markup, needle) => columnsOf(markup).findIndex((c) => c.includes(needle));

  it('replaces the wind-direction row with the zero-degree level in the wind column', () => {
    const cfg = {
      show_station: false, show_forecast: false, show_attributes: true,
      sensors: WIND_SENSORS,
      attributes_layout: [
        ['pressure'],
        ['zero_degree_level', 'wind_speed'],
      ],
    };
    const markup = renderCard(cfg);
    expect(markup).toContain('snowflake-thermometer');
    expect(markup).toContain('2,450 m'); // en number format, whole metres
    expect(markup).toContain('13 km/h'); // wind speed rounds like before
    expect(markup).not.toContain('compass'); // no wind-direction arrow
    expect(columnOf(markup, '946')).toBe(0);
    expect(columnOf(markup, 'snowflake-thermometer')).toBe(1);
    expect(columnOf(markup, '13 km/h')).toBe(1);
  });

  it('ignores show_* row keys once a layout is set', () => {
    const cfg = {
      show_station: false, show_forecast: false, show_attributes: true,
      show_pressure: false, show_humidity: true,
      sensors: WIND_SENSORS,
      attributes_layout: [['pressure']],
    };
    const markup = renderCard(cfg);
    expect(markup).toContain('946');
    expect(markup).not.toContain('75 %');
  });

  it('shows the zero-degree level via show_zero_degree_level without a layout', () => {
    const base = { show_station: false, show_forecast: false, show_attributes: true, sensors: WIND_SENSORS };
    expect(renderCard(base)).not.toContain('snowflake-thermometer');
    const markup = renderCard({ ...base, show_zero_degree_level: true });
    expect(markup).toContain('snowflake-thermometer');
    // Default position: climate column, after the pressure row.
    expect(columnOf(markup, 'snowflake-thermometer')).toBe(columnOf(markup, '946'));
  });

  it('prefers hass.formatEntityState for the zero-degree value when HA offers it', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      show_station: false, show_forecast: false, show_attributes: true,
      sensors: WIND_SENSORS, attributes_layout: [['zero_degree_level']],
    });
    card.hass = { ...hass, formatEntityState: (st) => `${st.state} formatted` };
    expect(flat(card.renderAttributes())).toContain('2450.4 formatted');
  });

  it('editor pills write into the layout instead of the show_* keys', () => {
    const cfg = {
      show_station: false, show_forecast: false, show_attributes: true,
      sensors: WIND_SENSORS,
      attributes_layout: [['pressure'], ['zero_degree_level', 'wind_speed']],
    };
    const editor = document.createElement('weather-station-card-editor');
    let written = null;
    editor.setConfig(cfg);
    editor.addEventListener('config-changed', (e) => { written = e.detail.config; });

    // Switch humidity on, wind speed off.
    editor._applyAttributeToggles(ATTRIBUTE_PATHS, ['show_pressure', 'show_humidity', 'show_zero_degree_level']);
    expect(written.attributes_layout).toEqual([['pressure', 'humidity'], ['zero_degree_level']]);
    expect(written).not.toHaveProperty('show_humidity');
    expect(written).not.toHaveProperty('show_wind_speed');

    const markup = renderCard({ ...written, sensors: WIND_SENSORS });
    expect(markup).toContain('75 %');
    expect(markup).toContain('946');
    expect(markup).not.toContain('weather-windy');
  });

  it('the first pill toggle on a show_*-driven card writes the layout it resolved to', () => {
    const cfg = {
      show_station: false, show_forecast: false, show_attributes: true,
      show_pressure: true, show_humidity: true, sensors: WIND_SENSORS,
    };
    const editor = document.createElement('weather-station-card-editor');
    let written = null;
    editor.setConfig(cfg);
    editor.addEventListener('config-changed', (e) => { written = e.detail.config; });
    editor._applyAttributeToggles(ATTRIBUTE_PATHS, [
      'show_pressure', 'show_humidity', 'show_precipitation', 'show_uv_index',
      'show_wind_direction', 'show_wind_speed', 'show_zero_degree_level',
    ]);
    // Same rows as before plus the zero-degree level at its default slot;
    // the show_* keys are gone, the layout carries them now.
    expect(written.attributes_layout).toEqual([
      ['pressure', 'humidity', 'precipitation', 'zero_degree_level'],
      ['uv_index'],
      ['wind_direction', 'wind_speed'],
    ]);
    expect(written).not.toHaveProperty('show_pressure');
    expect(written).not.toHaveProperty('show_humidity');
    expect(written).not.toHaveProperty('show_zero_degree_level');
  });

  // A row is a line. The combined tokens draw two values on one line,
  // the singles one each — and the last row of a column no longer
  // shares its line with whatever comes after it (gusts + zero-degree).
  it('renders one <div> line per row, combined tokens on one line', () => {
    const cfg = {
      show_station: false, show_forecast: false, show_attributes: true,
      sensors: { ...WIND_SENSORS, gust_speed: 'sensor.wspd' },
      attributes_layout: [
        ['dew_point_humidity', 'pressure'],
        ['wind_gust_speed', 'zero_degree_level'],
      ],
    };
    const markup = renderCard(cfg);
    const linesOf = (col) => col.split('</div><div>').length;
    const [climate, wind] = columnsOf(markup);
    expect(climate).toContain('75 %');
    expect(climate).toContain('12.3');
    expect(linesOf(climate)).toBe(2); // dew point + humidity share line 1, pressure is line 2
    expect(linesOf(wind)).toBe(2);    // gusts and the zero-degree level on separate lines
    expect(wind).toContain('snowflake-thermometer');

    const [splitCol] = columnsOf(renderCard({ ...cfg, attributes_layout: [['dew_point', 'humidity']] }));
    expect(linesOf(splitCol)).toBe(2);
    expect(splitCol).toContain('75 %');
    expect(splitCol).toContain('12.3');
  });
});

// The layout board writes the whole arrangement (ADR-0025); "back to
// automatic" must keep the rows that were on.
describe('editor._setAttributesLayout', () => {
  const SENSORS_ALL = { ...SENSORS, wind_speed: 'sensor.wspd', zero_degree_level: 'sensor.zero' };

  function editorFor(cfg) {
    const editor = document.createElement('weather-station-card-editor');
    const out = { written: null };
    editor.setConfig(cfg);
    editor.addEventListener('config-changed', (e) => { out.written = e.detail.config; });
    return { editor, out };
  }

  it('writes a normalised layout and drops every show_* row key', () => {
    const { editor, out } = editorFor({
      show_attributes: true, show_pressure: true, show_humidity: true, show_main: true,
      sensors: SENSORS_ALL,
    });
    editor._setAttributesLayout([['zero_degree_level', 'wind_speed'], [], ['pressure']]);
    expect(out.written.attributes_layout).toEqual([['zero_degree_level', 'wind_speed'], ['pressure']]);
    expect(out.written).not.toHaveProperty('show_pressure');
    expect(out.written).not.toHaveProperty('show_humidity');
    expect(out.written.show_main).toBe(true); // not a row key — untouched
  });

  it('null returns to automatic mode, projecting the membership onto show_* keys', () => {
    const { editor, out } = editorFor({
      show_attributes: true,
      sensors: SENSORS_ALL,
      attributes_layout: [['humidity'], ['zero_degree_level', 'wind_speed']],
    });
    editor._setAttributesLayout(null);
    expect(out.written).not.toHaveProperty('attributes_layout');
    // Opt-in rows that were on → explicit true; opt-out rows that were
    // off → explicit false; everything on its default is left out.
    expect(out.written.show_humidity).toBe(true);
    expect(out.written.show_zero_degree_level).toBe(true);
    expect(out.written.show_pressure).toBe(false);
    expect(out.written.show_wind_direction).toBe(false);
    expect(out.written.show_uv_index).toBe(false);
    expect(out.written).not.toHaveProperty('show_wind_speed'); // default on, still on
    expect(out.written).not.toHaveProperty('show_dew_point');  // default off, still off

    const markup = renderCard({ ...out.written, sensors: SENSORS_ALL });
    expect(markup).toContain('75 %');
    expect(markup).toContain('snowflake-thermometer');
    expect(markup).not.toContain('946');
  });
});
