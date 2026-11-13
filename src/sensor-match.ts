// Which entity fits which sensor slot (#451). Shared by the card's
// auto-pick for a new card (`getStubConfig`) and the editor's per-slot
// entity pickers, so the picker always offers the entity the card
// picked.
//
// Each slot has `auto` tiers, tried in order by the auto-pick, and
// `extra` predicates that only widen the picker's list. An auto tier
// that is too loose for a silent pick (any temperature sensor as the
// dew point) belongs in `extra`.

import { findNextRainEntity } from './next-rain.js';

export interface MatchState {
  attributes?: {
    device_class?: unknown;
    unit_of_measurement?: unknown;
    friendly_name?: unknown;
    area_id?: unknown;
  };
  last_changed?: string;
}

export type MatchStates = Record<string, MatchState | undefined>;

type Pred = (id: string, s: MatchState | undefined) => boolean;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const byClass = (...classes: string[]): Pred =>
  (_id, s) => classes.includes(str(s?.attributes?.device_class));
const byId = (re: RegExp): Pred => (id) => re.test(id);
const byIdOrName = (re: RegExp): Pred =>
  (id, s) => re.test(id) || re.test(str(s?.attributes?.friendly_name));
const byUnit = (re: RegExp): Pred => (_id, s) => re.test(str(s?.attributes?.unit_of_measurement));

// Zero-degree level: no device_class, and the metre unit alone would
// sweep in every altitude / distance sensor — match on the name.
const ZERO_DEGREE_NAME = /zero[._ -]?degree|freezing[._ -]?level|nullgrad|snow[._ -]?line/i;
const NEXT_RAIN_NAME = /next[._ -]?rain|n[aä]chster[._ -]?regen/i;

interface SlotMatcher {
  auto: Pred[];
  extra?: Pred[];
}

export const SENSOR_MATCHERS: Readonly<Record<string, SlotMatcher>> = {
  temperature: { auto: [byClass('temperature')] },
  pressure: { auto: [byClass('atmospheric_pressure'), byClass('pressure')] },
  humidity: { auto: [byClass('humidity')] },
  dew_point: { auto: [byId(/dew/)], extra: [byClass('temperature')] },
  // A daily-reset counter first (utility_meter cycle: daily), so the
  // statistics max per day equals the day's rainfall. The loose tier
  // skips `*_precipitation_rate` (Pirateweather and friends): a rate
  // in the counter slot draws garbage bars.
  precipitation: {
    auto: [byId(/precipitation_today/), byId(/precipitation_daily/), byId(/precipitation(?!_rate)/)],
    extra: [byClass('precipitation')],
  },
  // `precipitation_intensity` is the canonical class, but plenty of
  // integrations (Z-Wave POPP, ESPHome templates) ship a rate unit and
  // no class (#253).
  precipitation_rate: {
    auto: [byClass('precipitation_intensity'), byId(/(precipitation_rate|rain_rate)/)],
    extra: [byUnit(/^(mm|in|inch|inches|")\/(h|hr|hour)$/i)],
  },
  wind_speed: { auto: [byClass('wind_speed')], extra: [byClass('speed')] },
  gust_speed: { auto: [byId(/gust/)], extra: [byClass('wind_speed', 'speed')] },
  // No canonical class, but a stable unit (degrees).
  wind_direction: {
    auto: [byId(/(direction|bearing|wind.?dir)/)],
    extra: [byUnit(/^(°|deg)$/)],
  },
  // Solar-irradiance sensors (W/m²) share the slot; the card converts
  // them to lux.
  illuminance: { auto: [byClass('illuminance'), byClass('irradiance')] },
  uv_index: {
    auto: [byId(/uv/)],
    extra: [byIdOrName(/\buv[\s_-]?index\b|\buv\b/i)],
  },
  // Forecast-derived snow-line altitude (MeteoSwiss `zero_degree_level`,
  // Open-Meteo-style `freezing_level_height`).
  zero_degree_level: {
    auto: [byId(/(zero_degree(?!.*48h)|freezing_level|nullgrad)/)],
    extra: [byIdOrName(ZERO_DEGREE_NAME)],
  },
  zero_degree_level_48h: {
    auto: [byId(/zero_degree.*48h/)],
    extra: [byIdOrName(ZERO_DEGREE_NAME)],
  },
  next_rain: { auto: [], extra: [byIdOrName(NEXT_RAIN_NAME)] },
};

/** Slots a new card fills, in the editor's grid order. */
export const AUTO_PICK_KEYS: readonly string[] = Object.keys(SENSOR_MATCHERS);

interface HassForMatch {
  states?: MatchStates;
  entities?: Record<string, unknown>;
}

const sensorIds = (ids: readonly string[]): string[] => ids.filter((id) => id.startsWith('sensor.'));

/** Every entity the picker of `key` offers. Empty for a slot without a
 *  matcher (the picker then lists every sensor). */
export function sensorCandidates(key: string, ids: readonly string[], hass: HassForMatch | null | undefined): string[] {
  const m = SENSOR_MATCHERS[key];
  if (!m) return [];
  const states = hass?.states;
  const preds = [...m.auto, ...(m.extra ?? [])];
  const out = sensorIds(ids).filter((id) => preds.some((p) => p(id, states?.[id])));
  if (key === 'next_rain') {
    // The radar's sensor by registry identity survives an id rename.
    const registry = findNextRainEntity(hass as Parameters<typeof findNextRainEntity>[0]);
    if (registry && !out.includes(registry)) out.unshift(registry);
  }
  return out;
}

// Rank by friendly-name signals (outdoor / garden / weather station
// beats indoor / kitchen) and area, with recent activity as the
// tie-breaker. Unknown entities rank last.
function rankCandidate(id: string, states: MatchStates | undefined, now: number): number {
  const st = states?.[id];
  if (!st) return -1;
  let score = 0;
  const name = str(st.attributes?.friendly_name).toLowerCase();
  if (/\b(outdoor|outside|garden|weather|draussen|aussen|pool)\b/.test(name)) score += 10;
  if (/\b(indoor|inside|drinnen|kitchen|living|bedroom|fridge)\b/.test(name)) score -= 5;
  const areaId = str(st.attributes?.area_id).toLowerCase();
  if (/garden|outdoor|outside/.test(areaId)) score += 5;
  if (st.last_changed && now - new Date(st.last_changed).getTime() < 3_600_000) score += 1;
  return score;
}

function pickRanked(candidates: string[], states: MatchStates | undefined, now: number): string | undefined {
  if (candidates.length <= 1) return candidates[0];
  return candidates
    .map((id) => ({ id, score: rankCandidate(id, states, now) }))
    .sort((a, b) => b.score - a.score)[0].id;
}

/** The entity a new card wires into `key`: the best-ranked match of the
 *  first auto tier that has one, '' when none does. */
export function autoPickSensor(
  key: string,
  ids: readonly string[],
  hass: HassForMatch | null | undefined,
  now: number = Date.now(),
): string {
  if (key === 'next_rain') {
    return findNextRainEntity(hass as Parameters<typeof findNextRainEntity>[0]) || '';
  }
  const m = SENSOR_MATCHERS[key];
  if (!m) return '';
  const states = hass?.states;
  const pool = sensorIds(ids);
  for (const tier of m.auto) {
    const hit = pickRanked(pool.filter((id) => tier(id, states?.[id])), states, now);
    if (hit) return hit;
  }
  return '';
}
