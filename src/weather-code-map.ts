// WMO weather-code → card ConditionId lookup.
//
// Open-Meteo reports each day's weather as a WMO 4677 code
// (https://open-meteo.com/en/docs — "Weather variable documentation").
// The card draws condition icons from Home Assistant's own condition
// vocabulary (`ConditionId` in const.ts), so the Open-Meteo past block
// needs a translation table — the same shape unit conversions get
// (ADR-0009): pure data, auditable at a glance, a one-line edit to
// extend.
//
// Deliberately avoids `lightning` / `lightning-rainy` / `hail`. The
// card's own day-classifier never emits those conditions, so mapping
// Open-Meteo's thunderstorm / hail codes onto them would introduce
// icons the rest of the card never shows. Thunderstorm codes therefore
// map to `pouring` — the nearest heavy-precipitation condition the card
// does emit. (Otherwise this matches Home Assistant's own `open_meteo`
// integration mapping.)

import type { ConditionId } from './const.js';

/** WMO 4677 weather code → card ConditionId. Codes absent from the
 *  table fall through to `cloudy` in `wmoToCondition` — a neutral
 *  default that never implies precipitation or an alert the data did
 *  not actually report. */
export const WMO_CONDITION: Readonly<Record<number, ConditionId>> = {
  0: 'sunny', // clear sky
  1: 'sunny', // mainly clear
  2: 'partlycloudy', // partly cloudy
  3: 'cloudy', // overcast
  45: 'fog', // fog
  48: 'fog', // depositing rime fog
  51: 'rainy', // drizzle: light
  53: 'rainy', // drizzle: moderate
  55: 'rainy', // drizzle: dense
  56: 'snowy-rainy', // freezing drizzle: light
  57: 'snowy-rainy', // freezing drizzle: dense
  61: 'rainy', // rain: slight
  63: 'rainy', // rain: moderate
  65: 'pouring', // rain: heavy
  66: 'snowy-rainy', // freezing rain: light
  67: 'snowy-rainy', // freezing rain: heavy
  71: 'snowy', // snow fall: slight
  73: 'snowy', // snow fall: moderate
  75: 'snowy', // snow fall: heavy
  77: 'snowy', // snow grains
  80: 'rainy', // rain showers: slight
  81: 'rainy', // rain showers: moderate
  82: 'pouring', // rain showers: violent
  85: 'snowy', // snow showers: slight
  86: 'snowy', // snow showers: heavy
  95: 'pouring', // thunderstorm: slight or moderate
  96: 'pouring', // thunderstorm with slight hail
  99: 'pouring', // thunderstorm with heavy hail
};

/** Map a WMO weather code to a card ConditionId. Non-numeric, NaN, or
 *  unknown input returns `cloudy` — a neutral fallback. */
export function wmoToCondition(code: number | null | undefined): ConditionId {
  if (typeof code !== 'number' || !Number.isFinite(code)) return 'cloudy';
  return WMO_CONDITION[code] ?? 'cloudy';
}
