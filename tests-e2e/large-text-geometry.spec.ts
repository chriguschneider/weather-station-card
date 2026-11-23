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

      const measure = (w: number) => page.evaluate((w) => {
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
              // Widest descendant poking out of .card's right edge.
              const cardRight = card.getBoundingClientRect().right;
              let worst = '';
              let worstBy = 0;
              for (const el of Array.from(card.querySelectorAll('*')) as HTMLElement[]) {
                const by = el.getBoundingClientRect().right - cardRight;
                if (by > worstBy) {
                  worstBy = by;
                  worst = `${el.tagName.toLowerCase()}.${String(el.className)}`;
                }
              }
              resolve({
                scrollWidth: card.scrollWidth,
                clientWidth: card.clientWidth,
                worst,
                worstBy,
                overlaps,
                lineCount: lines.length,
                tallest,
              });
            }),
          ),
        );
      }, w);

      const geo = await measure(width);
      const info = `scrollWidth=${geo.scrollWidth} clientWidth=${geo.clientWidth} `
        + `widest offender=${geo.worst} (+${geo.worstBy}px)`;

      // Same fixture with default sizes: separates overflow the new options
      // add from overflow that exists in the default layout anyway.
      await unmountAll(page);
      await mount(
        page,
        buildBaseConfig({
          show_time: true,
          show_humidity: true,
          show_uv_index: true,
          show_sun: true,
        }),
        fixture,
      );
      const base = await measure(width);
      // eslint-disable-next-line no-console
      console.log(
        `[${width}px] new: ${info}; default: scrollWidth=${base.scrollWidth} `
        + `clientWidth=${base.clientWidth} widest offender=${base.worst} (+${base.worstBy}px)`,
      );

      expect(
        (geo.scrollWidth as number) - (geo.clientWidth as number),
        info,
      ).toBeLessThanOrEqual((base.scrollWidth as number) - (base.clientWidth as number));
      expect(geo.overlaps).toBe(false);
      expect(geo.lineCount).toBeGreaterThan(0);
      // Icons are taller than the text, so allow a line box up to 2.5x the
      // text height; a value broken mid-way would be at least 2x taller
      // than the icon-free single line and is caught by nowrap + this cap.
      expect(geo.tallest as number).toBeLessThan(2.5);
    });
  }
});
