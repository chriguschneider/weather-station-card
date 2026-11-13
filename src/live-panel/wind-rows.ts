// Wind rows: the live panel's direction / speed / gust lines and the
// forecast block's per-column wind row. Conversions go through the
// lookup tables in utils/unit-converters.ts (ADR-0009).

import { html } from 'lit';
import { cardinalDirectionsIcon } from '../const.js';
import { MDI_PATHS } from '../icons/mdi-paths.js';
import { sanitizeForecastEntries } from '../chart/sanitize.js';
import { convertWindSpeed } from '../utils/unit-converters.js';
import { parseNumericSafe } from '../utils/numeric.js';
import { attrEntity, unitLabel, type LivePanelCtx } from './context.js';

const ICON_INDEX_BY_DIR: Record<string, number> = {
  N: 0, NNE: 1, NE: 1, ENE: 2, E: 2, ESE: 3, SE: 3, SSE: 4, S: 4,
  SSW: 5, SW: 5, WSW: 6, W: 6, NW: 7, NNW: 7, WNW: 8,
};

/** Arrow icon for a bearing in degrees or a compass label; index 9 is
 *  the unknown-direction fallback. */
export function windDirIcon(deg: number | string): string {
  if (typeof deg === 'number') return cardinalDirectionsIcon[Math.floor((deg + 22.5) / 45.0)];
  return cardinalDirectionsIcon[ICON_INDEX_BY_DIR[deg] ?? 9];
}

/** Localised compass label of a bearing; a label passes through. */
export function windDirText(directions: readonly string[], deg: number | string): string {
  if (typeof deg === 'number') return directions[Math.floor((deg + 11.25) / 22.5)];
  return deg;
}

/** Live wind speed in the display unit; undefined hides the row. */
export function displayWindSpeed(ctx: LivePanelCtx, windSpeed: unknown): number | undefined {
  return convertWindSpeed(windSpeed, ctx.weatherUnits.windSpeed, ctx.unitSpeed);
}

/** A forecast entry's own unit (set by ForecastDataSource from the weather
 *  entity) wins over the station's, so forecast wind is not mis-converted
 *  when the two disagree. */
export function convertWind(ctx: LivePanelCtx, raw: unknown, sourceUnit?: string): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return convertWindSpeed(raw, sourceUnit ?? ctx.weatherUnits.windSpeed, ctx.unitSpeed) ?? null;
}

export function windSpeedText(ctx: LivePanelCtx, speed: number): string {
  const u = unitLabel(ctx, ctx.unitSpeed);
  return u ? `${speed} ${u}` : String(speed);
}

export function gustSpeed(ctx: LivePanelCtx, gust: unknown): number | null {
  return convertWind(ctx, parseNumericSafe(gust));
}

export function windRowDirection(ctx: LivePanelCtx, show: boolean, windDirection: unknown) {
  if (!show || windDirection === undefined) return null;
  const dir = windDirection as number | string;
  return html`${ctx.entityLink(attrEntity(ctx.config, 'wind_direction'),
    html`<ha-icon icon="hass:${windDirIcon(dir)}"></ha-icon> ${windDirText(ctx.cardinalDirections, dir)}`)}`;
}

export function windRowSpeed(ctx: LivePanelCtx, show: boolean, dWindSpeed: number | null | undefined) {
  if (!show || dWindSpeed == null) return null;
  return html`${ctx.entityLink(attrEntity(ctx.config, 'wind_speed'),
    html`<ha-icon icon="hass:weather-windy"></ha-icon>
    ${windSpeedText(ctx, dWindSpeed)}`)}`;
}

export function windRowGust(ctx: LivePanelCtx, show: boolean, windGustSpeed: unknown) {
  if (!show) return null;
  const dGust = gustSpeed(ctx, windGustSpeed);
  if (dGust === null) return null;
  return html`${ctx.entityLink(attrEntity(ctx.config, 'gust_speed'),
    html`<ha-icon icon="hass:weather-windy-variant"></ha-icon>
    ${windSpeedText(ctx, dGust)}`)}`;
}

// ADR-0018: the wide forecast rows render inline-SVG <use> references
// against the card's hidden sprite; names outside it fall back to <ha-icon>.
export function spriteIcon(fullName: string | undefined, cls = '') {
  const name = (fullName ?? '').replace(/^.*:/, '');
  if (MDI_PATHS[name]) {
    return html`<svg class="wsc-icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#wsc-i-${name}"></use></svg>`;
  }
  return html`<ha-icon class="${cls}" icon="${fullName}"></ha-icon>`;
}

interface ForecastWindEntry {
  wind_speed?: unknown;
  wind_gust_speed?: unknown;
  wind_speed_unit?: string;
  wind_bearing?: number | string | null;
}

// Forecast wind row. Two toggles: forecast.show_wind_arrow (direction)
// and forecast.show_wind_speed (speed). The deprecated
// forecast.show_wind_forecast still accepts `false` as a hard master-off
// so existing YAML that disabled the row keeps working.
export function renderForecastWind(
  ctx: LivePanelCtx,
  forecasts: readonly unknown[] | null | undefined,
  forecastItems: number,
) {
  const fc = ctx.config.forecast ?? {};
  if (fc.show_wind_forecast === false) return html``;
  const showArrow = fc.show_wind_arrow !== false;
  const showSpeed = fc.show_wind_speed !== false;
  if (!showArrow && !showSpeed) return html``;

  const forecast = sanitizeForecastEntries(forecasts ? forecasts.slice(0, forecastItems) : []) as ForecastWindEntry[];
  const unit = unitLabel(ctx, ctx.unitSpeed);

  // Every speed gets the width of the longest one, so all cells wrap
  // (speed below the arrow) or none does, whatever the screen width.
  const speeds = forecast.map((item) =>
    convertWind(ctx, item.wind_gust_speed ?? item.wind_speed, item.wind_speed_unit));
  const maxChars = Math.max(0, ...speeds.map((v) => (v === null ? 0 : String(v).length)));
  const speedStyle = maxChars > 0 ? `min-width: ${maxChars}ch` : '';

  // Integrations that omit wind fields (HA's Open-Meteo at hourly) get
  // each piece suppressed on its own: no default arrow, no orphan unit.
  return html`
    <div class="wind-details">
      ${forecast.map((item, i) => {
        const dWindSpeed = speeds[i];
        const hasBearing = item.wind_bearing != null;
        return html`
          <div class="wind-detail">
            ${showArrow && hasBearing ? spriteIcon(`hass:${windDirIcon(item.wind_bearing as number | string)}`, 'wind-icon') : ''}
            ${showSpeed && dWindSpeed !== null ? html`
              <span class="wind-value">
                <span class="wind-speed" style=${speedStyle}>${dWindSpeed}</span>
                <span class="wind-unit">${unit}</span>
              </span>
            ` : ''}
          </div>
        `;
      })}
    </div>
  `;
}
