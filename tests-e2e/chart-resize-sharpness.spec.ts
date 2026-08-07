// Regression: the chart canvas's pixel buffer must follow a card-width
// change that does NOT change the bar count.
//
// uPlot has no responsive resize of its own — Chart.js's
// responsive:true observer died with the library swap (ADR-0012).
// buildChart measures the container once; afterwards
// `#forecastChart canvas { width:100% }` CSS-stretches the fixed
// buffer to the container's current width. measureCard()'s
// skip-rebuild guard used to return without touching the chart when
// forecastItems was unchanged — so a sidebar toggle / window resize /
// section-grid settle left a stretched bitmap. User-visible symptom:
// a pixelated temperature line, worst at hourly where the canvas is
// widest ("von wo kommt diese verpixelte Linie?"). The guard now
// snaps the buffer via chart.resize() when the container width moved.
//
// Like chart-rebuild-on-reattach.spec.ts, the render pass is driven
// explicitly via card.measureCard() rather than waiting on the card's
// own ResizeObserver: headless Chromium does not reliably deliver
// resize observations for later size changes (verified locally — a
// plain retained ResizeObserver on ha-card gets its initial delivery
// but none for a subsequent width change). The observer WIRING is
// asserted separately below as DOM state.
import { test, expect } from '@playwright/test';
import { openHarness, mount, settle } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

/** Canvas geometry: the pixel-buffer width (attribute) vs the CSS
 *  layout width × devicePixelRatio × supersample factor. Sharp
 *  rendering means the two match (±1 px for rounding); a stretched
 *  canvas diverges. The supersample factor mirrors draw.ts
 *  (ADR-0019): at DPR < 1.5 the buffer is allocated at 2× and
 *  downscaled by CSS for smoother strokes — headless Chromium runs
 *  at DPR 1, so this project always sees factor 2. */
async function canvasGeometry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-slot="x"] > weather-station-card') as
      (HTMLElement & { shadowRoot: ShadowRoot | null }) | null;
    const canvas = card?.shadowRoot?.querySelector('#forecastChart canvas') as
      HTMLCanvasElement | null;
    if (!canvas) return null;
    const superSample = devicePixelRatio < 1.5 ? 2 : 1;
    return {
      bufferWidth: canvas.width,
      displayWidth: canvas.getBoundingClientRect().width * devicePixelRatio * superSample,
    };
  });
}

for (const type of ['hourly', 'daily'] as const) {
  test(`canvas buffer follows a card-width change (${type})`, async ({ page }) => {
    await openHarness(page, { theme: 'light' });
    const config = {
      ...buildBaseConfig(),
      show_station: true,
      show_forecast: true,
      forecast: { type, disable_animation: true },
    };
    await mount(page, config, buildFullFixture(), 'x');

    const before = await canvasGeometry(page);
    expect(before, 'chart drawn on mount').not.toBeNull();
    expect(Math.abs(before!.bufferWidth - before!.displayWidth),
      'sharp on mount').toBeLessThanOrEqual(1);

    // The ResizeObserver must be pinned to the LIVE ha-card. The old
    // attach observed whatever `ha-card` existed at setTimeout(0) after
    // connectedCallback — when the first render hadn't committed yet
    // (or Lit later swapped the element), the observer watched nothing
    // and no width change ever reached measureCard.
    const observerWired = await page.evaluate(() => {
      const card = document.querySelector('[data-slot="x"] > weather-station-card') as
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any;
      return !!card.resizeObserver &&
        card._resizeObservedCard === card.shadowRoot?.querySelector('ha-card');
    });
    expect(observerWired, 'ResizeObserver observes the live ha-card').toBe(true);

    // Shrink the harness slot — same shape as an HA sidebar toggle or
    // window resize: the card's width changes, the bar count doesn't.
    // Drive the observer's render pass explicitly (see header comment).
    await page.evaluate(async () => {
      const slot = document.querySelector('[data-slot="x"]') as HTMLElement;
      slot.style.width = '380px';
      const card = slot.querySelector('weather-station-card') as
        (HTMLElement & { measureCard(): void; updateComplete: Promise<unknown> });
      card.measureCard();
      await card.updateComplete;
    });
    await settle(page);

    const after = await canvasGeometry(page);
    expect(after, 'chart still present after resize').not.toBeNull();
    expect(after!.bufferWidth, 'buffer re-rendered at the new width')
      .not.toBe(before!.bufferWidth);
    expect(Math.abs(after!.bufferWidth - after!.displayWidth),
      'sharp after resize — buffer matches displayed size')
      .toBeLessThanOrEqual(1);
  });
}
