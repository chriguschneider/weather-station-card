// @vitest-environment jsdom
//
// Location panel (#357): zone dropdown, text fallback, and the two
// handlers that write `location.*` and `time_zone`.

import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import { renderLocationSection } from '../src/editor/render-location.js';
import { DEFAULTS } from '../src/defaults.js';

function makeEditor(overrides = {}) {
  return {
    hass: null,
    _isPanelExpanded: vi.fn(() => true),
    _setPanelExpanded: vi.fn(),
    _resetSection: vi.fn(),
    ...overrides,
  };
}

const makeCtx = (cfg = {}) => ({ t: (k) => k, cfg: { ...DEFAULTS, ...cfg } });

function mount(editor, cfg) {
  const container = document.createElement('div');
  render(renderLocationSection(editor, makeCtx(cfg)), container);
  const forms = [...container.querySelectorAll('ha-form')];
  return {
    container,
    placeForm: forms.find((f) => f.schema.some((s) => s.name === 'latitude')),
    modeForm: forms.find((f) => !f.schema.some((s) => s.name === 'latitude')),
  };
}

const values = (field) => field.selector.select.options.map((o) => o.value);

async function realEditor(config) {
  await import('../src/weather-station-card-editor.js');
  const real = document.createElement('weather-station-card-editor');
  real._config = config;
  real.configChanged = vi.fn();
  real.requestUpdate = vi.fn();
  return real;
}

const change = (form, value) =>
  form.dispatchEvent(new CustomEvent('value-changed', { detail: { value } }));

describe('location section', () => {
  it("lists the browser's zones in a closed dropdown", () => {
    const { placeForm } = mount(makeEditor());
    const field = placeForm.schema.find((s) => s.name === 'time_zone');
    expect(field.selector.select.custom_value).toBe(false);
    expect(values(field)).toEqual(Intl.supportedValuesOf('timeZone'));
    expect(values(field)).toContain('America/Denver');
  });

  it('falls back to a text field without Intl.supportedValuesOf', () => {
    const original = Intl.supportedValuesOf;
    Intl.supportedValuesOf = undefined;
    try {
      const { placeForm } = mount(makeEditor());
      expect(placeForm.schema.find((s) => s.name === 'time_zone').selector).toEqual({ text: {} });
    } finally {
      Intl.supportedValuesOf = original;
    }
  });

  it('offers server and location time and keeps a YAML-only IANA name', () => {
    const plain = mount(makeEditor());
    expect(values(plain.modeForm.schema[0])).toEqual(['server', 'location']);
    expect(plain.modeForm.data).toEqual({ time_zone: 'server' });

    const iana = mount(makeEditor(), { time_zone: 'America/Denver' });
    expect(values(iana.modeForm.schema[0])).toEqual(['server', 'location', 'America/Denver']);
    expect(iana.modeForm.data).toEqual({ time_zone: 'America/Denver' });
  });

  it('writes location.*, and drops location once it is empty', async () => {
    const real = await realEditor({ show_station: true });
    const { placeForm } = mount(makeEditor({ _locationChanged: real._locationChanged }));
    change(placeForm, { latitude: 47.1, longitude: -111.4, time_zone: 'America/Denver' });
    expect(real.configChanged.mock.calls[0][0].location)
      .toEqual({ latitude: 47.1, longitude: -111.4, time_zone: 'America/Denver' });
    real._config = real.configChanged.mock.calls[0][0];
    change(placeForm, { latitude: undefined, longitude: undefined, time_zone: undefined });
    expect('location' in real.configChanged.mock.calls[1][0]).toBe(false);
  });

  it('ignores a free-text zone that is not an IANA name', async () => {
    const real = await realEditor({});
    const { placeForm } = mount(makeEditor({ _locationChanged: real._locationChanged }));
    change(placeForm, { time_zone: 'Mars/Base' });
    expect('location' in real.configChanged.mock.calls[0][0]).toBe(false);
  });

  it('"Show times in" writes time_zone; server keeps the YAML terse', async () => {
    const real = await realEditor({});
    const { modeForm } = mount(makeEditor({ _timeZoneModeChanged: real._timeZoneModeChanged }));
    change(modeForm, { time_zone: 'location' });
    expect(real.configChanged.mock.calls[0][0].time_zone).toBe('location');
    change(modeForm, { time_zone: 'server' });
    expect('time_zone' in real.configChanged.mock.calls[1][0]).toBe(false);
  });
});

describe('location section details', () => {
  it('falls back to a text field when Intl.supportedValuesOf throws', () => {
    const original = Intl.supportedValuesOf;
    Intl.supportedValuesOf = () => { throw new RangeError('nope'); };
    try {
      const { placeForm } = mount(makeEditor());
      expect(placeForm.schema.find((s) => s.name === 'time_zone').selector).toEqual({ text: {} });
    } finally {
      Intl.supportedValuesOf = original;
    }
  });

  it('labels the fields and fills the form from the config', () => {
    const { placeForm, modeForm } = mount(makeEditor(), {
      location: { latitude: 47.1, longitude: -111.4, time_zone: 'America/Denver' },
    });
    expect(placeForm.computeLabel({ name: 'latitude' })).toBe('location_latitude');
    expect(placeForm.computeLabel({ name: 'longitude' })).toBe('location_longitude');
    expect(placeForm.computeLabel({ name: 'time_zone' })).toBe('location_time_zone');
    expect(modeForm.computeLabel()).toBe('time_zone_label');
    expect(placeForm.data).toEqual({ latitude: 47.1, longitude: -111.4, time_zone: 'America/Denver' });
  });

  it('keeps a configured zone the browser does not list', () => {
    const { placeForm } = mount(makeEditor(), { location: { time_zone: 'Etc/Custom' } });
    const field = placeForm.schema.find((s) => s.name === 'time_zone');
    expect(values(field)[0]).toBe('Etc/Custom');
  });

  it('handlers ignore events without config or from other targets', async () => {
    const real = await realEditor({});
    const stray = new CustomEvent('value-changed', { detail: { value: { time_zone: 'location' } } });
    real._locationChanged(stray);
    real._timeZoneModeChanged(stray);
    expect(real.configChanged).not.toHaveBeenCalled();

    const noConfig = await realEditor(undefined);
    noConfig._config = undefined;
    const form = document.createElement('ha-form');
    form.addEventListener('value-changed', noConfig._locationChanged);
    form.addEventListener('value-changed', noConfig._timeZoneModeChanged);
    change(form, { time_zone: 'location' });
    expect(noConfig.configChanged).not.toHaveBeenCalled();
  });
});
