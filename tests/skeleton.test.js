// Skeleton placeholder unit tests. The skeleton is a pure function
// that returns a Lit TemplateResult — we don't render to a real DOM
// here, only assert the values that flow into the template. Visual
// rendering is covered by the E2E placeholder test.

import { describe, it, expect } from 'vitest';
import { renderChartSkeleton } from '../src/chart/skeleton.js';

describe('renderChartSkeleton', () => {
  it('returns a TemplateResult', () => {
    const result = renderChartSkeleton({ chartHeight: 180 });
    // Lit TemplateResult has a strings array and a values array.
    expect(result).toBeTruthy();
    expect(Array.isArray(result.strings)).toBe(true);
    expect(Array.isArray(result.values)).toBe(true);
  });

  it('propagates chartHeight into the inline height style', () => {
    const result = renderChartSkeleton({ chartHeight: 240 });
    // The wrapper carries `style="height: ${chartHeight}px"` — the
    // numeric value lands as the sole interpolation in that string.
    expect(result.values).toContain(240);
  });

  it('ignores visibleBars (kept for backwards compat with axis-frame variant)', () => {
    // The shimmer placeholder has no per-column structure, so the
    // visibleBars option flows through but doesn't change output.
    const a = renderChartSkeleton({ chartHeight: 180, visibleBars: 0 });
    const b = renderChartSkeleton({ chartHeight: 180, visibleBars: 24 });
    expect(a.values).toEqual(b.values);
  });
});
