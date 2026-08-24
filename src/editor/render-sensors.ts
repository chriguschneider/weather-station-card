// Editor render partial — "Sensoren deiner Wetterstation" panel.
//
// v2.3 redesign (ADR-0023): a source dropdown at the top decides where
// the past half of the chart comes from — the user's station sensors,
// or Open-Meteo history (ADR-0015). The runtime always prefers station
// sensors when any are configured, so the two sources are mutually
// exclusive in practice; the dropdown makes that explicit instead of
// the former buried opt-in toggle. Choosing Open-Meteo hides the
// picker grid entirely (and _setPastSource drops configured sensors so
// the editor and the card agree).
//
// The 12 pickers render in a 2-column ha-form grid — each full-width
// row was half empty anyway, and entity names elide gracefully.
//
// Per-metric selector filtering: most filter by `device_class`; wind
// direction has no canonical class but a stable unit (degrees) so it
// gets a runtime predicate. Precipitation rate unions its class with a
// rate-unit predicate — integrations often ship mm/h and no class. UV
// index has neither a class nor a universal unit and gets a name/id
// pattern match. Each entry's `key` is the YAML key under `sensors:`
// and doubles as the i18n key.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, HomeAssistant } from './types.js';
import { renderEditorPanel } from './expansion-panel.js';

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
  const all: Array<[string, SensorState]> = hass?.states
    ? (Object.entries(hass.states).filter(([, s]) => !!s) as Array<[string, SensorState]>)
    : [];
  const byDeviceClass = (classes: string[]): string[] => all
    .filter(([id, s]) => id.startsWith('sensor.') &&
      classes.includes((s.attributes?.device_class) || ''))
    .map(([id]) => id);

  const directionEntities = all
    .filter(([id, s]) => id.startsWith('sensor.') &&
      ((s.attributes?.unit_of_measurement) === '°' ||
       (s.attributes?.unit_of_measurement) === 'deg'))
    .map(([id]) => id);

  // Precipitation-rate candidates: `device_class: precipitation_intensity`
  // is the canonical marker, but plenty of integrations (Z-Wave POPP,
  // hand-rolled ESPHome templates) ship the right unit and no class at
  // all. Union both so a working mm/h entity is never hidden behind a
  // class the integration forgot to set.
  const rateUnitRegex = /^(mm|in|inch|inches|")\/(h|hr|hour)$/i;
  const rateEntities = all
    .filter(([id, s]) => id.startsWith('sensor.') &&
      ((s.attributes?.device_class) === 'precipitation_intensity' ||
       rateUnitRegex.test((s.attributes?.unit_of_measurement) || '')))
    .map(([id]) => id);

  const uvRegex = /(?:^|[._-])uv(?:[._-]|index|$)/i;
  const uvNameRegex = /\buv[\s_-]?index\b|\buv\b/i;
  const uvEntities = all
    .filter(([id, s]) => {
      if (!id.startsWith('sensor.')) return false;
      const name = (s.attributes?.friendly_name) || '';
      return uvRegex.test(id) || uvNameRegex.test(name);
    })
    .map(([id]) => id);

  // Ordered as logical 2-column rows (the grid flows row-wise):
  //   temperature    | pressure           — base climate
  //   humidity       | dew_point          — moisture in the air
  //   precipitation  | precipitation_rate — moisture coming down (#253)
  //   wind_speed     | gust_speed         ┐ wind
  //   wind_direction | illuminance        ┘ the one mixed row
  //   uv_index       | sunshine_duration  — light; rarest slot last
  //
  // Twelve slots in two columns is six rows, but the themes are
  // 2+2+2+3+3 — wind and light have three members each, so ONE row has
  // to straddle two themes. Placing the two odd groups next to each
  // other keeps it at exactly one (wind_direction | illuminance) and
  // leaves every even group intact. `temperature` stays top-left as the
  // only required slot.
  return [
    { key: 'temperature',         candidates: byDeviceClass(['temperature']) },
    { key: 'pressure',            candidates: byDeviceClass(['atmospheric_pressure', 'pressure']) },
    { key: 'humidity',            candidates: byDeviceClass(['humidity']) },
    { key: 'dew_point',           candidates: byDeviceClass(['temperature']) },
    // The counter feeds the chart bars, the rate feeds the live cell and
    // the condition classifier — a station that exposes both wires both.
    { key: 'precipitation',       candidates: byDeviceClass(['precipitation']) },
    { key: 'precipitation_rate',  candidates: rateEntities },
    { key: 'wind_speed',          candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'gust_speed',          candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'wind_direction',      candidates: directionEntities },
    // Solar-irradiance sensors (W/m²) share the slot — the card
    // converts them to lux internally (community post 15, point 5).
    { key: 'illuminance',         candidates: byDeviceClass(['illuminance', 'irradiance']) },
    { key: 'uv_index',            candidates: uvEntities },
    { key: 'sunshine_duration',   candidates: [] },
  ];
}

// One 2-column grid container wrapping every per-metric entity
// selector. ha-form grids are transparent for data — the value bag
// keeps the flat { temperature: ..., humidity: ... } shape that
// _sensorsChanged already consumes.
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

  // The panel shows whenever a past block is — or should become —
  // configurable: in station / combination mode, or (regardless of
  // mode) when there is no past data yet, so the recovery controls
  // stay reachable.
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

  // Append "(required)" to required-field labels. ha-form also draws a
  // Material asterisk via the schema's `required: true` flag; the
  // text marker just makes the convention explicit for users who don't
  // pattern-match on Material asterisks.
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
