// Pure formatting / layout helpers used by the chart, testable without Lit or HA.

import { resolveCssVar } from './utils/resolve-css-var.js';

/** Tick-index pair; the caller draws a vertical line midway between the two ticks. */
export type SeparatorPosition = readonly [leftIdx: number, rightIdx: number];

/** Daily uses the doubled-today framing, hourly a single "now" line. */
export type SeparatorMode = 'daily' | 'hourly';

/** Scale a CSS colour's alpha by `factor`. Handles rgb/rgba/hex/hsl/hsla;
 *  other formats (named, oklch, colour-mix(), …) pass through unchanged. */
export function lightenColor(color: unknown, factor: number = 0.45): unknown {
  if (!color || typeof color !== 'string') return color;
  let m = /^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)\s*$/i.exec(color);
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${(a * factor).toFixed(3)})`;
  }
  m = /^hsla?\s*\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)\s*$/i.exec(color);
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return `hsla(${m[1]}, ${m[2]}%, ${m[3]}%, ${(a * factor).toFixed(3)})`;
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${factor.toFixed(3)})`;
  }
  return color;
}

/** True when `color` is dark (luma < 0.5), to pick theme-aware colour defaults:
 *  HA exposes no dark-mode flag to cards, so the resolved
 *  `--card-background-color` stands in. Handles rgb/rgba and hex; anything
 *  else returns false (the light default). */
export function isDarkColor(color: unknown): boolean {
  if (!color || typeof color !== 'string') return false;
  const c = color.trim();
  let r: number, g: number, b: number;
  let m = /^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c);
  if (m) {
    r = parseFloat(m[1]); g = parseFloat(m[2]); b = parseFloat(m[3]);
  } else {
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (!m) return false;
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  // Rec. 601 luma; enough for a binary light/dark split.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

const TEMP2_LEGACY_DEFAULT = 'rgba(68, 115, 158, 1.0)';

/** Low-temperature line colour. Only the default is theme-aware; a user-set
 *  colour passes through `resolveCssVar`. Shared by the chart and the sources popup. */
export function resolveTemp2Color(configured: string | undefined | null, backgroundColor: unknown, host?: Element | null): string {
  const themed = isDarkColor(backgroundColor)
    ? 'rgba(130, 175, 220, 1.0)'
    : 'rgba(38, 90, 140, 1.0)';
  if (!configured || configured === TEMP2_LEGACY_DEFAULT) return themed;
  return resolveCssVar(configured, themed, host);
}

/** First-render scrollLeft for the hourly viewport, clamped to
 *  [0, contentWidth - viewportWidth]: station + forecast centres the boundary,
 *  station-only shows the right edge, forecast-only the left edge. */
export function computeInitialScrollLeft({
  stationCount,
  forecastCount,
  contentWidth,
  viewportWidth,
}: {
  stationCount: number;
  forecastCount: number;
  contentWidth: number;
  viewportWidth: number;
}): number {
  const total = stationCount + forecastCount;
  if (total === 0) return 0;
  if (!Number.isFinite(contentWidth) || !Number.isFinite(viewportWidth)) return 0;
  if (viewportWidth >= contentWidth) return 0;

  let target: number;
  if (stationCount > 0 && forecastCount > 0) {
    const boundaryFraction = stationCount / total;
    target = boundaryFraction * contentWidth - viewportWidth / 2;
  } else if (stationCount > 0) {
    target = contentWidth - viewportWidth;
  } else {
    target = 0;
  }
  if (target < 0) return 0;
  if (target > contentWidth - viewportWidth) return contentWidth - viewportWidth;
  return target;
}

/** Tick-index pairs at which the framing / "now" lines are drawn.
 *
 *  Daily mode (today is a doubled column when both blocks are present):
 *  - Both blocks active: line before station-today + line after forecast-today.
 *  - Station-only:       line before today (rightmost column).
 *  - Forecast-only:      line after today (leftmost column).
 *
 *  Hourly mode (no doubled today — station and forecast meet at "now"):
 *  - Both blocks active: a single "now" line between the last station hour
 *    and the first forecast hour.
 *  - Station-only / Forecast-only: same as daily — anchor "now" against
 *    the chart's own edge.
 *
 *  Empty / single-tick chart: no lines. */
export function computeBlockSeparatorPositions(
  stationCount: number,
  forecastCount: number,
  ticksLength: number,
  mode: SeparatorMode = 'daily',
): SeparatorPosition[] {
  if (!Number.isFinite(ticksLength) || ticksLength < 2) return [];
  const out: SeparatorPosition[] = [];
  if (stationCount > 0 && forecastCount > 0) {
    if (mode === 'hourly') {
      out.push([stationCount - 1, stationCount]);
    } else {
      if (stationCount >= 2) out.push([stationCount - 2, stationCount - 1]);
      if (stationCount + 1 < ticksLength) out.push([stationCount, stationCount + 1]);
    }
  } else if (stationCount > 0) {
    out.push([ticksLength - 2, ticksLength - 1]);
  } else if (forecastCount > 0) {
    out.push([0, 1]);
  }
  return out;
}
