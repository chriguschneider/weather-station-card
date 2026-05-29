// Editor render partial — Section 6: Units.
// Single ha-form with two ha-select fields (pressure / wind speed).
// Both schemas + the human-readable label map are local to this file.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';
import { renderSectionHeader } from './section-header.js';

const UNITS_SCHEMA = [
  { name: 'pressure',
    selector: { select: { mode: 'dropdown', options: ['hPa', 'mmHg', 'inHg'] } } },
  { name: 'speed',
    selector: { select: { mode: 'dropdown', options: ['km/h', 'm/s', 'mph', 'Bft'] } } },
  { name: 'precipitation',
    selector: { select: { mode: 'dropdown', options: ['mm', 'in'] } } },
];

const UNIT_LABELS: Record<string, string> = {
  pressure: 'Convert pressure to',
  speed: 'Convert wind speed to',
  precipitation: 'Convert precipitation to',
};

export function renderUnitsSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, unitsConfig } = ctx;
  return html`
    <!-- ─── E. Units ────────────────────────────────────────────── -->
    ${renderSectionHeader({ editor, title: t('units_heading'), sectionKey: 'units', resetLabel: t('reset_section') })}
    <div class="textfield-container">
      <ha-form
        .data=${unitsConfig}
        .schema=${UNITS_SCHEMA}
        .hass=${editor.hass}
        .computeLabel=${(s: { name: string }) => UNIT_LABELS[s.name] || s.name}
        @value-changed=${editor._unitsChanged}
      ></ha-form>
    </div>
  `;
}
