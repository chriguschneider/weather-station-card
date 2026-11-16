// Static lookups shared across the card; no DOM, no Lit.

/** HA's standard weather condition IDs.
 *  https://developers.home-assistant.io/docs/core/entity/weather/ */
export type ConditionId =
  | 'clear-night'
  | 'cloudy'
  | 'exceptional'
  | 'fog'
  | 'hail'
  | 'lightning'
  | 'lightning-rainy'
  | 'partlycloudy'
  | 'pouring'
  | 'rainy'
  | 'snowy'
  | 'snowy-rainy'
  | 'sunny'
  | 'windy'
  | 'windy-variant';

const cardinalDirectionsIcon: ReadonlyArray<string> = [
  'arrow-down', 'arrow-bottom-left', 'arrow-left',
  'arrow-top-left', 'arrow-up', 'arrow-top-right',
  'arrow-right', 'arrow-bottom-right', 'arrow-down'
];

const weatherIcons: Readonly<Record<ConditionId, string>> = {
  'clear-night': 'hass:weather-night',
  'cloudy': 'hass:weather-cloudy',
  'exceptional': 'mdi:alert-circle-outline',
  'fog': 'hass:weather-fog',
  'hail': 'hass:weather-hail',
  'lightning': 'hass:weather-lightning',
  'lightning-rainy': 'hass:weather-lightning-rainy',
  'partlycloudy': 'hass:weather-partly-cloudy',
  'pouring': 'hass:weather-pouring',
  'rainy': 'hass:weather-rainy',
  'snowy': 'hass:weather-snowy',
  'snowy-rainy': 'hass:weather-snowy-rainy',
  'sunny': 'hass:weather-sunny',
  'windy': 'hass:weather-windy',
  'windy-variant': 'hass:weather-windy-variant'
};

const WeatherEntityFeature = {
  FORECAST_DAILY: 1,
  FORECAST_HOURLY: 2,
  FORECAST_TWICE_DAILY: 4,
} as const;

/** Floor for the old-HA banner (CalVer `YYYY.M[.patch]`). Conservative on
 *  purpose: the banner only fires below it, so a low value can never
 *  false-fire on a current install. */
const MIN_HA_VERSION = '2023.4';

/** True when `current` is an older HA release than `min`. Only the numeric
 *  `year.month.patch` triple counts, so a beta equals its release. Missing
 *  or unparseable input returns `false`: never warn on a version we failed
 *  to understand. */
function isHaVersionBelow(
  current: string | null | undefined,
  min: string,
): boolean {
  const cur = parseHaVersion(current);
  const lo = parseHaVersion(min);
  if (!cur || !lo) return false;
  for (let i = 0; i < 3; i++) {
    if (cur[i] < lo[i]) return true;
    if (cur[i] > lo[i]) return false;
  }
  return false; // equal — not below
}

/** Parse `YYYY.M[.patch][-suffix]` into `[year, month, patch]`; `null` when
 *  there is no numeric `year.month` head. */
function parseHaVersion(v: string | null | undefined): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  // Leading numeric run only; drops `b3` / `.dev0` / `-alpha` suffixes.
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const patch = m[3] === undefined ? 0 : Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(patch)) {
    return null;
  }
  return [year, month, patch];
}

export {
  cardinalDirectionsIcon,
  weatherIcons,
  WeatherEntityFeature,
  MIN_HA_VERSION,
  isHaVersionBelow,
};
