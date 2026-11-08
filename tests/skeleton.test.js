// Skeleton placeholder unit tests. The skeleton is a pure function
// that returns a Lit TemplateResult — we don't render to a real DOM
// here, only assert the values that flow into the template. Visual
// rendering is covered by the E2E placeholder test.

import { describe, it, expect } from 'vitest';
import { renderChartSkeleton } from '../src/chart/skeleton.js';

describe('renderChartSkeleton', () => {
  it('propagates chartHeight into the inline height style', () => {
    const result = renderChartSkeleton({ chartHeight: 240 });
    // The wrapper carries `style="height: ${chartHeight}px"` — the
    // numeric value lands as the sole interpolation in that string.
    expect(result.values).toContain(240);
  });
});
