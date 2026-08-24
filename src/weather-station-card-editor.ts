import { LitElement, html, type TemplateResult } from 'lit';
import type { HomeAssistant } from './editor/types.js';
import locale, { ensureLocaleLoaded } from './locale.js';
import { readCachedAvailability } from './openmeteo-source.js';
import { renderBasicsSection } from './editor/render-basics.js';
import { renderSensorsSection } from './editor/render-sensors.js';
import { renderChartSection } from './editor/render-chart.js';
import { renderLivePanelSection } from './editor/render-live-panel.js';
import { renderUnitsSection } from './editor/render-units.js';
import { renderTapSection } from './editor/render-tap.js';
import { SECTION_KEYS, type SectionKey } from './editor/section-keys.js';
import type { EditorContext, EditorLike, PastSource, TFn, TogglePath } from './editor/types.js';

type EditorMode = 'station' | 'forecast' | 'combination';

interface ValueChangedTarget {
  value?: string | number;
  checked?: boolean;
}

// Resolve a localized editor string. Falls back along
// language → base-language → English → key.
function tEditor(hass: HomeAssistant | null, key: string): string {
  const lang = (hass?.language) || 'en';
  const baseLang = lang.split('-')[0];
  for (const l of [lang, baseLang, 'en']) {
    const block = (locale as Record<string, { editor?: Record<string, string> } | undefined>)[l]?.editor;
    if (block && typeof block[key] === 'string') return block[key];
  }
  return key;
}

