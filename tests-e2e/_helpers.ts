// Spec-side helpers — common page-evaluate wrappers and screenshot
// settling primitives that every spec uses.
//
// The mount path: each spec calls `mount(page, config, fixture)`. That
// triggers a page.evaluate that:
//   1. Reconstructs the HassMock in the browser context from the
//      serialised FixtureBag.
//   2. Calls window.__wsc.mount(config, hass) which inserts the card
//      and awaits its first updateComplete.
//
// The settle path: each spec then calls `settle(page)` before any
// screenshot to wait for Chart.js's first paint + the post-firstUpdated
// scroll positioning to commit. ChartJs renders synchronously after
// `new Chart(...)`, but `requestAnimationFrame`-driven scroll setup
// adds one frame of slack; one rAF tick is enough.

import type { Page } from '@playwright/test';
import type { FixtureBag } from './hass-mock.types.js';

/** Open the harness page and wait until the bundle has loaded.
 *
 *  Pins the browser clock to a fixed instant before the bundle runs.
 *  Reason: the data source uses `new Date()` to anchor its
 *  recorder-fetch window. The fixture generators use a fixed
 *  `2026-05-06` anchor. Without a clock pin, the test runs at real
 *  wall-clock time and the two windows diverge — most hourly buckets
 *  miss their fixture entry, the chart renders isolated dots and
 *  broken lines.
 *
 *  17:30 of fixture-day rounds up to 18:00 for the data source's
 *  "next full hour exclusive" end. With 'today' mode's 12-hour
 *  station + 12-hour forecast the rolling window spans today-06:00
 *  to tomorrow-06:00 — midnight falls in the middle of the chart so
 *  the day-boundary separator is visibly demonstrated in baselines. */
export async function openHarness(
  page: Page,
  opts: { theme?: 'light' | 'dark' } = {},
): Promise<void> {
  await page.clock.install({ time: new Date('2026-05-06T17:30:00') });
  const query = opts.theme === 'dark' ? '?theme=dark' : '';
  await page.goto(`/tests-e2e/pages/card.html${query}`);
  await page.waitForFunction(() => typeof window.__wsc?.mount === 'function');
}

/** Mount a card into the harness with the given config + fixture.
 *  Returns once the card has rendered its canvas — i.e. the data
 *  sources have resolved their first emit and the orchestrator's
 *  drawChart has inserted the uPlot canvas into the shadow tree
 *  (per ADR-0012; pre-slice-2 it was a Chart.js canvas). */
export async function mount(
  page: Page,
  config: Record<string, unknown>,
  fixture: FixtureBag,
  slot: string = 'a',
): Promise<void> {
  await page.evaluate(async ([cfg, fix, slotName]) => {
    const hass = window.__wsc.createMock(fix);
    await window.__wsc.mount(cfg, hass, { slot: slotName });
  }, [config, fixture, slot] as [Record<string, unknown>, FixtureBag, string]);
  // Wait until the chart canvas has rendered. The data-source fetch +
  // Lit re-render happens after the initial updateComplete, so this is
  // the right boundary to settle on for visual baselines. Waits up to
  // 5 s — gives the harness room on a cold cache.
  await page.waitForFunction(
    (slotName) => {
      const card = document.querySelector(`[data-slot="${slotName}"] > weather-station-card`);
      if (!card) return false;
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const canvas = sr ? sr.querySelector('canvas') : null;
      return !!canvas && (canvas as HTMLCanvasElement).width > 0;
    },
    slot,
    { timeout: 5000 },
  );
  await settle(page);
}

/** Two rAF ticks of settling time. The first ensures Chart.js has
 *  committed its initial paint; the second covers any RAF-driven
 *  scroll-position write the card does after firstUpdated. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve()),
        ),
      ),
  );
}

/** Tear down all mounted cards — called between tests so the next
 *  one starts from a clean shadow tree. */
export async function unmountAll(page: Page): Promise<void> {
  await page.evaluate(() => window.__wsc.unmountAll());
}

/** Locator for a mounted card by harness slot. */
export function cardSelector(slot: string = 'a'): string {
  return `[data-slot="${slot}"] > weather-station-card`;
}

declare global {
  interface Window {
    __wsc: {
      createMock: (fixture: FixtureBag) => unknown;
      mount: (config: Record<string, unknown>, hass: unknown, opts?: { slot?: string }) => Promise<HTMLElement>;
      setHass: (slot: string, hass: unknown) => Promise<HTMLElement>;
      unmountAll: () => Promise<void>;
    };
  }
}
