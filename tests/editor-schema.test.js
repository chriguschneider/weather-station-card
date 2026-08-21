// @vitest-environment jsdom
//
// Schema-driven editor smoketests for the chart + live-panel sections
// after the v1.10.2 #87 migration. The other 5 sections (units / mode /
// sensors / forecast / tap) were already schema-driven before v1.10.2;
// this file consolidates the new chart + live-panel coverage that
// replaced editor-render-chart.test.js + editor-render-live-panel.test.js.
//
// Pattern: render the section into a jsdom <div>, then read each
// <ha-form>'s `.schema` property (lit's property binding) to assert
// that the schema-driven field set matches what the section should
// expose for the given config / sensor presence. Custom elements
// render as unknown HTMLElements; we only read their properties.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, html } from 'lit';
import { renderChartSection } from '../src/editor/render-chart.js';
import { renderLivePanelSection } from '../src/editor/render-live-panel.js';
import { DEFAULTS, DEFAULTS_FORECAST } from '../src/defaults.js';

function makeEditor() {
  return {
    hass: null,
    _config: null,
    _mode: 'combination',
    _setMode: vi.fn(),
    _valueChanged: vi.fn(),
    _sensorsChanged: vi.fn(),
    _sensorPickerChanged: vi.fn(),
    _unitsChanged: vi.fn(),
    _chartTopChanged: vi.fn(),
    _chartForecastChanged: vi.fn(),
    _livePanelChanged: vi.fn(),
    _actionChanged: vi.fn(),
    _conditionMappingChanged: vi.fn(),
    _renderSunshineAvailabilityHint: vi.fn(
      () => html`<span class="sunshine-availability-mock">availability info</span>`,
    ),
    configChanged: vi.fn(),
    requestUpdate: vi.fn(),
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
    cmap: {},
    mode: 'combination',
    showsStation: true,
    showsForecast: true,
    hasSensor: () => false,
    hasLiveValue: () => false,
    ...overrides,
  };
}

function renderInto(renderFn, editor, ctx) {
  const container = document.createElement('div');
  render(renderFn(editor, ctx), container);
  return container;
}

// Pull the .schema property off every <ha-form> element in the
// rendered tree. Returns an array of arrays (one inner array per form).
function collectFormSchemas(container) {
  return Array.from(container.querySelectorAll('ha-form'))
    .map((form) => /** @type {Array<{name: string}>} */ (form.schema) || []);
}

// Flatten all field names across every form in the section. Useful when
// the test only cares that a field exists somewhere, not which form
// owns it.
function allFieldNames(container) {
  return collectFormSchemas(container).flatMap((schema) => schema.map((f) => f.name));
}

// ── renderChartSection ────────────────────────────────────────────────

