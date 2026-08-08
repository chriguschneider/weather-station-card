// Visual regression: every render-mode permutation the card supports.
//
// 3 forecast types × 3 modes × 2 sunshine variants × 2 themes = 36 tests:
//   forecast types: daily, today (24h zoom), hourly
//   modes: combination, station-only, forecast-only
//   sunshine: off, on
//   themes: light (HA default), dark (HA default-dark)
//
// Each scenario gets a screenshot baseline. A regression in dataset
// assembly, separator framing, sunshine row placement, sparse-label
// rendering, or styling will fail the matching baseline check at CI
// time. Baselines are committed under tests-e2e/snapshots/ and
// generated on the GHA runner via update-baselines.yml (#18) so the
// 0.2 % maxDiffPixelRatio threshold holds.
//
// Animation is disabled via `forecast.disable_animation: true` in the
// base config so the screenshot timing is deterministic.

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll, cardSelector } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

type Mode = 'combination' | 'station' | 'forecast';
type ForecastType = 'daily' | 'today' | 'hourly';
type Theme = 'light' | 'dark';

interface ModeFlags {
  show_station: boolean;
  show_forecast: boolean;
}

const MODES: Record<Mode, ModeFlags> = {
  combination: { show_station: true, show_forecast: true },
  station:     { show_station: true, show_forecast: false },
  forecast:    { show_station: false, show_forecast: true },
};

const FORECAST_TYPES: ForecastType[] = ['daily', 'today', 'hourly'];
const THEMES: Theme[] = ['light', 'dark'];

for (const theme of THEMES) {
  test.describe(`render modes — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await openHarness(page, { theme });
    });

    test.afterEach(async ({ page }) => {
      await unmountAll(page);
    });

    // Dedicated baseline for the "two temperature lines in 24h
    // view" case — some forecast providers (meteoswiss,
    // openmeteo-hourly) emit BOTH `temperature` and `templow` per
    // hourly forecast bucket, which the card renders as the second
    // dashed line under the high-temp spline. Without this snapshot,
    // a regression in the templow handling would silently strip the
    // second line and only get caught by hand-eyeball next deploy.
    {
      const themeSuffix = theme === 'dark' ? '-dark' : '';
      const name = `today-combination-templow${themeSuffix}`;
      test(name, async ({ page }) => {
        const fixture = buildFullFixture({
          days: 1,
          hours: 24,
          forecastHours: 24,
          forecastWithTemplow: true,
        });
        await mount(
          page,
          buildBaseConfig({
            show_station: true,
            show_forecast: true,
            days: 1,
            forecast_days: 1,
            forecast: {
              type: 'today',
              disable_animation: true,
            },
          }),
          fixture,
        );
        await expect(page.locator(cardSelector())).toHaveScreenshot(
          `${name}.png`,
        );
      });
    }

    // Narrow-column baseline (Slice 7). The card lives inside HA's
    // grid — in a Companion-app column or the HA 2026.1 mobile-first
    // summary-card slot its host can be ~300px wide. The card's
    // @container rules key off its OWN width (container-type on
    // .card), so this test shrinks the harness slot + ha-card host
    // and screenshots the reflowed layout: smaller live-panel icon
    // and clock, wrapped attribute groups, no horizontal overflow.
    // Light theme + daily-combination only — one baseline is enough
    // to catch a regression in the responsive rules; the full
    // matrix stays at the wide 600px width above.
    {
      const themeSuffix = theme === 'dark' ? '-dark' : '';
      const name = `daily-combination-narrow${themeSuffix}`;
      test(name, async ({ page }) => {
        const fixture = buildFullFixture();
        await mount(
          page,
          buildBaseConfig({
            show_station: true,
            show_forecast: true,
            forecast: {
              type: 'daily',
              disable_animation: true,
            },
          }),
          fixture,
        );
        // Squeeze the harness slot + ha-card host to a phone-column
        // width so the card's @container rules engage. Done after
        // mount so the chart canvas sizes against the wide layout
        // first (the harness comment warns a fluid ha-card width can
        // race the chart sizing); a single fixed resize afterwards
        // is stable.
        await page.evaluate(() => {
          const slot = document.querySelector('[data-slot="a"]') as HTMLElement | null;
          const host = document.querySelector(
            '[data-slot="a"] > weather-station-card',
          ) as HTMLElement | null;
          if (slot) slot.style.width = '320px';
          if (host) host.style.width = '320px';
          const card = host?.shadowRoot?.querySelector('ha-card') as HTMLElement | null;
          if (card) card.style.width = '320px';
        });
        // One rAF tick so the container-query re-layout commits.
        await page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => r())),
        );
        await expect(page.locator(cardSelector())).toHaveScreenshot(
          `${name}.png`,
        );
      });
    }

    // 3 × 3 × 2 = 18 systematic baselines per theme.
    for (const mode of Object.keys(MODES) as Mode[]) {
      for (const forecastType of FORECAST_TYPES) {
        for (const sunshine of [false, true]) {
          const sunshineSuffix = sunshine ? '-sunshine' : '';
          // Light variants keep the historical filename so existing
          // baselines stay valid; dark variants get a `-dark` suffix.
          const themeSuffix = theme === 'dark' ? '-dark' : '';
          const name = `${forecastType}-${mode}${sunshineSuffix}${themeSuffix}`;
          test(name, async ({ page }) => {
            // ONE canonical dataset (maintainer decision, 2026-08):
            // 7 days of past + 7 days of future, and every mode draws
            // from it — the station cell shows exactly the past half
            // of the combination cell, the forecast cell exactly its
            // future half. 'today' shares the same window; the day
            // pager anchors on the current day / data edge.
            const fixture = buildFullFixture({ days: 7 });

            await mount(
              page,
              buildBaseConfig({
                ...MODES[mode],
                days: 7,
                forecast_days: 7,
                forecast: {
                  type: forecastType,
                  disable_animation: true,
                  show_sunshine: sunshine,
                },
              }),
              fixture,
            );
            await expect(page.locator(cardSelector())).toHaveScreenshot(
              `${name}.png`,
            );
          });
        }
      }
    }
  });
}
