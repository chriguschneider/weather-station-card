// Plugin unit tests. The Chart.js plugins are pure factories that return
// objects with `afterDraw(chart)` (or `afterDatasetsDraw(chart)`) hooks.
// We don't render to a real canvas — instead we hand the hook a mock
// chart with stubbed scales / chartArea / ctx, then assert which canvas
// calls happened and at which coordinates.
//
// What we actually want to catch with these tests:
//   1. Bail-out branches that protect against unready layout (no xScale,
//      no ticks, no meta data) — regressions there silently drop the
//      whole plugin, leaving the chart looking under-decorated.
//   2. Hourly vs. daily mode dispatch — separator plugin must produce a
//      single boundary line at hourly combination, doubled-today framing
//      at daily combination. Daily-tick-labels plugin must early-return
//      at hourly.
//   3. The `id` field — Chart.js dedupes plugins by id, so a typo here
//      would silently double-register.

import { describe, it, expect, vi } from 'vitest';
import {
  createSeparatorPlugin,
  createDailyTickLabelsPlugin,
  createSunshineLabelPlugin,
  createPrecipLabelPlugin,
} from '../src/chart/plugins.js';

function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    strokeRect: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}

function mockChart({ tickCount = 7, getPixelForTick = (i) => i * 50 } = {}) {
  return {
    ctx: mockCtx(),
    chartArea: { top: 10, bottom: 200, left: 0, right: 700 },
    scales: {
      x: {
        ticks: Array.from({ length: tickCount }, (_, i) => ({ value: i })),
        getPixelForTick,
        width: tickCount * 50,
        top: 0,
        bottom: 220,
      },
    },
  };
}

const mockStyle = { getPropertyValue: () => '#888' };

describe('createSeparatorPlugin', () => {
  it('returns a plugin object with id and afterDraw hook', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    expect(p.id).toBe('blockSeparator');
    expect(typeof p.afterDraw).toBe('function');
  });

  it('bails out when xScale is missing (layout not ready)', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    const chart = { ctx: mockCtx(), chartArea: { top: 0, bottom: 100 }, scales: {} };
    expect(() => p.afterDraw(chart)).not.toThrow();
    expect(chart.ctx.stroke).not.toHaveBeenCalled();
  });

  it('bails out when ticks are empty', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    const chart = mockChart({ tickCount: 0 });
    p.afterDraw(chart);
    expect(chart.ctx.stroke).not.toHaveBeenCalled();
  });

  it('draws two lines at daily combination (doubled-today framing)', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    const chart = mockChart({ tickCount: 7 });
    p.afterDraw(chart);
    // computeBlockSeparatorPositions returns [[1,2], [2,3]] for
    // station=3, forecast=4, total=7 in daily mode → two strokes.
    expect(chart.ctx.stroke).toHaveBeenCalledTimes(2);
    expect(chart.ctx.save).toHaveBeenCalledTimes(1);
    expect(chart.ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('draws a single boundary line at hourly combination', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
      mode: 'hourly',
    });
    const chart = mockChart({ tickCount: 7 });
    p.afterDraw(chart);
    expect(chart.ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('positions strokes at the midpoint between station and forecast pixels', () => {
    // tickCount=7, station=3, forecast=4. computeBlockSeparatorPositions
    // returns [[2, 3]] at hourly. With getPixelForTick(i)=i*50 the
    // midpoint is (2*50 + 3*50)/2 = 125.
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
      mode: 'hourly',
    });
    const chart = mockChart({ tickCount: 7 });
    p.afterDraw(chart);
    expect(chart.ctx.moveTo).toHaveBeenCalledWith(125, 10);
    expect(chart.ctx.lineTo).toHaveBeenCalledWith(125, 200);
  });
});

