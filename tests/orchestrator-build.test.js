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

import { buildForecastChart, ChartBuildError, toDisplayData } from '../src/chart/orchestrator.js';
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
    displayUnits: { temperature: '°C', pressure: 'hPa', speed: 'km/h', precipitation: 'mm' },
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
    expect(opts.precipFloor).toBe(20);
    expect(opts.datasets[0].data).toEqual([20, 21, 22]);
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

  const units = (temperature, precipitation) => ({ temperature, pressure: 'hPa', speed: 'km/h', precipitation });

  it('draws the temperatures in °F, rounded after the conversion', () => {
    buildForecastChart(inputs({ displayUnits: units('°F', 'mm') }));
    const { opts } = built.calls[0];
    expect(opts.datasets[0].data).toEqual([68, 70, 72]);
    expect(opts.datasets[1].data).toEqual([50, 52, 54]);
    // The render data the label plugins read.
    expect(opts.data.tempHigh).toEqual([68, 70, 72]);
    expect(opts.tempUnit).toBe('°F');
  });

  it('keeps fractional °F without round_temp', () => {
    buildForecastChart(inputs({ displayUnits: units('°F', 'mm') }, { round_temp: false }));
    const got = built.calls[0].opts.datasets[0].data;
    expect(got).toHaveLength(3);
    [68, 69.8, 71.6].forEach((v, i) => expect(got[i]).toBeCloseTo(v));
  });

  it('draws the rain bars, axis floor and label in inches', () => {
    const args = inputs({ displayUnits: units('°C', 'in') });
    args.data = { ...args.data, precip: [0, 25.4, 'x'] };
    buildForecastChart(args);
    const { opts } = built.calls[0];
    expect(opts.datasets[2].data).toEqual([0, 1, null]);
    expect(opts.precipUnit).toBe('in');
    expect(opts.precipFloor).toBe(1);
  });

  it('converts the rain axis floor into centimetres', () => {
    buildForecastChart(inputs({ displayUnits: units('°C', 'cm') }));
    expect(built.calls[0].opts.precipFloor).toBe(2);
    expect(built.calls[0].opts.precipUnit).toBe('cm');
    buildForecastChart(inputs({ displayUnits: units('°C', 'cm') }, { type: 'hourly' }));
    expect(built.calls[1].opts.precipFloor).toBe(0.4);
    expect(built.calls[1].opts.precipUnit).toBe('cm');
  });

  it('tags a failure while shaping the data as compute', () => {
    const args = inputs({ displayUnits: undefined });
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

describe('toDisplayData', () => {
  it('leaves a metric setup untouched', () => {
    const precip = [0, 1.2];
    const out = toDisplayData(
      { tempHigh: [21.4, null], tempLow: [], precip },
      { temperature: '°C', precipitation: 'mm' },
      false,
    );
    expect(out.precip).toBe(precip);
    expect(out.tempHigh).toEqual([21.4, null]);
  });

  it('converts, then rounds, and keeps gaps as gaps', () => {
    const out = toDisplayData(
      { tempHigh: [21.4, null, undefined, NaN], tempLow: [], precip: [] },
      { temperature: '°F', precipitation: 'mm' },
      true,
    );
    expect(out.tempHigh).toEqual([71, null, undefined, null]);
  });
});
