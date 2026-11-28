// Live-panel render context (ADR-0010): the row renderers here are plain
// functions over this one object. Interaction (more-info, popups) comes in
// as the two link callbacks, so nothing here touches the element or the DOM.

import type { Calendar } from '../utils/time-zone.js';
import type { ZeroDegreePoint } from '../zero-degree-popup.js';
import { getNumberFormat } from '../utils/intl-cache.js';
import { parseNumericSafe } from '../utils/numeric.js';
import { displayNumber, type DisplayQuantity, type DisplayUnits } from '../display-units.js';

export interface LiveStateObj {
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
}

export interface LiveHass {
  states?: Record<string, LiveStateObj | undefined>;
  config?: { latitude?: number | null; longitude?: number | null; elevation?: unknown };
  formatEntityState?: (stateObj: LiveStateObj) => string;
}

export interface LiveConfig {
  sensors?: Record<string, unknown>;
  weather_entity?: string;
  use_12hour_format?: boolean;
  title?: unknown;
  location?: unknown;
  elevation?: unknown;
  show_attributes?: boolean;
  forecast?: {
    type?: string;
    precipitation_color?: string;
    show_wind_forecast?: boolean;
    show_wind_arrow?: boolean;
    show_wind_speed?: boolean;
  };
  [key: string]: unknown;
}

/** The live readings the card extracts from its sensors. */
export interface LiveValues {
  humidity?: unknown;
  precipitation?: unknown;
  precipitation_unit?: string;
  /** The live rate in mm/h, unrounded; null when the row shows no rate. */
  precipitationRate?: number | null;
  uv_index?: unknown;
  illuminance?: unknown;
  windDirection?: unknown;
  zero_degree_level?: unknown;
  zero_degree_unit?: string;
  zero_degree_48h_level?: unknown;
  zero_degree_48h_unit?: string;
  zero_degree_48h_change?: number;
  zero_degree_48h_at?: string;
  zero_degree_curve?: ZeroDegreePoint[] | null;
  next_rain_text?: string;
  next_rain_icon?: string;
  next_rain_title?: string;
  pressureDelta3h?: number | null;
}

export const LIVE_READING_KEYS = [
  'temperature', 'dew_point', 'apparent_temperature', 'pressure', 'wind_speed', 'gust_speed', 'zero_degree_level', 'zero_degree_level_48h',
] as const;
export type LiveReadingKey = typeof LIVE_READING_KEYS[number];

/** A live reading as extracted (sensor-readings.ts): the raw value, its
 *  unit, and the value in canonical units (null for an unknown unit). */
export interface LiveReading {
  value: unknown;
  unit: string | undefined;
  canonical: number | null;
}

export type LinkFn = (entityId: string | undefined, content: unknown) => unknown;

export interface LivePanelCtx {
  config: LiveConfig;
  hass: LiveHass | null | undefined;
  /** Resolved display language, never empty. */
  language: string;
  calendar: Calendar;
  /** Locale string with a per-key English fallback; '' when unknown. */
  str: (key: string) => string;
  /** Unit labels of the active locale (`units` table). */
  units: Record<string, string | undefined>;
  cardinalDirections: readonly string[];
  readings: Readonly<Record<LiveReadingKey, LiveReading>>;
  /** The card's display units (ADR-0035, point 4). */
  displayUnits: DisplayUnits;
  values: LiveValues;
  /** Wraps content in a more-info link for the entity (or returns it). */
  entityLink: LinkFn;
  /** Like entityLink, but opens the zero-degree popup when it has a curve. */
  zeroDegreeLink: LinkFn;
}

/** Entity id backing a row: the configured sensor wins; rows whose value
 *  can fall back to the weather entity's attributes link to it then. */
export function attrEntity(
  config: LiveConfig | null | undefined,
  sensorKey: string,
  weatherFallback = true,
): string | undefined {
  const eid = config?.sensors?.[sensorKey];
  if (typeof eid === 'string' && eid) return eid;
  if (weatherFallback && config?.weather_entity) return config.weather_entity;
  return undefined;
}

