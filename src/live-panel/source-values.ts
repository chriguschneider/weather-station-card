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

/** `temperatureUnit` is the main temperature's unit (HA's unit system). */
export function sourceValueText(ctx: LivePanelCtx, key: string, temperatureUnit: string): string {
  const v = ctx.values;
  switch (key) {
    case 'temperature':
      return v.temperature === undefined ? '' : `${oneDecimal(v.temperature)}${temperatureUnit}`;
    case 'humidity':
      return v.humidity === undefined ? '' : humidityText(v.humidity);
    case 'dew_point':
      return v.dew_point === undefined ? '' : dewPointText(ctx, v.dew_point);
    case 'pressure': {
      const p = displayPressure(ctx, v.pressure);
      return p === undefined ? '' : pressureText(ctx, p);
    }
    case 'precipitation':
      return isPresent(v.precipitation) ? precipitationText(v.precipitation, v.precipitation_unit) : '';
    case 'uv_index': {
      const uv = finite(v.uv_index);
      return uv === null ? '' : uvText(uv);
    }
    case 'illuminance': {
      const lux = finite(v.illuminance);
      return lux === null ? '' : formatLux(lux);
    }
    case 'wind_speed': {
      const w = displayWindSpeed(ctx, v.windSpeed);
      return w === undefined ? '' : windSpeedText(ctx, w);
    }
    case 'gust_speed': {
      const g = gustSpeed(ctx, v.wind_gust_speed);
      return g === null ? '' : windSpeedText(ctx, g);
    }
    case 'wind_direction':
      return v.windDirection === undefined
        ? ''
        : windDirText(ctx.cardinalDirections, v.windDirection as number | string);
    case 'sun':
      return sunText(ctx);
    case 'moon':
      return moonText(ctx);
    default:
      return '';
  }
}
