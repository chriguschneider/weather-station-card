// Loading placeholder visibility. After Lit's first render commit
// (but before the async recorder/forecast WS calls resolve), the
// chart area must show the shimmer placeholder instead of an empty
// div. Once data lands, the placeholder is replaced by the real
// chart canvas in a single swap.
//
// This spec does NOT use the standard `mount()` helper because that
// one waits for `canvas` to appear before returning — by the time it
// returns the placeholder is gone. We use the lower-level
// `window.__wsc.mount()` directly and capture the state inside the
// same `page.evaluate` call.

import { test, expect } from '@playwright/test';
import { openHarness, unmountAll, cardSelector } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

test.describe('skeleton-first paint', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  test('renders shimmer placeholder before chart data lands', async ({ page }) => {
    const fixture = buildFullFixture();
    const config = {
      ...buildBaseConfig(),
      // Combination mode — both station and forecast data are
      // awaited, so the placeholder window is widest.
      show_station: true,
      show_forecast: true,
    };

    // Mount WITHOUT awaiting the canvas. Inside the evaluate we
    // capture the initial-paint state: are placeholder + canvas
    // present in the shadow DOM right after Lit's first updateComplete?
    // Note: with the uPlot swap (ADR-0012) the canvas is created by
    // uPlot as a child of `<div id="forecastChart">`, not as the
    // forecastChart element itself.
    const initialState = await page.evaluate(
      async ([cfg, fix]) => {
        const hass = window.__wsc.createMock(fix);
        const card = await window.__wsc.mount(cfg, hass);
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot!;
        const wrapper = sr.querySelector('.forecast-skeleton-wrapper');
        const rect = wrapper ? (wrapper as HTMLElement).getBoundingClientRect() : null;
        return {
          hasSkeletonWrapper: !!wrapper,
          // Confirms the wrapper reserves real vertical space so the
          // swap to the live chart doesn't reflow rows below it.
          wrapperRectHeight: rect ? rect.height : 0,
          hasCanvas: !!sr.querySelector('#forecastChart canvas'),
          hasLoadingDiv: !!sr.querySelector('.forecast-loading'),
        };
      },
      [config, fixture] as [Record<string, unknown>, ReturnType<typeof buildFullFixture>],
    );

    expect(initialState.hasLoadingDiv).toBe(true);
    expect(initialState.hasSkeletonWrapper).toBe(true);
    // Wrapper height comes from `style="height: ${chartHeight}px"`
    // on the div; covers the entire eventual chart area.
    expect(initialState.wrapperRectHeight).toBeGreaterThan(50);
    expect(initialState.hasCanvas).toBe(false);

    // Now wait for the real chart to commit, then re-check.
    await page.waitForFunction(
      (sel) => {
        const card = document.querySelector(sel);
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null })?.shadowRoot;
        return !!sr?.querySelector('#forecastChart canvas');
      },
      cardSelector(),
      { timeout: 5000 },
    );

    const finalState = await page.evaluate(
      (sel) => {
        const card = document.querySelector(sel);
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null })?.shadowRoot;
        return {
          hasSkeleton: !!sr?.querySelector('.forecast-skeleton-wrapper'),
          hasCanvas: !!sr?.querySelector('#forecastChart canvas'),
        };
      },
      cardSelector(),
    );
    expect(finalState.hasSkeleton).toBe(false);
    expect(finalState.hasCanvas).toBe(true);
  });
});
