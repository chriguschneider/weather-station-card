// Climate column rows: pressure, dew point / humidity, precipitation,
// next rain. Each row returns null when its toggle is off or its value
// is missing (Lit renders null as nothing), see ADR-0010 / ADR-0025.
// The `*Text` helpers are the row's value text, shared with the
// sources popup so the popup never formats a value a second way.

import { html } from 'lit';
import { getPressureTrend, getPressureTrendIcon } from '../pressure-trend.js';
import { getDewPointComfort, getDewPointComfortIcon } from '../dew-point-comfort.js';
import { precipIcon } from '../precip-rate.js';
import { convertPressure, isPrecipRateUnit, toMillimeters } from '../utils/unit-converters.js';
import { parseNumericSafe } from '../utils/numeric.js';
import { attrEntity, oneDecimal, unitLabel, type LivePanelCtx } from './context.js';

const isNumeric = (v: unknown): boolean => v != null && Number.isFinite(parseFloat(String(v)));

/** Pressure in the display unit; undefined hides the row
 *  (Math.round(null) would turn a null attribute into a bogus 0). */
export function displayPressure(ctx: LivePanelCtx, pressure: unknown): number | undefined {
  const num = parseNumericSafe(pressure);
  if (num === null) return undefined;
  return convertPressure(num, ctx.weatherUnits.pressure, ctx.unitPressure);
}

export function pressureText(ctx: LivePanelCtx, dPressure: unknown): string {
  const u = unitLabel(ctx, ctx.unitPressure);
  return u ? `${dPressure} ${u}` : String(dPressure);
}

export function humidityText(humidity: unknown): string {
  return `${humidity} %`;
}

/** Dew point capped at one decimal, same rule as the main temperature:
 *  a weather entity's computed attribute is often a full-precision float. */
export function dewPointText(ctx: LivePanelCtx, dewPoint: unknown): string {
  const unit = ctx.weatherUnits.temperature;
  const v = oneDecimal(dewPoint);
  return v && unit ? `${v} ${unit}` : v;
}

export function precipitationText(precipitation: unknown, unit: string | undefined): string {
  return unit ? `${precipitation} ${unit}` : String(precipitation);
}

export function climateRowPressure(ctx: LivePanelCtx, show: boolean, dPressure: unknown, deltaHpa: number | null) {
  if (!show || dPressure == null || !isNumeric(dPressure)) return null;
  const trend = getPressureTrend(deltaHpa);
  const iconName = getPressureTrendIcon(trend) || 'gauge';
  // Icon-only encoding: a `(±X.X/3h)` suffix wrapped on narrow columns.
  // The tooltip carries trend + 3-h delta + influence; the delta stays in
  // hPa (the WMO classification unit) even when the display is mmHg / inHg.
  let ariaLabel = '';
  if (trend && deltaHpa != null && Number.isFinite(deltaHpa)) {
    const deltaStr = (deltaHpa > 0 ? '+' : '') + deltaHpa.toFixed(1);
    ariaLabel = ctx.str('pressure_tooltip_template')
      .replace('{trend}', ctx.str(`pressure_trend_${trend}`))
      .replace('{delta}', deltaStr)
      .replace('{influence}', ctx.str(`pressure_influence_${trend}`));
  }
  return html`${ctx.entityLink(attrEntity(ctx.config, 'pressure'),
    html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${pressureText(ctx, dPressure)}</span>`)}`;
}

function dewPointTitle(ctx: LivePanelCtx, band: string, tdRaw: number, tairRaw: number): string {
  // The spread is shown in the display unit so it matches the row value.
  const spread = Math.max(0, tairRaw - tdRaw);
  return ctx.str('dew_point_tooltip_template')
    .replace('{td}', String(Math.round(tdRaw)))
    .replace('{spread}', String(Math.round(spread)))
    .replace(/\{unit\}/g, String(ctx.weatherUnits.temperature))
    .replace('{band}', ctx.str(`dew_point_band_${band}`));
}

// Dew point and humidity share one line (v2.3): the dew point is the
// headline value, humidity an optional second segment with its own icon
// and entity link. Humidity alone renders when the dew point is hidden.
export function climateRowDewPoint(
  ctx: LivePanelCtx,
  show: boolean,
  dewPoint: unknown,
  showHumidity: boolean,
  humidity: unknown,
) {
  const dewVisible = show && isNumeric(dewPoint);
  const humVisible = showHumidity && isNumeric(humidity);
  if (!dewVisible && !humVisible) return null;
  const humSegment = humVisible
    ? ctx.entityLink(attrEntity(ctx.config, 'humidity'),
        html`<ha-icon icon="hass:water-percent"></ha-icon> ${humidityText(humidity)}`)
    : html``;
  if (!dewVisible) return humSegment;
  // The classifier wants °C; display values stay in the user's unit.
  const toC = (v: number) => (ctx.sourceTempUnit === '°F' ? (v - 32) * 5 / 9 : v);
  const tdRaw = parseFloat(String(dewPoint));
  const tairRaw = parseFloat(String(ctx.values.temperature));
  const band = getDewPointComfort(toC(tdRaw), Number.isFinite(tairRaw) ? toC(tairRaw) : null);
  const iconName = getDewPointComfortIcon(band) || 'thermometer-water';
  const ariaLabel = band && Number.isFinite(tairRaw) ? dewPointTitle(ctx, band, tdRaw, tairRaw) : '';
  const dewSegment = ctx.entityLink(attrEntity(ctx.config, 'dew_point'),
    html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${dewPointText(ctx, dewPoint)}</span>`);
  return humVisible ? html`${dewSegment} ${humSegment}` : dewSegment;
}

export function climateRowPrecip(
  ctx: LivePanelCtx,
  show: boolean,
  hasValue: boolean,
  precipitation: unknown,
  precipitationUnit: string | undefined,
) {
  if (!show || !hasValue) return null;
  // A rate (native rate sensor or the counter-derived rate, mm/h or in/h)
  // maps intensity to an icon; precipIcon's thresholds are mm/h. Other
  // units (probability `%`, raw `mm`) keep the plain rainy icon.
  const rateMm = isPrecipRateUnit(precipitationUnit)
    ? toMillimeters(parseFloat(String(precipitation)), precipitationUnit)
    : null;
  const icon = rateMm != null && Number.isFinite(rateMm) ? precipIcon(rateMm) : 'hass:weather-rainy';
  // Link to the entity that produced the number: the dedicated rate
  // sensor when configured (#253), else the precipitation slot.
  const linkEid = attrEntity(ctx.config, 'precipitation_rate', false)
    || attrEntity(ctx.config, 'precipitation', false);
  return html`${ctx.entityLink(linkEid,
    html`<ha-icon icon="${icon}"></ha-icon> ${precipitationText(precipitation, precipitationUnit)}`)}`;
}

// Next-rain row (`sensors.next_rain`). Text, icon and tooltip are
// prepared by main.ts `_refreshNextRain`; the tooltip names which horizon
// answered, so a forecast "~17:00" is never read as a radar observation.
export function climateRowNextRain(
  ctx: LivePanelCtx,
  text: string | undefined,
  icon: string | undefined,
  title: string | undefined,
) {
  if (!text) return null;
  const eid = attrEntity(ctx.config, 'next_rain', false);
  return html`<span title=${title} aria-label=${title || text}>${ctx.entityLink(eid,
    html`<ha-icon icon="${icon}"></ha-icon> ${text}`)}</span>`;
}
