// Unit tests for the 'today' day-pager helpers in forecast-utils
// (ADR-0021): calendar-aligned 3-hour aggregation, the pinned
// viewport size, the current-day scroll target, and leading-empty
// trimming.

import { describe, it, expect } from 'vitest';
import {
  aggregateThreeHourCalendar,
  trimLeadingEmptyBlocks,
  trimTrailingEmptyBlocks,
  effectiveVisibleBars,
  computeDayPageScrollLeft,
  computeTodayPagerScrollLeft,
} from '../src/forecast-utils.js';

/** Local-time hourly entry — the aggregator anchors on LOCAL hours. */
function entry(y, m, d, h, fields = {}) {
  return { datetime: new Date(y, m, d, h).toISOString(), ...fields };
}

describe('aggregateThreeHourCalendar', () => {
  it('returns [] for empty or invalid input', () => {
    expect(aggregateThreeHourCalendar([])).toEqual([]);
    expect(aggregateThreeHourCalendar([{ datetime: 'not-a-date' }])).toEqual([]);
  });

  it('gap-fills every covered day to exactly 8 calendar blocks', () => {
    // Single entry at 13:00 → one whole day, 8 blocks, data in the
    // 12:00 block only.
    const out = aggregateThreeHourCalendar([entry(2026, 7, 5, 13, { temperature: 20 })]);
    expect(out).toHaveLength(8);
    const hours = out.map((b) => new Date(b.datetime).getHours());
    expect(hours).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(out[4].temperature).toBe(20);
    expect(out[0].temperature).toBeNull();
  });

  it('anchors blocks to the local calendar even across source gaps', () => {
    // 01:00 and 22:00 — a large recorder gap in between must NOT
    // shift the evening block: it stays anchored at 21:00.
    const out = aggregateThreeHourCalendar([
      entry(2026, 7, 5, 1, { temperature: 10 }),
      entry(2026, 7, 5, 22, { temperature: 16 }),
    ]);
    expect(out).toHaveLength(8);
    expect(out[0].temperature).toBe(10); // 00-03 block
    expect(out[7].temperature).toBe(16); // 21-24 block
    expect(out.slice(1, 7).every((b) => b.temperature === null)).toBe(true);
  });

  it('spans whole days from first to last entry', () => {
    const out = aggregateThreeHourCalendar([
      entry(2026, 7, 5, 23, { temperature: 12 }),
      entry(2026, 7, 7, 0, { temperature: 14 }),
    ]);
    expect(out).toHaveLength(24); // 3 calendar days × 8 blocks
  });

  it('applies the shared field rules: temp pooled high/low, precip summed, condition mode', () => {
    const out = aggregateThreeHourCalendar([
      entry(2026, 7, 5, 12, { temperature: 18, templow: 12, precipitation: 1.0, condition: 'rainy' }),
      entry(2026, 7, 5, 13, { temperature: 21, precipitation: 0.5, condition: 'rainy' }),
      entry(2026, 7, 5, 14, { temperature: 19, precipitation: 0.2, condition: 'cloudy' }),
    ]);
    const block = out[4]; // 12:00 block
    expect(block.temperature).toBe(21); // pooled max
    expect(block.templow).toBe(12);     // pooled min
    expect(block.precipitation).toBe(1.7);
    expect(block.condition).toBe('rainy');
  });
});

describe('trimLeadingEmptyBlocks', () => {
  const day = (y, m, d, withDataAtHour = null) =>
    aggregateThreeHourCalendar(
      withDataAtHour === null
        ? [entry(y, m, d, 0)] // datetime-only entries → all-null blocks
        : [entry(y, m, d, withDataAtHour, { temperature: 15 })],
    );

  it('drops whole leading empty days', () => {
    // Day 1 entirely empty (datetime-only source), day 2 has data.
    const blocks = [...day(2026, 7, 4), ...day(2026, 7, 5, 9)];
    const out = trimLeadingEmptyBlocks(blocks, false);
    expect(out).toHaveLength(8);
    expect(new Date(out[0].datetime).getDate()).toBe(5);
    // Calendar alignment preserved: first block is the 00:00 block.
    expect(new Date(out[0].datetime).getHours()).toBe(0);
  });

  it('keeps leading empty blocks inside the first day when a station side exists', () => {
    const blocks = day(2026, 7, 5, 18);
    const out = trimLeadingEmptyBlocks(blocks, false);
    expect(out).toHaveLength(8); // 00:00 block kept — page = calendar day
  });

  it('trims to the first data block in forecast-only mode', () => {
    const blocks = day(2026, 7, 5, 18);
    const out = trimLeadingEmptyBlocks(blocks, true);
    expect(new Date(out[0].datetime).getHours()).toBe(18);
    expect(out[0].temperature).toBe(15);
  });

  it('returns a copy even when nothing is trimmed', () => {
    const blocks = day(2026, 7, 5, 0);
    const out = trimLeadingEmptyBlocks(blocks, true);
    expect(out).toEqual(blocks);
    expect(out).not.toBe(blocks);
  });
});