// The locale tables are keyed by the config's spelling: the units-table
// id `Beaufort` is `Bft` there.
// eslint-disable-next-line no-restricted-syntax -- a locale key, the config's spelling of Beaufort
const LABEL_KEY:Readonly<Record<string, string>> = { Beaufort: 'Bft' };

/** Locale label of a unit key ('' when no unit is set). */
export function unitLabel(ctx: Pick<LivePanelCtx, 'units'>, unit: string | undefined): string {
  if (!unit) return '';
  const key = LABEL_KEY[unit] ?? unit;
  return ctx.units[key] ?? key;
}

export type ShownKey = 'temperature' | 'dew_point' | 'apparent_temperature' | 'pressure' | 'wind_speed' | 'gust_speed';

const SHOWN_QUANTITY: Readonly<Record<ShownKey, DisplayQuantity>> = {
  temperature: 'temperature',
  dew_point: 'temperature',
  apparent_temperature: 'temperature',
  pressure: 'pressure',
  wind_speed: 'speed',
  gust_speed: 'speed',
};

/** A reading as the card shows it (ADR-0035, points 4 and 5): number and
 *  label in the display unit, or the raw value with its own unit when
 *  that unit is unknown. Null when the value is not numeric. */
export function shownValue(
  ctx: Pick<LivePanelCtx, 'readings' | 'displayUnits' | 'units'>,
  key: ShownKey,
): { value: number | string; unit: string } | null {
  const reading = ctx.readings[key];
  const num = parseNumericSafe(reading?.value);
  if (num === null) return null;
  const quantity = SHOWN_QUANTITY[key];
  const displayUnit = ctx.displayUnits[quantity];
  const value = reading.canonical === null ? null : displayNumber(quantity, num, reading.unit, displayUnit);
  if (value === null) return { value: String(reading.value), unit: reading.unit ?? '' };
  return { value, unit: unitLabel(ctx, displayUnit) };
}

/** Value, a space, unit; the value alone without a unit. */
export function shownText(shown: { value: number | string; unit: string }): string {
  return shown.unit ? `${shown.value} ${shown.unit}` : String(shown.value);
}

export interface EntityFormatOptions {
  /** Unit of `value`; appended on the Intl path. */
  unit?: string;
  /** Format as this unit instead of the entity's own (e.g. metres). */
  unitOverride?: string;
  /** Intl path precision. */
  maxFractionDigits?: number;
  /** false drops the unit suffix (chart axis ticks). */
  withUnit?: boolean;
}

const NO_STATE = new Set(['unavailable', 'unknown']);

/** Formats `value` like HA formats entity `eid`: `hass.formatEntityState`
 *  (HA ≥ 2023.9) on a copy of the state carrying `value`; Intl otherwise,
 *  also for an unavailable entity (no unit or precision to borrow).
 *  One formatter for row, popup and tooltips. */
export function formatEntityNumber(
  ctx: Pick<LivePanelCtx, 'hass' | 'language'>,
  eid: string | undefined,
  value: unknown,
  opts: EntityFormatOptions = {},
): string {
  const { unitOverride, maxFractionDigits = 0, withUnit = true } = opts;
  const unit = unitOverride ?? opts.unit;
  const hass = ctx.hass;
  const stateObj = eid ? hass?.states?.[eid] : undefined;
  if (stateObj && !NO_STATE.has(stateObj.state) && typeof hass?.formatEntityState === 'function') {
    try {
      const full = hass.formatEntityState({
        ...stateObj,
        state: String(value),
        ...(unitOverride ? { attributes: { ...stateObj.attributes, unit_of_measurement: unitOverride } } : {}),
      });
      if (withUnit) return full;
      return unit && full.endsWith(unit) ? full.slice(0, -unit.length).trim() : full;
    } catch {
      // A formatter throw must never blank the row; take the Intl path.
    }
  }
  const num = parseFloat(String(value));
  const text = Number.isFinite(num)
    ? getNumberFormat(ctx.language, { maximumFractionDigits: maxFractionDigits }).format(num)
    : String(value);
  return withUnit && unit ? `${text} ${unit}` : text;
}

export const isPresent = (v: unknown): boolean => v !== undefined && v !== '';
