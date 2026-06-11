// Steady-state performance advisory: measures what a mounted card does
// when HA's WebSocket fan-out delivers hass objects where NO entity the
// card watches has changed. On a live dashboard this happens 2–5 times
// per second (every state change anywhere in HA produces a new hass),
// so per-tick work here is a continuous CPU tax on wall tablets.
//
// **Not a CI gate** (same reasoning as perf-render-time.spec.ts) —
// timing numbers are advisory. The COUNTER assertions are exact and do
// gate: chart updates per unrelated tick are a correctness property of
// the hass-tick gating, not a runner-speed artifact.
//
// Two probes per scenario:
//   1. Unrelated ticks: N fresh hass objects where only a synthetic
//      `sensor.unrelated_counter` entity changes. Counts Lit update
//      passes and uPlot `forecastChart.update()` calls.
//   2. Watched tick (sanity): the temperature sensor's state object is
//      replaced — the card MUST react with at least one update pass,
//      proving the gating never turns into "card stopped updating".

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from '@playwright/test';
import { openHarness, mount, cardSelector } from './_helpers.js';
import { buildFullFixture, buildBaseConfig, SENSORS } from './fixtures/generate.js';

const TICKS = 50;

interface SteadyStateResult {
  scenario: string;
  ticks: number;
  total_ms: number;
  ms_per_tick: number;
  update_passes: number;
  chart_updates: number;
  watched_tick_updated: boolean;
}

const RESULTS: SteadyStateResult[] = [];

test.describe.configure({ mode: 'serial' });

for (const scenario of [
  { name: 'hourly-combination', forecastType: 'hourly' as const },
  { name: 'daily-combination', forecastType: 'daily' as const },
]) {
  test(`steady-state: ${scenario.name}`, async ({ page }) => {
    await openHarness(page, { theme: 'light' });
    const config = {
      ...buildBaseConfig(),
      forecast: { type: scenario.forecastType, disable_animation: true },
    };
    await mount(page, config, buildFullFixture());

    const result = await page.evaluate(
      async ([selector, ticks, temperatureSensor]) => {
        const card = document.querySelector(selector) as HTMLElement & {
          _hass: { states: Record<string, unknown> };
          hass: unknown;
          updateComplete: Promise<boolean>;
          forecastChart?: { update: (...a: unknown[]) => unknown };
          updated?: (changed: unknown) => void;
        };
        const base = card._hass;

        // Count actual Lit update passes via an instance-level
        // `updated` shadow (Lit invokes this.updated(...) after each
        // commit, so the instance property intercepts every pass).
        let updatePasses = 0;
        const protoUpdated = Object.getPrototypeOf(card).updated as (changed: unknown) => void;
        Object.defineProperty(card, 'updated', {
          configurable: true,
          value: function (changed: unknown) {
            updatePasses++;
            return protoUpdated.call(this, changed);
          },
        });

        // Count uPlot redraws by wrapping the chart shim's update().
        let chartUpdates = 0;
        const chart = card.forecastChart;
        if (chart && typeof chart.update === 'function') {
          const origUpdate = chart.update;
          chart.update = function (...a: unknown[]) {
            chartUpdates++;
            return origUpdate.apply(this, a);
          };
        }

        // Probe 1 — unrelated ticks. Watched entity state objects are
        // carried over BY REFERENCE (HA state objects are immutable, a
        // non-updated entity keeps its reference across hass objects);
        // only the synthetic unrelated entity gets a fresh object.
        const start = performance.now();
        for (let i = 0; i < ticks; i++) {
          card.hass = {
            ...base,
            states: {
              ...base.states,
              'sensor.unrelated_counter': { state: String(i), attributes: {} },
            },
          };
          await card.updateComplete;
        }
        const totalMs = performance.now() - start;
        const unrelatedPasses = updatePasses;
        const unrelatedChartUpdates = chartUpdates;

        // Probe 2 — watched tick: replace the temperature state object
        // with a new value. The card must schedule an update.
        updatePasses = 0;
        const prevTemp = base.states[temperatureSensor] as { attributes: unknown };
        card.hass = {
          ...base,
          states: {
            ...base.states,
            [temperatureSensor]: { state: '16.3', attributes: prevTemp.attributes },
          },
        };
        await card.updateComplete;

        return {
          total_ms: totalMs,
          update_passes: unrelatedPasses,
          chart_updates: unrelatedChartUpdates,
          watched_tick_updated: updatePasses > 0,
        };
      },
      [cardSelector(), TICKS, SENSORS.temperature] as [string, number, string],
    );

    RESULTS.push({
      scenario: scenario.name,
      ticks: TICKS,
      total_ms: Math.round(result.total_ms * 100) / 100,
      ms_per_tick: Math.round((result.total_ms / TICKS) * 1000) / 1000,
      update_passes: result.update_passes,
      chart_updates: result.chart_updates,
      watched_tick_updated: result.watched_tick_updated,
    });

    // Sanity: the watched tick must always produce an update pass —
    // the gating may never suppress reactions to real sensor changes.
    expect(result.watched_tick_updated).toBe(true);

    // Gating contract: unrelated hass ticks must not redraw the chart.
    expect(result.chart_updates).toBe(0);
  });
}

test.afterAll(async () => {
  const out = 'test-results/perf-steady-state.json';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ results: RESULTS }, null, 2));
  console.log('[wsc-perf-steady]', JSON.stringify({ results: RESULTS }));
});
