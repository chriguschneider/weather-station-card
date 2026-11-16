// The precipitation y-axis ceiling must adapt to the data so heavy
// buckets scale proportionally instead of clipping flat at the top.
//
// Repro context: in 'today' mode precip is summed into 3-hour buckets
// (aggregateThreeHourCalendar). A wet afternoon produced buckets of 2.7 / 10 /
// 4.7 mm, but the ceiling was a fixed 4 mm — so the 10 mm and 4.7 mm
// bars both pinned to full height and read as equally tall while
// 2.7 mm sat just below. The bars no longer encoded their values.

import { describe, it, expect } from 'vitest';
import { computePrecipMax } from '../src/chart/orchestrator.js';

describe('computePrecipMax', () => {
  it('keeps the metric hourly/today floor (4 mm) when all buckets are below it', () => {
    expect(computePrecipMax(true, 'mm', [0.1, 1.2, 3.9, null])).toBe(4);
  });

  it('keeps the metric daily floor (20 mm) when totals stay below it', () => {
    expect(computePrecipMax(false, 'mm', [2, 11, 19])).toBe(20);
  });

  it('raises the ceiling to the tallest bucket when it exceeds the floor', () => {
    // The original bug: 10 mm and 4.7 mm both clipped at the fixed 4 mm.
    // Now the ceiling is 10 so 4.7 mm renders at ~47 % and 2.7 mm at ~27 %.
    expect(computePrecipMax(true, 'mm', [2.7, 10, 4.7])).toBe(10);
  });

  it('raises the daily ceiling on a stormy day above the 20 mm floor', () => {
    expect(computePrecipMax(false, 'mm', [5, 35, 12])).toBe(35);
  });

  it('uses a 1-unit floor for inches regardless of granularity', () => {
    expect(computePrecipMax(true, 'in', [0.2, 0.4])).toBe(1);
    expect(computePrecipMax(false, 'in', [0.3])).toBe(1);
  });

  it('converts the mm floors into centimetres', () => {
    expect(computePrecipMax(true, 'cm', [0.1])).toBe(0.4);
    expect(computePrecipMax(false, 'cm')).toBe(2);
    expect(computePrecipMax(true, 'cm', [1.5])).toBe(1.5);
  });

  it('ignores null / NaN / non-finite cells when finding the max', () => {
    expect(computePrecipMax(true, 'mm', [null, NaN, undefined, Infinity, 6])).toBe(6);
  });

  it('falls back to the floor when no precip data is supplied', () => {
    expect(computePrecipMax(true, 'mm')).toBe(4);
    expect(computePrecipMax(false, 'mm')).toBe(20);
  });
});
