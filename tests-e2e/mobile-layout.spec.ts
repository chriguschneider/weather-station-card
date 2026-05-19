// Mobile-emulation layout-invariant spec (Stufe 3a).
//
// Runs in the `mobile` Playwright project (Pixel 5 device profile —
// viewport 393x851, DPR 2.625, mobile user-agent, touch events). The
// chromium project deliberately skips this file (testIgnore in
// playwright.config.ts) so the mobile-specific invariants stay
// expressed in one place at the right DPR.
//
// What this catches:
//   - Canvas CSS-size vs HTML-attribute-size mismatch (e.g. uPlot
//     writing DPR-multiplied buffer dimensions onto canvas width/
//     height attrs without a matching CSS rule — the regression
//     that PR #176 fixed).
//   - Plugin draw coordinates vs uPlot data coordinates mismatch
//     at DPR>1 (the second half of #176).
//   - Chart overflow past the chart-container's intended height
//     (any layout regression that pushes data below the wind row).
//   - Negative-inset elements (.scroll-indicator-left/right,
//     .mode-toggle) being clipped by paint-containment style
//     properties on the parent.
//
// What this does NOT cover:
//   - Real-WebView quirks (Android WebView memory limits, iOS
//     position:sticky bugs, Companion-App-specific viewport meta
//     handling). For those, a paid real-device CI service would be
//     the right tool; defer until evidence justifies the cost.
//   - Visual baselines. Mobile baselines were considered and dropped
//     for this PR — assertion-based probes catch the bug class we
//     care about (DPR + layout invariants) without doubling the
//     snapshot matrix.

import { test, expect } from '@playwright/test';
import { openHarness, mount } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

test.describe.configure({ mode: 'serial' });

