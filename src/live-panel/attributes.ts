// Attribute row (ADR-0025): the resolved layout is a list of columns,
// each a list of row tokens. Every column becomes one <div>, every row
// inside it one <div> line, which is what the editor's layout board
// shows. A row returns null when its value is missing, so a column with
// nothing to show is dropped and the others spread across the width.

import { html } from 'lit';
import { resolveAttributesLayout, type AttributeToken } from '../attributes-layout.js';
import type { LivePanelCtx } from './context.js';
import { isPresent } from './context.js';
import {
  climateRowDewPoint,
  climateRowNextRain,
  climateRowPrecip,
  climateRowPressure,
  displayPressure,
} from './climate-rows.js';
import { climateRowZeroDegree, climateRowZeroDegree48h } from './zero-degree-rows.js';
import { renderMoonLine, siteCoords, sunRowSun, sunRowSunStrength } from './sun-rows.js';
import { displayWindSpeed, windRowDirection, windRowGust, windRowSpeed } from './wind-rows.js';

/** Values the rows read beyond the raw readings, derived once per render. */
interface Derived {
  dPressure: number | undefined;
  dWindSpeed: number | undefined;
  lat: number | null;
  lon: number | null;
}

// Row token → row renderer. `show` is true by construction (the token is
// in the layout); the rows keep their own value gates so a row listed but
// not wired still vanishes cleanly.
export function renderAttributeLine(ctx: LivePanelCtx, token: AttributeToken, d: Derived) {
  const v = ctx.values;
  switch (token) {
    case 'pressure':
      return climateRowPressure(ctx, true, d.dPressure, v.pressureDelta3h ?? null);
    case 'dew_point_humidity':
      return climateRowDewPoint(ctx, true, v.dew_point, true, v.humidity);
    case 'dew_point':
      return climateRowDewPoint(ctx, true, v.dew_point, false, v.humidity);
    case 'humidity':
      return climateRowDewPoint(ctx, false, v.dew_point, true, v.humidity);
    case 'precipitation':
      return climateRowPrecip(ctx, true, isPresent(v.precipitation), v.precipitation, v.precipitation_unit);
    case 'zero_degree_level':
      return climateRowZeroDegree(ctx, true, v.zero_degree_level, v.zero_degree_unit);
    case 'zero_degree_level_48h':
      return climateRowZeroDegree48h(ctx, v.zero_degree_48h_level, v.zero_degree_48h_unit,
        v.zero_degree_48h_change, v.zero_degree_48h_at, v.zero_degree_level);
    case 'next_rain':
      return climateRowNextRain(ctx, v.next_rain_text, v.next_rain_icon, v.next_rain_title);
    case 'uv_illuminance':
      return sunRowSunStrength(ctx, true, true, v.uv_index, v.illuminance, d.lat, d.lon);
    case 'uv_index':
      return sunRowSunStrength(ctx, true, false, v.uv_index, v.illuminance, d.lat, d.lon);
    case 'illuminance':
      return sunRowSunStrength(ctx, false, true, v.uv_index, v.illuminance, d.lat, d.lon);
    case 'sun':
      return sunRowSun(ctx, true);
    case 'moon':
      return renderMoonLine(ctx);
    case 'wind_direction':
      return windRowDirection(ctx, true, v.windDirection);
    case 'wind_speed':
      return windRowSpeed(ctx, true, d.dWindSpeed);
    case 'wind_gust_speed':
      return windRowGust(ctx, true, v.wind_gust_speed);
    default:
      return null;
  }
}

// One layout column → one <div> of line <div>s, or null when every row
// in it is off or unwired (the ADR-0010 "any visible" gate, data-driven).
// A line per <div> rather than inline + <br>: the last row of a column
// used to have no break, so a row appended after it shared its line.
export function renderAttributeColumn(ctx: LivePanelCtx, column: ReadonlyArray<AttributeToken>, d: Derived) {
  const lines = column
    .map((token) => renderAttributeLine(ctx, token, d))
    .filter((tpl) => tpl !== null)
    .map((tpl) => html`<div>${tpl}</div>`);
  if (lines.length === 0) return null;
  return html`<div>${lines}</div>`;
}

export function renderAttributes(ctx: LivePanelCtx) {
  if (ctx.config.show_attributes === false) return html``;
  // An explicit `attributes_layout` wins outright, otherwise the built-in
  // arrangement filtered by the show_* toggles.
  const layout = resolveAttributesLayout(ctx.config);
  const d: Derived = {
    dPressure: displayPressure(ctx, ctx.values.pressure),
    dWindSpeed: displayWindSpeed(ctx, ctx.values.windSpeed),
    // Missing coordinates fall through to the 110 000 lx constant inside
    // classifySunStrength.
    ...siteCoords(ctx),
  };
  return html`
    <div class="attributes">
      ${layout.map((column) => renderAttributeColumn(ctx, column, d))}
    </div>
  `;
}