class WeatherStationCardEditor extends LitElement implements EditorLike {
  hass: HomeAssistant | null = null;
  _config: Record<string, unknown> | null = null;

  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
    };
  }

  setConfig(config: Record<string, unknown> | null): void {
    if (!config) {
      throw new Error('Invalid configuration');
    }
    this._config = config;
    // Per-language locale strings ship in their own rollup chunks
    // (only English is eager). HA typically wires `hass` onto the
    // editor before setConfig, so language is already known here;
    // trigger the chunk fetch and re-render once it lands. The
    // card itself triggers the same load from set hass — both
    // sites are idempotent via the shared inflight map.
    const lang = this.hass?.language || 'en';
    if (lang !== 'en' && lang.split('-')[0] !== 'en') {
      void ensureLocaleLoaded(lang).then(() => this.requestUpdate());
    }
    this.requestUpdate();
  }

  get config(): Record<string, unknown> | null {
    return this._config;
  }

  // ── Mode (UI-only abstraction over show_station / show_forecast) ──────
  // The YAML schema keeps the two booleans for backwards compatibility;
  // the editor projects them onto a single radio so users pick a mode
  // up-front instead of inferring it from two unrelated toggles.
  get _mode(): EditorMode {
    if (!this._config) return 'station';
    const wantStation = this._config.show_station !== false;
    const wantForecast = this._config.show_forecast === true;
    if (wantStation && wantForecast) return 'combination';
    if (wantForecast) return 'forecast';
    return 'station';
  }

  _setMode(value: EditorMode): void {
    if (!this._config) return;
    const newConfig: Record<string, unknown> = { ...this._config };
    switch (value) {
      case 'station':
        newConfig.show_station = true;
        newConfig.show_forecast = false;
        break;
      case 'forecast':
        newConfig.show_station = false;
        newConfig.show_forecast = true;
        break;
      case 'combination':
        newConfig.show_station = true;
        newConfig.show_forecast = true;
        break;
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  // ── Past-data source (UI-only abstraction, ADR-0015 / ADR-0023) ──────
  // The runtime always prefers station sensors over the Open-Meteo
  // history opt-in, so the editor presents the two as one exclusive
  // dropdown. Reading: any configured sensor wins; otherwise the
  // opt-in decides. Writing "openmeteo" drops the sensors block so the
  // editor and the card agree (reversible until the user saves).
  get _pastSource(): PastSource {
    const sensors = (this._config?.sensors as Record<string, string>) || {};
    const hasSensor = Object.values(sensors).some(
      (v) => typeof v === 'string' && v.trim() !== '',
    );
    if (hasSensor) return 'station';
    const fc = this._config?.forecast as { openmeteo_history?: boolean } | undefined;
    return fc?.openmeteo_history === true ? 'openmeteo' : 'station';
  }

  _setPastSource = (value: PastSource): void => {
    if (!this._config) return;
    const newConfig: Record<string, unknown> = { ...this._config };
    const fc: Record<string, unknown> = { ...(newConfig.forecast as Record<string, unknown> ?? {}) };
    if (value === 'openmeteo') {
      fc.openmeteo_history = true;
      newConfig.forecast = fc;
      delete newConfig.sensors;
    } else {
      delete fc.openmeteo_history;
      if (Object.keys(fc).length === 0) {
        delete newConfig.forecast;
      } else {
        newConfig.forecast = fc;
      }
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  };

  // ── Clock mode (UI-only abstraction over three booleans) ─────────────
  // show_time / show_time_seconds / use_12hour_format project onto one
  // dropdown: off | 24h | 24h_seconds | 12h | 12h_seconds.
  get _clockMode(): string {
    const c = this._config ?? {};
    if (c.show_time !== true) return 'off';
    const twelve = c.use_12hour_format === true;
    const seconds = c.show_time_seconds === true;
    return (twelve ? '12h' : '24h') + (seconds ? '_seconds' : '');
  }

  _setClockMode = (value: string): void => {
    const selected: string[] = [];
    if (value !== 'off') selected.push('show_time');
    if (value.endsWith('_seconds')) selected.push('show_time_seconds');
    if (value.startsWith('12h')) selected.push('use_12hour_format');
    this._applyTogglePaths(
      [
        { path: 'show_time', def: false },
        { path: 'show_time_seconds', def: false },
        { path: 'use_12hour_format', def: false },
      ],
      selected,
    );
  };

  // ── Multi-select (chips) plumbing ────────────────────────────────────
  // Maps a multi-select value array back onto individual boolean config
  // keys. Each item carries its editor-visible default; keys that land
  // back on their default are deleted so the YAML stays terse.
  _applyTogglePaths = (
    items: ReadonlyArray<TogglePath>,
    selectedLeaves: ReadonlyArray<string>,
  ): void => {
    if (!this._config) return;
    const selected = new Set(selectedLeaves);
    const newConfig = JSON.parse(JSON.stringify(this._config)) as Record<string, unknown>;
    for (const { path, def } of items) {
      const leaf = path.split('.').pop() as string;
      const desired = selected.has(leaf);
      if (desired === def) {
        this._deleteByPath(newConfig, path);
      } else {
        this._setByPath(newConfig, path, desired);
      }
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  };

  _setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cursor[parts[i]];
      if (!next || typeof next !== 'object') {
        cursor[parts[i]] = {};
      }
      cursor = cursor[parts[i]] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }

  // ── Expansion-panel state (UI-only, not persisted to config) ─────────
  _expandedPanels: Record<string, boolean> = {};

  _isPanelExpanded(sectionKey: string): boolean {
    return this._expandedPanels[sectionKey] === true;
  }

  _setPanelExpanded(sectionKey: string, expanded: boolean): void {
    // No requestUpdate — ha-expansion-panel animates its own state;
    // the stored flag only keeps re-renders from collapsing panels.
    this._expandedPanels[sectionKey] = expanded;
  }

  // True when the card can render a past chart block: a station sensor
  // is configured, or the Open-Meteo past opt-in is on (ADR-0015).
  _pastDataAvailable(): boolean {
    if (!this._config) return true;
    const sensors = (this._config.sensors as Record<string, unknown>) || {};
    const hasSensor = Object.values(sensors).some(
      (v) => typeof v === 'string' && v.trim() !== '',
    );
    const fc = this._config.forecast as { openmeteo_history?: boolean } | undefined;
    return hasSensor || fc?.openmeteo_history === true;
  }

  // When the card has no way to show past data (no station sensors AND
  // the Open-Meteo past opt-in off), force forecast-only mode — the
  // station / combination views would only render an empty past block
  // (ADR-0015). One-directional: turning the opt-in on or wiring a
  // sensor re-enables the mode options but does NOT auto-switch back,
  // so the editor never fights a user who deliberately picked a mode.
  updated(changedProperties: Map<PropertyKey, unknown>): void {
    if (
      changedProperties.has('_config')
      && this._config
      && !this._pastDataAvailable()
      && this._mode !== 'forecast'
    ) {
      this._setMode('forecast');
    }
  }

  // ── Event plumbing ────────────────────────────────────────────────────
  configChanged(newConfig: Record<string, unknown>): void {
    const event = new Event('config-changed', { bubbles: true, composed: true }) as Event & { detail?: unknown };
    event.detail = { config: newConfig };
    this.dispatchEvent(event);
  }

  _sensorsChanged = (event: Event): void => {
    if (!this._config) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName.toLowerCase() !== 'ha-form') return;
    const detail = (event as CustomEvent<{ value: Record<string, string> }>).detail;
    this.configChanged({ ...this._config, sensors: detail.value });
    this.requestUpdate();
  };

  // Per-picker handler used now that the sensors block uses explicit
  // ha-entity-picker elements (instead of one ha-form). Empty value
  // removes the key from the YAML so unset sensors don't appear as
  // empty strings.
  _sensorPickerChanged = (key: string, value: unknown): void => {
    if (!this._config) return;
    const newSensors: Record<string, string> = { ...((this._config.sensors as Record<string, string>) || {}) };
    if (value === '' || value === null || value === undefined) {
      delete newSensors[key];
    } else {
      newSensors[key] = value as string;
    }
    this.configChanged({ ...this._config, sensors: newSensors });
    this.requestUpdate();
  };

  _unitsChanged = (event: Event): void => {
    if (!this._config) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName.toLowerCase() !== 'ha-form') return;
    const detail = (event as CustomEvent<{ value: Record<string, string> }>).detail;
    this.configChanged({ ...this._config, units: detail.value });
    this.requestUpdate();
  };

  // Chart-section ha-form handlers. The chart section spans two
  // config levels — top-level (title, days,
  // forecast_days) and forecast.* (number_of_forecasts, condition_icons,
  // show_*, style, round_temp, disable_animation). Each form replaces
  // the keys it owns and merges with the rest of config / forecast.
  _chartTopChanged = (event: Event): void => {
    if (!this._config) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName.toLowerCase() !== 'ha-form') return;
    const detail = (event as CustomEvent<{ value: Record<string, unknown> }>).detail;
    const newConfig: Record<string, unknown> = { ...this._config };
    for (const [key, value] of Object.entries(detail.value)) {
      if (value === undefined || value === '') {
        delete newConfig[key];
      } else {
        newConfig[key] = value;
      }
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  };

  _chartForecastChanged = (event: Event): void => {
    if (!this._config) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName.toLowerCase() !== 'ha-form') return;
    const detail = (event as CustomEvent<{ value: Record<string, unknown> }>).detail;
    const currentForecast = (this._config.forecast as Record<string, unknown>) || {};
    const newForecast = { ...currentForecast };
    for (const [key, value] of Object.entries(detail.value)) {
      if (value === undefined || value === '') {
        delete newForecast[key];
      } else {
        newForecast[key] = value;
      }
    }
    this.configChanged({ ...this._config, forecast: newForecast });
    this.requestUpdate();
  };

  // Live-panel ha-form handler. Both forms (main panel toggles +
  // attributes toggles) feed top-level cfg.show_*
  // keys, so a single handler can merge whichever bag arrives. Same
  // diff/delete pattern as _chartTopChanged.
  _livePanelChanged = (event: Event): void => {
    if (!this._config) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName.toLowerCase() !== 'ha-form') return;
    const detail = (event as CustomEvent<{ value: Record<string, unknown> }>).detail;
    const newConfig: Record<string, unknown> = { ...this._config };
    for (const [key, value] of Object.entries(detail.value)) {
      if (value === undefined || value === '') {
        delete newConfig[key];
      } else {
        newConfig[key] = value;
      }
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  };

  // Per-section reset-to-defaults. Walks the SECTION_KEYS list for
  // the given section and removes each key from
  // this._config — letting DEFAULTS take over on the next render.
  // Dot-paths address nested keys (e.g. `forecast.show_sunshine`).
  // No confirm dialog: reset is reversible by closing the editor
  // without saving (HA shows an unsaved-changes indicator).
  _resetSection = (sectionKey: string): void => {
    if (!this._config) return;
    const keys = SECTION_KEYS[sectionKey as SectionKey];
    if (!keys) return;
    const newConfig = JSON.parse(JSON.stringify(this._config)) as Record<string, unknown>;
    for (const path of keys) {
      this._deleteByPath(newConfig, path);
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  };

  // Walk a dot-path and delete the leaf. Cleans up empty parent objects
  // so the YAML stays terse (e.g. resetting every forecast.* key removes
  // the empty `forecast: {}` block too).
  _deleteByPath(obj: Record<string, unknown>, path: string): void {
    const parts = path.split('.');
    const stack: Array<Record<string, unknown>> = [obj];
    let cursor: Record<string, unknown> | undefined = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cursor?.[parts[i]];
      if (!next || typeof next !== 'object') return;
      cursor = next as Record<string, unknown>;
      stack.push(cursor);
    }
    delete cursor![parts[parts.length - 1]];
    // Walk back up; drop empty intermediate objects.
    for (let i = stack.length - 1; i > 0; i--) {
      const node = stack[i];
      if (node && Object.keys(node).length === 0) {
        delete stack[i - 1][parts[i - 1]];
      } else {
        break;
      }
    }
  }

  _valueChanged = (event: { target: ValueChangedTarget }, key: string): void => {
    if (!this._config) return;

    const newConfig: Record<string, unknown> = { ...this._config };
    const newValue = event.target.checked ?? event.target.value;

    if (key.includes('.')) {
      const parts = key.split('.');
      let level: Record<string, unknown> = newConfig;
      for (let i = 0; i < parts.length - 1; i++) {
        level[parts[i]] = { ...(level[parts[i]] as Record<string, unknown>) };
        level = level[parts[i]] as Record<string, unknown>;
      }
      level[parts[parts.length - 1]] = newValue;
    } else {
      newConfig[key] = newValue;
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  };

  // Render an inline hint under the forecast_days field showing what
  // Open-Meteo currently has cached for this location — and a warning
  // when the configured forecast_days exceeds what's actually
  // available. Only relevant when the sunshine row is enabled (no other
  // editor field depends on this cache).
  _renderSunshineAvailabilityHint(cfg: Record<string, unknown>, t: TFn): unknown {
    const fc = cfg && cfg.forecast as { show_sunshine?: boolean } | undefined;
    if (fc?.show_sunshine !== true) return '';
    const hass = this.hass;
    const lat = hass?.config ? hass.config.latitude : null;
    const lon = hass?.config ? hass.config.longitude : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

    const av = readCachedAvailability(lat as number, lon as number);
    if (!av) {
      return html`<div class="hint" style="margin-top:4px;">
        ${t('sunshine_availability_pending')}
      </div>`;
    }

    const requested = parseInt(String(cfg.forecast_days ?? (cfg.days || 7)), 10);
    const overshoots = Number.isFinite(requested) && av.forecastDays > 0 && requested > av.forecastDays;
    const baseLine = (t('sunshine_availability') || 'Sunshine: {past} past, {future} forecast days available')
      .replace('{past}', String(av.pastDays))
      .replace('{future}', String(av.forecastDays));

    return html`
      <div class="hint" style="margin-top:4px;">
        ${baseLine}
        ${overshoots ? html`<br/>${(t('sunshine_availability_warning') || 'Configured forecast_days ({req}) exceeds available — last {gap} columns will have empty sunshine bars.')
          .replace('{req}', String(requested))
          .replace('{gap}', String(requested - av.forecastDays))}` : ''}
      </div>
    `;
  }

  // ha-selector with the ui_action selector returns either an action
  // config object or undefined (when the picker is reset). Persist the
  // value as-is so HA's standard handle-action helper can read it back
  // unchanged — same shape Bubble / Mushroom / built-in cards consume.
  _actionChanged = (key: string, value: unknown): void => {
    if (!this._config) return;
    const newConfig: Record<string, unknown> = { ...this._config };
    if (value === undefined || value === null) {
      delete newConfig[key];
    } else {
      newConfig[key] = value;
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  };

  // ── Render ────────────────────────────────────────────────────────────
  // Thin orchestrator. Each section A–F lives in its own partial under
  // src/editor/. The styles below are global to the whole editor surface
  // (every partial expects to find them in scope) — keeping them here
  // means the partials don't carry their own scoped CSS, which would
  // duplicate the same .switch-container / .flex-container / .radio-group
  // rules across files.
  render(): TemplateResult {
    const t: TFn = (k) => tEditor(this.hass, k);
    const cfg = (this._config ?? {}) as EditorContext['cfg'];
    const fcfg = (cfg.forecast ?? {});
    const sensorsConfig = (cfg.sensors ?? {});
    const unitsConfig = (cfg.units ?? {});
    const mode = this._mode;
    const isStation = mode === 'station';
    const isForecast = mode === 'forecast';
    const isCombo = mode === 'combination';
    const showsForecast = isForecast || isCombo;
    const showsStation = isStation || isCombo;
    const hasSensor = (key: string): boolean => !!sensorsConfig[key];

    // Forecast-only mode typically has no station sensors, but the
    // configured weather.* entity already exposes standard current
    // attributes (humidity, pressure, wind_*, sometimes uv_index /
    // dew_point). The runtime falls back to those — the editor needs
    // to mirror that so the corresponding toggle stays visible.
    const SENSOR_TO_WEATHER_ATTR: Record<string, string> = {
      humidity: 'humidity',
      pressure: 'pressure',
      dew_point: 'dew_point',
      uv_index: 'uv_index',
      wind_direction: 'wind_bearing',
      wind_speed: 'wind_speed',
      gust_speed: 'wind_gust_speed',
    };
    const wxEntityId = typeof cfg.weather_entity === 'string' ? cfg.weather_entity : '';
    const wxStateRaw = wxEntityId
      ? (this.hass?.states as Record<string, { attributes?: Record<string, unknown> } | undefined> | undefined)?.[wxEntityId]
      : undefined;
    const wxAttrs = wxStateRaw?.attributes ?? {};
    const hasLiveValue = (key: string): boolean => {
      if (sensorsConfig[key]) return true;
      const wxKey = SENSOR_TO_WEATHER_ATTR[key];
      if (!wxKey) return false;
      const v = wxAttrs[wxKey];
      return v !== undefined && v !== null;
    };

    const pastDataAvailable = this._pastDataAvailable();

    const ctx: EditorContext = {
      t, cfg, fcfg, sensorsConfig, unitsConfig,
      mode, showsStation, showsForecast,
      hasSensor, hasLiveValue, pastDataAvailable,
    };

    return html`
      <style>
        h4.subsection {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--secondary-text-color, #727272);
          margin: 18px 0 8px;
        }
        h4.subsection:first-child { margin-top: 4px; }
        .textfield-container {
          display: flex; flex-direction: column; margin-bottom: 10px; gap: 16px;
        }
        .grid2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .gated { margin-left: 12px; display: flex; flex-direction: column; gap: 16px; }
        /* Toggle pills (src/editor/toggle-pills.ts) — every option is
           always visible, filled = on. The label mirrors ha-form's own
           field labels so a pill row reads as one more form field. */
        .pill-field { display: flex; flex-direction: column; gap: 8px; }
        .pill-label {
          font-size: 0.9rem;
          color: var(--secondary-text-color, #727272);
        }
        .pills { display: flex; flex-wrap: wrap; gap: 8px; }
        .pill {
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          border-radius: 16px;
          padding: 7px 14px;
          font-size: 13px;
          font-family: inherit;
          line-height: 1;
          color: var(--primary-text-color, #212121);
          background: transparent;
          cursor: pointer;
          user-select: none;
        }
        .pill:hover { border-color: var(--primary-color, #03a9f4); }
        .pill:focus-visible {
          outline: 2px solid var(--primary-color, #03a9f4);
          outline-offset: 2px;
        }
        .pill.on {
          background: var(--primary-color, #03a9f4);
          border-color: var(--primary-color, #03a9f4);
          /* HA's "text on an accent fill" token — not a hardcoded white,
             which some themes make unreadable on a light accent. */
          color: var(--text-primary-color, #fff);
        }
        .divider {
          border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          margin: 4px 0;
        }
        .hint {
          font-size: 0.85rem;
          color: var(--secondary-text-color, #727272);
          margin: 4px 0 12px;
        }
        /* Collapsible section panels (ADR-0023). The header slot holds
           icon + title + state summary + reset; ha-expansion-panel
           draws its own chevron and manages expand/collapse. */
        ha-expansion-panel.editor-panel {
          display: block;
          margin-bottom: 12px;
        }
        .panel-header {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
          padding: 2px 0;
        }
        .panel-icon {
          color: var(--secondary-text-color, #727272);
          flex: none;
        }
        .panel-titles { flex: 1; min-width: 0; }
        .panel-title {
          font-size: 0.95rem;
          font-weight: 500;
          color: var(--primary-text-color, #212121);
        }
        .panel-summary {
          font-size: 0.8rem;
          color: var(--secondary-text-color, #727272);
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .panel-reset {
          --mdc-icon-button-size: 32px;
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color, #727272);
          opacity: 0.7;
          flex: none;
        }
        .panel-reset:hover {
          opacity: 1;
          color: var(--primary-text-color, #212121);
        }
        .panel-body { padding: 12px 4px 4px; }
        .editor-footer {
          margin-top: 24px;
          padding-top: 12px;
          border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          text-align: right;
        }
        .editor-footer a {
          color: var(--primary-color, #03a9f4);
          text-decoration: none;
          font-size: 0.9rem;
        }
        .editor-footer a:hover { text-decoration: underline; }
      </style>

      <div>
        ${renderBasicsSection(this, ctx)}
        ${renderSensorsSection(this, ctx)}
        ${renderChartSection(this, ctx)}
        ${renderLivePanelSection(this, ctx)}
        ${renderUnitsSection(this, ctx)}
        ${renderTapSection(this, ctx)}
        <div class="editor-footer">
          <a href="https://github.com/chriguschneider/weather-station-card/blob/master/docs/CONFIGURATION.md"
             target="_blank" rel="noopener noreferrer">
            📖 ${t('open_documentation')}
          </a>
        </div>
      </div>
    `;
  }
}

customElements.define('weather-station-card-editor', WeatherStationCardEditor);
