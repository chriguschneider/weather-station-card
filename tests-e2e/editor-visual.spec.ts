// Visual baseline for the README's editor screenshot.
//
// Sibling to editor.spec.ts (which exercises the editor's behavioural
// contract via mutator methods + config-changed events). This file is
// pure visual regression so the README hero-table editor cell
// auto-updates from CI just like the other two cells.
//
// One snapshot per theme — same `(prefers-color-scheme: dark)` swap
// the chart screenshots use.

import { test, expect } from '@playwright/test';
import { openHarness } from './_helpers.js';
import { buildBaseConfig } from './fixtures/generate.js';

declare global {
  interface Window {
    __wsce: {
      mount(config: Record<string, unknown>): Promise<void>;
      get(): HTMLElement | null;
    };
  }
}

const THEMES = ['light', 'dark'] as const;

for (const theme of THEMES) {
  test.describe(`editor — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await openHarness(page, { theme });
      await page.evaluate(() => {
        const host = document.getElementById('harness') as HTMLElement;
        let editorEl: HTMLElement | null = null;
        window.__wsce = {
          async mount(config: Record<string, unknown>) {
            if (editorEl) editorEl.remove();
            // Editor is lazy-loaded in its own bundle chunk; trigger
            // registration via the card's static getConfigElement
            // before createElement (matches the editor.spec.ts harness).
            const CardCls = customElements.get('weather-station-card') as
              { getConfigElement: () => Promise<HTMLElement> } | undefined;
            if (CardCls?.getConfigElement) await CardCls.getConfigElement();
            editorEl = document.createElement('weather-station-card-editor');
            host.appendChild(editorEl);
            (editorEl as unknown as { setConfig: (c: Record<string, unknown>) => void }).setConfig(config);
            await (editorEl as unknown as { updateComplete: Promise<void> }).updateComplete;
          },
          get() { return editorEl; },
        } as unknown as typeof window.__wsce;
      });
    });

    test.afterEach(async ({ page }) => {
      await page.evaluate(() => {
        const el = window.__wsce.get();
        el?.remove();
      });
    });

    test('default config render', async ({ page }) => {
      await page.evaluate((cfg) => window.__wsce.mount(cfg), buildBaseConfig());
      // Allow any chart-preview within the editor to settle before
      // capturing — same heuristic the chart specs use elsewhere.
      await page.waitForTimeout(50);
      const themeSuffix = theme === 'dark' ? '-dark' : '';
      await expect(page.locator('weather-station-card-editor'))
        .toHaveScreenshot(`editor${themeSuffix}.png`);
    });
  });
}
