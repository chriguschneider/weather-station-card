// Editor render partial — Section 3: "Sensoren deiner Wetterstation".
//
// Per-metric sensor field list. Most filter by `device_class`; wind
// direction has no canonical class but a stable unit (degrees) so it
// gets a runtime predicate. UV index has neither a class nor a universal
// unit and gets a name/id pattern match. Each entry's `key` is the
// YAML key under `sensors:` and doubles as the i18n key (see locale.js
// `editor` blocks).
//
// Renders via <ha-form> with one `entity` selector per field — same
// pattern as the unit dropdowns (render-units.ts) and the weather-
// entity picker (render-forecast.ts), so all data-source fields share
// one declarative shape. ha-form delegates to <ha-entity-picker>
// internally, which is hardcoded to render its label as an external
// header above the box (use-top-label) — that's an HA-frontend design
// choice we can't override without fighting the framework.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, HomeAssistant } from './types.js';
import { renderSectionHeader } from './section-header.js';

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

  const uvRegex = /(?:^|[._-])uv(?:[._-]|index|$)/i;
  const uvNameRegex = /\buv[\s_-]?index\b|\buv\b/i;
  const uvEntities = all
    .filter(([id, s]) => {
      if (!id.startsWith('sensor.')) return false;
      const name = (s.attributes?.friendly_name) || '';
      return uvRegex.test(id) || uvNameRegex.test(name);
    })
    .map(([id]) => id);

  return [
    { key: 'temperature',         candidates: byDeviceClass(['temperature']) },
    { key: 'humidity',            candidates: byDeviceClass(['humidity']) },
    // Solar-irradiance sensors (W/m²) share the slot — the card
    // converts them to lux internally (community post 15, point 5).
    { key: 'illuminance',         candidates: byDeviceClass(['illuminance', 'irradiance']) },
    { key: 'precipitation',       candidates: byDeviceClass(['precipitation']) },
    { key: 'pressure',            candidates: byDeviceClass(['atmospheric_pressure', 'pressure']) },
    { key: 'wind_speed',          candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'gust_speed',          candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'wind_direction',      candidates: directionEntities },
    { key: 'uv_index',            candidates: uvEntities },
    { key: 'dew_point',           candidates: byDeviceClass(['temperature']) },
    { key: 'sunshine_duration',   candidates: [] },
  ];
}

function buildSensorsSchema(hass: HassWithStates | null): Array<{ name: string; required?: boolean; selector: object }> {
  return buildSensorFields(hass).map((f) => ({
    name: f.key,
    required: REQUIRED_KEYS.has(f.key),
    selector: {
      entity: f.candidates.length > 0
        ? { include_entities: f.candidates }
        : { domain: 'sensor' },
    },
  }));
}

// forecast.* boolean: the Open-Meteo no-station past-block opt-in
// (ADR-0015). Lives in the sensors section because it is the
// recorder-free alternative to wiring station sensors.
const OPENMETEO_HISTORY_SCHEMA = [
  { name: 'openmeteo_history', selector: { boolean: {} } },
];

export function renderSensorsSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, sensorsConfig, fcfg, pastDataAvailable, showsStation } = ctx;

  // The section shows whenever a past block is — or should become —
  // configurable: in station / combination mode, or (regardless of
  // mode) when there is no past data yet, so the recovery controls
  // (the Open-Meteo opt-in, the sensor pickers) stay reachable.
  if (!showsStation && pastDataAvailable) return html``;

  // Append "(required)" to required-field labels. ha-form also draws a
  // Material asterisk via the schema's `required: true` flag; the
  // text marker just makes the convention explicit for users who don't
  // pattern-match on Material asterisks.
  const computeLabel = (schema: { name: string; required?: boolean }): string => {
    const base = t(schema.name);
    return schema.required ? `${base} (${t('required_marker')})` : base;
  };

  return html`
    ${renderSectionHeader({ editor, title: t('station_sensors_heading'), sectionKey: 'sensors', resetLabel: t('reset_section') })}

    ${!pastDataAvailable ? html`
      <div class="hint">${t('openmeteo_history_unavailable')}</div>
    ` : ''}

    <div class="textfield-container">
      <ha-form
        .data=${{ openmeteo_history: fcfg.openmeteo_history === true }}
        .schema=${OPENMETEO_HISTORY_SCHEMA}
        .hass=${editor.hass}
        .computeLabel=${() => t('openmeteo_history')}
        @value-changed=${editor._chartForecastChanged}
      ></ha-form>
      <div class="hint" style="padding-left:20px;">${t('openmeteo_history_hint')}</div>
    </div>

    <div class="textfield-container">
      <ha-form
        .data=${sensorsConfig}
        .schema=${buildSensorsSchema(editor.hass)}
        .hass=${editor.hass}
        .computeLabel=${computeLabel}
        @value-changed=${editor._sensorsChanged}
      ></ha-form>
    </div>
  `;
}
