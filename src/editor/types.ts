// Shared types for the editor render partials.
//
// Each `editor/render-<section>.ts` exports a `renderSection(editor, ctx)`
// function. They all share the same shape — `editor` is the
// LitElement host with the per-input event handlers, `ctx` is a per-render
// bag of computed view-state assembled in the host's `render()` method.
//
// The editor is loose-typed by design: contributors who add a new
// section don't need to touch this file unless their handler isn't
// covered by the union of `EditorLike`'s existing fields.

/** Subset of Home Assistant's frontend `hass` object the editor
 *  reads. The full type lives in custom-card-helpers — keeping a
 *  loose subset here avoids an extra dev-dep purely for typing. */
export interface HomeAssistant {
  language?: string;
  config?: { latitude?: number | null; longitude?: number | null };
  states?: Record<string, { state: string } | undefined>;
}

/** Translation lookup. Returns the English fallback (and ultimately
 *  the key itself) when no localization is configured. */
export type TFn = (key: string) => string;

/** Event shape for `<ha-switch>` / `<ha-textfield>` change handlers
 *  that bind directly to `_valueChanged`. Shared by the partials that
 *  use raw `<ha-switch>` rows (render-chart, render-live-panel); the
 *  ha-form / ha-selector based partials see CustomEvents with a
 *  different shape and don't need this. */
export type ChangeEvt = Event & { target: HTMLInputElement };

/** Anything `_valueChanged` accepts on `event.target` — covers both
 *  `<ha-textfield>` (value) and `<ha-switch>` / `<ha-checkbox>`
 *  (checked). */
interface ValueChangedTarget {
  value?: string | number;
  checked?: boolean;
}

/** Editor host surface. Each render partial receives the LitElement
 *  instance so it can bind handler closures (`@change="${(e) =>
 *  editor._valueChanged(e, 'days')}"`). Method signatures are kept
 *  loose because the host is JS-style with `static get properties`
 *  rather than decorator-typed. */
/** Top-level mode the card runs in. Defines which inputs the editor
 *  shows and which sources the data layer subscribes to. */
export type EditorMode = 'station' | 'forecast' | 'combination';

/** Where the past half of the chart gets its data (ADR-0015): station
 *  sensors via the recorder, or the Open-Meteo history opt-in. */
export type PastSource = 'station' | 'openmeteo';

/** Toggle-path descriptor for the multi-select (chips) fields. `def`
 *  is the *editor-visible* default for the key — the same truthiness
 *  the data bags use (`!== false` → def true, `=== true` → def false).
 *  Writing deletes keys that land back on their default so the YAML
 *  stays terse. */
export interface TogglePath {
  path: string;
  def: boolean;
}

export interface EditorLike {
  hass: HomeAssistant | null;
  _config: Record<string, unknown> | null;
  _mode: EditorMode;
  _setMode(value: EditorMode): void;
  _pastSource: PastSource;
  _setPastSource(value: PastSource): void;
  _clockMode: string;
  _setClockMode(value: string): void;
  _applyTogglePaths(items: ReadonlyArray<TogglePath>, selectedLeaves: ReadonlyArray<string>): void;
  _isPanelExpanded(sectionKey: string): boolean;
  _setPanelExpanded(sectionKey: string, expanded: boolean): void;
  _valueChanged(event: { target: ValueChangedTarget }, key: string): void;
  _sensorsChanged(event: Event): void;
  _sensorPickerChanged(key: string, value: unknown): void;
  _unitsChanged(event: Event): void;
  _chartTopChanged(event: Event): void;
  _chartForecastChanged(event: Event): void;
  _livePanelChanged(event: Event): void;
  _resetSection(sectionKey: string): void;
  _actionChanged(key: string, value: unknown): void;
  _renderSunshineAvailabilityHint(cfg: Record<string, unknown>, t: TFn): unknown;
  configChanged(newConfig: Record<string, unknown>): void;
  requestUpdate(): void;
}

/** Per-render context bag. Computed once at the top of the host's
 *  `render()` and passed to each partial — saves every partial from
 *  recomputing the same `mode`, `cfg.forecast`, etc. */
export interface EditorContext {
  t: TFn;
  cfg: Record<string, unknown> & {
    forecast?: Record<string, unknown>;
    sensors?: Record<string, string>;
    units?: Record<string, string>;
    [k: string]: unknown;
  };
  fcfg: Record<string, unknown>;
  sensorsConfig: Record<string, string>;
  unitsConfig: Record<string, string>;
  mode: 'station' | 'forecast' | 'combination';
  showsStation: boolean;
  showsForecast: boolean;
  hasSensor: (key: string) => boolean;
  hasLiveValue: (key: string) => boolean;
  /** True when the card can show a past chart block — either a station
   *  sensor is configured, or the Open-Meteo past opt-in is on
   *  (ADR-0015). When false, station / combination modes are disabled
   *  in the editor and the card is forced to forecast-only. */
  pastDataAvailable: boolean;
}
