// @vitest-environment jsdom
//
// Schema-driven editor smoketests for the redesigned (v2.4, ADR-0023)
// basics / sensors / chart / live-panel sections.
//
// Pattern: render the section into a jsdom <div>, then read each
// <ha-form>'s `.schema` property (lit's property binding) to assert
// that the schema-driven field set matches what the section should
// expose for the given config / sensor presence. Custom elements
// render as unknown HTMLElements; we only read their properties.
// Grid containers ({type: 'grid', schema: [...]}) are flattened.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, html } from 'lit';
import { renderBasicsSection } from '../src/editor/render-basics.js';
import { renderSensorsSection } from '../src/editor/render-sensors.js';
import { renderChartSection } from '../src/editor/render-chart.js';
import { renderLivePanelSection } from '../src/editor/render-live-panel.js';
import { DEFAULTS, DEFAULTS_FORECAST } from '../src/defaults.js';

function makeEditor(overrides = {}) {
  return {
    hass: null,
    _config: null,
    _mode: 'combination',
    _pastSource: 'station',
    _clockMode: 'off',
    _setMode: vi.fn(),
    _setPastSource: vi.fn(),
    _setClockMode: vi.fn(),
    _applyTogglePaths: vi.fn(),
    _isPanelExpanded: vi.fn(() => true),
    _setPanelExpanded: vi.fn(),
    _valueChanged: vi.fn(),
    _sensorsChanged: vi.fn(),
    _sensorPickerChanged: vi.fn(),
    _unitsChanged: vi.fn(),
    _chartTopChanged: vi.fn(),
    _chartForecastChanged: vi.fn(),
    _livePanelChanged: vi.fn(),
    _actionChanged: vi.fn(),
    _resetSection: vi.fn(),
    _renderSunshineAvailabilityHint: vi.fn(
      () => html`<span class="sunshine-availability-mock">availability info</span>`,
    ),
    configChanged: vi.fn(),
    requestUpdate: vi.fn(),
    ...overrides,
  };
}

function makeCtx({ cfg = {}, fcfg = {}, ...overrides } = {}) {
  const mergedFcfg = { ...DEFAULTS_FORECAST, ...fcfg };
  const mergedCfg = { ...DEFAULTS, ...cfg, forecast: mergedFcfg };
  return {
    t: (k) => k,
    cfg: mergedCfg,
    fcfg: mergedFcfg,
    sensorsConfig: {},
    unitsConfig: {},
    mode: 'combination',
    showsStation: true,
    showsForecast: true,
    hasSensor: () => false,
    hasLiveValue: () => false,
    pastDataAvailable: true,
    ...overrides,
  };
}

function renderInto(renderFn, editor, ctx) {
  const container = document.createElement('div');
  render(renderFn(editor, ctx), container);
  return container;
}

// Flatten one form's schema, recursing into grid containers.
function flattenSchema(fields, out = []) {
  for (const field of fields || []) {
    if (field.type === 'grid' && Array.isArray(field.schema)) {
      flattenSchema(field.schema, out);
    } else {
      out.push(field);
    }
  }
  return out;
}

function collectFormSchemas(container) {
  return Array.from(container.querySelectorAll('ha-form'))
    .map((form) => flattenSchema(form.schema || []));
}

function allFieldNames(container) {
  return collectFormSchemas(container).flatMap((schema) => schema.map((f) => f.name));
}

// Find the (form, field) pair for a given flattened field name.
function findField(container, name) {
  for (const form of container.querySelectorAll('ha-form')) {
    for (const field of flattenSchema(form.schema || [])) {
      if (field.name === name) return { form, field };
    }
  }
  return null;
}

function selectOptionValues(field) {
  return (field.selector?.select?.options || []).map((o) => (typeof o === 'string' ? o : o.value));
}

// ── renderBasicsSection ───────────────────────────────────────────────

