// Editor render partial — "Live-Anzeige" (Live panel).
// The now-panel that sits above the chart: current temperature,
// condition, clock, and the attributes row.
//
// v2.4 redesign (ADR-0023): the former walls of toggles (8 main-panel
// + 13 attribute switches) collapse into two multi-select fields under
// their on/off gates, and the three clock booleans (show_time,
// show_time_seconds, use_12hour_format) project onto a single "clock"
// dropdown — the same UI-only-abstraction pattern the mode dropdown
// uses for show_station / show_forecast.
//
// Font-size knobs (current_temp_size, icons_size, time_size,
// day_date_size) stay in DEFAULTS + YAML only.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, TogglePath } from './types.js';
import { renderEditorPanel } from './expansion-panel.js';

// Main-panel elements. `def` mirrors the editor-visible defaults the
// old toggle bags used (`!== false` → true, `=== true` → false).
const MAIN_ELEMENT_PATHS: ReadonlyArray<TogglePath> = [
  { path: 'show_temperature',       def: true },
  { path: 'show_current_condition', def: true },
  { path: 'show_day',               def: false },
  { path: 'show_date',              def: false },
];

// Attribute cells, in display order (humidity right after dew_point —
// it renders on the dew-point line, opt-in since v2.3). `gate` names
// which availability predicate controls whether the option is offered.
// `gateKey` takes a list when more than one sensor slot can satisfy the
// row — precipitation is offered for a cumulative counter OR a dedicated
// rate sensor (#253), either of which produces a live value.
const ATTRIBUTE_PATHS: ReadonlyArray<
  TogglePath & { gate?: 'live' | 'sensor'; gateKey?: string | readonly string[] }
> = [
  { path: 'show_pressure',          def: true,  gate: 'live',   gateKey: 'pressure' },
  { path: 'show_dew_point',         def: false, gate: 'live',   gateKey: 'dew_point' },
  { path: 'show_humidity',          def: false, gate: 'live',   gateKey: 'humidity' },
  { path: 'show_precipitation',     def: false, gate: 'sensor',
    gateKey: ['precipitation', 'precipitation_rate'] },
  { path: 'show_uv_index',          def: true,  gate: 'live',   gateKey: 'uv_index' },
  { path: 'show_illuminance',       def: false, gate: 'sensor', gateKey: 'illuminance' },
  { path: 'show_sunshine_duration', def: false, gate: 'sensor', gateKey: 'sunshine_duration' },
  { path: 'show_wind_direction',    def: true,  gate: 'live',   gateKey: 'wind_direction' },
  { path: 'show_wind_speed',        def: true,  gate: 'live',   gateKey: 'wind_speed' },
  { path: 'show_wind_gust_speed',   def: false, gate: 'live',   gateKey: 'gust_speed' },
  // Sun/moon have no sensor gate — sun uses sun.sun, the moon line is
  // computed in-card (ADR-0022).
  { path: 'show_sun',               def: false },
  { path: 'show_moon',              def: true },
];

const CLOCK_OPTIONS = ['off', '24h', '24h_seconds', '12h', '12h_seconds'] as const;

function selectedLeaves(
  cfg: Record<string, unknown>,
  paths: ReadonlyArray<TogglePath>,
): string[] {
  return paths
    .filter(({ path, def }) => (def ? cfg[path] !== false : cfg[path] === true))
    .map(({ path }) => path);
}

/** Attribute options currently available for this config — shared with
 *  the panel summary (count of enabled among available). */
export function availableAttributePaths(
  hasLiveValue: (key: string) => boolean,
  hasSensor: (key: string) => boolean,
): Array<TogglePath> {
  return ATTRIBUTE_PATHS.filter(({ gate, gateKey }) => {
    if (!gate || !gateKey) return true;
    const keys = typeof gateKey === 'string' ? [gateKey] : gateKey;
    const has = gate === 'live' ? hasLiveValue : hasSensor;
    return keys.some(has);
  });
}

