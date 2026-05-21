// @vitest-environment jsdom
// jsdom required because the editor extends LitElement which references
// `customElements`, `HTMLElement`, etc. Per-file directive keeps the
// rest of the suite on node for speed.
//
// What this file covers:
//   - _valueChanged: simple key, dotted key (forecast.foo, units.bar),
//     deeper dotted key, checkbox event-shape (target.checked),
//     missing-config early return.
//   - _sensorPickerChanged: add, replace, delete on empty/null/undefined.
//
// We instantiate the editor class with a minimal mock for the Lit-side
// surface (configChanged + requestUpdate) — the methods themselves are
// pure-ish: read event.target, mutate this._config, fire configChanged.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../src/weather-station-card-editor.js';

function makeEditor(initialConfig = {}) {
  const editor = document.createElement('weather-station-card-editor');
  editor._config = initialConfig;
  // configChanged dispatches a "config-changed" event up to the Lovelace
  // dashboard frame. In tests we capture the new config directly via
  // a spy so we can assert what shape was emitted.
  editor.configChanged = vi.fn();
  editor.requestUpdate = vi.fn();
  return editor;
}

function event(value, { checked } = {}) {
  return {
    target: {
      value,
      ...(checked !== undefined ? { checked } : {}),
    },
  };
}

describe('editor._valueChanged', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor({ title: 'old', days: 7, forecast: { style: 'style2' } });
  });

  it('is a no-op when _config is missing', () => {
    editor._config = null;
    editor._valueChanged(event('x'), 'title');
    expect(editor.configChanged).not.toHaveBeenCalled();
  });

  it('writes a top-level string key', () => {
    editor._valueChanged(event('Living Room'), 'title');
    expect(editor.configChanged).toHaveBeenCalledOnce();
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.title).toBe('Living Room');
    expect(newCfg.days).toBe(7); // unchanged
  });

  it('writes a top-level checkbox value (event.target.checked beats .value)', () => {
    editor._valueChanged(event('ignored', { checked: true }), 'show_main');
    expect(editor.configChanged.mock.calls[0][0].show_main).toBe(true);
  });

  it('preserves false from a checkbox event (a truthy-only check would drop it)', () => {
    editor._valueChanged(event('ignored', { checked: false }), 'show_main');
    expect(editor.configChanged.mock.calls[0][0].show_main).toBe(false);
  });

  it('writes a dotted key into nested forecast object', () => {
    editor._valueChanged(event('style1'), 'forecast.style');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.forecast.style).toBe('style1');
    // Nested object is replaced — verify it's a new reference (no
    // mutation leak into the original config).
    expect(newCfg.forecast).not.toBe(editor._config.forecast);
  });

  it('does not mutate the original _config', () => {
    const before = { ...editor._config, forecast: { ...editor._config.forecast } };
    editor._valueChanged(event('style1'), 'forecast.style');
    expect(editor._config).toEqual(before);
  });

  it('creates intermediate levels for a dotted key on missing branches', () => {
    editor._config = { title: 'x' };
    editor._valueChanged(event(7), 'forecast.foo');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.forecast.foo).toBe(7);
  });

  it('handles three-level dotted keys (a.b.c)', () => {
    editor._config = {};
    editor._valueChanged(event('deep'), 'a.b.c');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.a.b.c).toBe('deep');
  });

  it('triggers a Lit re-render via requestUpdate', () => {
    editor._valueChanged(event('Living Room'), 'title');
    expect(editor.requestUpdate).toHaveBeenCalledOnce();
  });
});

