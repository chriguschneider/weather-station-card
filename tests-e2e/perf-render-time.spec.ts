// Performance advisory: measures end-to-end mount → chart-rendered
// timing for a representative card config. Outputs a JSON line on
// stdout that the CI workflow picks up to render in the build summary.
//
// **Not a CI gate** — GHA-runner CPU variability would create flaky
// failures. Trend-tracking only; sustained regressions become visible
// in the build summary line over multiple PRs.
//
// Three configs (combination/daily, today, hourly) cover the three
// buildForecastChart code paths (separator+labels / today / hourly).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

interface Sample {
  scenario: string;
  median_ms: number;
  p95_ms: number;
  iterations: number;
}

const SAMPLES: Sample[] = [];
const ITERATIONS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

const SCENARIOS = [
  { name: 'daily-combination', forecastType: 'daily' as const, mode: 'combination' as const },
  { name: 'today-combination', forecastType: 'today' as const, mode: 'combination' as const },
  { name: 'hourly-combination', forecastType: 'hourly' as const, mode: 'combination' as const },
];

test.describe.configure({ mode: 'serial' });

for (const scenario of SCENARIOS) {
  test(`render-time: ${scenario.name}`, async ({ page }) => {
    await openHarness(page, { theme: 'light' });
    const config = {
      ...buildBaseConfig(),
      show_station: scenario.mode !== 'forecast',
      show_forecast: scenario.mode !== 'station',
      forecast: { type: scenario.forecastType, disable_animation: true },
    };
    const fixture = buildFullFixture();

    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = await page.evaluate(() => performance.now());
      await mount(page, config, fixture, `iter-${i}`);
      const end = await page.evaluate(() => performance.now());
      samples.push(end - start);
      await unmountAll(page);
    }

    SAMPLES.push({
      scenario: scenario.name,
      median_ms: Math.round(median(samples) * 100) / 100,
      p95_ms: Math.round(p95(samples) * 100) / 100,
      iterations: ITERATIONS,
    });

    // Sanity floor — if render time is genuinely zero, something
    // bypassed the chart pipeline. Loose to avoid flakiness.
    expect(median(samples)).toBeGreaterThan(0);
  });
}

test.afterAll(async () => {
  // Persist the samples for the CI workflow's summary step. Path is
  // tracked in .gitignore (test-results/* already excluded). Console
  // line is also kept for local visibility.
  const out = 'test-results/perf-render-time.json';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ samples: SAMPLES }, null, 2));
  console.log('[wsc-perf]', JSON.stringify({ samples: SAMPLES }));
});