export function renderLivePanelSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, hasSensor, hasLiveValue } = ctx;
  const showMain = cfg.show_main === true;
  const showAttrs = cfg.show_attributes === true;

  const gateSchema = (name: string): Array<{ name: string; selector: object }> =>
    [{ name, selector: { boolean: {} } }];

  const mainElementsSchema = [{
    name: 'main_elements',
    selector: {
      select: {
        mode: 'dropdown',
        multiple: true,
        options: MAIN_ELEMENT_PATHS.map(({ path }) => ({ value: path, label: t(path) })),
      },
    },
  }];

  const clockSchema = [{
    name: 'clock_mode',
    selector: {
      select: {
        mode: 'dropdown',
        options: CLOCK_OPTIONS.map((value) => ({ value, label: t(`clock_${value}`) })),
      },
    },
  }];

  const availableAttrs = availableAttributePaths(hasLiveValue, hasSensor);
  const attributesSchema = [{
    name: 'attributes',
    selector: {
      select: {
        mode: 'dropdown',
        multiple: true,
        options: availableAttrs.map(({ path }) => ({ value: path, label: t(path) })),
      },
    },
  }];

  const handleMainElements = (event: CustomEvent<{ value: { main_elements?: string[] } }>): void => {
    editor._applyTogglePaths(MAIN_ELEMENT_PATHS, event.detail.value?.main_elements ?? []);
  };
  const handleClock = (event: CustomEvent<{ value: { clock_mode?: string } }>): void => {
    const next = event.detail.value?.clock_mode;
    if (next && next !== editor._clockMode) editor._setClockMode(next);
  };
  const handleAttributes = (event: CustomEvent<{ value: { attributes?: string[] } }>): void => {
    editor._applyTogglePaths(availableAttrs, event.detail.value?.attributes ?? []);
  };

  const labelFor = (schema: { name: string }): string => {
    const map: Record<string, string> = {
      show_main: t('show_main'),
      show_attributes: t('show_attributes'),
      main_elements: t('main_elements_label'),
      clock_mode: t('clock_label'),
      attributes: t('attributes_heading'),
    };
    return map[schema.name] || t(schema.name);
  };

  const enabledAttrs = selectedLeaves(cfg, availableAttrs);
  const summary = `${t('main_panel_heading')} ${showMain ? t('summary_on') : t('summary_off')}`
    + ` · ${showAttrs ? `${enabledAttrs.length} ${t('summary_attributes')}` : `${t('attributes_heading')} ${t('summary_off')}`}`;

  const body = html`
    <div class="textfield-container">
      <ha-form
        .data=${{ show_main: showMain }}
        .schema=${gateSchema('show_main')}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._livePanelChanged}
      ></ha-form>
      ${showMain ? html`
        <div class="gated">
          <ha-form
            .data=${{ main_elements: selectedLeaves(cfg, MAIN_ELEMENT_PATHS) }}
            .schema=${mainElementsSchema}
            .hass=${editor.hass}
            .computeLabel=${labelFor}
            @value-changed=${handleMainElements}
          ></ha-form>
          <ha-form
            .data=${{ clock_mode: editor._clockMode }}
            .schema=${clockSchema}
            .hass=${editor.hass}
            .computeLabel=${labelFor}
            @value-changed=${handleClock}
          ></ha-form>
        </div>
      ` : ''}

      <div class="divider"></div>

      <ha-form
        .data=${{ show_attributes: showAttrs }}
        .schema=${gateSchema('show_attributes')}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._livePanelChanged}
      ></ha-form>
      ${showAttrs ? html`
        <div class="gated">
          <ha-form
            .data=${{ attributes: enabledAttrs }}
            .schema=${attributesSchema}
            .hass=${editor.hass}
            .computeLabel=${labelFor}
            @value-changed=${handleAttributes}
          ></ha-form>
        </div>
      ` : ''}
    </div>
  `;

  return renderEditorPanel({
    editor,
    sectionKey: 'live_panel',
    icon: 'mdi:clock-outline',
    title: t('live_panel_heading'),
    summary,
    resetLabel: t('reset_section'),
    body,
  });
}
