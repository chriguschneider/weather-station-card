// @vitest-environment jsdom
// Regression test for the "bar grew but the mm didn't" bug on always-on
// tablets.
//
// The chart's value-printing label plugins (precip / temp / sunshine /
// daily-tick) read their numbers from a single render-data object that
// drawChartUnsafe hands — by reference — to both the plugins and the
// chart builder. The in-place update path (updateChart) used to refresh
// only the chart datasets (bar heights, line positions) and never that
// shared object, so on screens that sit on the card for a long time —
// which only ever hit updateChart, never a full destroy+rebuild — the
// bars moved while the printed numbers stayed frozen.
//
// updateChart now mutates forecastChart.renderData in place. We assert
// the SAME object reference is refreshed (so the plugins' closed-over
// reference sees the new values) and that the redraw is triggered.

import { describe, it, expect, vi } from 'vitest';
import '../src/main.js';

function mockChart() {
  return {
    data: {
      labels: [],
      // tempHigh, tempLow, precip — matches drawChartUnsafe's dataset order.
      datasets: [{ data: [] }, { data: [] }, { data: [] }],
    },
    renderData: {
      dateTime: ['d0'],
      precip: [0],
      tempHigh: [1],
      tempLow: [0],
      sunshine: [0],
    },
    update: vi.fn(),
    reset: vi.fn(),
  };
}

describe('updateChart — in-place refresh of the plugins shared render-data', () => {
  it('mutates forecastChart.renderData in place so label values re-print', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({ show_station: true, sensors: { temperature: 'sensor.t' } });

    const chart = mockChart();
    const sharedRef = chart.renderData;
    card.forecastChart = chart;
    card.forecasts = [{}]; // non-empty so updateChart proceeds past its guard

    const fresh = {
      dateTime: ['d0', 'd1'],
      tempHigh: [10, 12],
      tempLow: [4, 5],
      precip: [0, 4.7],
      sunshine: [0, 3],
      dayLength: [13, 13],
    };
    card.computeForecastData = () => fresh;

    card.updateChart();

    // Same object reference, fields refreshed in place — this is what
    // lets the plugins (which close over that reference) see new numbers.
    expect(card.forecastChart.renderData).toBe(sharedRef);
    expect(sharedRef.dateTime).toEqual(['d0', 'd1']);
    expect(sharedRef.precip).toEqual([0, 4.7]);
    expect(sharedRef.tempHigh).toEqual([10, 12]);
    expect(sharedRef.tempLow).toEqual([4, 5]);
    expect(sharedRef.sunshine).toEqual([0, 3]);

    // Datasets refreshed too (bar heights / line positions) and a redraw
    // requested so the draw hook re-runs the plugins.
    expect(chart.data.datasets[2].data).toEqual([0, 4.7]);
    expect(chart.update).toHaveBeenCalled();
  });

  it('does not throw when the chart has no renderData yet (defensive)', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({ show_station: true, sensors: { temperature: 'sensor.t' } });

    const chart = mockChart();
    delete chart.renderData;
    card.forecastChart = chart;
    card.forecasts = [{}];
    card.computeForecastData = () => ({
      dateTime: ['d0'], tempHigh: [1], tempLow: [0], precip: [1], sunshine: [0], dayLength: [13],
    });

    expect(() => card.updateChart()).not.toThrow();
    expect(chart.update).toHaveBeenCalled();
  });
});
