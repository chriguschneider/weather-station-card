// @vitest-environment jsdom
// The live panel's "Info button: data sources" toggle (ADR-0031): it
// reads `show_sources` with the default on, drops the key when switched
// back to the default, and hands an explicit `false` to the live-panel
// handler like the other toggles.

import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import { renderLivePanelSection } from '../src/editor/render-live-panel.js';
import { DEFAULTS, DEFAULTS_FORECAST } from '../src/defaults.js';

function makeEditor(config) {
  return {
    hass: null,
    _config: config,
    _mode: 'combination',
    _pastSource: 'station',
    _clockMode: 'off',
    _timeFormat: '24h',
    _setClockMode: vi.fn(),
    _applyTogglePaths: vi.fn(),
    _isPanelExpanded: vi.fn(() => true),
    _setPanelExpanded: vi.fn(),
    _livePanelChanged: vi.fn(),
    _resetSection: vi.fn(),
    configChanged: vi.fn(),
    requestUpdate: vi.fn(),
  };
}

function renderPanel(config) {
  const editor = makeEditor(config);
  const fcfg = { ...DEFAULTS_FORECAST };
  const ctx = {
    t: (k) => k,
    cfg: { ...DEFAULTS, ...config, forecast: fcfg },
    fcfg,
    sensorsConfig: {},
    unitsConfig: {},
    mode: 'combination',
    showsStation: true,
    showsForecast: true,
    hasSensor: () => false,
    hasLiveValue: () => false,
    pastDataAvailable: true,
  };
  const container = document.createElement('div');
  render(renderLivePanelSection(editor, ctx), container);
  const form = Array.from(container.querySelectorAll('ha-form'))
    .find((f) => (f.schema || []).some((s) => s.name === 'show_sources'));
  return { editor, container, form };
}

function fire(form, value) {
  const ev = new CustomEvent('value-changed', { detail: { value }, bubbles: true, composed: true });
  form.dispatchEvent(ev);
  return ev;
}

describe('editor: show_sources toggle', () => {
  it('is on when the key is absent (default) and off for an explicit false', () => {
    expect(renderPanel({ type: 'custom:weather-station-card' }).form.data.show_sources).toBe(true);
    expect(renderPanel({ type: 'custom:weather-station-card', show_sources: false }).form.data.show_sources).toBe(false);
  });

  it('shows the hint under the toggle', () => {
    const { container } = renderPanel({ type: 'custom:weather-station-card' });
    expect(container.textContent).toContain('show_sources_hint');
  });

  it('drops the key when switched back on (the default)', () => {
    const config = { type: 'custom:weather-station-card', title: 'Home', show_sources: false };
    const { editor, form } = renderPanel(config);
    fire(form, { show_sources: true });
    expect(editor.configChanged).toHaveBeenCalledTimes(1);
    expect(editor.configChanged.mock.calls[0][0]).toEqual({ type: 'custom:weather-station-card', title: 'Home' });
    expect(editor.requestUpdate).toHaveBeenCalled();
    expect(editor._livePanelChanged).not.toHaveBeenCalled();
    expect(config.show_sources).toBe(false);
  });

  it('passes an explicit false to the live-panel handler', () => {
    const { editor, form } = renderPanel({ type: 'custom:weather-station-card' });
    fire(form, { show_sources: false });
    expect(editor._livePanelChanged).toHaveBeenCalledTimes(1);
    expect(editor._livePanelChanged.mock.calls[0][0].detail.value).toEqual({ show_sources: false });
    expect(editor.configChanged).not.toHaveBeenCalled();
  });
});
