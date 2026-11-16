// Shared types for the editor render partials: `editor` is the host with the
// event handlers, `ctx` the per-render view-state from the host's render().

import type { PlaceHit } from './location-lookup.js';

/** The subset of HA's frontend `hass` object the editor reads. */
export interface HomeAssistant {
  language?: string;
  locale?: { language?: string };
  config?: {
    latitude?: number | null;
    longitude?: number | null;
    elevation?: number | null;
    time_zone?: string;
    location_name?: string;
  };
  states?: Record<string, { state: string } | undefined>;
}

/** Translation lookup; falls back to English, then to the key. */
export type TFn = (key: string) => string;

/** What `_valueChanged` reads from `event.target`: `value` or `checked`. */
interface ValueChangedTarget {
  value?: string | number;
  checked?: boolean;
}

/** Top-level mode the card runs in. */
export type EditorMode = 'station' | 'forecast' | 'combination';

/** Where the past half of the chart gets its data (ADR-0015): station
 *  sensors via the recorder, or the Open-Meteo history opt-in. */
export type PastSource = 'station' | 'openmeteo';

/** Toggle-path descriptor for the pill rows. `def` is the editor-visible
 *  default (`!== false` → true, `=== true` → false); keys that land on it
 *  are deleted on write. */
export interface TogglePath {
  path: string;
  def: boolean;
}

/** Transient state of the Location panel's place search / determine
 *  button; never written to the config. */
export interface LocationUiState {
  query: string;
  results: PlaceHit[];
  status: { kind: 'ok' | 'error'; text: string } | null;
  /** Switch is on but HA has no home coordinates to preset. */
  pending?: boolean;
  /** Coordinates elevation and zone were last determined for. */
  anchor?: { latitude: number; longitude: number } | null;
}

/** Editor host surface that the render partials bind their handlers to. */
export interface EditorLike {
  hass: HomeAssistant | null;
  _config: Record<string, unknown> | null;
  _mode: EditorMode;
  _setMode(value: EditorMode): void;
  _pastSource: PastSource;
  _setPastSource(value: PastSource): void;
  _clockMode: string;
  _setClockMode(value: string): void;
  /** '24h' | '12h' — use_12hour_format, shared by every time value. */
  _timeFormat: string;
  _setTimeFormat(value: string): void;
  _applyTogglePaths(items: ReadonlyArray<TogglePath>, selectedLeaves: ReadonlyArray<string>): void;
  _applyAttributeToggles(items: ReadonlyArray<TogglePath>, selectedLeaves: ReadonlyArray<string>): void;
  /** Write an explicit `attributes_layout` (null = back to automatic,
   *  keeping the current rows on via their show_* keys). */
  _setAttributesLayout(layout: ReadonlyArray<ReadonlyArray<string>> | null): void;
  requestUpdate(): void;
  _isPanelExpanded(sectionKey: string): boolean;
  _setPanelExpanded(sectionKey: string, expanded: boolean): void;
  _valueChanged(event: { target: ValueChangedTarget }, key: string): void;
  _sensorsChanged(event: Event): void;
  _unitsChanged(event: Event): void;
  _chartTopChanged(event: Event): void;
  _chartForecastChanged(event: Event): void;
  _livePanelChanged(event: Event): void;
  _locationChanged(event: Event): void;
  _timeZoneModeChanged(event: Event): void;
  _locUi: LocationUiState;
  _locationSwitchChanged(event: Event): void;
  _locationMapChanged(event: Event): void;
  _locationQueryChanged(event: Event): void;
  _locationSearch(): Promise<void>;
  _locationPick(hit: PlaceHit): void;
  _locationDetermine(): Promise<void>;
  _resetSection(sectionKey: string): void;
  _actionChanged(key: string, value: unknown): void;
  _renderSunshineAvailabilityHint(cfg: Record<string, unknown>, t: TFn): unknown;
  configChanged(newConfig: Record<string, unknown>): void;
  requestUpdate(): void;
}

/** Per-render context, computed once in the host's `render()`. */
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
  /** True when the card can show a past chart block (ADR-0015); when
   *  false, station / combination modes are disabled. */
  pastDataAvailable: boolean;
}
