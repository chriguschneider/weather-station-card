// @vitest-environment jsdom
// Static drift detector for the configuration defaults.
//
// The card's DEFAULTS object (src/defaults.ts) is the single source of
// truth for `setConfig({})` and `getStubConfig()`. A future PR that
// adds a key to one path without adding it to DEFAULTS — or vice versa
// — silently re-introduces the v1.x drift class that #83 closed. This
// file makes that drift mechanically detectable.
//
// Two checks:
//   1. getStubConfig output keys ⊆ DEFAULTS keys (modulo `sensors` which
//      is auto-detected).
//   2. setConfig({sensors: {temperature: 'sensor.t'}}) produces a config
//      whose keys are a superset of DEFAULTS keys (DEFAULTS spread sets
//      the floor; the user merge can only add keys).

import { describe, it, expect, vi } from 'vitest';
import { render, html } from 'lit';
import '../src/main.js';
import { DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS } from '../src/defaults.js';
import { SECTION_KEYS } from '../src/editor/section-keys.js';
import { renderBasicsSection } from '../src/editor/render-basics.js';
import { renderSensorsSection } from '../src/editor/render-sensors.js';
import { renderChartSection } from '../src/editor/render-chart.js';
import { renderLivePanelSection } from '../src/editor/render-live-panel.js';
import { renderUnitsSection } from '../src/editor/render-units.js';

const Card = customElements.get('weather-station-card');

function topLevelKeys(obj) {
  return Object.keys(obj).sort();
}

function omit(obj, keys) {
  const skip = new Set(keys);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!skip.has(k)) out[k] = v;
  }
  return out;
}

describe('config defaults — drift guard', () => {
  it('getStubConfig output keys are a subset of DEFAULTS keys', () => {
    const stub = Card.getStubConfig({ states: {} }, [], []);
    const stubWithoutSensors = omit(stub, ['sensors']);
    const stubKeys = topLevelKeys(stubWithoutSensors);
    const defaultKeys = topLevelKeys(omit(DEFAULTS, ['sensors']));
    // Every stub key must exist in DEFAULTS — no orphan stub-only keys.
    for (const key of stubKeys) {
      expect(defaultKeys).toContain(key);
    }
  });

  it('setConfig({}) produces every DEFAULTS top-level key', () => {
    // Combination is now the default (#83 follow-up), so we provide a
    // minimal sensor + weather_entity to satisfy the mode-aware
    // validation. The shape check is the point — not whether the
    // validation passes.
    const card = document.createElement('weather-station-card');
    card.setConfig({
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    const cfg = card.config;
    const defaultKeys = topLevelKeys(omit(DEFAULTS, ['sensors']));
    const cfgKeys = topLevelKeys(cfg);
    for (const key of defaultKeys) {
      expect(cfgKeys).toContain(key);
    }
  });

  it('setConfig preserves nested forecast / units keys from DEFAULTS', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    const cfg = card.config;
    const forecastDefaultKeys = Object.keys(DEFAULTS.forecast).sort();
    for (const key of forecastDefaultKeys) {
      expect(cfg.forecast).toHaveProperty(key);
    }
    const unitsDefaultKeys = Object.keys(DEFAULTS.units).sort();
    for (const key of unitsDefaultKeys) {
      expect(cfg.units).toHaveProperty(key);
    }
  });
});

// ── Schema-coverage drift guard (v1.10.2 #93) ────────────────────────
//
// Two-way drift detection between SECTION_KEYS (used by _resetSection)
// and the schema fields each render-*.ts actually exposes:
//   1. Every key listed in SECTION_KEYS must resolve to a real path in
//      DEFAULTS (so reset doesn't dangle on a removed key).
//   2. Every schema field exposed by a section's <ha-form> must appear
//      in the corresponding SECTION_KEYS list (so reset is exhaustive).
//
// Companion to the existing drift-guard which checks the other direction
// (every DEFAULTS key referenced by setConfig / getStubConfig).

function pathExistsInDefaults(path) {
  const parts = path.split('.');
  let cursor = DEFAULTS;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(cursor, part)) return false;
    cursor = cursor[part];
  }
  return true;
}

// SECTION_KEYS paths the user CAN set via YAML / editor but for which
// no DEFAULTS entry exists. Reset still works (delete the key →
// runtime fallback like `cfg.title || ''` provides the default).
const DELETE_ONLY_PATHS = new Set([
  'title',  // free-text user label, runtime fallback in render-chart.ts
]);

// Schema field names a render-*.ts treats as UI-only (not config-backed)
// or that map to a SECTION_KEYS parent-path block (see CHILDREN_OF map).
const SCHEMA_KEY_SKIPLIST = new Set([
  'mode',  // render-basics.ts exposes the UI-level abstraction; backed by
           // show_station + show_forecast in SECTION_KEYS basics.
  'type',  // render-basics.ts chart-type schema field; bound to forecast.type
           // (which IS in SECTION_KEYS basics).
  // v2.4 (ADR-0023) UI-only abstractions: each is backed by config keys
  // that ARE listed per-section in SECTION_KEYS.
  'past_source',    // sensors + forecast.openmeteo_history (sensors section)
  'chart_rows',     // six forecast.* row booleans (chart section)
  'main_elements',  // four show_* booleans (live_panel section)
  'clock_mode',     // show_time / show_time_seconds / use_12hour_format
  'attributes',     // the attribute show_* booleans (live_panel section)
]);

