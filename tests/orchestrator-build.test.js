// @vitest-environment jsdom
// buildForecastChart (#452): pure inputs in, the chart handle out, and
// failures tagged with the phase they happened in.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const built = vi.hoisted(() => ({ calls: [], throwOnBuild: null }));

vi.mock('../src/chart/draw.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildChart: (target, opts) => {
      if (built.throwOnBuild) throw built.throwOnBuild;
      built.calls.push({ target, opts });
      return { id: 'chart', opts };
    },
  };
});

import { buildForecastChart, ChartBuildError } from '../src/chart/orchestrator.js';
import { normalizeConfig } from '../src/card-config.js';
import { calendarFor } from '../src/utils/time-zone.js';

const calendar = calendarFor('Europe/Zurich');

function inputs(overrides = {}, forecast = {}) {
  const dateTime = ['2026-08-20T00:00:00+02:00', '2026-08-20T00:00:00+02:00', '2026-08-21T00:00:00+02:00'];
  return {
    target: document.createElement('div'),
    config: normalizeConfig({ forecast: { show_sunshine: true, ...forecast } }),
    language: 'en',
    calendar,
    data: {
      forecast: [],
      dateTime,
      tempHigh: [20, 21, 22],
      tempLow: [10, 11, 12],
      tempLowAvailable: true,
      precip: [0, 1.2, 'x'],
      sunshine: [5, 6, null],
      dayLength: [14, 14, 14],
      precipProb: null,
    },
    stationCount: 1,
    forecastCount: 2,
    unitSystem: { temperature: '°C', length: 'km' },
    ll: (key) => (key === 'units' ? { mm: 'mm', in: 'in' } : key),
    themeHost: document.body,
    inPreview: true,
    ...overrides,
  };
}

beforeEach(() => {
  built.calls.length = 0;
  built.throwOnBuild = null;
});

describe('buildForecastChart', () => {
  it('returns the built chart without touching anything else', () => {
    const args = inputs();
    const chart = buildForecastChart(args);
    expect(chart.id).toBe('chart');
    expect(built.calls).toHaveLength(1);
    const { target, opts } = built.calls[0];
    expect(target).toBe(args.target);
    expect(opts.stationCount).toBe(1);
    expect(opts.inPreview).toBe(true);
    expect(opts.tempUnit).toBe('°C');
    expect(opts.precipUnit).toBe('mm');
    expect(opts.doubledToday).toBe(true);
    // temp high, temp low, precip, sunshine
    expect(opts.datasets).toHaveLength(4);
    expect(opts.datasets[2].data).toEqual([0, 1.2, null]);
  });

  it('hides the low line and the separator in hourly mode', () => {
    const args = inputs({ data: { ...inputs().data, tempLowAvailable: false } }, { type: 'hourly', show_sunshine: false });
    buildForecastChart(args);
    const { opts } = built.calls[0];
    expect(opts.datasets).toHaveLength(3);
    expect(opts.datasets[1].hidden).toBe(true);
    expect(opts.doubledToday).toBe(false);
    expect(opts.isHourly).toBe(true);
  });

  it('labels the precipitation in the configured unit', () => {
    const args = inputs({ config: normalizeConfig({ units: { precipitation: 'in' } }) });
    buildForecastChart(args);
    expect(built.calls[0].opts.precipUnit).toBe('in');
  });

  it('tags a failure while shaping the data as compute', () => {
    const args = inputs({ unitSystem: undefined });
    let caught;
    try { buildForecastChart(args); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ChartBuildError);
    expect(caught.phase).toBe('compute');
    expect(caught.original).toBeInstanceOf(TypeError);
    expect(built.calls).toHaveLength(0);
  });

  it('tags a failure in the chart constructor as init', () => {
    built.throwOnBuild = new Error('canvas gone');
    let caught;
    try { buildForecastChart(inputs()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ChartBuildError);
    expect(caught.phase).toBe('init');
    expect(caught.message).toBe('canvas gone');
  });
});
