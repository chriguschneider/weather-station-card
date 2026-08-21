// Regression tests for the "precip bar scaling only updates on reload"
// bug.
//
// The y-scale ceilings used to be computed once at chart-build time and
// closed over as frozen scalars by the scale range functions, so the
// in-place update path (updateChart → instance.update() → uPlot
// setData) kept drawing new, taller rain buckets against the stale
// ceiling — the bars clipped flat at the top until a full
// destroy+rebuild (page reload, mode toggle) recomputed the axis.
//
// refreshYScaleState is now the single code path both the build and
// the update derive their ceilings from; uPlot re-invokes the range
// closures (which read the mutated state live) on every setData. These
// tests pin the derivation; computePrecipMax's floor semantics are
// covered in orchestrator-precip-max.test.js and delegate to the same
// precipCeiling tested here.

import { describe, it, expect } from 'vitest';
import { precipCeiling, refreshYScaleState } from '../src/chart/draw.js';

// Matches the orchestrator's dataset order: tempHigh, tempLow (both
// TempAxis lines), precip (PrecipAxis bar), optional sunshine.
function mkSeries({ tempHigh = [], tempLow = [], precip = [], sunshine = [] } = {}) {
  return [
    { yAxisID: 'TempAxis', data: tempHigh },
    { yAxisID: 'TempAxis', data: tempLow },
    { yAxisID: 'PrecipAxis', data: precip },
    { yAxisID: 'SunshineAxis', data: sunshine },
  ];
}

describe('precipCeiling', () => {
  it('stays at the floor while every bucket is below it', () => {
    expect(precipCeiling(20, [0.3, 1.2, 4.9])).toBe(20);
  });

  it('rises to the tallest bucket once it clears the floor', () => {
    expect(precipCeiling(20, [5, 45, 12])).toBe(45);
  });

  it('ignores null / NaN / Infinity / string cells', () => {
    expect(precipCeiling(4, [null, NaN, undefined, Infinity, '99', 6])).toBe(6);
  });

  it('returns the bare floor for missing data', () => {
    expect(precipCeiling(4)).toBe(4);
    expect(precipCeiling(20, [])).toBe(20);
  });
});

describe('refreshYScaleState', () => {
  const RESERVES = { bottom: 0.25, top: 0.2 };
  const refresh = (state, series) =>
    refreshYScaleState(state, series, 20, RESERVES.bottom, RESERVES.top);

  it('lifts precipMax in place when an update brings taller buckets (the reload bug)', () => {
    const state = { precipMax: 0, tempMin: 0, tempMax: 1 };
    // Build-time data: drizzle, ceiling rests on the daily 20 mm floor.
    refresh(state, mkSeries({ tempHigh: [10, 12], tempLow: [4, 5], precip: [1.2, 0.4] }));
    expect(state.precipMax).toBe(20);
    // Rain intensifies on the SAME chart instance — the in-place update
    // must raise the ceiling so the 45 mm bar scales instead of clipping.
    refresh(state, mkSeries({ tempHigh: [10, 12], tempLow: [4, 5], precip: [30, 45] }));
    expect(state.precipMax).toBe(45);
  });

  it('drops precipMax back to the floor when the rain column leaves the data', () => {
    const state = { precipMax: 0, tempMin: 0, tempMax: 1 };
    refresh(state, mkSeries({ precip: [30, 45] }));
    expect(state.precipMax).toBe(45);
    refresh(state, mkSeries({ precip: [0.4, 0] }));
    expect(state.precipMax).toBe(20);
  });

  it('pads the temp bounds around the current data (proportionality formula)', () => {
    const state = { precipMax: 0, tempMin: 0, tempMax: 1 };
    refresh(state, mkSeries({ tempHigh: [10, 20], tempLow: [5, 8] }));
    // rawMin 5, rawMax 20, rawRange 15, denom 1-0.25-0.2 = 0.55:
    //   min = 5 - 18 * (0.25 / 0.55), max = 20 + 18 * (0.2 / 0.55)
    expect(state.tempMin).toBeCloseTo(5 - 18 * (0.25 / 0.55), 10);
    expect(state.tempMax).toBeCloseTo(20 + 18 * (0.2 / 0.55), 10);
  });

  it('follows the temperature when it moves past the old bounds', () => {
    const state = { precipMax: 0, tempMin: 0, tempMax: 1 };
    refresh(state, mkSeries({ tempHigh: [10, 20], tempLow: [5, 8] }));
    const prevMax = state.tempMax;
    refresh(state, mkSeries({ tempHigh: [10, 35], tempLow: [5, 8] }));
    expect(state.tempMax).toBeGreaterThan(35);
    expect(state.tempMax).toBeGreaterThan(prevMax);
  });

  it('falls back to the 0..30 default band when no finite temps exist', () => {
    const state = { precipMax: 0, tempMin: 99, tempMax: 99 };
    refresh(state, mkSeries({ tempHigh: [null, undefined], tempLow: [] }));
    expect(state.tempMin).toBeLessThan(0);
    expect(state.tempMax).toBeGreaterThan(30);
  });
});
