// Value text of one live value for the sources popup (ADR-0031). Built
// from the same helpers the rows render with, so the popup shows what
// the row shows. '' = the value is not on screen.

import { formatLux } from '../sun-strength.js';
import { isPresent, oneDecimal, type LivePanelCtx } from './context.js';
import { dewPointText, displayPressure, humidityText, precipitationText, pressureText } from './climate-rows.js';
import { moonText, sunText, uvText } from './sun-rows.js';
import { displayWindSpeed, gustSpeed, windDirText, windSpeedText } from './wind-rows.js';

function finite(v: unknown): number | null {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

type TextFn = (ctx: LivePanelCtx, temperatureUnit: string) => string;

const VALUE_TEXT: Record<string, TextFn> = {
  temperature: ({ values: v }, unit) => (v.temperature === undefined ? '' : `${oneDecimal(v.temperature)}${unit}`),
  humidity: ({ values: v }) => (v.humidity === undefined ? '' : humidityText(v.humidity)),
  dew_point: (ctx) => (ctx.values.dew_point === undefined ? '' : dewPointText(ctx, ctx.values.dew_point)),
  pressure: (ctx) => {
    const p = displayPressure(ctx, ctx.values.pressure);
    return p === undefined ? '' : pressureText(ctx, p);
  },
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
  wind_speed: (ctx) => {
    const w = displayWindSpeed(ctx, ctx.values.windSpeed);
    return w === undefined ? '' : windSpeedText(ctx, w);
  },
  gust_speed: (ctx) => {
    const g = gustSpeed(ctx, ctx.values.wind_gust_speed);
    return g === null ? '' : windSpeedText(ctx, g);
  },
  wind_direction: (ctx) => {
    const dir = ctx.values.windDirection;
    return dir === undefined ? '' : windDirText(ctx.cardinalDirections, dir as number | string);
  },
  sun: (ctx) => sunText(ctx),
  moon: (ctx) => moonText(ctx),
};

/** `temperatureUnit` is the main temperature's unit (HA's unit system). */
export function sourceValueText(ctx: LivePanelCtx, key: string, temperatureUnit: string): string {
  return VALUE_TEXT[key]?.(ctx, temperatureUnit) ?? '';
}
