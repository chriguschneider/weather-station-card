import { describe, it, expect } from 'vitest';
import {
  lightenColor,
  isDarkColor,
  computeBlockSeparatorPositions,
  computeInitialScrollLeft,
} from '../src/format-utils.js';

describe('isDarkColor', () => {
  it('classifies HA dark-theme card backgrounds as dark', () => {
    expect(isDarkColor('#1c1c1c')).toBe(true);
    expect(isDarkColor('rgb(28, 28, 28)')).toBe(true);
    expect(isDarkColor('rgba(17, 17, 17, 1)')).toBe(true);
  });

  it('classifies light backgrounds as light', () => {
    expect(isDarkColor('#ffffff')).toBe(false);
    expect(isDarkColor('#fff')).toBe(false);
    expect(isDarkColor('rgb(250, 250, 250)')).toBe(false);
  });

  it('uses perceptual luma, not channel average', () => {
    // Saturated blue is dark despite a maxed channel; yellow is light.
    expect(isDarkColor('rgb(0, 0, 255)')).toBe(true);
    expect(isDarkColor('rgb(255, 215, 0)')).toBe(false);
  });

  it('falls back to light for unparseable input', () => {
    expect(isDarkColor('')).toBe(false);
    expect(isDarkColor('var(--card-background-color)')).toBe(false);
    expect(isDarkColor(undefined)).toBe(false);
    expect(isDarkColor('papayawhip')).toBe(false);
  });
});

