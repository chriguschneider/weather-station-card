// "Next rain" live row (`sensors.next_rain`). Reads the MeteoSwiss radar
// nowcast schema — `at` (ISO timestamp), `source` (radar | forecast),
// `checked_until` — and formats it card-side: the sensor's own state is
// a sentence in the HA server language that is only recomputed every
// five minutes, so "12 min" would go stale and ignore the card language.
// Any other sensor in the slot still works: a timestamp sensor is read
// like `at`, everything else shows its state verbatim.
//
// Pure — no Lit. main.ts owns the tick and the rendering; the editor
// uses the detection helpers.

import { getDateTimeFormat } from './utils/intl-cache.js';

/** 'station' = the card's own live rain rate said it is raining; the
 *  radar sensor was overruled (or absent). */
export type NextRainSource = 'radar' | 'forecast' | 'station' | '';

export type NextRainView =
  | { kind: 'now'; source: NextRainSource }
  | { kind: 'minutes'; minutes: number; source: NextRainSource }
  | { kind: 'time'; at: Date; withWeekday: boolean; source: NextRainSource }
  | { kind: 'none'; until: Date }
  | { kind: 'text'; text: string };

export interface NextRainStateLike {
  state?: string;
  attributes?: Record<string, unknown>;
}

export interface NextRainStrings {
  now: string;
  none: string;
  /** Carries a `{time}` placeholder. */
  checked_until: string;
}

// Same thresholds as the integration's own text, so the card and the
// device page never disagree on the shape of the answer.
const MINUTES_ONLY_MS = 60 * 60_000;
const CLOCK_ONLY_MS = 24 * 60 * 60_000;

// Platform + translation key are stable across entity-id renames, which
// is why detection prefers them over the id pattern.
export const RADAR_PLATFORM = 'meteoswiss_radar';
const NEXT_RAIN_TRANSLATION_KEY = 'next_rain';
const NEXT_RAIN_ID_PATTERN = /next_rain/;

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const NO_VALUE = new Set(['', 'unknown', 'unavailable']);

function sourceOf(attrs: Record<string, unknown>): NextRainSource {
  return attrs.source === 'radar' || attrs.source === 'forecast' ? attrs.source : '';
}

function viewAt(at: number, now: number, source: NextRainSource): NextRainView {
  const delta = at - now;
  if (delta <= 0) return { kind: 'now', source };
  // An hourly model answer never becomes a countdown — "in 40 min"
  // would claim a precision the forecast doesn't have.
  if (source !== 'forecast' && delta < MINUTES_ONLY_MS) {
    return { kind: 'minutes', minutes: Math.ceil(delta / 60_000), source };
  }
  return { kind: 'time', at: new Date(at), withWeekday: delta > CLOCK_ONLY_MS, source };
}

export function classifyNextRain(
  stateObj: NextRainStateLike | undefined,
  now: number,
  rainingNow = false,
): NextRainView | null {
  // A measured rain rate above zero beats everything the sensor says:
  // the radar's 1 km pixel and the hourly model can both miss a shower
  // that is wetting the station right now, and "No rain" next to
  // "1.4 mm/h" reads as a bug. Checked before the unavailable guard —
  // first-hand measurement needs no sensor to confirm it.
  if (rainingNow) return { kind: 'now', source: 'station' };
  const raw = stateObj?.state;
  if (raw === undefined || NO_VALUE.has(raw)) return null;
  const attrs = stateObj?.attributes ?? {};

  const at = parseTime(attrs.at) ?? (attrs.device_class === 'timestamp' ? parseTime(raw) : null);
  if (at !== null) return viewAt(at, now, sourceOf(attrs));

  // "No rain" is only worth more than the state text when we know how
  // far the search reached.
  const until = parseTime(attrs.checked_until);
  if (until !== null && until > now) return { kind: 'none', until: new Date(until) };
  return { kind: 'text', text: raw };
}

function formatClock(date: Date, withWeekday: boolean, language: string, hour12: boolean | undefined): string {
  return getDateTimeFormat(language, {
    ...(withWeekday ? { weekday: 'short' } : {}),
    hour: 'numeric',
    minute: 'numeric',
    hour12,
  }).format(date);
}

export function formatNextRain(
  view: NextRainView,
  language: string,
  hour12: boolean | undefined,
  strings: NextRainStrings,
): string {
  switch (view.kind) {
    case 'now':
      return strings.now;
    case 'minutes':
      return new Intl.RelativeTimeFormat(language, { style: 'short', numeric: 'always' })
        .format(view.minutes, 'minute');
    case 'time': {
      const clock = formatClock(view.at, view.withWeekday, language, hour12);
      return view.source === 'forecast' ? `~${clock}` : clock;
    }
    case 'none':
      return strings.none;
    case 'text':
      return view.text;
  }
}

/** Tooltip for the dry case: how far the forecast was searched. The
 *  horizon is the end of the model run, not a weather event, so it
 *  stays out of the row text. */
export function formatCheckedUntil(
  view: NextRainView,
  now: number,
  language: string,
  hour12: boolean | undefined,
  strings: NextRainStrings,
): string {
  if (view.kind !== 'none') return '';
  const withWeekday = view.until.getTime() - now > CLOCK_ONLY_MS;
  return strings.checked_until.replace('{time}', formatClock(view.until, withWeekday, language, hour12));
}

export function nextRainIcon(view: NextRainView): string {
  switch (view.kind) {
    case 'none':
      return 'mdi:umbrella-closed-outline';
    case 'minutes':
    case 'time':
      if (view.source === 'radar') return 'mdi:radar';
      if (view.source === 'forecast') return 'mdi:weather-cloudy-clock';
      return 'mdi:weather-pouring';
    default:
      return 'mdi:weather-pouring';
  }
}

interface RegistryEntryLike {
  platform?: string;
  translation_key?: string;
}

export interface HassLike {
  entities?: Record<string, RegistryEntryLike | undefined>;
  states?: Record<string, unknown>;
  config?: { components?: ReadonlyArray<string> };
}

/** The radar's "next rain" sensor, found by registry identity first and
 *  by entity-id pattern second (other integrations, older HA). */
export function findNextRainEntity(hass: HassLike | null | undefined): string | undefined {
  const entities = hass?.entities ?? {};
  for (const [eid, entry] of Object.entries(entities)) {
    if (entry?.platform === RADAR_PLATFORM && entry.translation_key === NEXT_RAIN_TRANSLATION_KEY) {
      return eid;
    }
  }
  return Object.keys(hass?.states ?? {})
    .find((eid) => eid.startsWith('sensor.') && NEXT_RAIN_ID_PATTERN.test(eid));
}

/** True when the radar integration is loaded but exposes no "next rain"
 *  sensor — its nowcast entities are opt-in, so this is the common case
 *  for users who installed it for the map. */
export function radarNowcastDisabled(hass: HassLike | null | undefined): boolean {
  const components = hass?.config?.components ?? [];
  if (!components.includes(RADAR_PLATFORM)) return false;
  return findNextRainEntity(hass) === undefined;
}
