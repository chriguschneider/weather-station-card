// Drift guard for the localized editor blocks (v2.4 editor i18n).
//
// Every locale ships an `editor` block translating the ACTIVE editor
// surface. Three checks per language:
//   1. Completeness — every key the editor actually looks up exists
//      (missing keys silently fall back to English at runtime, so a
//      forgotten key never fails loudly without this test).
//   2. Typo guard — no key unknown to en.ts (a misspelled key would
//      otherwise be dead weight that LOOKS translated).
//   3. Placeholder preservation — parameterized strings keep their
//      {tokens}, which the editor fills via String.replace.
//
// en.ts may carry extra legacy keys (kept for third-party translation
// compat) — the superset direction is deliberately not checked.

import { describe, it, expect } from 'vitest';
import en from '../src/locales/en.js';
import de from '../src/locales/de.js';
import bg from '../src/locales/bg.js';
import ca from '../src/locales/ca.js';
import cs from '../src/locales/cs.js';
import da from '../src/locales/da.js';
import el from '../src/locales/el.js';
import es from '../src/locales/es.js';
import fi from '../src/locales/fi.js';
import fr from '../src/locales/fr.js';
import hu from '../src/locales/hu.js';
import it_ from '../src/locales/it.js';
import ko from '../src/locales/ko.js';
import lt from '../src/locales/lt.js';
import nb from '../src/locales/nb.js';
import nl from '../src/locales/nl.js';
import pl from '../src/locales/pl.js';
import pt from '../src/locales/pt.js';
import ro from '../src/locales/ro.js';
import ru from '../src/locales/ru.js';
import sk from '../src/locales/sk.js';
import sv from '../src/locales/sv.js';
import uk from '../src/locales/uk.js';

const LOCALES = {
  bg, ca, cs, da, de, el, es, fi, fr, hu, it: it_,
  ko, lt, nb, nl, pl, pt, ro, ru, sk, sv, uk,
};

// The active editor surface — every t() lookup the current partials
// perform. Legacy en.ts keys (setup_heading, openmeteo_history, ...)
// are intentionally absent.
const REQUIRED_EDITOR_KEYS = [
  // sensor field labels (double as live-panel vocabulary)
  'temperature', 'humidity', 'illuminance', 'precipitation',
  'precipitation_rate', 'pressure',
  'wind_speed', 'gust_speed', 'wind_direction', 'uv_index', 'dew_point',
  'sunshine_duration',
  // basics
  'required_marker', 'title', 'days', 'forecast_days', 'weather_entity',
  'mode_label', 'mode_station', 'mode_forecast', 'mode_combination',
  'chart_type_label', 'forecast_type_daily', 'forecast_type_today',
  'forecast_type_hourly',
  // panel + subsection headings
  'station_sensors_heading', 'chart_section_heading', 'live_panel_heading',
  'actions_section_heading', 'units_heading', 'reset_section',
  'chart_time_range_heading', 'chart_rows_heading', 'chart_appearance_heading',
  'main_panel_heading', 'attributes_heading', 'open_documentation',
  // actions
  'tap_action_label', 'hold_action_label', 'double_tap_action_label',
  // live panel gates + elements
  'show_main', 'show_temperature', 'show_current_condition',
  'show_attributes', 'show_humidity', 'show_pressure', 'show_dew_point',
  'show_wind_direction', 'show_wind_speed', 'show_wind_gust_speed',
  'show_uv_index', 'show_illuminance', 'show_precipitation',
  'show_sun', 'show_moon', 'show_day', 'show_date',
  // chart rows + hints
  'show_chart_icons', 'show_chart_wind_direction', 'show_chart_wind_speed',
  'show_chart_date', 'show_chart_sunshine', 'show_chart_sunshine_hint',
  'show_chart_mode_toggle', 'sunshine_availability',
  'sunshine_availability_pending', 'sunshine_availability_warning',
  'openmeteo_history_hint', 'openmeteo_history_unavailable',
  // chart appearance + range
  'chart_style', 'chart_style_without_boxes', 'chart_style_with_boxes',
  'round_temp', 'disable_animation', 'number_of_forecasts',
  'number_of_forecasts_helper', 'chart_height',
  // past-source dropdown
  'past_source_label', 'past_source_station', 'past_source_openmeteo',
  // clock dropdown
  'clock_label', 'clock_off', 'clock_24h', 'clock_24h_seconds',
  'clock_12h', 'clock_12h_seconds',
  // multi-select labels
  'main_elements_label',
  // units
  'unit_pressure_label', 'unit_speed_label', 'unit_precipitation_label',
  // panel summaries
  'summary_connected', 'summary_no_sensors', 'summary_openmeteo',
  'summary_days', 'summary_columns', 'summary_rows', 'summary_attributes',
  'summary_on', 'summary_off',
];

const PLACEHOLDERS = {
  sunshine_availability: ['{past}', '{future}'],
  sunshine_availability_warning: ['{req}', '{gap}'],
  summary_connected: ['{n}'],
};

describe('locale editor blocks (parity with en)', () => {
  const enKeys = new Set(Object.keys(en.editor));

  it('the required-key list itself is a subset of en (test self-check)', () => {
    for (const key of REQUIRED_EDITOR_KEYS) {
      expect(enKeys.has(key), `required key "${key}" missing from en.ts`).toBe(true);
    }
  });

  for (const [lang, table] of Object.entries(LOCALES)) {
    it(`${lang}: editor block is complete`, () => {
      const block = table.editor;
      expect(block, `${lang} has no editor block`).toBeTruthy();
      for (const key of REQUIRED_EDITOR_KEYS) {
        expect(
          typeof block[key],
          `${lang}.editor.${key} missing (falls back to English silently)`,
        ).toBe('string');
      }
    });

    it(`${lang}: no editor keys unknown to en (typo guard)`, () => {
      for (const key of Object.keys(table.editor ?? {})) {
        expect(enKeys.has(key), `${lang}.editor.${key} is not a key en.ts knows`).toBe(true);
      }
    });

    it(`${lang}: parameterized strings keep their placeholders`, () => {
      for (const [key, tokens] of Object.entries(PLACEHOLDERS)) {
        const value = table.editor?.[key];
        if (typeof value !== 'string') continue; // completeness test covers absence
        for (const token of tokens) {
          expect(
            value.includes(token),
            `${lang}.editor.${key} lost placeholder ${token}`,
          ).toBe(true);
        }
      }
    });
  }
});
