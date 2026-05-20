// Static lookups shared across the card. Pure data — no DOM, no Lit.

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

/** Minimum Home Assistant version the card is verified against.
 *
 *  Conservative on purpose: this is a known-good floor, not the latest
 *  release. HA uses CalVer (`YYYY.M[.patch]`). 2023.4 shipped in April
 *  2023 — well over two years before this card's v2.0. By then the
 *  custom-card surface this card depends on (`hass.states`,
 *  `hass.config`, the `weather` forecast-feature flags, `ha-card` /
 *  `ha-icon`) had long stabilised. Anyone still on an HA older than
 *  that has skipped 30+ monthly releases and is far outside the
 *  population that installs cards from HACS today. The banner only
 *  fires *below* this floor, so a too-low value simply means the banner
 *  never helps anyone — it can never false-fire on a current install. */
const MIN_HA_VERSION = '2023.4';

/** True when `current` is an older HA release than `min`.
 *
 *  HA version strings are CalVer: `YYYY.M` or `YYYY.M.patch`, sometimes
 *  with a suffix (`2024.1.0b3`, `2024.1.0.dev0`). We compare only the
 *  numeric `year.month.patch` triple; any trailing suffix is ignored
 *  (a beta of a release is treated as that release — not "below").
 *
 *  Defensive by contract: missing or unparseable input returns `false`
 *  ("don't know → don't warn"). The caller must never show a
 *  compatibility banner on a version it failed to understand, because a
 *  false-fire on a perfectly current install is worse than a missed
 *  warning on a genuinely ancient one. */
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

/** Parse `YYYY.M[.patch][-suffix]` into a `[year, month, patch]` tuple.
 *  Returns `null` for missing input or anything without a numeric
 *  `year.month` head. Never throws. */
function parseHaVersion(v: string | null | undefined): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  // Take the leading numeric dotted run; drop any `b3` / `.dev0` /
  // `-alpha` suffix. `2024.1.0b3` → `2024.1.0`, `2024.1` → `2024.1`.
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