describe('lightenColor', () => {
  it('reduces alpha of an rgba colour', () => {
    expect(lightenColor('rgba(132, 209, 253, 1.0)')).toBe('rgba(132, 209, 253, 0.450)');
  });

  it('handles rgb without alpha (treats alpha as 1)', () => {
    expect(lightenColor('rgb(132, 209, 253)')).toBe('rgba(132, 209, 253, 0.450)');
  });

  it('compounds an existing alpha', () => {
    expect(lightenColor('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.225)');
  });

  it('expands a 6-digit hex to rgba', () => {
    expect(lightenColor('#ff8000')).toBe('rgba(255, 128, 0, 0.450)');
  });

  it('expands a 3-digit hex to rgba', () => {
    expect(lightenColor('#f80')).toBe('rgba(255, 136, 0, 0.450)');
  });

  it('honours a custom factor', () => {
    expect(lightenColor('rgba(255, 0, 0, 1.0)', 0.2)).toBe('rgba(255, 0, 0, 0.200)');
  });

  it('reduces alpha of an hsla colour', () => {
    expect(lightenColor('hsla(210, 80%, 60%, 1.0)')).toBe('hsla(210, 80%, 60%, 0.450)');
  });

  it('handles hsl without alpha (treats alpha as 1)', () => {
    expect(lightenColor('hsl(210, 80%, 60%)')).toBe('hsla(210, 80%, 60%, 0.450)');
  });

  it('compounds an existing hsl alpha', () => {
    expect(lightenColor('hsla(0, 100%, 50%, 0.5)')).toBe('hsla(0, 100%, 50%, 0.225)');
  });

  it('returns the input unchanged for unknown formats', () => {
    expect(lightenColor('oklch(0.7 0.15 150)')).toBe('oklch(0.7 0.15 150)');
    expect(lightenColor('red')).toBe('red');
    expect(lightenColor('inherit')).toBe('inherit');
  });

  it('passes through nullish / non-string inputs without throwing', () => {
    expect(lightenColor(null)).toBe(null);
    expect(lightenColor(undefined)).toBe(undefined);
    expect(lightenColor(123)).toBe(123);
    expect(lightenColor('')).toBe('');
  });
});

describe('computeBlockSeparatorPositions', () => {
  it('returns no positions when there are fewer than 2 ticks', () => {
    expect(computeBlockSeparatorPositions(1, 0, 1)).toEqual([]);
    expect(computeBlockSeparatorPositions(0, 0, 0)).toEqual([]);
  });

  it('frames the doubled-today column when both blocks present', () => {
    // station 0..6 (7 cols), forecast 7..13 (7 cols). Today = 6 / 7.
    expect(computeBlockSeparatorPositions(7, 7, 14)).toEqual([
      [5, 6], // before station-today
      [7, 8], // after forecast-today
    ]);
  });

  it('emits only the right line when there is just one station column', () => {
    // station=1, forecast=7 — no left framing because no col before today.
    expect(computeBlockSeparatorPositions(1, 7, 8)).toEqual([
      [1, 2],
    ]);
  });

  it('emits only the left line when forecast-today is the rightmost tick', () => {
    expect(computeBlockSeparatorPositions(7, 1, 8)).toEqual([
      [5, 6],
    ]);
  });

  it('station-only: line before today (rightmost)', () => {
    expect(computeBlockSeparatorPositions(7, 0, 7)).toEqual([
      [5, 6],
    ]);
  });

  it('forecast-only: line after today (leftmost)', () => {
    expect(computeBlockSeparatorPositions(0, 7, 7)).toEqual([
      [0, 1],
    ]);
  });

  it('returns no positions when both counts are zero', () => {
    expect(computeBlockSeparatorPositions(0, 0, 5)).toEqual([]);
  });

  it('handles non-finite ticksLength defensively', () => {
    expect(computeBlockSeparatorPositions(7, 7, NaN)).toEqual([]);
    expect(computeBlockSeparatorPositions(7, 7, undefined)).toEqual([]);
  });

  it('hourly mode: single "now" line between last station hour and first forecast hour', () => {
    // 24 station hours + 24 forecast hours. "Now" sits between idx 23 and 24.
    expect(computeBlockSeparatorPositions(24, 24, 48, 'hourly')).toEqual([
      [23, 24],
    ]);
  });

  it('hourly mode: forecast-only falls back to a single leading edge line', () => {
    expect(computeBlockSeparatorPositions(0, 24, 24, 'hourly')).toEqual([
      [0, 1],
    ]);
  });

  it('hourly mode: station-only falls back to a single trailing edge line', () => {
    expect(computeBlockSeparatorPositions(24, 0, 24, 'hourly')).toEqual([
      [22, 23],
    ]);
  });

  it('default mode is daily (back-compat for callers that omit the parameter)', () => {
    expect(computeBlockSeparatorPositions(7, 7, 14)).toEqual(
      computeBlockSeparatorPositions(7, 7, 14, 'daily'),
    );
  });
});

describe('computeInitialScrollLeft', () => {
  it('returns 0 when nothing is loaded yet', () => {
    expect(computeInitialScrollLeft({
      stationCount: 0, forecastCount: 0, contentWidth: 1000, viewportWidth: 500,
    })).toBe(0);
  });

  it('returns 0 when viewport is wider than content (no scroll possible)', () => {
    expect(computeInitialScrollLeft({
      stationCount: 24, forecastCount: 0, contentWidth: 400, viewportWidth: 600,
    })).toBe(0);
  });

  it('combination: centres boundary in viewport', () => {
    // 24+24, content 4800, viewport 600 → boundary at 50% = 2400, target = 2100.
    expect(computeInitialScrollLeft({
      stationCount: 24, forecastCount: 24, contentWidth: 4800, viewportWidth: 600,
    })).toBe(2100);
  });

  it('combination clamps when boundary is near the edge', () => {
    // 1 station + 23 forecast → boundary at 1/24 ≈ 4.2 % of contentWidth.
    // Target is negative; clamp to 0.
    expect(computeInitialScrollLeft({
      stationCount: 1, forecastCount: 23, contentWidth: 4800, viewportWidth: 600,
    })).toBe(0);
  });

  it('station-only: scrolls to right edge (most recent visible)', () => {
    expect(computeInitialScrollLeft({
      stationCount: 24, forecastCount: 0, contentWidth: 2400, viewportWidth: 600,
    })).toBe(1800);
  });

  it('forecast-only: scrolls to left edge', () => {
    expect(computeInitialScrollLeft({
      stationCount: 0, forecastCount: 24, contentWidth: 2400, viewportWidth: 600,
    })).toBe(0);
  });

  it('handles non-finite dimensions defensively', () => {
    expect(computeInitialScrollLeft({
      stationCount: 24, forecastCount: 24, contentWidth: NaN, viewportWidth: 600,
    })).toBe(0);
  });
});