describe('editor._sensorPickerChanged', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor({
      sensors: { temperature: 'sensor.temp', humidity: 'sensor.hum' },
    });
  });

  it('is a no-op when _config is missing', () => {
    editor._config = null;
    editor._sensorPickerChanged('temperature', 'sensor.new');
    expect(editor.configChanged).not.toHaveBeenCalled();
  });

  it('adds a new sensor key', () => {
    editor._sensorPickerChanged('illuminance', 'sensor.lux');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.sensors.illuminance).toBe('sensor.lux');
    expect(newCfg.sensors.temperature).toBe('sensor.temp'); // existing kept
  });

  it('replaces an existing sensor key', () => {
    editor._sensorPickerChanged('temperature', 'sensor.kitchen_temp');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.sensors.temperature).toBe('sensor.kitchen_temp');
  });

  it('deletes the key on empty-string value (the picker-clear path)', () => {
    editor._sensorPickerChanged('temperature', '');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect('temperature' in newCfg.sensors).toBe(false);
    expect(newCfg.sensors.humidity).toBe('sensor.hum'); // sibling kept
  });

  it('deletes the key on null value', () => {
    editor._sensorPickerChanged('temperature', null);
    expect('temperature' in editor.configChanged.mock.calls[0][0].sensors).toBe(false);
  });

  it('deletes the key on undefined value', () => {
    editor._sensorPickerChanged('temperature', undefined);
    expect('temperature' in editor.configChanged.mock.calls[0][0].sensors).toBe(false);
  });

  it('starts with an empty sensors object when none was configured', () => {
    editor._config = {};
    editor._sensorPickerChanged('temperature', 'sensor.new');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.sensors).toEqual({ temperature: 'sensor.new' });
  });

  it('does not mutate the original sensors object', () => {
    const before = { ...editor._config.sensors };
    editor._sensorPickerChanged('illuminance', 'sensor.lux');
    expect(editor._config.sensors).toEqual(before);
  });

  it('triggers a Lit re-render', () => {
    editor._sensorPickerChanged('temperature', 'sensor.new');
    expect(editor.requestUpdate).toHaveBeenCalledOnce();
  });
});

describe('editor._actionChanged', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor({ tap_action: { action: 'more-info' } });
  });

  it('writes a non-null value', () => {
    editor._actionChanged('hold_action', { action: 'navigate', navigation_path: '/x' });
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.hold_action).toEqual({ action: 'navigate', navigation_path: '/x' });
    expect(newCfg.tap_action).toEqual({ action: 'more-info' }); // unchanged
  });

  it('deletes the key on undefined (picker-cleared)', () => {
    editor._actionChanged('tap_action', undefined);
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect('tap_action' in newCfg).toBe(false);
  });

  it('deletes the key on null', () => {
    editor._actionChanged('tap_action', null);
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect('tap_action' in newCfg).toBe(false);
  });
});

describe('editor._conditionMappingChanged', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor({ condition_mapping: { rainy_threshold_mm: 0.3 } });
  });

  it('writes a numeric value, coercing the string from the input', () => {
    editor._conditionMappingChanged(event('5.5'), 'pouring_threshold_mm');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.condition_mapping.pouring_threshold_mm).toBe(5.5);
    expect(newCfg.condition_mapping.rainy_threshold_mm).toBe(0.3); // unchanged
  });

  it('deletes the key on empty string (use default)', () => {
    editor._conditionMappingChanged(event(''), 'rainy_threshold_mm');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect('rainy_threshold_mm' in (newCfg.condition_mapping || {})).toBe(false);
  });

  it('drops the entire condition_mapping when emptied to {}', () => {
    editor._conditionMappingChanged(event(''), 'rainy_threshold_mm');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect('condition_mapping' in newCfg).toBe(false);
  });

  it('ignores non-numeric input (no write, no exception)', () => {
    editor._conditionMappingChanged(event('not a number'), 'rainy_threshold_mm');
    // configChanged still fires (the editor still touches the config wrapper),
    // but rainy_threshold_mm keeps its previous value.
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.condition_mapping.rainy_threshold_mm).toBe(0.3);
  });
});

