// Shared wrapper for the editor's collapsible sections. Every section
// except the always-visible basics renders as an <ha-expansion-panel>
// whose header carries an icon, the section title, a one-line state
// summary (readable while collapsed — the user sees the configuration
// without opening anything), and the per-section reset button.
//
// The body is always rendered into the default slot — ha-expansion-
// panel handles show/hide itself. That keeps the schema-coverage drift
// guard (tests/defaults.test.js) able to see every field without
// simulating expand clicks.

import { html, type TemplateResult } from 'lit';
import type { EditorLike } from './types.js';

interface EditorPanelArgs {
  editor: EditorLike;
  /** SECTION_KEYS key — doubles as the expanded-state key. */
  sectionKey: string;
  /** mdi:* icon name shown in the header. */
  icon: string;
  title: string;
  /** One-line state summary under the title. */
  summary: string;
  resetLabel: string;
  body: TemplateResult;
}

export function renderEditorPanel(args: EditorPanelArgs): TemplateResult {
  const { editor, sectionKey, icon, title, summary, resetLabel, body } = args;
  return html`
    <ha-expansion-panel
      outlined
      class="editor-panel"
      .expanded=${editor._isPanelExpanded(sectionKey)}
      @expanded-changed=${(e: CustomEvent<{ expanded?: boolean }>) =>
        editor._setPanelExpanded(sectionKey, e.detail?.expanded === true)}
    >
      <div slot="header" class="panel-header">
        <ha-icon class="panel-icon" .icon=${icon}></ha-icon>
        <div class="panel-titles">
          <div class="panel-title">${title}</div>
          <div class="panel-summary">${summary}</div>
        </div>
        <ha-icon-button
          class="panel-reset"
          title=${resetLabel}
          aria-label=${resetLabel}
          @click=${(e: Event) => {
            // The header doubles as the expand/collapse toggle — the
            // reset click must not bubble into it.
            e.stopPropagation();
            editor._resetSection(sectionKey);
          }}
        ><ha-icon icon="mdi:restore"></ha-icon></ha-icon-button>
      </div>
      <div class="panel-body">${body}</div>
    </ha-expansion-panel>
  `;
}