describe('renderBasicsSection (schema-driven)', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor();
  });

  it('renders without throwing on default config', () => {
    expect(() => renderInto(renderBasicsSection, editor, makeCtx())).not.toThrow();
  });

  it('exposes mode, chart type, and title fields', () => {
    const names = allFieldNames(renderInto(renderBasicsSection, editor, makeCtx()));
    expect(names).toContain('mode');
    expect(names).toContain('type');
    expect(names).toContain('title');
  });

  it('shows the weather entity while a forecast is shown', () => {
    const names = allFieldNames(renderInto(renderBasicsSection, editor, makeCtx()));
    expect(names).toContain('weather_entity');
  });

  it('hides the weather entity in station-only mode', () => {
    const container = renderInto(
      renderBasicsSection,
      editor,
      makeCtx({ mode: 'station', showsForecast: false }),
    );
    expect(allFieldNames(container)).not.toContain('weather_entity');
  });
});

// ── renderSensorsSection ──────────────────────────────────────────────

describe('renderSensorsSection (schema-driven)', () => {
  it('exposes the past-source dropdown plus the 12 pickers for station source', () => {
    const container = renderInto(renderSensorsSection, makeEditor(), makeCtx());
    const names = allFieldNames(container);
    expect(names).toContain('past_source');
    for (const key of [
      'temperature', 'humidity', 'illuminance', 'precipitation',
      'precipitation_rate', 'pressure',
      'wind_speed', 'gust_speed', 'wind_direction', 'uv_index', 'dew_point',
      'sunshine_duration',
    ]) {
      expect(names).toContain(key);
    }
  });

  it('pairs the rate picker with the precipitation counter (#253)', () => {
    const container = renderInto(renderSensorsSection, makeEditor(), makeCtx());
    const names = allFieldNames(container);
    expect(names.indexOf('precipitation_rate')).toBe(names.indexOf('precipitation') + 1);
  });

  // Z-Wave POPP rain sensors (and hand-rolled ESPHome templates) ship
  // mm/h with no device_class at all. Filtering on the class alone hid
  // the only working rate entity behind an unavailable one that had it.
  it('offers rate entities by unit as well as by device_class (#253)', () => {
    const hass = {
      states: {
        'sensor.popp_rain_rate': { state: '0.0', attributes: { unit_of_measurement: 'mm/h' } },
        'sensor.classy_rate': {
          state: '0.0',
          attributes: { device_class: 'precipitation_intensity', unit_of_measurement: 'mm/h' },
        },
        'sensor.imperial_rate': { state: '0.0', attributes: { unit_of_measurement: 'in/h' } },
        'sensor.counter': { state: '5.2', attributes: { unit_of_measurement: 'mm' } },
      },
    };
    const container = renderInto(renderSensorsSection, makeEditor({ hass }), makeCtx());
    const { field } = findField(container, 'precipitation_rate');
    const offered = field.selector.entity.include_entities;
    expect(offered).toContain('sensor.popp_rain_rate');
    expect(offered).toContain('sensor.classy_rate');
    expect(offered).toContain('sensor.imperial_rate');
    expect(offered).not.toContain('sensor.counter');
  });

  it('wraps the pickers in a 2-column grid container', () => {
    const container = renderInto(renderSensorsSection, makeEditor(), makeCtx());
    const gridForms = Array.from(container.querySelectorAll('ha-form'))
      .filter((form) => (form.schema || []).some((f) => f.type === 'grid'));
    expect(gridForms.length).toBe(1);
  });

  it('hides the pickers entirely when the source is Open-Meteo', () => {
    const container = renderInto(
      renderSensorsSection,
      makeEditor({ _pastSource: 'openmeteo' }),
      makeCtx(),
    );
    const names = allFieldNames(container);
    expect(names).toContain('past_source');
    expect(names).not.toContain('temperature');
  });

  it('is hidden in forecast-only mode while past data is available', () => {
    const container = renderInto(
      renderSensorsSection,
      makeEditor(),
      makeCtx({ showsStation: false, mode: 'forecast', pastDataAvailable: true }),
    );
    expect(container.querySelectorAll('ha-form').length).toBe(0);
  });

  it('stays reachable (recovery controls) when no past data exists', () => {
    const container = renderInto(
      renderSensorsSection,
      makeEditor(),
      makeCtx({ showsStation: false, mode: 'forecast', pastDataAvailable: false }),
    );
    expect(allFieldNames(container)).toContain('past_source');
  });
});