describe('editor._setMode', () => {
  it('station: sets show_station=true, show_forecast=false', () => {
    const editor = makeEditor({ show_station: true, show_forecast: true });
    editor._setMode('station');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.show_station).toBe(true);
    expect(newCfg.show_forecast).toBe(false);
  });

  it('forecast: sets show_station=false, show_forecast=true', () => {
    const editor = makeEditor({ show_station: true, show_forecast: false });
    editor._setMode('forecast');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.show_station).toBe(false);
    expect(newCfg.show_forecast).toBe(true);
  });

  it('combination: both true', () => {
    const editor = makeEditor({});
    editor._setMode('combination');
    const newCfg = editor.configChanged.mock.calls[0][0];
    expect(newCfg.show_station).toBe(true);
    expect(newCfg.show_forecast).toBe(true);
  });

  it('reflects via the _mode getter after a round-trip', () => {
    const editor = makeEditor({});
    editor._setMode('forecast');
    editor._config = editor.configChanged.mock.calls[0][0];
    expect(editor._mode).toBe('forecast');
  });
});

describe('editor._mode getter', () => {
  it('reads "combination" when both flags ON (or default)', () => {
    expect(makeEditor({ show_station: true, show_forecast: true })._mode).toBe('combination');
  });

  it('reads "forecast" when station off + forecast on', () => {
    expect(makeEditor({ show_station: false, show_forecast: true })._mode).toBe('forecast');
  });

  it('reads "station" when forecast off (station defaults true)', () => {
    expect(makeEditor({ show_forecast: false })._mode).toBe('station');
  });

  it('reads "station" when both flags absent (station-only is the legacy default)', () => {
    expect(makeEditor({})._mode).toBe('station');
  });
});

describe('editor._pastDataAvailable', () => {
  it('true when a station sensor is configured', () => {
    expect(makeEditor({ sensors: { temperature: 'sensor.t' } })._pastDataAvailable()).toBe(true);
  });

  it('true when the Open-Meteo past opt-in is on', () => {
    expect(makeEditor({ forecast: { openmeteo_history: true } })._pastDataAvailable()).toBe(true);
  });

  it('false with no sensors and the opt-in off', () => {
    expect(makeEditor({ sensors: {}, forecast: {} })._pastDataAvailable()).toBe(false);
    expect(makeEditor({})._pastDataAvailable()).toBe(false);
  });

  it('ignores empty-string sensor slots', () => {
    expect(makeEditor({ sensors: { temperature: '' } })._pastDataAvailable()).toBe(false);
  });
});

describe('editor auto-flip to forecast-only (no past data)', () => {
  it('forces forecast-only when no past data and mode is combination', () => {
    const editor = makeEditor({ show_station: true, show_forecast: true });
    editor.updated(new Map([['_config', {}]]));
    const cfg = editor.configChanged.mock.calls[0][0];
    expect(cfg.show_station).toBe(false);
    expect(cfg.show_forecast).toBe(true);
  });

  it('does not flip when a sensor makes past data available', () => {
    const editor = makeEditor({
      show_station: true, show_forecast: true, sensors: { temperature: 'sensor.t' },
    });
    editor.updated(new Map([['_config', {}]]));
    expect(editor.configChanged).not.toHaveBeenCalled();
  });

  it('does not flip when the opt-in makes past data available', () => {
    const editor = makeEditor({
      show_station: true, show_forecast: true, forecast: { openmeteo_history: true },
    });
    editor.updated(new Map([['_config', {}]]));
    expect(editor.configChanged).not.toHaveBeenCalled();
  });

  it('does not flip when already forecast-only', () => {
    const editor = makeEditor({ show_station: false, show_forecast: true });
    editor.updated(new Map([['_config', {}]]));
    expect(editor.configChanged).not.toHaveBeenCalled();
  });

  it('ignores updates that did not change _config', () => {
    const editor = makeEditor({ show_station: true, show_forecast: true });
    editor.updated(new Map([['hass', {}]]));
    expect(editor.configChanged).not.toHaveBeenCalled();
  });
});