// Sections whose SECTION_KEYS list contains a parent-path (no dots) —
// resetting the parent implicitly covers every schema field underneath.
// Maps section key → set of parent-path names that absorb child fields.
const PARENT_KEY_SECTIONS = {
  sensors: new Set(['sensors']),
  units: new Set(['units']),
};

// Render a section into jsdom and pull every <ha-form>'s .schema field
// names, recursing into grid containers ({type: 'grid'}) so their
// children count as fields (the container's own name is layout-only).
function collectSchemaNames(fields, out) {
  for (const field of fields || []) {
    if (field.type === 'grid' && Array.isArray(field.schema)) {
      collectSchemaNames(field.schema, out);
    } else {
      out.push(field.name);
    }
  }
}

function schemaFieldsFromSection(renderFn, ctx) {
  const editor = makeEditorMock();
  const fullCtx = { ...defaultCtx(), ...ctx };
  const container = document.createElement('div');
  render(renderFn(editor, fullCtx), container);
  const names = [];
  for (const form of container.querySelectorAll('ha-form')) {
    collectSchemaNames(form.schema || [], names);
  }
  return names;
}

function makeEditorMock() {
  return {
    hass: null,
    _config: null,
    _mode: 'combination',
    _pastSource: 'station',
    _clockMode: 'off',
    _setMode: vi.fn(),
    _setPastSource: vi.fn(),
    _setClockMode: vi.fn(),
    _applyTogglePaths: vi.fn(),
    _isPanelExpanded: vi.fn(() => true),
    _setPanelExpanded: vi.fn(),
    _valueChanged: vi.fn(),
    _sensorsChanged: vi.fn(),
    _sensorPickerChanged: vi.fn(),
    _unitsChanged: vi.fn(),
    _chartTopChanged: vi.fn(),
    _chartForecastChanged: vi.fn(),
    _livePanelChanged: vi.fn(),
    _actionChanged: vi.fn(),
    _resetSection: vi.fn(),
    _renderSunshineAvailabilityHint: vi.fn(() => html``),
    configChanged: vi.fn(),
    requestUpdate: vi.fn(),
  };
}

function defaultCtx() {
  // Maximum schema exposure: every gate enabled, every sensor / live
  // value present. The drift test should see every conditionally-
  // rendered field at least once.
  const fcfg = { ...DEFAULTS_FORECAST, show_sunshine: true };
  const cfg = {
    ...DEFAULTS,
    show_main: true,
    show_attributes: true,
    show_time: true,
    forecast: fcfg,
    units: { ...DEFAULTS_UNITS },
  };
  return {
    t: (k) => k,
    cfg,
    fcfg,
    sensorsConfig: {},
    unitsConfig: cfg.units,
    cmap: {},
    mode: 'combination',
    showsStation: true,
    showsForecast: true,
    hasSensor: () => true,
    hasLiveValue: () => true,
    pastDataAvailable: true,
  };
}

describe('SECTION_KEYS ↔ DEFAULTS drift guard', () => {
  for (const [sectionKey, paths] of Object.entries(SECTION_KEYS)) {
    it(`every SECTION_KEYS["${sectionKey}"] path resolves in DEFAULTS or DELETE_ONLY_PATHS`, () => {
      for (const path of paths) {
        const ok = pathExistsInDefaults(path) || DELETE_ONLY_PATHS.has(path);
        expect(
          ok,
          `${sectionKey} → ${path} missing from DEFAULTS (and not in DELETE_ONLY_PATHS)`,
        ).toBe(true);
      }
    });
  }
});

describe('Editor schema fields ↔ SECTION_KEYS drift guard', () => {
  const cases = [
    { name: 'basics', renderFn: renderBasicsSection },
    { name: 'sensors', renderFn: renderSensorsSection },
    { name: 'chart', renderFn: renderChartSection },
    { name: 'live_panel', renderFn: renderLivePanelSection },
    { name: 'units', renderFn: renderUnitsSection },
    // render-tap.ts uses ha-selector instead of ha-form — its fields
    // (tap_action / hold_action / double_tap_action) are listed
    // explicitly in SECTION_KEYS and exercised by editor.test.js.
  ];

  for (const { name, renderFn } of cases) {
    it(`every schema field in ${name} appears in SECTION_KEYS or skip-list`, () => {
      const fields = schemaFieldsFromSection(renderFn);
      const sectionLeaves = new Set(
        SECTION_KEYS[name].map((p) => p.split('.').pop()),
      );
      const parentPaths = PARENT_KEY_SECTIONS[name];
      for (const field of fields) {
        if (SCHEMA_KEY_SKIPLIST.has(field)) continue;
        // Sections that reset via a parent-path (sensors / units) cover
        // their schema fields implicitly — no per-field listing needed.
        if (parentPaths) continue;
        expect(
          sectionLeaves.has(field),
          `Schema field "${field}" in section "${name}" is not in SECTION_KEYS["${name}"] or SCHEMA_KEY_SKIPLIST`,
        ).toBe(true);
      }
    });
  }
});