describe('createDailyTickLabelsPlugin', () => {
  const baseConfig = {
    forecast: {
      type: 'daily',
      labels_font_size: 11,
      show_date: true,
    },
  };
  const baseData = {
    dateTime: ['2026-05-04T00:00:00', '2026-05-05T00:00:00', '2026-05-06T00:00:00'],
  };

  it('returns a plugin object with id and afterDraw hook', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    expect(p.id).toBe('dailyTickLabels');
    expect(typeof p.afterDraw).toBe('function');
  });

  it('renders left-aligned time + sparse date at hourly mode', () => {
    // Since v1.4 the plugin handles 'hourly' itself — chart.js's own
    // tick callback returns empty strings for hourly/today so the
    // overlay below owns all label rendering. Each visible tick gets
    // a 24h time stamp; the leftmost visible tick (and any midnight
    // tick) additionally gets a stacked bold date label above.
    const p = createDailyTickLabelsPlugin({
      config: { forecast: { ...baseConfig.forecast, type: 'hourly' } },
      language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 3 });
    chart.scales.x.bottom = 50;
    chart.scales.x.width = 150;
    p.afterDraw(chart);
    // 3 visible ticks × 1 time label = 3 calls. Plus a date label on
    // the leftmost-visible tick (i=0) and on midnight ticks (every
    // tick in this fixture, since dateTime entries are all 00:00).
    // Total: 3 time + 3 date = 6 fillText calls.
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(6);
    // No background mask — the 'two background colors' artifact path
    // is gone, the plugin draws straight onto the empty axis box.
    expect(chart.ctx.fillRect).not.toHaveBeenCalled();
  });

  it('today mode: renders left-aligned time per column + sparse date', () => {
    // Today mode shares the time-based rendering with hourly: 24h time
    // per column, date label on leftmost (i=0) and on midnight
    // columns. Mid-block (non-midnight) columns show only the time —
    // the date carries over from the most recent labelled column.
    const p = createDailyTickLabelsPlugin({
      config: { forecast: { ...baseConfig.forecast, type: 'today' } },
      language: 'en',
      data: {
        // 3 hourly-ish entries, none of them midnight except via
        // happenstance — pick distinct hours within one day.
        dateTime: [
          '2026-05-06T09:00:00',
          '2026-05-06T12:00:00',
          '2026-05-06T15:00:00',
        ],
      },
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 3 });
    chart.scales.x.bottom = 50;
    chart.scales.x.width = 150;
    p.afterDraw(chart);
    // 3 time labels + 1 date label on i=0 = 4 fillText calls.
    // No midnight columns in this fixture, so no extra date labels.
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(4);
    // No bold midnight stroke on this fixture.
    expect(chart.ctx.stroke).not.toHaveBeenCalled();
  });

  it('today mode: draws bold midnight day-boundary stroke', () => {
    // 12-hour fixture spanning today 18:00 → tomorrow 05:00. The
    // midnight column (i=6, 2026-05-07T00:00) is the only one that
    // should trigger the bold vertical stroke from chart.bottom up
    // to the date row.
    const dateTime = [];
    for (let h = 18; h <= 23; h++) dateTime.push(`2026-05-06T${String(h).padStart(2, '0')}:00:00`);
    for (let h = 0; h <= 5; h++) dateTime.push(`2026-05-07T${String(h).padStart(2, '0')}:00:00`);
    const p = createDailyTickLabelsPlugin({
      config: { forecast: { ...baseConfig.forecast, type: 'today' } },
      language: 'en',
      data: { dateTime },
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 12 });
    chart.scales.x.bottom = 50;
    chart.scales.x.width = 600;
    p.afterDraw(chart);
    // Exactly one midnight in the 12-hour window → exactly one stroke.
    expect(chart.ctx.stroke).toHaveBeenCalledTimes(1);
    // 12 time labels + 2 date labels (i=0 leftmost + i=6 midnight) = 14.
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(14);
  });

  it('hourly mode: leftmostVisibleIdx tracks wrapper.scrollLeft', () => {
    // Mock the canvas → closest() lookup so the plugin sees a
    // .forecast-scroll.scrolling wrapper with a non-zero scrollLeft.
    // The first tick whose pixel position >= scrollLeft becomes the
    // leftmost visible — its date label should be rendered, earlier
    // (off-screen) ticks should not get a date label.
    const wrapper = { scrollLeft: 100 };
    const fakeCanvas = { closest: () => wrapper };
    const p = createDailyTickLabelsPlugin({
      config: { forecast: { ...baseConfig.forecast, type: 'hourly' } },
      language: 'en',
      data: {
        // Five non-midnight hourly entries within one day so only the
        // leftmost-visible tick (not midnight columns) shows a date.
        dateTime: [
          '2026-05-06T09:00:00',
          '2026-05-06T10:00:00',
          '2026-05-06T11:00:00',
          '2026-05-06T12:00:00',
          '2026-05-06T13:00:00',
        ],
      },
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    // tickCount=5, getPixelForTick(i)=i*50 → ticks at 0, 50, 100, 150, 200
    // scrollLeft=100 → first tick where pixel >= 100 is i=2 (pixel 100).
    const chart = mockChart({ tickCount: 5 });
    chart.canvas = fakeCanvas;
    chart.scales.x.bottom = 50;
    chart.scales.x.width = 250;
    p.afterDraw(chart);
    // 5 time labels + 1 date label on i=2 (leftmost visible) = 6.
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(6);
  });

  it('bails out when xScale is missing', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = { ctx: mockCtx(), scales: {} };
    expect(() => p.afterDraw(chart)).not.toThrow();
    expect(chart.ctx.fillText).not.toHaveBeenCalled();
  });

  it('draws weekday + date for each tick at daily mode', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 3 });
    p.afterDraw(chart);
    // 3 ticks × (weekday + date) = 6 fillText calls. The legacy
    // background-mask approach (one fillRect per tick) was removed in
    // v1.4 — chart.js's tick callback now returns empty strings, so
    // the axis box is already blank when the plugin draws on top.
    expect(chart.ctx.fillRect).not.toHaveBeenCalled();
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(6);
  });

  it('skips one label at the doubled-today seam (combination, daily)', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 1, doubledToday: true,
    });
    const chart = mockChart({ tickCount: 3 });
    p.afterDraw(chart);
    // doubledToday=true and stationCount=1: tick i=0 (stationCount-1)
    // is skipped entirely (continue before the fillText calls).
    // Remaining 2 ticks each draw weekday + date → 4 fillText calls.
    expect(chart.ctx.fillRect).not.toHaveBeenCalled();
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(4);
  });

  it('honours show_date: false by drawing only the weekday line', () => {
    const cfg = { forecast: { ...baseConfig.forecast, show_date: false } };
    const p = createDailyTickLabelsPlugin({
      config: cfg, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 3 });
    p.afterDraw(chart);
    // 3 ticks, weekday only → 3 fillText calls (no date row).
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(3);
  });
});