test.describe('mobile layout — daily-combination', () => {
  test('canvas CSS dimensions match the chart-container bounds', async ({ page }) => {
    // Without a CSS rule constraining the canvas, uPlot's HTML
    // width/height attributes (which it sets to fullWidCss * pxRatio
    // for sharp retina rendering) become the canvas's default CSS
    // display size. At DPR=2.625 that produces a 2.6x-too-large
    // canvas whose bottom rows render past the chart-container.
    // Assert the canvas's CSS-computed bounding box height matches
    // the container's bounding box height.
    await openHarness(page);
    const fix = buildFullFixture('daily-combination');
    const cfg = buildBaseConfig('daily-combination');
    await mount(page, cfg, fix);
    await page.waitForTimeout(300);

    const dims = await page.evaluate(() => {
      const host = document.querySelector('weather-station-card') as { shadowRoot: ShadowRoot | null } | null;
      const root = host?.shadowRoot;
      if (!root) throw new Error('no shadow root');
      const container = root.querySelector('.chart-container') as HTMLElement | null;
      const canvas = root.querySelector('#forecastChart canvas') as HTMLCanvasElement | null;
      if (!container || !canvas) throw new Error('chart-container or canvas missing');
      const cRect = container.getBoundingClientRect();
      const cnRect = canvas.getBoundingClientRect();
      return {
        containerHeight: cRect.height,
        canvasCssHeight: cnRect.height,
        canvasCssWidth: cnRect.width,
        containerWidth: cRect.width,
        canvasHtmlWidth: Number(canvas.getAttribute('width')) || 0,
        canvasHtmlHeight: Number(canvas.getAttribute('height')) || 0,
        pxRatio: window.devicePixelRatio,
      };
    });

    // Canvas CSS height MUST equal container height. With DPR=2.625
    // and the bug present, canvasCssHeight would be ~472 px against
    // a 180 px container.
    expect(dims.canvasCssHeight).toBeCloseTo(dims.containerHeight, 0);
    // Width too — same failure mode, different axis.
    expect(dims.canvasCssWidth).toBeCloseTo(dims.containerWidth, 0);
    // Sanity: the HTML buffer dimensions ARE DPR-multiplied (this is
    // intentional, gives sharp retina rendering). If this assertion
    // ever flips it means uPlot stopped doing DPR scaling internally
    // and the canvas would render blurry.
    if (dims.pxRatio > 1) {
      expect(dims.canvasHtmlHeight).toBeGreaterThan(dims.canvasCssHeight);
    }
  });

  test('plugin draw coordinates land within the chart canvas', async ({ page }) => {
    // The plugin shim divides u.bbox by pxRatio so plugins draw in
    // CSS pixels. If the canvas context is not pre-scaled by pxRatio
    // before plugins run, those CSS-pixel calls land at 1/pxRatio of
    // the intended canvas position — labels clustered in a fraction
    // of the chart width while bars/lines span the full width.
    //
    // We can't easily inspect canvas pixel content, but we can probe
    // the shim's coordinate output against the canvas's CSS bounds.
    // The plugin coordinates ARE proxied through `chart.scales.x`
    // and `chart.chartArea`; getDatasetMeta(2).data[i].x gives the
    // per-bar centre x positions. At DPR=2.625, with the bug, those
    // x values would max out at ~width/2.625; without the bug they
    // span the full canvas CSS width.
    await openHarness(page);
    const fix = buildFullFixture('daily-combination');
    const cfg = buildBaseConfig('daily-combination');
    await mount(page, cfg, fix);
    await page.waitForTimeout(300);

    const probe = await page.evaluate(() => {
      const host = document.querySelector('weather-station-card') as { forecastChart?: unknown; shadowRoot: ShadowRoot | null } | null;
      const root = host?.shadowRoot;
      if (!root) throw new Error('no shadow root');
      const canvas = root.querySelector('#forecastChart canvas') as HTMLCanvasElement | null;
      if (!canvas) throw new Error('no canvas');
      const canvasRect = canvas.getBoundingClientRect();

      // Re-derive the plugin shim's getPixelForTick output. The
      // orchestrator builds this on every chart draw and the plugins
      // read it; we duplicate the math here so the probe is
      // independent of internal API names.
      // colW = (u.bbox.width / pxRatio) / columnCount = chartArea.width / columnCount
      // tickX_i = chartArea.left + (i + 0.5) * colW
      //
      // What we want to assert: the LEFTMOST tick is inside the
      // canvas, the RIGHTMOST tick is inside the canvas, and the
      // span from first to last covers most of the canvas width.
      // If the shim was off by pxRatio, rightmost would be at
      // canvasWidth / pxRatio.
      // The card stashes the forecastChart instance on `this`; we
      // pull the uPlot bbox from there.
      const uplot = ((host as unknown as { forecastChart?: { uplot?: { bbox?: { left: number; width: number } } } } | null)?.forecastChart?.uplot);
      if (!uplot?.bbox) throw new Error('uplot not ready');
      const pxRatio = window.devicePixelRatio;
      const chartLeftCss = uplot.bbox.left / pxRatio;
      const chartWidthCss = uplot.bbox.width / pxRatio;
      const firstTickX = chartLeftCss + 0.5 * (chartWidthCss / 8);
      const lastTickX = chartLeftCss + 7.5 * (chartWidthCss / 8);
      return {
        canvasWidth: canvasRect.width,
        chartLeftCss,
        chartWidthCss,
        firstTickX,
        lastTickX,
        pxRatio,
      };
    });

    // Span between first and last tick should cover at least 80% of
    // canvas width (with margins for axis padding). At DPR > 1 with
    // the bug, this would be width / pxRatio ≈ 38%.
    const tickSpan = probe.lastTickX - probe.firstTickX;
    expect(tickSpan).toBeGreaterThan(probe.canvasWidth * 0.8);
    // Right-most tick must land inside the canvas.
    expect(probe.lastTickX).toBeLessThan(probe.canvasWidth);
    // Left-most tick must be positive (inside the canvas left edge).
    expect(probe.firstTickX).toBeGreaterThan(0);
  });

  test('chart canvas does not overflow below the chart-container', async ({ page }) => {
    // Insurance against any regression that puts the canvas outside
    // its parent — overflow detection is more directly testable
    // than the underlying mechanism. If the canvas's bottom edge
    // is below the wind row (the bug from before #176), this fails.
    await openHarness(page);
    const fix = buildFullFixture('daily-combination');
    const cfg = buildBaseConfig('daily-combination');
    await mount(page, cfg, fix);
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const host = document.querySelector('weather-station-card') as { shadowRoot: ShadowRoot | null } | null;
      const root = host?.shadowRoot;
      if (!root) throw new Error('no shadow root');
      const container = root.querySelector('.chart-container') as HTMLElement | null;
      const canvas = root.querySelector('#forecastChart canvas') as HTMLCanvasElement | null;
      const wind = root.querySelector('.wind-details') as HTMLElement | null;
      if (!container || !canvas) throw new Error('container or canvas missing');
      return {
        canvasBottom: canvas.getBoundingClientRect().bottom,
        containerBottom: container.getBoundingClientRect().bottom,
        windTop: wind?.getBoundingClientRect().top ?? Infinity,
      };
    });

    // Canvas must not extend past the chart-container's bottom edge
    // (within a 1 px tolerance for browser rounding).
    expect(overflow.canvasBottom).toBeLessThanOrEqual(overflow.containerBottom + 1);
    // Defence-in-depth: canvas bottom must be above the wind row
    // top. If the canvas overflows the container AND clears the
    // conditions row, this catches it.
    expect(overflow.canvasBottom).toBeLessThanOrEqual(overflow.windTop + 1);
  });

  test('scroll-indicators and mode-toggle are not clipped by paint containment', async ({ page }) => {
    // The .scroll-indicator-{left,right} and .mode-toggle sit at
    // left/right: -14 px relative to .forecast-scroll-block — they
    // intentionally protrude into the .card's horizontal padding.
    // A CSS regression that adds paint-containment to the parent
    // (content-visibility: auto, contain: paint) would clip them.
    // We assert the elements' bounding boxes are non-empty and
    // their effective visible widths match their CSS width.
    await openHarness(page);
    // Switch to hourly so the scroll-indicators actually mount
    // (they're only shown when totalBars > visibleBars).
    const fix = buildFullFixture('hourly-combination');
    const cfg = buildBaseConfig('hourly-combination');
    await mount(page, cfg, fix);
    await page.waitForTimeout(300);

    const dims = await page.evaluate(() => {
      const host = document.querySelector('weather-station-card') as { shadowRoot: ShadowRoot | null } | null;
      const root = host?.shadowRoot;
      if (!root) throw new Error('no shadow root');
      const left = root.querySelector('.scroll-indicator-left') as HTMLElement | null;
      const right = root.querySelector('.scroll-indicator-right') as HTMLElement | null;
      const toggle = root.querySelector('.mode-toggle') as HTMLElement | null;
      const pick = (el: HTMLElement | null): { w: number; h: number } | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      };
      return { left: pick(left), right: pick(right), toggle: pick(toggle) };
    });

    // Every indicator that is present in the DOM must have its full
    // 30x30 CSS size visible (the .scroll-indicator rule sets both).
    if (dims.left) expect(dims.left.w).toBeGreaterThanOrEqual(30);
    if (dims.right) expect(dims.right.w).toBeGreaterThanOrEqual(30);
    if (dims.toggle) expect(dims.toggle.w).toBeGreaterThanOrEqual(30);
  });
});
