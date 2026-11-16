// Editor partial "Sensors" (ADR-0023). A source dropdown picks the past
// data source (ADR-0015); Open-Meteo hides the picker grid. Per-metric
// filtering comes from sensor-match.ts (#451); each key is the YAML key
// under `sensors:` and doubles as the i18n key.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, HomeAssistant } from './types.js';
import { renderEditorPanel } from './expansion-panel.js';
import { sensorCandidates } from '../sensor-match.js';

interface SensorState {
  state: string;
  attributes?: {
    device_class?: string;
    unit_of_measurement?: string;
    friendly_name?: string;
  };
}

interface HassWithStates extends HomeAssistant {
  states?: Record<string, SensorState | undefined>;
}

const REQUIRED_KEYS = new Set(['temperature']);

function buildSensorFields(hass: HassWithStates | null): Array<{ key: string; candidates: string[] }> {
  // The same matcher picks a new card's sensors (getStubConfig), so the
  // auto-picked entity is always among a slot's candidates.
  const ids = hass?.states
    ? Object.entries(hass.states).filter(([, s]) => !!s).map(([id]) => id)
    : [];
  const candidates = (key: string): string[] =>
    sensorCandidates(key, ids, hass);

  // 2-column rows (the grid flows row-wise): climate, moisture,
  // precipitation (#253), wind, wind + light (the one mixed row), light,
  // then the forecast-derived zero-degree pair, then next_rain alone.
  // `temperature` stays top-left as the only required slot.
  return [
    'temperature', 'pressure',
    'humidity', 'dew_point',
    // The counter feeds the chart bars, the rate feeds the live cell and
    // the condition classifier — a station that exposes both wires both.
    'precipitation', 'precipitation_rate',
    'wind_speed', 'gust_speed',
    'wind_direction', 'illuminance',
    // sunshine_duration has no matcher: its picker lists every sensor.
    'uv_index', 'sunshine_duration',
    'zero_degree_level', 'zero_degree_level_48h',
    'next_rain',
  ].map((key) => ({ key, candidates: candidates(key) }));
}

// ha-form grids are transparent for data, so the value bag stays the flat
// { temperature: ..., humidity: ... } shape _sensorsChanged consumes.
function buildSensorsSchema(hass: HassWithStates | null): Array<Record<string, unknown>> {
  return [{
    name: '',
    type: 'grid',
    schema: buildSensorFields(hass).map((f) => ({
      name: f.key,
      required: REQUIRED_KEYS.has(f.key),
      selector: {
        entity: f.candidates.length > 0
          ? { include_entities: f.candidates }
          : { domain: 'sensor' },
      },
    })),
  }];
}

export function renderSensorsSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, sensorsConfig, pastDataAvailable, showsStation } = ctx;

  // Also shown without past data, whatever the mode, so the recovery
  // controls stay reachable.
  if (!showsStation && pastDataAvailable) return html``;

  const source = editor._pastSource;

  const sourceSchema = [{
    name: 'past_source',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'station', label: t('past_source_station') },
          { value: 'openmeteo', label: t('past_source_openmeteo') },
        ],
      },
    },
  }];

  const handleSourceChanged = (event: CustomEvent<{ value: { past_source: 'station' | 'openmeteo' } }>): void => {
    const next = event.detail.value?.past_source;
    if (next && next !== source) editor._setPastSource(next);
  };

  // Spell out "(required)" next to ha-form's asterisk.
  const computeLabel = (schema: { name: string; required?: boolean }): string => {
    const base = t(schema.name);
    return schema.required ? `${base} (${t('required_marker')})` : base;
  };

  const connectedCount = Object.values(sensorsConfig)
    .filter((v) => typeof v === 'string' && v.trim() !== '').length;
  const summary = source === 'openmeteo'
    ? t('summary_openmeteo')
    : (connectedCount > 0
      ? t('summary_connected').replace('{n}', String(connectedCount))
      : t('summary_no_sensors'));

  const body = html`
    ${!pastDataAvailable ? html`
      <div class="hint">${t('openmeteo_history_unavailable')}</div>
    ` : ''}

    <div class="textfield-container">
      <ha-form
        .data=${{ past_source: source }}
        .schema=${sourceSchema}
        .hass=${editor.hass}
        .computeLabel=${() => t('past_source_label')}
        @value-changed=${handleSourceChanged}
      ></ha-form>

      ${source === 'openmeteo' ? html`
        <div class="hint">${t('openmeteo_history_hint')}</div>
      ` : html`
        <ha-form
          .data=${sensorsConfig}
          .schema=${buildSensorsSchema(editor.hass)}
          .hass=${editor.hass}
          .computeLabel=${computeLabel}
          @value-changed=${editor._sensorsChanged}
        ></ha-form>
      `}
    </div>
  `;

  return renderEditorPanel({
    editor,
    sectionKey: 'sensors',
    icon: 'mdi:thermometer',
    title: t('station_sensors_heading'),
    summary,
    resetLabel: t('reset_section'),
    body,
  });
}
