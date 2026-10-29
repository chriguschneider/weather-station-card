// @vitest-environment jsdom
//
// Location panel (#357, #372): home line, "Use another location" switch,
// place search / determine (mocked fetch), fields and "Show times in".

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'lit';
import { renderLocationSection } from '../src/editor/render-location.js';
import { resolveElevation } from '../src/zero-degree-trend.js';
import { DEFAULTS } from '../src/defaults.js';

const HASS = {
  language: 'en',
  config: {
    latitude: 47.37,
    longitude: 8.54,
    elevation: 410,
    time_zone: 'Europe/Zurich',
    location_name: 'Home',
  },
};

function makeEditor(overrides = {}) {
  return {
    hass: HASS,
    _locUi: { query: '', results: [], status: null },
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
  const byField = (name) => forms.find((f) => f.schema.some((s) => s.name === name));
  return {
    container,
    forms,
    switchForm: byField('use_location'),
    fieldsForm: byField('elevation'),
    mapForm: byField('location'),
    queryForm: byField('query'),
    modeForm: forms.find((f) => f.schema.length === 1 && f.schema[0].name === 'time_zone'),
    summary: container.querySelector('.panel-summary').textContent,
  };
}

const values = (field) => field.selector.select.options.map((o) => o.value);

async function realEditor(config, hass = HASS) {
  await import('../src/weather-station-card-editor.js');
  const real = document.createElement('weather-station-card-editor');
  real.hass = hass;
  real._config = config;
  real.configChanged = vi.fn();
  real.requestUpdate = vi.fn();
  return real;
}

const change = (form, value) =>
  form.dispatchEvent(new CustomEvent('value-changed', { detail: { value } }));

const lastConfig = (real) => real.configChanged.mock.calls.at(-1)[0];

const jsonResponse = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe('location panel: home and switch', () => {
  it('shows only the home line and the switch while off', () => {
    const m = mount(makeEditor());
    expect(m.container.querySelector('.loc-home').textContent)
      .toContain('Home · 47.37, 8.54 · 410 m · Europe/Zurich');
    expect(m.switchForm.data).toEqual({ use_location: false });
    expect(m.forms).toHaveLength(1);
    expect(m.summary).toBe('location_summary_home · Home');
  });

  it('is the first section of the editor', async () => {
    const real = await realEditor({ show_station: true });
    const html = JSON.stringify(real.render().strings);
    expect(html.indexOf('loc-search')).toBeGreaterThanOrEqual(0);
    const src = (await import('node:fs')).readFileSync('src/weather-station-card-editor.ts', 'utf8');
    const order = ['Location', 'Basics', 'Sensors', 'Chart', 'LivePanel', 'Units', 'Tap']
      .map((n) => src.indexOf(`render${n}Section(this, ctx)`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i > 0)).toBe(true);
  });

  it('shows the fields once coordinates are set, with a coordinate summary', () => {
    const m = mount(makeEditor(), {
      location: { latitude: 46.5, longitude: 7.9, elevation: 1200, time_zone: 'Europe/Zurich' },
      time_zone: 'location',
    });
    expect(m.switchForm.data).toEqual({ use_location: true });
    expect(m.mapForm.data).toEqual({ location: { latitude: 46.5, longitude: 7.9 } });
    expect(m.fieldsForm.data).toEqual({ elevation: 1200, time_zone: 'Europe/Zurich' });
    expect(m.modeForm.data).toEqual({ time_zone: 'location' });
    expect(m.summary).toBe('46.50, 7.90 · 1200 m · time_zone_location');
  });

  it('summary names Home time for the server mode', () => {
    const m = mount(makeEditor(), { location: { latitude: 46.5, longitude: 7.9 } });
    expect(m.summary).toBe('46.50, 7.90 · time_zone_server');
  });

  it('switch on presets home coordinates, server zone, no elevation, location time', async () => {
    const real = await realEditor({ show_station: true });
    const m = mount(makeEditor({ _locationSwitchChanged: real._locationSwitchChanged }));
    change(m.switchForm, { use_location: true });
    const cfg = lastConfig(real);
    expect(cfg.location).toEqual({ latitude: 47.37, longitude: 8.54, time_zone: 'Europe/Zurich' });
    expect('elevation' in cfg.location).toBe(false);
    expect(cfg.time_zone).toBe('location');
  });

  it('switch off removes location and time_zone', async () => {
    const real = await realEditor({
      show_station: true,
      location: { latitude: 1, longitude: 2, elevation: 3, time_zone: 'Europe/Zurich' },
      time_zone: 'location',
    });
    const m = mount(makeEditor({ _locationSwitchChanged: real._locationSwitchChanged }));
    change(m.switchForm, { use_location: false });
    const cfg = lastConfig(real);
    expect('location' in cfg).toBe(false);
    expect('time_zone' in cfg).toBe(false);
    expect(cfg.show_station).toBe(true);
  });
});

describe('location panel: fields', () => {
  const placed = { location: { latitude: 47.1, longitude: -111.4 } };

  it("lists the browser's zones in a closed dropdown", () => {
    const { fieldsForm } = mount(makeEditor(), placed);
    const field = fieldsForm.schema.find((s) => s.name === 'time_zone');
    expect(field.selector.select.custom_value).toBe(false);
    expect(values(field)).toEqual(Intl.supportedValuesOf('timeZone'));
  });

  it('falls back to a text field without Intl.supportedValuesOf, or when it throws', () => {
    const original = Intl.supportedValuesOf;
    try {
      for (const stub of [undefined, () => { throw new RangeError('nope'); }]) {
        Intl.supportedValuesOf = stub;
        const { fieldsForm } = mount(makeEditor(), placed);
        expect(fieldsForm.schema.find((s) => s.name === 'time_zone').selector).toEqual({ text: {} });
      }
    } finally {
      Intl.supportedValuesOf = original;
    }
  });

  it('keeps a configured zone the browser does not list', () => {
    const { fieldsForm } = mount(makeEditor(), { location: { ...placed.location, time_zone: 'Etc/Custom' } });
    expect(values(fieldsForm.schema.find((s) => s.name === 'time_zone'))[0]).toBe('Etc/Custom');
  });

  it('offers location and home time and keeps a YAML-only IANA name', () => {
    expect(values(mount(makeEditor(), placed).modeForm.schema[0])).toEqual(['location', 'server']);
    const iana = mount(makeEditor(), { ...placed, time_zone: 'America/Denver' });
    expect(values(iana.modeForm.schema[0])).toEqual(['location', 'server', 'America/Denver']);
  });

  it('writes elevation and zone into location; ignores a non-IANA zone', async () => {
    const real = await realEditor({ location: { latitude: 47.1, longitude: -111.4 } });
    const m = mount(makeEditor({ _locationChanged: real._locationChanged }), placed);
    change(m.fieldsForm, { elevation: 1200, time_zone: 'America/Denver' });
    expect(lastConfig(real).location)
      .toEqual({ latitude: 47.1, longitude: -111.4, elevation: 1200, time_zone: 'America/Denver' });
    change(m.fieldsForm, { elevation: undefined, time_zone: 'Mars/Base' });
    expect(lastConfig(real).location).toEqual({ latitude: 47.1, longitude: -111.4 });
  });

  it('"Show times in" writes time_zone; server keeps the YAML terse', async () => {
    const real = await realEditor({});
    const { modeForm } = mount(makeEditor({ _timeZoneModeChanged: real._timeZoneModeChanged }), placed);
    change(modeForm, { time_zone: 'location' });
    expect(lastConfig(real).time_zone).toBe('location');
    change(modeForm, { time_zone: 'server' });
    expect('time_zone' in lastConfig(real)).toBe(false);
  });

  it('handlers ignore events from other targets or without config', async () => {
    const real = await realEditor({});
    const stray = new CustomEvent('value-changed', { detail: { value: { time_zone: 'location' } } });
    for (const h of ['_locationChanged', '_timeZoneModeChanged', '_locationSwitchChanged', '_locationMapChanged']) {
      real[h](stray);
    }
    expect(real.configChanged).not.toHaveBeenCalled();

    const noConfig = await realEditor(undefined);
    noConfig._config = undefined;
    const form = document.createElement('ha-form');
    for (const h of ['_locationChanged', '_timeZoneModeChanged', '_locationSwitchChanged', '_locationMapChanged']) {
      form.addEventListener('value-changed', noConfig[h]);
    }
    change(form, { time_zone: 'location', use_location: true, location: { latitude: 1, longitude: 2 } });
    expect(noConfig.configChanged).not.toHaveBeenCalled();
  });
});

describe('location panel: search and determine (mocked fetch)', () => {
  const placed = { location: { latitude: 47.1, longitude: -111.4 } };

  it('neither request fires on render, typing or marker drag', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const real = await realEditor({ ...placed });
    const m = mount(makeEditor({
      _locationQueryChanged: real._locationQueryChanged,
      _locationMapChanged: real._locationMapChanged,
    }), placed);
    change(m.queryForm, { query: 'Bern' });
    change(m.mapForm, { location: { latitude: 46.9, longitude: 7.4, radius: 0 } });
    expect(real._locUi.query).toBe('Bern');
    expect(lastConfig(real).location).toEqual({ latitude: 46.9, longitude: 7.4 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('search sends one request, a hit writes all four fields and skips determine', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      results: [{
        name: 'Bern', admin1: 'Bern', country: 'Switzerland',
        latitude: 46.95, longitude: 7.45, elevation: 542, timezone: 'Europe/Zurich',
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const real = await realEditor({ location: { latitude: 1, longitude: 2 } });
    real._locUi = { query: 'Bern', results: [], status: null };
    await real._locationSearch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=Bern&count=10&language=en&format=json',
    );
    expect(real._locUi.results).toHaveLength(1);

    const m = mount(makeEditor({ _locUi: real._locUi, _locationPick: real._locationPick }), placed);
    const hit = m.container.querySelector('.loc-hit');
    expect(hit.textContent.trim()).toBe('Bern, Bern, Switzerland');
    hit.click();
    expect(lastConfig(real).location).toEqual({
      latitude: 46.95, longitude: 7.45, elevation: 542, time_zone: 'Europe/Zurich',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('search failure and empty result show a message', async () => {
    const real = await realEditor({ location: { latitude: 1, longitude: 2 } });
    real._locUi = { query: 'x', results: [], status: null };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, true)));
    await real._locationSearch();
    expect(real._locUi.status.text).toBe('No place found.');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await real._locationSearch();
    expect(real._locUi.status.kind).toBe('error');
  });

  it('an empty query sends nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const real = await realEditor({});
    await real._locationSearch();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('determine writes elevation and zone and leaves the coordinates alone', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ elevation: 1234, timezone: 'America/Denver' }));
    vi.stubGlobal('fetch', fetchMock);
    const real = await realEditor({ location: { latitude: 47.1, longitude: -111.4 } });
    await real._locationDetermine();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://api.open-meteo.com/v1/forecast?latitude=47.1&longitude=-111.4&timezone=auto');
    expect(lastConfig(real).location).toEqual({
      latitude: 47.1, longitude: -111.4, elevation: 1234, time_zone: 'America/Denver',
    });
    expect(real._locUi.status).toEqual({ kind: 'ok', text: 'determined for 47.10, -111.40' });
  });

  it('a failed determine shows the error and writes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false)));
    const real = await realEditor({ location: { latitude: 47.1, longitude: -111.4 } });
    await real._locationDetermine();
    expect(real.configChanged).not.toHaveBeenCalled();
    expect(real._locUi.status.kind).toBe('error');
  });

  it('determine without coordinates does nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const real = await realEditor({});
    await real._locationDetermine();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveElevation', () => {
  const hass = { config: { elevation: 410 } };
  it('prefers location.elevation, then top-level, then sensor, then HA', () => {
    const sensors = [{ elevation: 700 }];
    expect(resolveElevation({ location: { elevation: 1200 }, elevation: 900 }, sensors, hass)).toBe(1200);
    expect(resolveElevation({ location: { latitude: 1 }, elevation: 900 }, sensors, hass)).toBe(900);
    expect(resolveElevation({ location: {} }, sensors, hass)).toBe(700);
    expect(resolveElevation({}, [], hass)).toBe(410);
  });
});
