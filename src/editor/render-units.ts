// Editor render partial — "Einheiten" (Units) panel.
// One ha-form with a 2-column grid of unit dropdowns. Labels come from
// the locale files (v2.4 — they were hardcoded English before).

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';
import { renderEditorPanel } from './expansion-panel.js';

const UNITS_SCHEMA = [{
  name: '',
  type: 'grid',
  schema: [
    { name: 'pressure',
      selector: { select: { mode: 'dropdown', options: ['hPa', 'mmHg', 'inHg'] } } },
    { name: 'speed',
      selector: { select: { mode: 'dropdown', options: ['km/h', 'm/s', 'mph', 'Bft'] } } },
    { name: 'precipitation',
      selector: { select: { mode: 'dropdown', options: ['mm', 'in'] } } },
  ],
}];

export function renderUnitsSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, unitsConfig } = ctx;

  const labelFor = (schema: { name: string }): string => {
    const map: Record<string, string> = {
      pressure: t('unit_pressure_label'),
      speed: t('unit_speed_label'),
      precipitation: t('unit_precipitation_label'),
    };
    return map[schema.name] || schema.name;
  };

  const summary = [
    unitsConfig.pressure || 'hPa',
    unitsConfig.speed || 'km/h',
    unitsConfig.precipitation || 'mm',
  ].join(' · ');

  const body = html`
    <div class="textfield-container">
      <ha-form
        .data=${unitsConfig}
        .schema=${UNITS_SCHEMA}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._unitsChanged}
      ></ha-form>
    </div>
  `;

  return renderEditorPanel({
    editor,
    sectionKey: 'units',
    icon: 'mdi:ruler',
    title: t('units_heading'),
    summary,
    resetLabel: t('reset_section'),
    body,
  });
}