// ── renderChartSection ────────────────────────────────────────────────

describe('renderChartSection (schema-driven)', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor();
  });

  it('renders without throwing on default config', () => {
    expect(() => renderInto(renderChartSection, editor, makeCtx())).not.toThrow();
  });

  it('titles its panel with the chart heading', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    expect(container.querySelector('.panel-title')?.textContent?.trim()).toBe('chart_section_heading');
  });

  it('emits the three subsection headings (time-range, rows, appearance)', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    const subs = Array.from(container.querySelectorAll('h4.subsection')).map(
      (h) => h.textContent?.trim(),
    );
    expect(subs).toEqual([
      'chart_time_range_heading',
      'chart_rows_heading',
      'chart_appearance_heading',
    ]);
  });

  it('collapses the six chart rows into one multi-select', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    const found = findField(container, 'chart_rows');
    expect(found).toBeTruthy();
    expect(found.field.selector.select.multiple).toBe(true);
    expect(selectOptionValues(found.field)).toEqual([
      'condition_icons', 'show_wind_arrow', 'show_wind_speed',
      'show_date', 'show_sunshine', 'show_mode_toggle',
    ]);
  });

  it('pre-selects the rows that are on (opt-out rows on, sunshine off by default)', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    const { form } = findField(container, 'chart_rows');
    expect(form.data.chart_rows).toEqual([
      'condition_icons', 'show_wind_arrow', 'show_wind_speed',
      'show_date', 'show_mode_toggle',
    ]);
  });

  it('exposes the appearance fields (style, round_temp, disable_animation)', () => {
    const names = allFieldNames(renderInto(renderChartSection, editor, makeCtx()));
    expect(names).toContain('style');
    expect(names).toContain('round_temp');
    expect(names).toContain('disable_animation');
  });

  it('exposes number_of_forecasts and the (formerly YAML-only) chart_height', () => {
    const names = allFieldNames(renderInto(renderChartSection, editor, makeCtx()));
    expect(names).toContain('number_of_forecasts');
    expect(names).toContain('chart_height');
  });

  it('no longer owns the title field (moved to basics)', () => {
    expect(allFieldNames(renderInto(renderChartSection, editor, makeCtx()))).not.toContain('title');
  });

  it('does NOT call the sunshine availability hint when show_sunshine is off', () => {
    renderInto(renderChartSection, editor, makeCtx({ fcfg: { show_sunshine: false } }));
    expect(editor._renderSunshineAvailabilityHint).not.toHaveBeenCalled();
  });

  it('calls the sunshine availability hint and embeds its output when show_sunshine is on', () => {
    const container = renderInto(
      renderChartSection,
      editor,
      makeCtx({ fcfg: { show_sunshine: true } }),
    );
    expect(editor._renderSunshineAvailabilityHint).toHaveBeenCalledOnce();
    expect(container.querySelector('.sunshine-availability-mock')).toBeTruthy();
  });

  it('hides the days field when showsStation is false (forecast-only)', () => {
    const container = renderInto(
      renderChartSection,
      editor,
      makeCtx({ showsStation: false, mode: 'forecast' }),
    );
    expect(allFieldNames(container)).not.toContain('days');
  });

  it('hides the forecast_days field when showsForecast is false (station-only)', () => {
    const container = renderInto(
      renderChartSection,
      editor,
      makeCtx({ showsForecast: false, mode: 'station' }),
    );
    expect(allFieldNames(container)).not.toContain('forecast_days');
  });

  it('shows both days and forecast_days in combination mode', () => {
    const names = allFieldNames(renderInto(renderChartSection, editor, makeCtx()));
    expect(names).toContain('days');
    expect(names).toContain('forecast_days');
  });
});

