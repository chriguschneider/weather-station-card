// Regression: the forecast chart must rebuild when its #forecastChart
// container is recreated while the card stays alive.
//
// On an HA dashboard view switch the card is detached and re-attached;
// the forecast block then re-renders through its loading→ready cycle,
// and Lit rebuilds a FRESH `#forecastChart` div. The previous uPlot
// instance survives on `this.forecastChart` but its canvas is now
// detached. The `measureCard()` skip-rebuild guard used to bail out on
// the stale instance, leaving the new div empty — a blank chart while
// the condition-icon row still rendered (the user-visible symptom was
// "Forecast bleibt leer nach View-Wechsel"). The guard now only skips
// when the chart root is still connected.
import { test, expect } from '@playwright/test';
import { openHarness, mount } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

async function chartCanvas(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-slot="x"] > weather-station-card') as
      (HTMLElement & { shadowRoot: ShadowRoot | null }) | null;
    const sr = card?.shadowRoot;
    const canvas = sr?.querySelector('#forecastChart canvas') as HTMLCanvasElement | null;
    return {
      hasCanvas: !!canvas,
      width: canvas?.width ?? 0,
      icons: sr ? sr.querySelectorAll('.conditions ha-icon').length : -1,
    };
  });
}

for (const type of ['hourly', 'daily'] as const) {
  test(`forecast chart rebuilds after its container is recreated (${type})`, async ({ page }) => {
    await openHarness(page, { theme: 'light' });
    const config = {
      ...buildBaseConfig(),
      show_station: true,
      show_forecast: true,
      forecast: { type, disable_animation: true },
    };
    await mount(page, config, buildFullFixture(), 'x');

    const initial = await chartCanvas(page);
    expect(initial.hasCanvas, 'chart drawn on mount').toBe(true);
    const iconsBefore = initial.icons;
    expect(iconsBefore).toBeGreaterThan(0);

    // Recreate the chart container (data stays ready → icon row survives,
    // matching the real view-switch symptom).
    await page.evaluate(async () => {
      const card = document.querySelector('[data-slot="x"] > weather-station-card') as
        (HTMLElement & { shadowRoot: ShadowRoot | null; updateComplete: Promise<unknown> });
      card.shadowRoot!.querySelector('#forecastChart')!.replaceChildren();
      await card.updateComplete;
    });
    const emptied = await chartCanvas(page);
    expect(emptied.hasCanvas, 'canvas detached after container recreate').toBe(false);
    expect(emptied.icons, 'icon row still rendered (data ready)').toBe(iconsBefore);

    // The next render pass (here driven explicitly) must rebuild.
    await page.evaluate(async () => {
      const card = document.querySelector('[data-slot="x"] > weather-station-card') as
        (HTMLElement & { measureCard(): void; updateComplete: Promise<unknown> });
      card.measureCard();
      await card.updateComplete;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const rebuilt = await chartCanvas(page);
    expect(rebuilt.hasCanvas, 'chart rebuilt into the fresh container').toBe(true);
    expect(rebuilt.width, 'rebuilt canvas has width').toBeGreaterThan(0);
  });
}
