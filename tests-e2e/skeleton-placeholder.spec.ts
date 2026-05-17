// Skeleton placeholder visibility. After Lit's first render commit
// (but before the async recorder/forecast WS calls resolve), the
// chart area must show the axis-frame placeholder instead of an
// empty div. Once data lands, the placeholder is replaced by the
// real chart canvas in a single swap.
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

  test('renders axis-frame placeholder before chart data lands', async ({ page }) => {
    const fixture = buildFullFixture();
    const config = {
      ...buildBaseConfig(),
      // Combination mode — both station and forecast data are
      // awaited, so the placeholder window is widest.
      show_station: true,
      show_forecast: true,
    };

    // Mount WITHOUT awaiting the canvas. Inside the evaluate we
    // capture the initial-paint state: are skeleton + canvas
    // present in the shadow DOM right after Lit's first updateComplete?
    const initialState = await page.evaluate(
      async ([cfg, fix]) => {
        const hass = window.__wsc.createMock(fix);
        const card = await window.__wsc.mount(cfg, hass);
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot!;
        // Sample one gridline's namespace + bounding rect. The bug
        // caught on first deploy: gridlines existed in the DOM but
        // had no rendered dimensions because they were created via
        // `html\`\`` instead of `svg\`\``, ending up in the HTML
        // namespace where <line> renders nothing.
        const firstGrid = sr.querySelector('svg.forecast-skeleton line.forecast-skeleton-grid');
        const gridRect = firstGrid ? (firstGrid as SVGElement).getBoundingClientRect() : null;
        return {
          hasSkeletonSvg: !!sr.querySelector('svg.forecast-skeleton'),
          gridlineCount: sr.querySelectorAll('svg.forecast-skeleton line.forecast-skeleton-grid').length,
          axisCount: sr.querySelectorAll('svg.forecast-skeleton line.forecast-skeleton-axis').length,
          gridFirstNamespace: firstGrid?.namespaceURI ?? null,
          gridFirstRectHeight: gridRect ? gridRect.height : 0,
          hasCanvas: !!sr.querySelector('canvas#forecastChart'),
          hasLoadingDiv: !!sr.querySelector('.forecast-loading'),
        };
      },
      [config, fixture] as [Record<string, unknown>, ReturnType<typeof buildFullFixture>],
    );

    expect(initialState.hasLoadingDiv).toBe(true);
    expect(initialState.hasSkeletonSvg).toBe(true);
    expect(initialState.axisCount).toBe(1);
    // visibleBars from default config (buildBaseConfig sets
    // number_of_forecasts). gridlineCount = visibleBars - 1.
    expect(initialState.gridlineCount).toBeGreaterThan(0);
    // Namespace must be SVG. HTML namespace would mean Lit created
    // the elements via `html\`\``; they'd be present in the DOM but
    // render nothing.
    expect(initialState.gridFirstNamespace).toBe('http://www.w3.org/2000/svg');
    // Rendered height > 0 confirms the line is actually painted
    // with its full y1→y2 span, not collapsed to a 0-pixel HTML
    // element.
    expect(initialState.gridFirstRectHeight).toBeGreaterThan(10);
    expect(initialState.hasCanvas).toBe(false);

    // Now wait for the real chart to commit, then re-check.
    await page.waitForFunction(
      (sel) => {
        const card = document.querySelector(sel);
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null })?.shadowRoot;
        return !!sr?.querySelector('canvas#forecastChart');
      },
      cardSelector(),
      { timeout: 5000 },
    );

    const finalState = await page.evaluate(
      (sel) => {
        const card = document.querySelector(sel);
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null })?.shadowRoot;
        return {
          hasSkeleton: !!sr?.querySelector('svg.forecast-skeleton'),
          hasCanvas: !!sr?.querySelector('canvas#forecastChart'),
        };
      },
      cardSelector(),
    );
    expect(finalState.hasSkeleton).toBe(false);
    expect(finalState.hasCanvas).toBe(true);
  });
});