// ── renderLivePanelSection ────────────────────────────────────────────

describe('renderLivePanelSection (schema-driven)', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor();
  });

  it('renders without throwing on default config', () => {
    expect(() => renderInto(renderLivePanelSection, editor, makeCtx())).not.toThrow();
  });

  it('titles its panel with the live-panel heading', () => {
    const container = renderInto(renderLivePanelSection, editor, makeCtx());
    expect(container.querySelector('.panel-title')?.textContent?.trim()).toBe('live_panel_heading');
  });

  it('exposes show_main and show_attributes master toggles in default state', () => {
    const names = allFieldNames(renderInto(renderLivePanelSection, editor, makeCtx()));
    expect(names).toContain('show_main');
    expect(names).toContain('show_attributes');
  });

  it('hides the element multi-select and clock while show_main is off', () => {
    const names = allFieldNames(renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_main: false } }),
    ));
    expect(names).not.toContain('main_elements');
    expect(names).not.toContain('clock_mode');
  });

  it('reveals the element multi-select and the clock dropdown when show_main is on', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_main: true } }),
    );
    const elements = findField(container, 'main_elements');
    expect(elements).toBeTruthy();
    expect(selectOptionValues(elements.field)).toEqual([
      'show_temperature', 'show_current_condition', 'show_day', 'show_date',
    ]);
    const clock = findField(container, 'clock_mode');
    expect(selectOptionValues(clock.field)).toEqual([
      'off', '24h', '24h_seconds', '12h', '12h_seconds',
    ]);
  });

  it('offers only sun + moon attribute options when no sensors / live values report', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_attributes: true } }),
    );
    const { field } = findField(container, 'attributes');
    expect(selectOptionValues(field)).toEqual(['show_sun', 'show_moon']);
  });

  it('offers exactly the attribute options whose backing value is present', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({
        cfg: { show_attributes: true },
        hasLiveValue: (k) => k === 'humidity' || k === 'pressure',
        hasSensor: (k) => k === 'precipitation',
      }),
    );
    const values = selectOptionValues(findField(container, 'attributes').field);
    expect(values).toContain('show_humidity');
    expect(values).toContain('show_pressure');
    expect(values).toContain('show_precipitation');
    expect(values).not.toContain('show_uv_index');
    expect(values).not.toContain('show_illuminance');
  });

  it('offers precipitation when only the rate sensor is wired (#253)', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({
        cfg: { show_attributes: true },
        hasSensor: (k) => k === 'precipitation_rate',
      }),
    );
    const values = selectOptionValues(findField(container, 'attributes').field);
    expect(values).toContain('show_precipitation');
  });

  it('lists humidity right after dew_point (shared line since v2.3)', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({
        cfg: { show_attributes: true },
        hasLiveValue: (k) => k === 'humidity' || k === 'dew_point',
      }),
    );
    const values = selectOptionValues(findField(container, 'attributes').field);
    expect(values.indexOf('show_humidity')).toBe(values.indexOf('show_dew_point') + 1);
  });

  it('pre-selects humidity only when explicitly opted in', () => {
    const hasLiveValue = (k) => k === 'humidity' || k === 'dew_point';
    const off = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_attributes: true }, hasLiveValue }),
    );
    expect(findField(off, 'attributes').form.data.attributes).not.toContain('show_humidity');

    const on = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_attributes: true, show_humidity: true }, hasLiveValue }),
    );
    expect(findField(on, 'attributes').form.data.attributes).toContain('show_humidity');
  });

  it('hides the attributes multi-select when show_attributes is off', () => {
    const names = allFieldNames(renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_attributes: false } }),
    ));
    expect(names).toContain('show_attributes');
    expect(names).not.toContain('attributes');
  });
});