describe('renderChartSection (schema-driven)', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor();
  });

  it('renders without throwing on default config', () => {
    expect(() => renderInto(renderChartSection, editor, makeCtx())).not.toThrow();
  });

  it('shows the chart section heading', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    expect(container.querySelector('h3.section')?.textContent?.trim()).toBe('chart_section_heading');
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

  it('exposes the chart-row toggles via schema (icons, wind_arrow, wind_speed, date, sunshine)', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    const names = allFieldNames(container);
    expect(names).toContain('condition_icons');
    expect(names).toContain('show_wind_arrow');
    expect(names).toContain('show_wind_speed');
    expect(names).toContain('show_date');
    expect(names).toContain('show_sunshine');
  });

  it('exposes the appearance toggles via schema (round_temp, disable_animation, style)', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    const names = allFieldNames(container);
    expect(names).toContain('round_temp');
    expect(names).toContain('disable_animation');
    expect(names).toContain('style');
  });

  it('renders multiple ha-form blocks (one per logical group)', () => {
    const container = renderInto(renderChartSection, editor, makeCtx());
    expect(container.querySelectorAll('ha-form').length).toBeGreaterThanOrEqual(4);
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
    const container = renderInto(renderChartSection, editor, makeCtx());
    const names = allFieldNames(container);
    expect(names).toContain('days');
    expect(names).toContain('forecast_days');
  });

  it('exposes a title field via schema', () => {
    const container = renderInto(renderChartSection, editor, makeCtx({ cfg: { title: 'Living Room' } }));
    expect(allFieldNames(container)).toContain('title');
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

  it('shows the live-panel section heading', () => {
    const container = renderInto(renderLivePanelSection, editor, makeCtx());
    expect(container.querySelector('h3.section')?.textContent?.trim()).toBe('live_panel_heading');
  });

  it('emits the two subsection headings (main panel, attributes)', () => {
    const container = renderInto(renderLivePanelSection, editor, makeCtx());
    const subs = Array.from(container.querySelectorAll('h4.subsection')).map(
      (h) => h.textContent?.trim(),
    );
    expect(subs).toEqual(['main_panel_heading', 'attributes_heading']);
  });

  it('exposes show_main and show_attributes master toggles in default state', () => {
    const container = renderInto(renderLivePanelSection, editor, makeCtx());
    const names = allFieldNames(container);
    expect(names).toContain('show_main');
    expect(names).toContain('show_attributes');
  });

  it('reveals main-panel sub-toggles when show_main is enabled', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_main: true } }),
    );
    const names = allFieldNames(container);
    expect(names).toContain('show_temperature');
    expect(names).toContain('show_current_condition');
    expect(names).toContain('show_time');
    expect(names).toContain('show_day');
    expect(names).toContain('show_date');
  });

  it('hides main-panel sub-toggles when show_main is off', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_main: false } }),
    );
    const names = allFieldNames(container);
    expect(names).toContain('show_main');
    expect(names).not.toContain('show_temperature');
  });

  it('reveals time-format sub-toggles only when show_time is enabled', () => {
    const offContainer = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_main: true, show_time: false } }),
    );
    expect(allFieldNames(offContainer)).not.toContain('show_time_seconds');

    const onContainer = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_main: true, show_time: true } }),
    );
    const names = allFieldNames(onContainer);
    expect(names).toContain('show_time_seconds');
    expect(names).toContain('use_12hour_format');
  });

  it('hides attribute sub-toggles when show_attributes is on but no sensors / live values report', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({
        cfg: { show_attributes: true },
        hasLiveValue: () => false,
        hasSensor: () => false,
      }),
    );
    const names = allFieldNames(container);
    // Master + show_sun + show_moon (always shown — the moon line is
    // computed in-card, no sensor gate) + nothing else.
    expect(names).toContain('show_attributes');
    expect(names).toContain('show_sun');
    expect(names).toContain('show_moon');
    expect(names).not.toContain('show_humidity');
    expect(names).not.toContain('show_pressure');
  });

  it('reveals only the sub-toggles whose backing sensor / live value is present', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({
        cfg: { show_attributes: true },
        hasLiveValue: (k) => k === 'humidity' || k === 'pressure',
        hasSensor: (k) => k === 'precipitation',
      }),
    );
    const names = allFieldNames(container);
    expect(names).toContain('show_humidity');
    expect(names).toContain('show_pressure');
    expect(names).toContain('show_precipitation');
    expect(names).not.toContain('show_uv_index');
    expect(names).not.toContain('show_illuminance');
  });

  it('humidity is opt-in and its toggle follows show_dew_point (shared line since v2.3)', () => {
    const hasLiveValue = (k) => k === 'humidity' || k === 'dew_point';
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_attributes: true }, hasLiveValue }),
    );
    const attrNames = collectFormSchemas(container)[1].map((f) => f.name);
    expect(attrNames.indexOf('show_humidity')).toBe(attrNames.indexOf('show_dew_point') + 1);

    // Key at its DEFAULTS value (false) → toggle off: opt-in semantics.
    const attrForm = container.querySelectorAll('ha-form')[1];
    expect(attrForm.data.show_humidity).toBe(false);

    // Explicit true → toggle on.
    const onContainer = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({ cfg: { show_attributes: true, show_humidity: true }, hasLiveValue }),
    );
    expect(onContainer.querySelectorAll('ha-form')[1].data.show_humidity).toBe(true);
  });

  it('shows the wind sub-toggles when their respective live values are present', () => {
    const container = renderInto(
      renderLivePanelSection,
      editor,
      makeCtx({
        cfg: { show_attributes: true },
        hasLiveValue: (k) =>
          k === 'wind_direction' || k === 'wind_speed' || k === 'gust_speed',
      }),
    );
    const names = allFieldNames(container);
    expect(names).toContain('show_wind_direction');
    expect(names).toContain('show_wind_speed');
    expect(names).toContain('show_wind_gust_speed');
  });
});
