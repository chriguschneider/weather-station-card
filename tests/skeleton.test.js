// Skeleton placeholder unit tests. The skeleton is a pure function
// that returns a Lit TemplateResult — we don't render to a real DOM
// here, only assert the values that flow into the template. Visual
// rendering is covered by the E2E placeholder test.

import { describe, it, expect } from 'vitest';
import { renderChartSkeleton } from '../src/chart/skeleton.js';

describe('renderChartSkeleton', () => {
  it('returns a TemplateResult', () => {
    const result = renderChartSkeleton({ chartHeight: 180, visibleBars: 7 });
    // Lit TemplateResult has a strings array and a values array.
    expect(result).toBeTruthy();
    expect(Array.isArray(result.strings)).toBe(true);
    expect(Array.isArray(result.values)).toBe(true);
  });

  it('propagates chartHeight into the template', () => {
    const result = renderChartSkeleton({ chartHeight: 240, visibleBars: 8 });
    // The chartHeight appears multiple times (svg height + each gridline y2).
    expect(result.values).toContain(240);
  });

  it('falls back to 8 columns when visibleBars is 0', () => {
    // 8 columns → 7 interior gridlines + 1 horizontal axis line = 8 lines total.
    // Each gridline is itself a TemplateResult in the values array.
    const result = renderChartSkeleton({ chartHeight: 180, visibleBars: 0 });
    // The last interpolated value is the array of gridline templates.
    const gridlines = result.values.find((v) => Array.isArray(v));
    expect(gridlines).toBeTruthy();
    expect(gridlines.length).toBe(7);
  });

  it('produces visibleBars-1 gridlines when visibleBars is set', () => {
    const result = renderChartSkeleton({ chartHeight: 180, visibleBars: 5 });
    const gridlines = result.values.find((v) => Array.isArray(v));
    expect(gridlines.length).toBe(4);
  });

  it('handles visibleBars=1 without crashing (zero interior gridlines)', () => {
    const result = renderChartSkeleton({ chartHeight: 180, visibleBars: 1 });
    const gridlines = result.values.find((v) => Array.isArray(v));
    expect(gridlines.length).toBe(0);
  });
});
