// Pure formatting / layout helpers used by the chart. Kept in their own
// module so they can be unit-tested without pulling in Lit, Chart.js, or HA.

/** Tick-index pair returned by `computeBlockSeparatorPositions`. The
 *  caller draws a vertical line at the midpoint between those two
 *  ticks (e.g. `(getPixelForTick(left) + getPixelForTick(right)) / 2`). */
export type SeparatorPosition = readonly [leftIdx: number, rightIdx: number];

/** Forecast block mode for separator positioning — daily uses the
 *  doubled-today framing, hourly uses a single "now" line. */
export type SeparatorMode = 'daily' | 'hourly';

/** Reduce a CSS colour to ~`factor` of its original alpha. Used to render
 *  forecast precipitation bars at lower opacity than the measured station
 *  bars next to them. Handles rgb/rgba/hex/hsl/hsla — the shapes either
 *  the editor or a hand-written YAML config can produce. Other formats
 *  (named colours, oklch, colour-mix(), …) pass through unchanged so no
 *  exception escapes into the render path. */
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

/** True when `color` is perceptually dark (luma < 0.5). Used to pick
 *  theme-aware colour DEFAULTS (e.g. the low-temp line, community
 *  post 15): HA exposes no explicit dark-mode flag to cards, but the
 *  resolved `--card-background-color` luma is a reliable proxy.
 *  Handles rgb/rgba and hex; anything unparseable (empty string,
 *  var() leftovers, named colours) returns false — the light-theme
 *  default is the safe fallback. */
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
  // Rec. 601 luma — perceptual weighting is enough for a binary
  // light/dark split; no need for linearised sRGB here.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/** Decide where to scroll the hourly viewport on first render so the user
 *  lands at a useful position rather than "the start of all loaded data".
 *
 *    combination   → centre the station/forecast boundary in the viewport.
 *    station-only  → right edge (most recent hour visible).
 *    forecast-only → left edge (next hours visible).
 *    all-visible   → 0 (no scrolling possible anyway).
 *
 *  Returns a scrollLeft value clamped to [0, contentWidth - viewportWidth].
 *  Pure function — caller reads `scrollWidth` and `clientWidth` from the
 *  scroll container after layout and feeds them in. */
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

/** Compute the tick-index pairs at which the chart's framing / "now"
 *  lines should be drawn. Returns an array of `[leftIdx, rightIdx]`
 *  pairs; the caller draws a vertical line at the midpoint between
 *  those two ticks.
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
      // The "now" boundary sits between index (stationCount - 1) and
      // index stationCount. One line, centred between those ticks.
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
