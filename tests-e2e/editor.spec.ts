// Editor spec — verifies the mode radio, sensor pickers, layout
// switches, and tap_action selector all update the config that the
// editor dispatches via `config-changed`.
//
// The editor is a sibling LitElement (`weather-station-card-editor`)
// loaded from the same bundle. The harness mounts it directly — no
// need to go through the card's static `getConfigElement()` since
// that's just `document.createElement('weather-station-card-editor')`.
//
// We don't render against HA's full `<ha-form>` / `<ha-entity-picker>`
// custom elements (the harness page declares them as unknown
// elements). The interaction surface this spec covers is the editor
// CLASS's own JS contract: setting the config in, calling its mutator
// methods, observing the `config-changed` event.

import { test, expect } from '@playwright/test';
import { openHarness } from './_helpers.js';
import { buildBaseConfig, SENSORS, WEATHER_ENTITY } from './fixtures/generate.js';

declare global {
  interface Window {
    __wsce: {
      mount(config: Record<string, unknown>): Promise<void>;
      get(): HTMLElement | null;
      lastEvent: { config: Record<string, unknown> } | null;
    };
  }
}

test.describe('editor', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    // Bootstrap an editor harness alongside the card harness — the
    // editor doesn't need the card's __wsc.mount path because it's a
    // sibling element, not a child of the weather-station-card.
    await page.evaluate(() => {
      const host = document.getElementById('harness') as HTMLElement;
      let editorEl: HTMLElement | null = null;
      let lastEvent: { config: Record<string, unknown> } | null = null;
      window.__wsce = {
        async mount(config: Record<string, unknown>) {
          if (editorEl) editorEl.remove();
          // The editor is lazy-loaded in a separate bundle chunk.
          // Trigger its registration via the card's static
          // getConfigElement (HA's canonical entry point) before
          // constructing the element directly — otherwise the
          // custom element isn't defined yet and setConfig is
          // missing.
          const CardCls = customElements.get('weather-station-card') as
            { getConfigElement: () => Promise<HTMLElement> } | undefined;
          if (CardCls?.getConfigElement) await CardCls.getConfigElement();
          editorEl = document.createElement('weather-station-card-editor');
          // The editor surfaces its mutations via the standard HA
          // `config-changed` event with `event.detail.config`.
          editorEl.addEventListener('config-changed', (ev: Event) => {
            lastEvent = (ev as CustomEvent<{ config: Record<string, unknown> }>).detail;
          });
          host.appendChild(editorEl);
          (editorEl as unknown as { setConfig: (c: Record<string, unknown>) => void }).setConfig(config);
          await (editorEl as unknown as { updateComplete: Promise<void> }).updateComplete;
        },
        get() { return editorEl; },
        get lastEvent() { return lastEvent; },
        set lastEvent(v: { config: Record<string, unknown> } | null) { lastEvent = v; },
      } as unknown as typeof window.__wsce;
    });
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      const el = window.__wsce.get();
      el?.remove();
    });
  });

  test('_setMode flips show_station / show_forecast', async ({ page }) => {
    await page.evaluate((cfg) => window.__wsce.mount(cfg), buildBaseConfig());

    // Initial state — combination → both flags true.
    const init = await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & { _mode: string };
      return ed._mode;
    });
    expect(init).toBe('combination');

    // Switch to station.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & { _setMode: (m: string) => void };
      ed._setMode('station');
    });
    const afterStation = await page.evaluate(() => window.__wsce.lastEvent);
    expect(afterStation?.config.show_station).toBe(true);
    expect(afterStation?.config.show_forecast).toBe(false);

    // Switch to forecast.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & { _setMode: (m: string) => void };
      ed._setMode('forecast');
    });
    const afterForecast = await page.evaluate(() => window.__wsce.lastEvent);
    expect(afterForecast?.config.show_station).toBe(false);
    expect(afterForecast?.config.show_forecast).toBe(true);
  });

  test('_sensorPickerChanged adds and removes sensor keys', async ({ page }) => {
    await page.evaluate((cfg) => window.__wsce.mount(cfg), buildBaseConfig());

    // Add a new sensor.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & {
        _sensorPickerChanged: (key: string, value: string | null | undefined) => void;
      };
      ed._sensorPickerChanged('snow_depth', 'sensor.test_snow_depth');
    });
    const afterAdd = await page.evaluate(() => window.__wsce.lastEvent);
    expect((afterAdd?.config.sensors as Record<string, string>).snow_depth).toBe('sensor.test_snow_depth');

    // Remove an existing sensor by passing empty string.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & {
        _sensorPickerChanged: (key: string, value: string | null | undefined) => void;
      };
      ed._sensorPickerChanged('humidity', '');
    });
    const afterRemove = await page.evaluate(() => window.__wsce.lastEvent);
    expect((afterRemove?.config.sensors as Record<string, string>).humidity).toBeUndefined();
    // Other sensors unchanged.
    expect((afterRemove?.config.sensors as Record<string, string>).temperature).toBe(SENSORS.temperature);
  });

  test('_actionChanged sets and clears action keys', async ({ page }) => {
    await page.evaluate((cfg) => window.__wsce.mount(cfg), buildBaseConfig());

    // Set tap_action.
    await page.evaluate((entity) => {
      const ed = window.__wsce.get() as HTMLElement & {
        _actionChanged: (key: string, value: unknown) => void;
      };
      ed._actionChanged('tap_action', { action: 'more-info', entity });
    }, WEATHER_ENTITY);
    const afterSet = await page.evaluate(() => window.__wsce.lastEvent);
    expect(afterSet?.config.tap_action).toEqual({ action: 'more-info', entity: WEATHER_ENTITY });

    // Clear by passing undefined.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & {
        _actionChanged: (key: string, value: unknown) => void;
      };
      ed._actionChanged('tap_action', undefined);
    });
    const afterClear = await page.evaluate(() => window.__wsce.lastEvent);
    expect(afterClear?.config.tap_action).toBeUndefined();
  });

  test('_valueChanged supports nested forecast.type', async ({ page }) => {
    await page.evaluate((cfg) => window.__wsce.mount(cfg), buildBaseConfig());

    // Toggle forecast.type via the same nested-key path as the mode
    // toggle in the editor radio.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & {
        _valueChanged: (e: { target: { value: string } }, key: string) => void;
      };
      ed._valueChanged({ target: { value: 'hourly' } }, 'forecast.type');
    });
    const after = await page.evaluate(() => window.__wsce.lastEvent);
    expect((after?.config.forecast as { type?: string }).type).toBe('hourly');
    // Other forecast keys preserved.
    expect((after?.config.forecast as { disable_animation?: boolean }).disable_animation).toBe(true);
  });

  test('_conditionMappingChanged adds, updates, removes a threshold', async ({ page }) => {
    await page.evaluate((cfg) => window.__wsce.mount(cfg), buildBaseConfig());

    // Add a threshold override.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & {
        _conditionMappingChanged: (e: { target: { value?: string } }, key: string) => void;
      };
      ed._conditionMappingChanged({ target: { value: '2.5' } }, 'rainy_threshold_mm');
    });
    const afterAdd = await page.evaluate(() => window.__wsce.lastEvent);
    expect((afterAdd?.config.condition_mapping as Record<string, number>)?.rainy_threshold_mm).toBe(2.5);

    // Update — overwrite value.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & {
        _conditionMappingChanged: (e: { target: { value?: string } }, key: string) => void;
      };
      ed._conditionMappingChanged({ target: { value: '5' } }, 'rainy_threshold_mm');
    });
    const afterUpdate = await page.evaluate(() => window.__wsce.lastEvent);
    expect((afterUpdate?.config.condition_mapping as Record<string, number>)?.rainy_threshold_mm).toBe(5);

    // Remove — empty string drops the key, and dropping the last key
    // also removes the condition_mapping object entirely.
    await page.evaluate(() => {
      const ed = window.__wsce.get() as HTMLElement & {
        _conditionMappingChanged: (e: { target: { value?: string } }, key: string) => void;
      };
      ed._conditionMappingChanged({ target: { value: '' } }, 'rainy_threshold_mm');
    });
    const afterRemove = await page.evaluate(() => window.__wsce.lastEvent);
    expect(afterRemove?.config.condition_mapping).toBeUndefined();
  });
});
