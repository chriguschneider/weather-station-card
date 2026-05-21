// Editor render partial — Section 1: "Karte einrichten" (Card setup).
// Two foundational dropdowns rendered via <ha-form> + select selector
// (the HA-documented pattern that gives proper Material rendering with
// label-as-value-mapping working both ways):
//   • Modus (mode) — gates section visibility for everything below.
//     Mode is a UI-only abstraction; the YAML keeps show_station /
//     show_forecast booleans for backwards-compat, so we intercept
//     value-changed and route through _setMode.
//   • Diagramm-Typ (forecast.type) — drives both the past chart's
//     aggregation and the forecast subscription resolution. Top-level
//     because it's relevant in every mode.
//
// Title field is in render-chart.ts (visually it sits above the chart).
// Always visible regardless of mode.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';
import { renderSectionHeader } from './section-header.js';

export function renderModeSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, fcfg, mode, pastDataAvailable } = ctx;

  // Build schemas at render time so option labels reflect the current
  // locale. ha-form's select selector accepts {value, label} options
  // and renders Material dropdowns with the label-text shown when
  // selected (closed) AND in the dropdown list.
  const modeSchema = [{
    name: 'mode',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'combination', label: t('mode_combination') },
          { value: 'station', label: t('mode_station') },
          { value: 'forecast', label: t('mode_forecast') },
        ],
      },
    },
  }];

  const chartTypeSchema = [{
    name: 'type',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'daily', label: t('forecast_type_daily') },
          { value: 'today', label: t('forecast_type_today') },
          { value: 'hourly', label: t('forecast_type_hourly') },
        ],
      },
    },
  }];

  const handleModeChanged = (event: CustomEvent<{ value: { mode: 'combination' | 'station' | 'forecast' } }>): void => {
    const next = event.detail.value?.mode;
    if (next && next !== mode) editor._setMode(next);
  };

  const handleChartTypeChanged = (event: CustomEvent<{ value: { type: string } }>): void => {
    const next = event.detail.value?.type;
    if (next && next !== fcfg.type) {
      editor._valueChanged({ target: { value: next } }, 'forecast.type');
    }
  };

  return html`
    ${renderSectionHeader({ editor, title: t('card_setup_heading'), sectionKey: 'card_setup', resetLabel: t('reset_section') })}
    <div class="textfield-container">
      <ha-form
        .data=${{ mode }}
        .schema=${modeSchema}
        .hass=${editor.hass}
        .disabled=${!pastDataAvailable}
        .computeLabel=${() => t('mode_label')}
        @value-changed=${handleModeChanged}
      ></ha-form>

      <ha-form
        .data=${{ type: fcfg.type || 'daily' }}
        .schema=${chartTypeSchema}
        .hass=${editor.hass}
        .computeLabel=${() => t('chart_type_label')}
        @value-changed=${handleChartTypeChanged}
      ></ha-form>
    </div>
  `;
}
