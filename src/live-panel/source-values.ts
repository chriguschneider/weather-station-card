// Value text of one live value for the sources popup (ADR-0031). Built
// from the same helpers the rows render with, so the popup shows what
// the row shows. '' = the value is not on screen.

import { formatLux } from '../sun-strength.js';
import { isPresent, shownValue, type LivePanelCtx } from './context.js';
import { dewPointText, humidityText, precipitationText, pressureText } from './climate-rows.js';
import { moonText, sunText, uvText } from './sun-rows.js';
import { windDirText, windSpeedText } from './wind-rows.js';

function finite(v: unknown): number | null {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

type TextFn = (ctx: LivePanelCtx) => string;

const VALUE_TEXT: Record<string, TextFn> = {
  // As the main temperature shows it: no space before the unit.
  temperature: (ctx) => {
    const shown = shownValue(ctx, 'temperature');
    return shown ? `${shown.value}${shown.unit}` : '';
  },
  humidity: ({ values: v }) => (v.humidity === undefined ? '' : humidityText(v.humidity)),
  dew_point: dewPointText,
  pressure: pressureText,
  precipitation: ({ values: v }) =>
    (isPresent(v.precipitation) ? precipitationText(v.precipitation, v.precipitation_unit) : ''),
  uv_index: ({ values: v }) => {
    const uv = finite(v.uv_index);
    return uv === null ? '' : uvText(uv);
  },
  illuminance: ({ values: v }) => {
    const lux = finite(v.illuminance);
    return lux === null ? '' : formatLux(lux);
  },
  wind_speed: (ctx) => windSpeedText(ctx, 'wind_speed'),
  gust_speed: (ctx) => windSpeedText(ctx, 'gust_speed'),
  wind_direction: (ctx) => {
    const dir = ctx.values.windDirection;
    return dir === undefined ? '' : windDirText(ctx.cardinalDirections, dir as number | string);
  },
  sun: (ctx) => sunText(ctx),
  moon: (ctx) => moonText(ctx),
};

export function sourceValueText(ctx: LivePanelCtx, key: string): string {
  return VALUE_TEXT[key]?.(ctx) ?? '';
}
