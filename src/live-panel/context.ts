// Live-panel render context (ADR-0010, amended for #449). The row
// renderers in this directory are plain functions over this one object;
// main.ts builds it once per render (`_liveCtx`) from its instance state.
// Interaction (more-info, popups) stays in main.ts and comes in as the
// two link callbacks, so nothing here touches the element or the DOM.

import type { Calendar } from '../utils/time-zone.js';
import type { ZeroDegreePoint } from '../zero-degree-popup.js';
import { getNumberFormat } from '../utils/intl-cache.js';

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
    precipitation_color?: string;
    show_wind_forecast?: boolean;
    show_wind_arrow?: boolean;
    show_wind_speed?: boolean;
  };
  [key: string]: unknown;
}

/** The live readings `_extractSensorReadings` leaves on the card. */
export interface LiveValues {
  temperature?: unknown;
  humidity?: unknown;
  pressure?: unknown;
  dew_point?: unknown;
  precipitation?: unknown;
  precipitation_unit?: string;
  uv_index?: unknown;
  illuminance?: unknown;
  windSpeed?: unknown;
  windDirection?: unknown;
  wind_gust_speed?: unknown;
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
  unitPressure?: string;
  unitSpeed?: string;
  /** Units of the synthetic weather object (the station's source units). */
  weatherUnits: { temperature?: string; windSpeed?: string; pressure?: string };
  /** Unit of the temperature sensor; the dew-point classifier wants °C. */
  sourceTempUnit: string;
  values: LiveValues;
  /** Wraps content in a more-info link for the entity (or returns it). */
  entityLink: LinkFn;
  /** Like entityLink, but opens the zero-degree popup when it has a curve. */
  zeroDegreeLink: LinkFn;
}

/** Entity id backing a row: the configured sensor wins; rows whose value
 *  can fall back to the weather entity's attributes (see
 *  `_extractSensorReadings`) link to the weather entity in that case. */
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

/** Locale label of a unit key ('' when no unit is set). */
export function unitLabel(ctx: LivePanelCtx, unit: string | undefined): string {
  return unit ? ctx.units[unit] ?? unit : '';
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

/** "Format `value` like HA formats entity `eid`": HA's own formatter
 *  (`hass.formatEntityState`, HA ≥ 2023.9: the entity's display
 *  precision and the user's number format) on a copy of the entity's
 *  state carrying `value`; Intl otherwise. An entity that is unavailable
 *  carries no unit or precision to borrow, so a last-good value shown
 *  during an outage takes the Intl path too. One formatter for the row,
 *  the popup and the tooltips, so a level reads the same everywhere. */
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

/** Rounds to one decimal, the main temperature's rule; non-numeric
 *  values pass through as text. */
export function oneDecimal(v: unknown): string {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return v === undefined || v === null ? '' : String(v);
  return String(n % 1 !== 0 ? Math.round(n * 10) / 10 : n);
}

export const isPresent = (v: unknown): boolean => v !== undefined && v !== '';
