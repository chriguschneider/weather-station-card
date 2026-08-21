// Editor render partial — "Aktionen" (Actions) panel.
// Tap / hold / double-tap action selectors.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';
import { renderEditorPanel } from './expansion-panel.js';

export function renderTapSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg } = ctx;

  const tapAction = (cfg.tap_action as { action?: string } | undefined)?.action || 'none';
  const summary = `${t('tap_action_label')}: ${tapAction}`;

  const body = html`
    <div class="textfield-container">
      ${[
        ['tap_action', 'tap_action_label'],
        ['hold_action', 'hold_action_label'],
        ['double_tap_action', 'double_tap_action_label'],
      ].map(([key, labelKey]) => html`
        <ha-selector
          .hass=${editor.hass}
          .selector=${{ ui_action: {} }}
          .value=${cfg[key]}
          .label=${t(labelKey)}
          @value-changed=${(e: CustomEvent<{ value: unknown }>) => editor._actionChanged(key, e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `;

  return renderEditorPanel({
    editor,
    sectionKey: 'actions',
    icon: 'mdi:gesture-tap',
    title: t('actions_section_heading'),
    summary,
    resetLabel: t('reset_section'),
    body,
  });
}
