// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import '../src/weather-station-card-editor.js';
import { renderChartSection } from '../src/editor/render-chart.js';
import { DEFAULTS, DEFAULTS_FORECAST } from '../src/defaults.js';

function setup(forecast = {}) {
  const editor = document.createElement('weather-station-card-editor');
  editor._config = { forecast };
  editor.configChanged = vi.fn();
  editor.requestUpdate = vi.fn();
  editor._renderSunshineAvailabilityHint = vi.fn(() => '');
  const fcfg = { ...DEFAULTS_FORECAST, ...forecast };
  const ctx = {
    t: (k) => k, cfg: { ...DEFAULTS, forecast: fcfg }, fcfg,
    showsStation: true, showsForecast: true,
    isPanelExpanded: () => true,
  };
  const container = document.createElement('div');
  render(renderChartSection(editor, ctx), container);
  const pill = container.querySelector('.pills[data-group="chart_rows"] .pill[data-value="show_jump_to_now"]');
  return { editor, pill };
}

describe('show_jump_to_now pill', () => {
  it('toggling off writes false, toggling back removes the key', () => {
    const off = setup();
    expect(off.pill.classList.contains('on')).toBe(true);
    off.pill.click();
    expect(off.editor.configChanged.mock.calls[0][0].forecast.show_jump_to_now).toBe(false);

    const back = setup({ show_jump_to_now: false });
    expect(back.pill.classList.contains('on')).toBe(false);
    back.pill.click();
    // The now-empty forecast parent is dropped with the key.
    expect(back.editor.configChanged.mock.calls[0][0].forecast?.show_jump_to_now).toBeUndefined();
  });
});
