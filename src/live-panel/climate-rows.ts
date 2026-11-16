// Climate column rows: pressure, dew point / humidity, precipitation,
// next rain (ADR-0010, ADR-0025). A row returns null when off or valueless.
// The `*Text` helpers are shared with the sources popup so a value is
// formatted one way only.

import { html } from 'lit';
import { getPressureTrend, getPressureTrendIcon } from '../pressure-trend.js';
import { getDewPointComfort, getDewPointComfortIcon } from '../dew-point-comfort.js';
import { precipIcon } from '../precip-rate.js';
import { isPrecipRateUnit, toMillimeters } from '../utils/unit-converters.js';
import { displayDecimals, fromCanonical, parseUnit, toDisplay } from '../utils/units.js';
import { parseNumericSafe } from '../utils/numeric.js';
import { attrEntity, shownText, shownValue, unitLabel, type LivePanelCtx, type LiveReading } from './context.js';

const isNumeric = (v: unknown): boolean => v != null && Number.isFinite(parseFloat(String(v)));

export function pressureText(ctx: LivePanelCtx): string {
  const shown = shownValue(ctx, 'pressure');
  return shown ? shownText(shown) : '';
}

export function humidityText(humidity: unknown): string {
  return `${String(humidity)} %`;
}

export function dewPointText(ctx: LivePanelCtx): string {
  const shown = shownValue(ctx, 'dew_point');
  return shown ? shownText(shown) : '';
}

export function precipitationText(precipitation: unknown, unit: string | undefined): string {
  return unit ? `${String(precipitation)} ${unit}` : String(precipitation);
}

export function climateRowPressure(ctx: LivePanelCtx, show: boolean, deltaHpa: number | null) {
  const text = show ? pressureText(ctx) : '';
  if (!text) return null;
  const trend = getPressureTrend(deltaHpa);
  const iconName = getPressureTrendIcon(trend) || 'gauge';
  // Icon-only: the tooltip carries trend, 3-h delta and influence. The
  // trend is classified in hPa; the delta is shown in the row's unit.
  let ariaLabel = '';
  const unit = ctx.displayUnits.pressure;
  const d = toDisplay('pressure', deltaHpa, unit, 'delta');
  if (trend && d !== null) {
    const deltaStr = (d > 0 ? '+' : '') + d.toFixed(displayDecimals('pressure', unit, 'delta') ?? 1);
    ariaLabel = ctx.str('pressure_tooltip_template')
      .replace('{trend}', ctx.str(`pressure_trend_${trend}`))
      .replace('{delta}', deltaStr)
      .replace('{unit}', unitLabel(ctx, unit))
      .replace('{influence}', ctx.str(`pressure_influence_${trend}`));
  }
  return html`${ctx.entityLink(attrEntity(ctx.config, 'pressure'),
    html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${text}</span>`)}`;
}

// A reading in whole degrees of the display unit: the raw number when it
// already is in that unit, so a 54 °F sensor is not shown as 53.99… → 54.
function inDisplayTemperature(reading: LiveReading, unit: string): number | null {
  const raw = parseNumericSafe(reading.value);
  if (raw !== null && parseUnit('temperature', reading.unit) === parseUnit('temperature', unit)) return raw;
  return fromCanonical('temperature', reading.canonical, unit);
}

function dewPointTitle(ctx: LivePanelCtx, band: string): string {
  const unit = ctx.displayUnits.temperature;
  const td = inDisplayTemperature(ctx.readings.dew_point, unit);
  const tair = inDisplayTemperature(ctx.readings.temperature, unit);
  if (td === null || tair === null) return '';
  const spread = Math.max(0, tair - td);
  return ctx.str('dew_point_tooltip_template')
    .replace('{td}', String(Math.round(td)))
    .replace('{spread}', String(Math.round(spread)))
    .replace(/\{unit\}/g, unitLabel(ctx, unit))
    .replace('{band}', ctx.str(`dew_point_band_${band}`));
}

// Dew point and humidity share one line: dew point first, humidity an
// optional second segment. Humidity alone renders when the dew point is hidden.
export function climateRowDewPoint(
  ctx: LivePanelCtx,
  show: boolean,
  showHumidity: boolean,
  humidity: unknown,
) {
  const dewText = show ? dewPointText(ctx) : '';
  const humVisible = showHumidity && isNumeric(humidity);
  if (!dewText && !humVisible) return null;
  const humSegment = humVisible
    ? ctx.entityLink(attrEntity(ctx.config, 'humidity'),
        html`<ha-icon icon="hass:water-percent"></ha-icon> ${humidityText(humidity)}`)
    : html``;
  if (!dewText) return humSegment;
  // The classifier reads canonical °C; an unknown unit gives no band.
  const { dew_point: dew, temperature } = ctx.readings;
  const band = getDewPointComfort(dew.canonical, temperature.canonical);
  const iconName = getDewPointComfortIcon(band) || 'thermometer-water';
  const ariaLabel = band ? dewPointTitle(ctx, band) : '';
  const dewSegment = ctx.entityLink(attrEntity(ctx.config, 'dew_point'),
    html`<span title=${ariaLabel} aria-label=${ariaLabel}><ha-icon
      icon="hass:${iconName}"
    ></ha-icon> ${dewText}</span>`);
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

// Next-rain row (`sensors.next_rain`). The tooltip names which horizon
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