describe('trimTrailingEmptyBlocks', () => {
  it('keeps trailing empty evening blocks when a forecast side exists', () => {
    const blocks = aggregateThreeHourCalendar([entry(2026, 7, 5, 9, { temperature: 15 })]);
    const out = trimTrailingEmptyBlocks(blocks, false);
    expect(out).toHaveLength(8); // page stays a full calendar day
  });

  it('trims to the last data block in station-only mode', () => {
    const blocks = aggregateThreeHourCalendar([
      entry(2026, 7, 5, 3, { temperature: 12 }),
      entry(2026, 7, 5, 14, { temperature: 18 }),
    ]);
    const out = trimTrailingEmptyBlocks(blocks, true);
    // Last kept block is the 12:00 block that holds the 14:00 entry.
    expect(new Date(out[out.length - 1].datetime).getHours()).toBe(12);
    expect(out[out.length - 1].temperature).toBe(18);
  });

  it('returns a copy even when nothing is trimmed', () => {
    const blocks = aggregateThreeHourCalendar([entry(2026, 7, 5, 23, { temperature: 9 })]);
    const out = trimTrailingEmptyBlocks(blocks, true);
    expect(out).toEqual(blocks);
    expect(out).not.toBe(blocks);
  });
});

describe('computeTodayPagerScrollLeft', () => {
  const series = [{ datetime: new Date(2026, 7, 6, 0).toISOString() }];

  it('anchors station-only at the series end (rolling last-24-h window)', () => {
    const left = computeTodayPagerScrollLeft({
      forecasts: series, stationCount: 8, forecastCount: 0,
      contentWidth: 1600, viewportWidth: 400,
    });
    expect(left).toBe(1200);
  });

  it('anchors forecast-only at the series start', () => {
    const left = computeTodayPagerScrollLeft({
      forecasts: series, stationCount: 0, forecastCount: 8,
      contentWidth: 1600, viewportWidth: 400,
    });
    expect(left).toBe(0);
  });

  it("delegates to the current day's page in combination mode", () => {
    const now = new Date(2026, 7, 6, 14, 30);
    const twoDays = aggregateThreeHourCalendar([
      entry(2026, 7, 5, 0, { temperature: 10 }),
      entry(2026, 7, 6, 23, { temperature: 12 }),
    ]);
    const left = computeTodayPagerScrollLeft({
      forecasts: twoDays, stationCount: 10, forecastCount: 6,
      contentWidth: 1600, viewportWidth: 800, now,
    });
    expect(left).toBe(800); // today's midnight block at index 8 of 16
  });

  it('returns null on empty series or invalid width', () => {
    expect(computeTodayPagerScrollLeft({
      forecasts: [], stationCount: 1, forecastCount: 0,
      contentWidth: 800, viewportWidth: 400,
    })).toBeNull();
    expect(computeTodayPagerScrollLeft({
      forecasts: series, stationCount: 1, forecastCount: 0,
      contentWidth: 0, viewportWidth: 400,
    })).toBeNull();
  });
});

describe('effectiveVisibleBars', () => {
  it("pins 'today' to 8 regardless of number_of_forecasts", () => {
    expect(effectiveVisibleBars({ forecast: { type: 'today', number_of_forecasts: 24 } })).toBe(8);
    expect(effectiveVisibleBars({ forecast: { type: 'today' } })).toBe(8);
  });

  it('uses number_of_forecasts elsewhere, 0 for fit-all/invalid', () => {
    expect(effectiveVisibleBars({ forecast: { type: 'hourly', number_of_forecasts: 12 } })).toBe(12);
    expect(effectiveVisibleBars({ forecast: { type: 'daily', number_of_forecasts: '8' } })).toBe(8);
    expect(effectiveVisibleBars({ forecast: { type: 'hourly', number_of_forecasts: 0 } })).toBe(0);
    expect(effectiveVisibleBars({ forecast: { type: 'hourly' } })).toBe(0);
    expect(effectiveVisibleBars(null)).toBe(0);
  });
});

describe('computeDayPageScrollLeft', () => {
  const now = new Date(2026, 7, 6, 14, 30); // Aug 6 local, afternoon
  const twoDays = aggregateThreeHourCalendar([
    entry(2026, 7, 5, 0, { temperature: 10 }),
    entry(2026, 7, 6, 23, { temperature: 12 }),
  ]); // 16 blocks: Aug 5 + Aug 6

  it("puts today's first block at the left edge", () => {
    // Today's midnight block is index 8 of 16 → half the content width.
    expect(computeDayPageScrollLeft(twoDays, 1600, now)).toBe(800);
  });

  it('returns null when no block anchors at today\'s local midnight', () => {
    const yesterdayOnly = twoDays.slice(0, 8);
    expect(computeDayPageScrollLeft(yesterdayOnly, 800, now)).toBeNull();
  });

  it('returns null on empty series or non-positive width', () => {
    expect(computeDayPageScrollLeft([], 800, now)).toBeNull();
    expect(computeDayPageScrollLeft(twoDays, 0, now)).toBeNull();
    expect(computeDayPageScrollLeft(null, 800, now)).toBeNull();
  });
});
