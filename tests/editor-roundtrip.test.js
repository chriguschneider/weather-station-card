// @vitest-environment jsdom
// Round-trip guarantees of the editor's ha-form handlers: the form
// hands back what it was given → the emitted config is identical;
// clearing a field removes the key; a reset leaves no empty parent.

import { describe, it, expect, vi } from 'vitest';
import '../src/weather-station-card-editor.js';

const CONFIG = {
  type: 'custom:weather-station-card',
  title: 'Home',
  days: 5,
  show_main: false,
  sensors: { temperature: 'sensor.t', humidity: 'sensor.h' },
  units: { pressure: 'hPa', speed: 'km/h' },
  forecast: { style: 'style2', round_temp: true },
};

function makeEditor(config = CONFIG) {
  const editor = document.createElement('weather-station-card-editor');
  editor._config = JSON.parse(JSON.stringify(config));
  editor.requestUpdate = vi.fn();
  editor.configChanged = vi.fn();
  return editor;
}

// ha-form events carry the whole form value in detail.value.
function formEvent(value) {
  const target = document.createElement('ha-form');
  return { target, detail: { value } };
}

const emitted = (editor) => editor.configChanged.mock.calls[0][0];

describe('unchanged data in → identical config out', () => {
  it('_unitsChanged', () => {
    const e = makeEditor();
    e._unitsChanged(formEvent({ ...CONFIG.units }));
    expect(emitted(e)).toEqual(CONFIG);
  });

  it('_sensorsChanged', () => {
    const e = makeEditor();
    e._sensorsChanged(formEvent({ ...CONFIG.sensors }));
    expect(emitted(e)).toEqual(CONFIG);
  });

  it('_chartTopChanged', () => {
    const e = makeEditor();
    e._chartTopChanged(formEvent({ title: 'Home', days: 5 }));
    expect(emitted(e)).toEqual(CONFIG);
  });

  it('_chartForecastChanged', () => {
    const e = makeEditor();
    e._chartForecastChanged(formEvent({ ...CONFIG.forecast }));
    expect(emitted(e)).toEqual(CONFIG);
  });

  it('_livePanelChanged', () => {
    const e = makeEditor();
    e._livePanelChanged(formEvent({ show_main: false }));
    expect(emitted(e)).toEqual(CONFIG);
  });

  it('does not mutate the config it was given', () => {
    const e = makeEditor();
    e._chartForecastChanged(formEvent({ style: 'style1' }));
    expect(e._config).toEqual(CONFIG);
  });

  it('ignores events that do not come from an ha-form', () => {
    const e = makeEditor();
    e._unitsChanged({ target: document.createElement('div'), detail: { value: {} } });
    e._chartTopChanged({ target: document.createElement('div'), detail: { value: {} } });
    expect(e.configChanged).not.toHaveBeenCalled();
  });
});

describe('clearing a field deletes the key', () => {
  it('_chartTopChanged: empty string and undefined', () => {
    const e = makeEditor();
    e._chartTopChanged(formEvent({ title: '', days: undefined }));
    const out = emitted(e);
    expect('title' in out).toBe(false);
    expect('days' in out).toBe(false);
    expect(out.sensors).toEqual(CONFIG.sensors);
  });

  it('_chartForecastChanged keeps the other forecast keys', () => {
    const e = makeEditor();
    e._chartForecastChanged(formEvent({ style: '' }));
    expect(emitted(e).forecast).toEqual({ round_temp: true });
  });

  it('_livePanelChanged', () => {
    const e = makeEditor();
    e._livePanelChanged(formEvent({ show_main: undefined }));
    expect('show_main' in emitted(e)).toBe(false);
  });

  it('_unitsChanged: a field the form no longer reports is gone', () => {
    const e = makeEditor();
    e._unitsChanged(formEvent({ pressure: 'hPa' }));
    expect(emitted(e).units).toEqual({ pressure: 'hPa' });
  });

  it('_sensorsChanged: a field the form no longer reports is gone', () => {
    const e = makeEditor();
    e._sensorsChanged(formEvent({ temperature: 'sensor.t' }));
    expect(emitted(e).sensors).toEqual({ temperature: 'sensor.t' });
  });
});

describe('_resetSection', () => {
  it('removes an emptied forecast: {} along with the section keys', () => {
    const e = makeEditor({ ...CONFIG, forecast: { style: 'style2', round_temp: true } });
    e._resetSection('chart');
    const out = emitted(e);
    expect('forecast' in out).toBe(false);
    expect('days' in out).toBe(false);
    expect(out.title).toBe('Home');
  });

  it('keeps forecast keys that belong to another section', () => {
    const e = makeEditor({ ...CONFIG, forecast: { style: 'style2', type: 'hourly' } });
    e._resetSection('chart');
    expect(emitted(e).forecast).toEqual({ type: 'hourly' });
  });

  it('is a no-op for an unknown section', () => {
    const e = makeEditor();
    e._resetSection('nope');
    expect(e.configChanged).not.toHaveBeenCalled();
  });

  it('resetting the sensors section removes the sensors block', () => {
    const e = makeEditor();
    e._resetSection('sensors');
    expect('sensors' in emitted(e)).toBe(false);
  });
});

describe('_deleteByPath', () => {
  it('prunes every emptied ancestor', () => {
    const e = makeEditor();
    const obj = { a: { b: { c: 1 } }, keep: 1 };
    e._deleteByPath(obj, 'a.b.c');
    expect(obj).toEqual({ keep: 1 });
  });

  it('stops pruning at the first non-empty ancestor', () => {
    const e = makeEditor();
    const obj = { a: { b: { c: 1 }, other: 2 } };
    e._deleteByPath(obj, 'a.b.c');
    expect(obj).toEqual({ a: { other: 2 } });
  });

  it('is a no-op when the path does not exist', () => {
    const e = makeEditor();
    const obj = { a: 1 };
    e._deleteByPath(obj, 'x.y.z');
    e._deleteByPath(obj, 'a.b');
    expect(obj).toEqual({ a: 1 });
  });

  it('deletes a top-level key', () => {
    const e = makeEditor();
    const obj = { a: 1, b: 2 };
    e._deleteByPath(obj, 'a');
    expect(obj).toEqual({ b: 2 });
  });
});
