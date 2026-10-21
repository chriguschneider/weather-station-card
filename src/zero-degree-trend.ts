// Zero-degree rows (#333): where the 0 °C isotherm is heading in the
// next 48 h (trend row) and where the estimated snow line sits relative
// to the location (current row). Pure functions, no DOM.
//
// Input is the `forecast` curve of `sensors.zero_degree_level_48h`
// (hourly `{datetime, level}`, parsed by parseZeroDegreeCurve) in the
// sensor's unit; elevations are always metres (HA's `config.elevation`
// and the card's `elevation:` option are metres).
//
// The thresholds below are the card's own heuristics, decided in #333.

import type { ZeroDegreePoint } from './zero-degree-popup.js';

export type ZeroDegreeTrendClass =
  | 'rising_fast'
  | 'rising'
  | 'stable'
  | 'falling'
  | 'falling_fast';

export type SiteState = 'far' | 'near' | 'at' | 'unknown';

export interface ZeroDegreeTrend {
  trend: ZeroDegreeTrendClass;
  /** The extreme the level moves to first; for `stable` the lowest point. */
  target: ZeroDegreePoint;
  /** The opposite movement after the target, when it is significant. */
  next: ZeroDegreePoint | null;
  /** Lowest and highest level in the window (the "stays between" range). */
  min: number;
  max: number;
}

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 48;
// A movement smaller than this is noise at the scale of the model's
// hourly isotherm — the row calls it stable (#333).
const SIGNIFICANT_CHANGE_M = 200;
// Average pace from now to the target that counts as "fast"; 40 m/h is
// roughly 1000 m in a day (#333).
const FAST_PACE_M_PER_H = 40;
// MeteoSwiss rule of thumb: during precipitation the snow line lies
// about 300 m below the zero-degree level (#333). An estimate only.
const SNOW_LINE_OFFSET_M = 300;
// Snow line up to this far above the site counts as "just above you"
// (#333).
const NEAR_BAND_M = 300;
// International foot, exactly 0.3048 m (NIST SP 811, appendix B.8).
const METRES_PER_FOOT = 0.3048;

/** Metres per unit of the zero-degree sensor; anything but `ft` is
 *  taken as metres (the MeteoSwiss sensor reports `m`). */
export function metresPerUnit(unit: string | undefined): number {
  return unit === 'ft' ? METRES_PER_FOOT : 1;
}

/** Five-state tendency of the zero-degree level over the points within
 *  `nowTime … nowTime + 48 h`. `metresPerUnit` converts the curve's
 *  unit for the metre thresholds. Null when the window holds no point. */
export function classifyZeroDegreeTrend(
  curve: readonly ZeroDegreePoint[],
  nowLevel: number,
  nowTime: number,
  unitMetres = 1,
): ZeroDegreeTrend | null {
  if (!Number.isFinite(nowLevel)) return null;
  const end = nowTime + WINDOW_HOURS * HOUR_MS;
  const window = curve.filter((p) => p.t >= nowTime && p.t <= end);
  if (!window.length) return null;

  const { min, max } = findExtremes(window);
  const range = { min: min.level, max: max.level };
  const pick = pickTarget(min, max, nowLevel, unitMetres);
  if (!pick) return { trend: 'stable', target: min, next: null, ...range };

  const trend = paceTrend(pick, nowTime);
  const next = findNext(window, pick.p, pick.falling, unitMetres);
  return { trend, target: pick.p, next, ...range };
}

interface Candidate {
  p: ZeroDegreePoint;
  /** Distance from the current level, in metres. */
  amount: number;
  falling: boolean;
}

function isSignificant(amountMetres: number): boolean {
  return amountMetres >= SIGNIFICANT_CHANGE_M;
}

function findExtremes(window: readonly ZeroDegreePoint[]): { min: ZeroDegreePoint; max: ZeroDegreePoint } {
  let min = window[0];
  let max = window[0];
  for (const p of window) {
    if (p.level < min.level) min = p;
    if (p.level > max.level) max = p;
  }
  return { min, max };
}

// The extreme that comes first wins; the later one only when the
// earlier one is too small to matter.
function pickTarget(
  min: ZeroDegreePoint,
  max: ZeroDegreePoint,
  nowLevel: number,
  unitMetres: number,
): Candidate | undefined {
  const low: Candidate = { p: min, amount: (nowLevel - min.level) * unitMetres, falling: true };
  const high: Candidate = { p: max, amount: (max.level - nowLevel) * unitMetres, falling: false };
  const ordered = min.t <= max.t ? [low, high] : [high, low];
  return ordered.find((c) => isSignificant(c.amount));
}

