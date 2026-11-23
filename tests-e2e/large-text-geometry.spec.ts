// Geometry checks for attributes_size / condition_size (#557). Assertions
// only, no screenshots: baselines come from the GHA runner (ADR-0003).

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll } from './_helpers.js';
import { buildFullFixture, buildBaseConfig, WEATHER_ENTITY } from './fixtures/generate.js';

const LONG_STATE = 'Teilweise bewölkt mit Regenschauern am Abend';

test.describe('large attribute and condition text', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  for (const width of [500, 360, 280]) {
    test(`lays out cleanly at ${width}px`, async ({ page }) => {
      const fixture = buildFullFixture();
      fixture.states![WEATHER_ENTITY].state = LONG_STATE;
      await mount(
        page,
        buildBaseConfig({
          attributes_size: 20,
          condition_size: 28,
          show_time: true,
          show_humidity: true,
          show_uv_index: true,
          show_sun: true,
        }),
        fixture,
      );

      const geo = await page.evaluate((w) => {
        const host = document.querySelector('weather-station-card') as HTMLElement;
        (host.parentElement as HTMLElement).style.width = `${w}px`;
        const sr = host.shadowRoot as ShadowRoot;
        const haCard = sr.querySelector('ha-card') as HTMLElement;
        haCard.style.width = `${w}px`;
        return new Promise<Record<string, unknown>>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const card = sr.querySelector('.card') as HTMLElement;
              const cond = sr.querySelector('.current-condition') as HTMLElement;
              const clock = sr.querySelector('.current-time') as HTMLElement | null;
              const cr = cond.getBoundingClientRect();
              const kr = clock ? clock.getBoundingClientRect() : null;
              const overlaps = !!kr
                && cr.left < kr.right && cr.right > kr.left
                && cr.top < kr.bottom && cr.bottom > kr.top;
              const lines = Array.from(sr.querySelectorAll('.attributes > div > div')) as HTMLElement[];
              const tallest = Math.max(
                ...lines.map((l) => l.getBoundingClientRect().height
                  / parseFloat(getComputedStyle(l).lineHeight === 'normal'
                    ? String(parseFloat(getComputedStyle(l).fontSize) * 1.2)
                    : getComputedStyle(l).lineHeight)),
              );
              resolve({
                overflow: card.scrollWidth > card.clientWidth,
                overlaps,
                lineCount: lines.length,
                tallest,
              });
            }),
          ),
        );
      }, width);

      expect(geo.overflow).toBe(false);
      expect(geo.overlaps).toBe(false);
      expect(geo.lineCount).toBeGreaterThan(0);
      // Icons are taller than the text, so allow a line box up to 2.5x the
      // text height; a value broken mid-way would be at least 2x taller
      // than the icon-free single line and is caught by nowrap + this cap.
      expect(geo.tallest as number).toBeLessThan(2.5);
    });
  }
});
