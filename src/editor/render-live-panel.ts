// Editor render partial — Section 5: "Live-Anzeige" (Live panel).
// The now-panel that sits above the chart: current temperature,
// condition, time, and the attributes row.
//
// Font-size knobs (current_temp_size, icons_size, time_size,
// day_date_size) are not exposed in the editor — they live in DEFAULTS
// + YAML only. Most users never touch them; the editor surface stays
// cleaner without them.
//
// Always visible — show_main is the gate for the panel itself; users
// can keep it off in pure forecast mode if they prefer the chart alone.
//
// Schema-driven via <ha-form>. Two ha-form blocks split the section
// visually:
//   - Main panel: show_main + 6 sub-toggles (time-related toggles
//     conditionally appear)
//   - Attributes: show_attributes + 10 sub-toggles (each conditional
//     on hasLiveValue / hasSensor for the matching metric)

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';
import { renderSectionHeader } from './section-header.js';

interface SchemaField {
  name: string;
  selector: object;
}

// Gate for the whole panel. Sub-toggles only appear when show_main is on.
// `show_time` further gates two sub-toggles for seconds / 12-hour format.
function buildMainPanelSchema(showMain: boolean, showTime: boolean): SchemaField[] {
  const schema: SchemaField[] = [
    { name: 'show_main', selector: { boolean: {} } },
  ];
  if (!showMain) return schema;
  schema.push(
    { name: 'show_temperature', selector: { boolean: {} } },
    { name: 'show_current_condition', selector: { boolean: {} } },
    { name: 'show_time', selector: { boolean: {} } },
  );
  if (showTime) {
    schema.push(
      { name: 'show_time_seconds', selector: { boolean: {} } },
      { name: 'use_12hour_format', selector: { boolean: {} } },
    );
  }
  schema.push(
    { name: 'show_day', selector: { boolean: {} } },
    { name: 'show_date', selector: { boolean: {} } },
  );
  return schema;
}

// Attributes-row gate + 10 sub-toggles. Each metric only appears in the
// schema when its backing sensor (or weather-entity attribute, for
// hasLiveValue) is configured — keeps the editor focused on what the
// user can actually control.
function buildAttributesSchema(
  showAttrs: boolean,
  hasLiveValue: (key: string) => boolean,
  hasSensor: (key: string) => boolean,
): SchemaField[] {
  const schema: SchemaField[] = [
    { name: 'show_attributes', selector: { boolean: {} } },
  ];
  if (!showAttrs) return schema;
  if (hasLiveValue('pressure')) {
    schema.push({ name: 'show_pressure', selector: { boolean: {} } });
  }
  if (hasLiveValue('dew_point')) {
    schema.push({ name: 'show_dew_point', selector: { boolean: {} } });
  }
  // Humidity renders on the dew-point line (opt-in) — the toggle sits
  // right after show_dew_point to mirror that.
  if (hasLiveValue('humidity')) {
    schema.push({ name: 'show_humidity', selector: { boolean: {} } });
  }
  if (hasSensor('precipitation')) {
    schema.push({ name: 'show_precipitation', selector: { boolean: {} } });
  }
  if (hasLiveValue('uv_index')) {
    schema.push({ name: 'show_uv_index', selector: { boolean: {} } });
  }
  if (hasSensor('illuminance')) {
    schema.push({ name: 'show_illuminance', selector: { boolean: {} } });
  }
  if (hasSensor('sunshine_duration')) {
    schema.push({ name: 'show_sunshine_duration', selector: { boolean: {} } });
  }
  if (hasLiveValue('wind_direction')) {
    schema.push({ name: 'show_wind_direction', selector: { boolean: {} } });
  }
  if (hasLiveValue('wind_speed')) {
    schema.push({ name: 'show_wind_speed', selector: { boolean: {} } });
  }
  if (hasLiveValue('gust_speed')) {
    schema.push({ name: 'show_wind_gust_speed', selector: { boolean: {} } });
  }
  schema.push({ name: 'show_sun', selector: { boolean: {} } });
  // Computed in-card (ADR-0022) — no sensor gate, always offered.
  schema.push({ name: 'show_moon', selector: { boolean: {} } });
  return schema;
}

export function renderLivePanelSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, hasSensor, hasLiveValue } = ctx;
  const showMain = cfg.show_main === true;
  const showTime = cfg.show_time === true;
  const showAttrs = cfg.show_attributes === true;

  const mainPanelSchema = buildMainPanelSchema(showMain, showTime);
  const attributesSchema = buildAttributesSchema(showAttrs, hasLiveValue, hasSensor);

  const mainPanelData = {
    show_main: showMain,
    show_temperature: cfg.show_temperature !== false,
    show_current_condition: cfg.show_current_condition !== false,
    show_time: showTime,
    show_time_seconds: cfg.show_time_seconds === true,
    use_12hour_format: cfg.use_12hour_format === true,
    show_day: cfg.show_day === true,
    show_date: cfg.show_date === true,
  };
  const attributesData = {
    show_attributes: showAttrs,
    // Opt-in since the dew-point line merge (v2.3) — matches
    // DEFAULTS.show_humidity: false and the renderer's `=== true` gate.
    show_humidity: cfg.show_humidity === true,
    show_pressure: cfg.show_pressure !== false,
    show_dew_point: cfg.show_dew_point === true,
    show_precipitation: cfg.show_precipitation === true,
    show_uv_index: cfg.show_uv_index !== false,
    show_illuminance: cfg.show_illuminance === true,
    show_sunshine_duration: cfg.show_sunshine_duration === true,
    show_wind_direction: cfg.show_wind_direction !== false,
    show_wind_speed: cfg.show_wind_speed !== false,
    show_wind_gust_speed: cfg.show_wind_gust_speed === true,
    show_sun: cfg.show_sun === true,
    show_moon: cfg.show_moon !== false,
  };

  const labelFor = (schema: { name: string }): string => t(schema.name);

  return html`
    ${renderSectionHeader({ editor, title: t('live_panel_heading'), sectionKey: 'live_panel', resetLabel: t('reset_section') })}

    <h4 class="subsection">${t('main_panel_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${mainPanelData}
        .schema=${mainPanelSchema}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._livePanelChanged}
      ></ha-form>
    </div>

    <h4 class="subsection">${t('attributes_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${attributesData}
        .schema=${attributesSchema}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._livePanelChanged}
      ></ha-form>
    </div>

    <!-- Font-size knobs (current_temp_size, icons_size, time_size,
         day_date_size) live in DEFAULTS + YAML only — most users never
         change them and the editor surface is cleaner without them. -->
  `;
}