describe('createSunshineLabelPlugin', () => {
  // Mock chart that mimics what draw.js's afterFit produces: x-axis at
  // top with the bottom strip reserved for the sunshine label.
  // xScale.bottom is the bottom of the (now taller) axis; we draw at
  // xScale.bottom - bandHeight/2.
  function sunshineMockChart({ tickCount = 3 }) {
    return {
      ctx: mockCtx(),
      chartArea: { top: 50, bottom: 200, left: 0, right: 700 },
      scales: {
        x: {
          ticks: Array.from({ length: tickCount }, (_, i) => ({ value: i })),
          getPixelForTick: (i) => i * 50,
          width: tickCount * 50,
          top: 0,
          bottom: 50, // bottom of the (afterFit-grown) axis box
        },
      },
    };
  }

  const baseConfig = { forecast: { labels_font_size: 11 } };

  it('returns a plugin object with id and afterDraw hook', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: { sunshine: [], dayLength: [] },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
    });
    expect(p.id).toBe('sunshineLabel');
    expect(typeof p.afterDraw).toBe('function');
  });

  it('bails out when xScale is missing (layout not ready)', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: { sunshine: [5], dayLength: [10] },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
    });
    const chart = { ctx: mockCtx(), chartArea: { top: 50, bottom: 200 }, scales: {} };
    expect(() => p.afterDraw(chart)).not.toThrow();
    expect(chart.ctx.fillText).not.toHaveBeenCalled();
  });

  it('paints a background pill and the "Xh" text per non-null column', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: {
        sunshine: [7, null, 2.5, 0],
        dayLength: [13, 13, 13, 13],
      },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
    });
    const chart = sunshineMockChart({ tickCount: 4 });
    p.afterDraw(chart);
    // 7 → "7h", 2.5 → "2.5h" → 2 labels. null and 0 are skipped.
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(2);
    expect(chart.ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(chart.ctx.fillText).toHaveBeenNthCalledWith(1, '7h', expect.any(Number), expect.any(Number));
    expect(chart.ctx.fillText).toHaveBeenNthCalledWith(2, '2.5h', expect.any(Number), expect.any(Number));
  });

  it('rounds large values to integer hours (no decimal noise above 9 h)', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: {
        sunshine: [9.7, 11.4, 1.7],
        dayLength: [13, 13, 13],
      },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
    });
    const chart = sunshineMockChart({ tickCount: 3 });
    p.afterDraw(chart);
    expect(chart.ctx.fillText).toHaveBeenCalledWith('10h', expect.any(Number), expect.any(Number));
    expect(chart.ctx.fillText).toHaveBeenCalledWith('11h', expect.any(Number), expect.any(Number));
    // Sub-10 stays one-decimal: 1.7 → "1.7h".
    expect(chart.ctx.fillText).toHaveBeenCalledWith('1.7h', expect.any(Number), expect.any(Number));
  });

  it('strips trailing .0 below 10 h (e.g. exact integer 7.0 → "7h", not "7.0h")', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: {
        sunshine: [7, 8.0],
        dayLength: [13, 13],
      },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
    });
    const chart = sunshineMockChart({ tickCount: 2 });
    p.afterDraw(chart);
    expect(chart.ctx.fillText).toHaveBeenCalledWith('7h', expect.any(Number), expect.any(Number));
    expect(chart.ctx.fillText).toHaveBeenCalledWith('8h', expect.any(Number), expect.any(Number));
  });

  it('renders sub-1h values as "0.Xh" decimals', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: { sunshine: [0.4], dayLength: [13] },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
    });
    const chart = sunshineMockChart({ tickCount: 1 });
    p.afterDraw(chart);
    expect(chart.ctx.fillText).toHaveBeenCalledWith('0.4h', expect.any(Number), expect.any(Number));
  });

  it('does not throw when data.sunshine is missing entirely', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: {},
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
    });
    const chart = sunshineMockChart({ tickCount: 3 });
    expect(() => p.afterDraw(chart)).not.toThrow();
    expect(chart.ctx.fillText).not.toHaveBeenCalled();
  });

  it('positions labels via xScale.getPixelForTick (column-centred)', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig, data: { sunshine: [7], dayLength: [13] },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 20,
    });
    const chart = sunshineMockChart({ tickCount: 1 });
    p.afterDraw(chart);
    // Column at index 0 is at x=0 (getPixelForTick(0)). labelY =
    // xScale.bottom (50) - bandHeight (20) / 2 = 40.
    expect(chart.ctx.fillText).toHaveBeenCalledWith('7h', 0, 40);
  });

  it('uses per-column border colour (light alpha for forecast columns)', () => {
    // Mirror precipLabelPlugin: the box stroke for each column comes
    // from the sunshinePerBarColor array, so forecast columns get the
    // 45 %-alpha tone matching their bar fill.
    const p = createSunshineLabelPlugin({
      config: baseConfig,
      data: { sunshine: [7, 5], dayLength: [13, 13] },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
      sunshineColor: 'rgba(255, 193, 7, 1.0)',
      sunshinePerBarColor: [
        'rgba(255, 193, 7, 1.0)',     // station — full alpha
        'rgba(255, 193, 7, 0.45)',    // forecast — light
      ],
    });
    const chart = sunshineMockChart({ tickCount: 2 });
    p.afterDraw(chart);
    // Two strokeRect calls, one per column. Each one's strokeStyle
    // must have been the per-column color when the call happened.
    // The plugin assigns to ctx.strokeStyle before strokeRect, so we
    // can't read history directly — instead, we verify by stubbing
    // both calls and checking that the recorded strokeStyle property
    // moved through the expected values via mock invocation order.
    expect(chart.ctx.strokeRect).toHaveBeenCalledTimes(2);
    // Final assignment is the last column's color.
    expect(chart.ctx.strokeStyle).toBe('rgba(255, 193, 7, 0.45)');
  });

  it('falls back to the global sunshineColor when no per-bar array is supplied', () => {
    const p = createSunshineLabelPlugin({
      config: baseConfig,
      data: { sunshine: [7], dayLength: [13] },
      textColor: '#000', backgroundColor: '#fff', bandHeight: 18,
      sunshineColor: 'rgba(1, 2, 3, 1.0)',
    });
    const chart = sunshineMockChart({ tickCount: 1 });
    p.afterDraw(chart);
    expect(chart.ctx.strokeStyle).toBe('rgba(1, 2, 3, 1.0)');
  });
});

