// Editor render partial — "Live-Anzeige" (Live panel).
// The now-panel that sits above the chart: current temperature,
// condition, clock, and the attributes row.
//
// v2.3 redesign (ADR-0023): the former walls of toggles (8 main-panel
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
import { renderTogglePills } from './toggle-pills.js';
import { renderLayoutBoard } from './layout-board.js';
import {
  hasExplicitLayout,
  resolveAttributesLayout,
  tokenOfShowKey,
  type AttributeToken,
} from '../attributes-layout.js';

// Main-panel elements. `def` mirrors the editor-visible defaults the
// old toggle bags used (`!== false` → true, `=== true` → false).
export const MAIN_ELEMENT_PATHS: ReadonlyArray<TogglePath> = [
  { path: 'show_temperature',       def: true },
  { path: 'show_current_condition', def: false },
  { path: 'show_day',               def: false },
  { path: 'show_date',              def: false },
];

// Attribute cells, in display order (humidity right after dew_point —
// it renders on the dew-point line, opt-in since v2.3). `gate` names
// which availability predicate controls whether the option is offered.
// `gateKey` takes a list when more than one sensor slot can satisfy the
// row — precipitation is offered for a cumulative counter OR a dedicated
// rate sensor (#253), either of which produces a live value.
// `requireAll` flips the gate from "any of the keys" to "all of them" —
// a combined line needs both of its values.
export const ATTRIBUTE_PATHS: ReadonlyArray<
  TogglePath & { gate?: 'live' | 'sensor'; gateKey?: string | readonly string[]; requireAll?: boolean }
> = [
  { path: 'show_pressure',          def: true,  gate: 'live',   gateKey: 'pressure' },
  { path: 'show_dew_point_humidity', def: false, gate: 'live',  gateKey: ['dew_point', 'humidity'], requireAll: true },
  { path: 'show_dew_point',         def: false, gate: 'live',   gateKey: 'dew_point' },
  { path: 'show_humidity',          def: false, gate: 'live',   gateKey: 'humidity' },
  // Opt-out, matching DEFAULTS: the cell only renders when a precip
  // value actually exists, so a card with a rain sensor wired wants it.
  { path: 'show_precipitation',     def: true,  gate: 'sensor',
    gateKey: ['precipitation', 'precipitation_rate'] },
  { path: 'show_zero_degree_level', def: false, gate: 'sensor', gateKey: 'zero_degree_level' },
  { path: 'show_uv_illuminance',    def: false, gate: 'live',   gateKey: ['uv_index', 'illuminance'], requireAll: true },
  { path: 'show_uv_index',          def: true,  gate: 'live',   gateKey: 'uv_index' },
  { path: 'show_illuminance',       def: false, gate: 'sensor', gateKey: 'illuminance' },
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

// Attribute pills mirror the resolved layout (ADR-0025): a pill is on
// when its row token is in the columns the card renders — the explicit
// `attributes_layout` when set, else the show_* keys folded into the
// automatic arrangement (both singles of a pair on → the combined pill).
function selectedAttributeLeaves(
  cfg: Record<string, unknown>,
  paths: ReadonlyArray<TogglePath>,
): string[] {
  const on = new Set<string>(resolveAttributesLayout(cfg).flat());
  return paths
    .filter(({ path }) => {
      const token = tokenOfShowKey(path);
      return token !== undefined && on.has(token);
    })
    .map(({ path }) => path);
}

// Pill / board label for a row. The combined lines are named from
// their parts so no locale needs an extra string for them.
export function attributeLabel(t: (key: string) => string, path: string): string {
  const leaf = path.split('.').pop() ?? path;
  if (leaf === 'show_dew_point_humidity') return `${t('show_dew_point')} + ${t('show_humidity')}`;
  if (leaf === 'show_uv_illuminance') return `${t('show_uv_index')} + ${t('show_illuminance')}`;
  return t(leaf);
}

/** Attribute options currently available for this config — shared with
 *  the panel summary (count of enabled among available). */
export function availableAttributePaths(
  hasLiveValue: (key: string) => boolean,
  hasSensor: (key: string) => boolean,
): Array<TogglePath> {
  return ATTRIBUTE_PATHS.filter(({ gate, gateKey, requireAll }) => {
    if (!gate || !gateKey) return true;
    const keys = typeof gateKey === 'string' ? [gateKey] : gateKey;
    const has = gate === 'live' ? hasLiveValue : hasSensor;
    return requireAll ? keys.every(has) : keys.some(has);
  });
}

// The layout board under the attribute pills (ADR-0025). Its input is
// the resolved columns narrowed to the rows the pill row offers AND has
// on — a default-on row with no sensor behind it is not rendered by the
// card, so it has no place to be arranged either.
function renderAttributesBoard(
  editor: EditorLike,
  ctx: EditorContext,
  enabledAttrs: ReadonlyArray<string>,
): TemplateResult {
  const { t, cfg } = ctx;
  const enabledTokens = new Set<string>(
    enabledAttrs.map(tokenOfShowKey).filter((tok): tok is AttributeToken => tok !== undefined),
  );
  const layout = resolveAttributesLayout(cfg)
    .map((column) => column.filter((tok) => enabledTokens.has(tok)))
    .filter((column) => column.length > 0);
  if (layout.length === 0) return html``;
  return renderLayoutBoard({
    layout,
    explicit: hasExplicitLayout(cfg),
    labelFor: (token) => attributeLabel(t, `show_${token}`),
    t,
    onChange: (next) => editor._setAttributesLayout(next),
    onReset: () => editor._setAttributesLayout(null),
    rerender: () => editor.requestUpdate(),
  });
}

export function renderLivePanelSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, hasSensor, hasLiveValue } = ctx;
  const showMain = cfg.show_main === true;
  const showAttrs = cfg.show_attributes === true;

  const gateSchema = (name: string): Array<{ name: string; selector: object }> =>
    [{ name, selector: { boolean: {} } }];

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

  const handleClock = (event: CustomEvent<{ value: { clock_mode?: string } }>): void => {
    const next = event.detail.value?.clock_mode;
    if (next && next !== editor._clockMode) editor._setClockMode(next);
  };

  const labelFor = (schema: { name: string }): string => {
    const map: Record<string, string> = {
      show_main: t('show_main'),
      show_attributes: t('show_attributes'),
      clock_mode: t('clock_label'),
    };
    return map[schema.name] || t(schema.name);
  };

  const enabledAttrs = selectedAttributeLeaves(cfg, availableAttrs);
  const board = renderAttributesBoard(editor, ctx, enabledAttrs);
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
          ${renderTogglePills({
            label: t('main_elements_label'),
            group: 'main_elements',
            options: MAIN_ELEMENT_PATHS.map(({ path }) => ({ value: path, label: t(path) })),
            selected: selectedLeaves(cfg, MAIN_ELEMENT_PATHS),
            onChange: (next) => editor._applyTogglePaths(MAIN_ELEMENT_PATHS, next),
          })}
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
          ${renderTogglePills({
            label: t('attributes_heading'),
            group: 'attributes',
            options: availableAttrs.map(({ path }) => ({ value: path, label: attributeLabel(t, path) })),
            selected: enabledAttrs,
            onChange: (next) => editor._applyAttributeToggles(availableAttrs, next),
          })}
          ${board}
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
