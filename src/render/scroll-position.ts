// Scroll-position math of the forecast block (#472): the initial "scroll
// to now" target and the day-pager realignment. Pure functions over the
// wrapper's measured sizes; main.ts reads the DOM, owns the settle
// observer and writes `scrollLeft`.

import { computeInitialScrollLeft } from '../format-utils.js';
import { computeTodayPagerScrollLeft, effectiveVisibleBars } from '../forecast-utils.js';
import type { Calendar } from '../utils/time-zone.js';

export interface ScrollConfig {
  show_station?: unknown;
  show_forecast?: unknown;
  weather_entity?: unknown;
  forecast?: { type?: string; number_of_forecasts?: number | string } | null;
}

/** Wait until every block the card intends to render has data. The
 *  forecast subscription usually answers before the recorder; applying
 *  the scroll then would pin the forecast-only position (0) and a
 *  combination card would open at the start of the station history. */
export function initialScrollDataReady(
  cfg: ScrollConfig | null | undefined,
  stationCount: number,
  forecastCount: number,
): boolean {
  const c = cfg || {};
  const wantsStation = c.show_station !== false;
  const wantsForecast = c.show_forecast === true && !!c.weather_entity;
  return (!wantsStation || stationCount > 0) && (!wantsForecast || forecastCount > 0);
}

/** The scroll re-applies when this changes; outside it the user's own
 *  scroll position survives the hourly data refreshes. */
export function initialScrollGeneration(cfg: ScrollConfig | null | undefined): string {
  const fc = cfg?.forecast || {};
  return `${fc.type || 'daily'}|${fc.number_of_forecasts || 0}`;
}

export interface InitialScrollInputs {
  config: ScrollConfig | null | undefined;
  forecasts: ReadonlyArray<unknown> | null | undefined;
  stationCount: number;
  forecastCount: number;
  scrollWidth: number;
  clientWidth: number;
  calendar: Calendar;
}

/** The scrollLeft to apply, or null while the layout has not settled. */
export function resolveInitialScrollLeft(inputs: InitialScrollInputs): number | null {
  const { scrollWidth, clientWidth, stationCount, forecastCount } = inputs;
  // Lit's updateComplete guarantees the DOM commit, not that layout has
  // measured `.forecast-content`'s `width: <pct>%` or that the canvas is
  // sized: at first paint scrollWidth can still equal clientWidth.
  if (scrollWidth <= clientWidth) return null;
  // On a mode toggle drawChart's rAF can run before Lit commits the new
  // pct, so the PREVIOUS mode's width would be measured with the NEW
  // counts. Bail when the width doesn't match what totalBars implies; a
  // later resize picks it up. The 10 % tolerance covers sub-pixel
  // rounding and stays far under the daily ↔ hourly width delta.
  const totalBars = stationCount + forecastCount;
  const visibleBars = effectiveVisibleBars(inputs.config);
  if (totalBars > 0 && visibleBars > 0 && totalBars > visibleBars) {
    const expected = clientWidth * (totalBars / visibleBars);
    if (Math.abs(scrollWidth - expected) > expected * 0.1) return null;
  }
  // Day pager: never open on a half-empty page. Station-only anchors at
  // the series end, forecast-only at the start, combination on today's
  // page; falls back to the boundary-centred position (e.g. clock skew).
  const dayPage = inputs.config?.forecast?.type === 'today'
    ? computeTodayPagerScrollLeft({
        forecasts: inputs.forecasts as Parameters<typeof computeTodayPagerScrollLeft>[0]['forecasts'],
        stationCount,
        forecastCount,
        contentWidth: scrollWidth,
        viewportWidth: clientWidth,
      }, inputs.calendar)
    : null;
  return dayPage ?? computeInitialScrollLeft({
    stationCount,
    forecastCount,
    contentWidth: scrollWidth,
    viewportWidth: clientWidth,
  });
}

/** Day-pager self-healing: a refresh that reshapes the content (a new
 *  day after midnight, a longer provider forecast) keeps the pixel
 *  scrollLeft, which then lands mid-page. Returns the nearest whole-day
 *  page, or null when already aligned (2 px slack) or not scrollable. */
export function dayPagerRealignLeft(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): number | null {
  const w = clientWidth;
  if (w <= 0 || scrollWidth <= w) return null;
  const offset = scrollLeft % w;
  if (offset <= 2 || offset >= w - 2) return null;
  const maxLeft = scrollWidth - w;
  return Math.min(maxLeft, Math.max(0, Math.round(scrollLeft / w) * w));
}