describe('createPrecipLabelPlugin', () => {
  // The precip-label plugin reads from chart.getDatasetMeta(2) — the
  // third dataset in our chart (tempHigh, tempLow, precip). The mock
  // chart needs to expose that meta plus the PrecipAxis scale used to
  // anchor the label to the precipitation 0-line.
  function precipMockChart({ barCount = 3, hasPrecipAxis = true, hasXScale = true } = {}) {
    return {
      ctx: mockCtx(),
      chartArea: { top: 10, bottom: 200, left: 0, right: 700 },
      getDatasetMeta: (i) => i === 2 ? {
        data: Array.from({ length: barCount }, (_, idx) => ({
          x: idx * 50 + 25,
          options: { borderColor: '#abcdef' },
        })),
      } : null,
      scales: {
        ...(hasXScale ? { x: { getPixelForTick: (i) => i * 50 + 25 } } : {}),
        ...(hasPrecipAxis ? {
          PrecipAxis: { getPixelForValue: () => 180 },
        } : {}),
      },
    };
  }

  const baseConfig = { forecast: { labels_font_size: 11 } };

  it('returns a plugin object with id and afterDatasetsDraw hook', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [] },
      precipUnit: 'mm', precipPerBarColor: [], precipColor: '#0066cc',
      textColor: '#000', backgroundColor: '#fff',
    });
    expect(p.id).toBe('precipLabel');
    expect(typeof p.afterDatasetsDraw).toBe('function');
  });

  it('bails out when precip dataset meta is missing (chart not ready)', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [1.5] },
      precipUnit: 'mm', precipPerBarColor: ['#0066cc'], precipColor: '#0066cc',
      textColor: '#000', backgroundColor: '#fff',
    });
    const chart = {
      ctx: mockCtx(),
      getDatasetMeta: () => null,
      scales: {},
      chartArea: { top: 0, bottom: 100 },
    };
    expect(() => p.afterDatasetsDraw(chart)).not.toThrow();
    expect(chart.ctx.fillText).not.toHaveBeenCalled();
  });

  it('skips bars with null or zero precipitation', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [null, 0, 1.2] },
      precipUnit: 'mm', precipPerBarColor: ['#0066cc', '#0066cc', '#0066cc'],
      precipColor: '#0066cc', textColor: '#000', backgroundColor: '#fff',
    });
    const chart = precipMockChart({ barCount: 3 });
    p.afterDatasetsDraw(chart);
    // Only 1.2 → renders. number + unit = 2 fillText calls per visible bar.
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(2);
    expect(chart.ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it('rounds large values (>9) to integers and keeps 1 decimal otherwise', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [12.7, 0.5] },
      precipUnit: 'mm', precipPerBarColor: ['#0066cc', '#0066cc'],
      precipColor: '#0066cc', textColor: '#000', backgroundColor: '#fff',
    });
    const chart = precipMockChart({ barCount: 2 });
    p.afterDatasetsDraw(chart);
    expect(chart.ctx.fillText).toHaveBeenCalledWith('13', expect.any(Number), expect.any(Number));
    expect(chart.ctx.fillText).toHaveBeenCalledWith('0.5', expect.any(Number), expect.any(Number));
  });

  it('converts mm values to inches (2 decimals) and labels "in" for an inch target', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [25.4, 2.54] },
      precipUnit: 'in', precipSourceBase: 'mm', precipTargetBase: 'in',
      precipPerBarColor: ['#0066cc', '#0066cc'],
      precipColor: '#0066cc', textColor: '#000', backgroundColor: '#fff',
    });
    const chart = precipMockChart({ barCount: 2 });
    p.afterDatasetsDraw(chart);
    // 25.4 mm = 1.00 in, 2.54 mm = 0.10 in.
    expect(chart.ctx.fillText).toHaveBeenCalledWith('1.00', expect.any(Number), expect.any(Number));
    expect(chart.ctx.fillText).toHaveBeenCalledWith('0.10', expect.any(Number), expect.any(Number));
    expect(chart.ctx.fillText).toHaveBeenCalledWith('in', expect.any(Number), expect.any(Number));
  });

  it('falls back to bar.x when xScale.getPixelForTick is missing', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [1.5] },
      precipUnit: 'mm', precipPerBarColor: ['#0066cc'], precipColor: '#0066cc',
      textColor: '#000', backgroundColor: '#fff',
    });
    const chart = precipMockChart({ barCount: 1, hasXScale: false });
    p.afterDatasetsDraw(chart);
    // Should still render; just at bar.x instead of tick pixel.
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('falls back to chartArea.bottom when PrecipAxis is missing', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [1.5] },
      precipUnit: 'mm', precipPerBarColor: ['#0066cc'], precipColor: '#0066cc',
      textColor: '#000', backgroundColor: '#fff',
    });
    const chart = precipMockChart({ barCount: 1, hasPrecipAxis: false });
    p.afterDatasetsDraw(chart);
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('uses bar.options.borderColor for the box stroke when available', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [1.5] },
      precipUnit: 'mm', precipPerBarColor: ['#fallback'], precipColor: '#globalFallback',
      textColor: '#000', backgroundColor: '#fff',
    });
    const chart = precipMockChart({ barCount: 1 });
    p.afterDatasetsDraw(chart);
    // The mock bar has options.borderColor: '#abcdef' — that should win.
    expect(chart.ctx.strokeStyle).toBe('#abcdef');
  });

  it('honours chartTextColor override for text fill', () => {
    const p = createPrecipLabelPlugin({
      config: baseConfig, data: { precip: [1.5] },
      precipUnit: 'mm', precipPerBarColor: ['#0066cc'], precipColor: '#0066cc',
      textColor: '#000', backgroundColor: '#fff',
      chartTextColor: '#custom',
    });
    const chart = precipMockChart({ barCount: 1 });
    p.afterDatasetsDraw(chart);
    expect(chart.ctx.fillStyle).toBe('#custom');
  });
});