const TREND_BY_DIRECTION_AND_PACE: Record<'falling' | 'rising', [slow: ZeroDegreeTrendClass, fast: ZeroDegreeTrendClass]> = {
  falling: ['falling', 'falling_fast'],
  rising: ['rising', 'rising_fast'],
};

function paceTrend(pick: Candidate, nowTime: number): ZeroDegreeTrendClass {
  const hours = (pick.p.t - nowTime) / HOUR_MS;
  const fast = hours > 0 && pick.amount / hours >= FAST_PACE_M_PER_H;
  return TREND_BY_DIRECTION_AND_PACE[pick.falling ? 'falling' : 'rising'][fast ? 1 : 0];
}

// The opposite extreme after the target, measured from the target:
// "falls to 1'586 m Thu, then up to 2'556 m Fri".
function findNext(
  window: readonly ZeroDegreePoint[],
  target: ZeroDegreePoint,
  falling: boolean,
  unitMetres: number,
): ZeroDegreePoint | null {
  let next: ZeroDegreePoint | null = null;
  for (const p of window) {
    if (p.t <= target.t) continue;
    const better = !next || (falling ? p.level > next.level : p.level < next.level);
    if (better) next = p;
  }
  if (!next || !isSignificant(Math.abs(next.level - target.level) * unitMetres)) return null;
  return next;
}

const TREND_ICONS: Record<ZeroDegreeTrendClass, string> = {
  // Same arrow family as the pressure tendency (pressure-trend.ts).
  rising_fast: 'mdi:arrow-up',
  rising: 'mdi:arrow-top-right',
  stable: 'mdi:arrow-right',
  falling: 'mdi:arrow-bottom-right',
  falling_fast: 'mdi:arrow-down',
};

export function zeroDegreeTrendIcon(trend: ZeroDegreeTrendClass): string {
  return TREND_ICONS[trend];
}

/** Estimated snow line in the curve's unit. */
export function snowLine(level: number, unitMetres = 1): number {
  return level - SNOW_LINE_OFFSET_M / unitMetres;
}

/** Where the estimated snow line lies relative to the site. `level` is
 *  in the sensor unit, `elevation` in metres. */
export function classifySiteState(
  level: number | undefined,
  elevation: number | undefined,
  unitMetres = 1,
): SiteState {
  if (level === undefined || elevation === undefined
    || !Number.isFinite(level) || !Number.isFinite(elevation)) return 'unknown';
  const line = level * unitMetres - SNOW_LINE_OFFSET_M;
  if (line <= elevation) return 'at';
  if (line <= elevation + NEAR_BAND_M) return 'near';
  return 'far';
}

const SITE_ICONS: Record<SiteState, string> = {
  far: 'mdi:snowflake-thermometer',
  near: 'mdi:snowflake-alert',
  at: 'mdi:snowflake',
  unknown: 'mdi:snowflake-thermometer',
};

export function siteStateIcon(state: SiteState): string {
  return SITE_ICONS[state];
}

/** True when the estimated snow line at `targetLevel` reaches the site. */
export function reachesSite(
  targetLevel: number,
  elevation: number | undefined,
  unitMetres = 1,
): boolean {
  if (elevation === undefined || !Number.isFinite(elevation) || !Number.isFinite(targetLevel)) return false;
  return targetLevel * unitMetres - SNOW_LINE_OFFSET_M <= elevation;
}

function toMetres(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Site elevation in metres: the card's `elevation:` option, else an
 *  `elevation` attribute on the sensors (48 h first, then the current
 *  level — hass-meteoswiss-weather#227), else HA's configured elevation. */
export function resolveElevation(
  config: { elevation?: unknown } | null | undefined,
  sensorAttrs: ReadonlyArray<Record<string, unknown> | null | undefined>,
  hass: { config?: { elevation?: unknown } } | null | undefined,
): number | undefined {
  const fromConfig = toMetres(config?.elevation);
  if (fromConfig !== undefined) return fromConfig;
  for (const attrs of sensorAttrs) {
    const v = toMetres(attrs?.elevation);
    if (v !== undefined) return v;
  }
  return toMetres(hass?.config?.elevation);
}
