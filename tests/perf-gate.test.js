// Unit tests for the cold-mount perf regression gate's pure core.
//
// The gate (scripts/perf-gate.cjs) is invoked from build.yml. Its
// `evaluate()` function is side-effect-free: it takes a parsed baseline
// + parsed perf results and returns a structured verdict. The I/O,
// process.exit, and GHA annotation emission are the script's `main()`,
// which is not exercised here -- only the comparison logic that decides
// pass / fail / placeholder, since that is the part a regression in the
// gate itself would silently break.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../scripts/perf-gate.cjs');

const SCENARIOS = ['daily-combination', 'today-combination', 'hourly-combination'];

function results(medians) {
  return {
    samples: SCENARIOS.map((scenario, i) => ({
      scenario,
      median_ms: medians[i],
      p95_ms: medians[i] * 1.2,
      iterations: 5,
    })),
  };
}

function baseline(values, extra = {}) {
  return {
    placeholder: false,
    tolerance_pct: 25,
    metric: 'median_ms',
    baselines: {
      'daily-combination': values[0],
      'today-combination': values[1],
      'hourly-combination': values[2],
    },
    ...extra,
  };
}

describe('perf-gate evaluate()', () => {
  it('passes when every scenario is exactly on baseline', () => {
    const v = evaluate(baseline([100, 80, 120]), results([100, 80, 120]));
    expect(v.status).toBe('pass');
    expect(v.rows.every((r) => !r.regressed)).toBe(true);
  });

  it('passes when scenarios are within the +25% tolerance', () => {
    // 100 -> 124 is +24%, still inside the +25% band.
    const v = evaluate(baseline([100, 80, 120]), results([124, 99, 149]));
    expect(v.status).toBe('pass');
  });

  it('passes exactly at the tolerance boundary', () => {
    // 100 * 1.25 = 125; measured 125 is not greater than the limit.
    const v = evaluate(baseline([100, 80, 120]), results([125, 100, 150]));
    expect(v.status).toBe('pass');
  });

  it('fails when a scenario regresses past the tolerance', () => {
    // 100 -> 126 is +26%, past the +25% band.
    const v = evaluate(baseline([100, 80, 120]), results([126, 80, 120]));
    expect(v.status).toBe('fail');
    const regressed = v.rows.filter((r) => r.regressed);
    expect(regressed).toHaveLength(1);
    expect(regressed[0].scenario).toBe('daily-combination');
  });

  it('reports the delta percentage on each row', () => {
    const v = evaluate(baseline([100, 80, 120]), results([150, 80, 120]));
    const daily = v.rows.find((r) => r.scenario === 'daily-combination');
    expect(daily.deltaPct).toBe(50);
  });

  it('faster-than-baseline never fails the gate', () => {
    const v = evaluate(baseline([100, 80, 120]), results([40, 30, 50]));
    expect(v.status).toBe('pass');
    const daily = v.rows.find((r) => r.scenario === 'daily-combination');
    expect(daily.deltaPct).toBeLessThan(0);
  });

  it('honours a custom tolerance_pct', () => {
    // With a tight 5% tolerance, 100 -> 110 regresses.
    const v = evaluate(
      baseline([100, 80, 120], { tolerance_pct: 5 }),
      results([110, 80, 120]),
    );
    expect(v.status).toBe('fail');
  });

  it('defaults to a 25% tolerance when tolerance_pct is absent', () => {
    const b = baseline([100, 80, 120]);
    delete b.tolerance_pct;
    expect(evaluate(b, results([124, 80, 120])).status).toBe('pass');
    expect(evaluate(b, results([126, 80, 120])).status).toBe('fail');
  });

  it('treats a placeholder baseline as warn-only', () => {
    const b = baseline([0, 0, 0], { placeholder: true });
    // Even a wildly slow run does not fail when placeholder is set.
    const v = evaluate(b, results([9999, 9999, 9999]));
    expect(v.status).toBe('placeholder');
    expect(v.messages.join(' ')).toMatch(/placeholder/i);
  });

  it('still records measured medians in placeholder mode', () => {
    const b = baseline([0, 0, 0], { placeholder: true });
    const v = evaluate(b, results([111, 222, 333]));
    expect(v.rows.map((r) => r.measured)).toEqual([111, 222, 333]);
  });

  it('fails when the results file carries no samples', () => {
    const v = evaluate(baseline([100, 80, 120]), { samples: [] });
    expect(v.status).toBe('fail');
    expect(v.messages.join(' ')).toMatch(/no samples/i);
  });

  it('warns but does not fail on a scenario missing from the baseline', () => {
    const b = baseline([100, 80, 120]);
    delete b.baselines['hourly-combination'];
    const v = evaluate(b, results([100, 80, 120]));
    // A missing baseline entry cannot be a regression -- it surfaces as
    // a warning, not a hard fail, so adding a new scenario does not
    // instantly red-build before its baseline is pinned.
    expect(v.status).toBe('pass');
    expect(v.messages.join(' ')).toMatch(/hourly-combination/);
  });

  it('treats a zero baseline (un-pinned) as a non-comparable entry', () => {
    // placeholder:false but a scenario still left at 0 -- not a real
    // baseline, so it must not be compared (0 * 1.25 = 0 would fail
    // every run). It is reported as missing instead.
    const b = baseline([100, 80, 0]);
    const v = evaluate(b, results([100, 80, 200]));
    expect(v.status).toBe('pass');
    expect(v.messages.join(' ')).toMatch(/hourly-combination/);
  });
});
