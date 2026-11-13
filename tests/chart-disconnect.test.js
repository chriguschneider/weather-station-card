// @vitest-environment jsdom
// uPlot keeps a window `dppxchange` listener per instance, so a chart
// that survives disconnect pins the removed card in memory (#438).
import { describe, it, expect, vi } from 'vitest';
import '../src/main.js';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };

function mountCard() {
  const card = document.createElement('weather-station-card');
  card.setConfig({ show_station: false });
  document.body.appendChild(card);
  return card;
}

describe('forecast chart lifecycle', () => {
  it('destroys the chart on disconnect', () => {
    const card = mountCard();
    const destroy = vi.fn();
    card.forecastChart = { destroy };
    card.remove();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(card.forecastChart).toBeNull();
  });

  it('survives a chart whose destroy throws', () => {
    const card = mountCard();
    card.forecastChart = { destroy: () => { throw new Error('gone'); } };
    expect(() => card.remove()).not.toThrow();
    expect(card.forecastChart).toBeNull();
  });

  it('redraws after reconnect', async () => {
    const card = mountCard();
    await card.updateComplete;
    card.forecastChart = { destroy: vi.fn() };
    card.remove();
    document.body.appendChild(card);
    await card.updateComplete;
    // Without hass the card renders nothing; measureCard only needs the
    // ha-card element to be there.
    card.shadowRoot.appendChild(document.createElement('ha-card'));
    const draw = vi.spyOn(card, 'drawChart').mockImplementation(() => undefined);
    card.measureCard();
    expect(draw).toHaveBeenCalled();
    card.remove();
  });

  it('drops the data sources on disconnect (DataSourceController)', () => {
    const card = mountCard();
    const teardown = vi.spyOn(card._sources, 'teardownForecast');
    card.remove();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('labels a failure while shaping chart data as compute', () => {
    const card = mountCard();
    card._initialChartBuilt = true;
    card.forecasts = [{ datetime: '2026-08-20T00:00:00Z' }];
    const target = document.createElement('div');
    target.id = 'forecastChart';
    card.shadowRoot.appendChild(target);
    card.computeForecastData = () => { throw new Error('bad entry'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    card.drawChart();
    expect(card._chartError).toBe('compute: bad entry');
    expect(card.forecastChart).toBeNull();
    card.remove();
  });
});
