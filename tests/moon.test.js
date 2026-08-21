import { describe, it, expect } from 'vitest';
import {
  moonIllumination,
  moonTimes,
  nextMoonEvent,
  litMoonPath,
} from '../src/moon.js';

// Eclipses are astronomy's free ground truth: a solar eclipse happens
// exactly at new moon, a lunar eclipse exactly at full moon. Four
// well-documented events pin both extremes of the fraction curve.
const NEW_MOONS = [
  new Date(Date.UTC(2017, 7, 21, 18, 26)), // total solar eclipse (USA)
  new Date(Date.UTC(2024, 3, 8, 18, 18)), // total solar eclipse (USA/MX)
];
const FULL_MOONS = [
  new Date(Date.UTC(2015, 8, 28, 2, 47)), // total lunar eclipse (supermoon)
  new Date(Date.UTC(2000, 0, 21, 4, 44)), // total lunar eclipse
];

// Reference site for rise/set: the e2e fixture's coordinates (CH).
const LAT = 46.91;
const LON = 7.42;
const DAY_MS = 86_400_000;

describe('moonIllumination — anchors', () => {
  it('is ~0 at solar eclipses (new moon)', () => {
    for (const d of NEW_MOONS) {
      expect(moonIllumination(d).fraction).toBeLessThan(0.02);
    }
  });

  it('is ~1 at lunar eclipses (full moon)', () => {
    for (const d of FULL_MOONS) {
      expect(moonIllumination(d).fraction).toBeGreaterThan(0.98);
    }
  });

  it('flips waning→waxing across a new moon', () => {
    const at = NEW_MOONS[0].valueOf();
    expect(moonIllumination(new Date(at - DAY_MS)).waxing).toBe(false);
    expect(moonIllumination(new Date(at + DAY_MS)).waxing).toBe(true);
  });

  it('flips waxing→waning across a full moon', () => {
    const at = FULL_MOONS[0].valueOf();
    expect(moonIllumination(new Date(at - DAY_MS)).waxing).toBe(true);
    expect(moonIllumination(new Date(at + DAY_MS)).waxing).toBe(false);
  });

  it('matches HA\'s Moon integration for Aug 2026 (waxing gibbous on the 21st)', () => {
    // Cross-checked against the official integration's history: new
    // moon Aug 12, first quarter Aug 19/20, waxing gibbous from Aug 20.
    const out = moonIllumination(new Date(Date.UTC(2026, 7, 21, 12, 0)));
    expect(out.waxing).toBe(true);
    expect(out.fraction).toBeGreaterThan(0.5);
    expect(out.fraction).toBeLessThan(0.85);
  });

  it('stays within [0, 1] and swings full range over a synodic month', () => {
    let min = 1;
    let max = 0;
    const start = Date.UTC(2026, 0, 1);
    for (let h = 0; h < 30 * 24; h += 6) {
      const f = moonIllumination(new Date(start + h * 3_600_000)).fraction;
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      min = Math.min(min, f);
      max = Math.max(max, f);
    }
    expect(min).toBeLessThan(0.03);
    expect(max).toBeGreaterThan(0.97);
  });
});

describe('moonTimes / nextMoonEvent', () => {
  it('yields at most one rise and one set per day, roughly alternating', () => {
    let rises = 0;
    let sets = 0;
    const start = Date.UTC(2026, 2, 1, 12, 0);
    for (let day = 0; day < 60; day++) {
      const t = moonTimes(new Date(start + day * DAY_MS), LAT, LON);
      if (t.rise) rises++;
      if (t.set) sets++;
    }
    // ~50 min daily drift → ≥1 skip day per lunation, never more than
    // two in 60 days; rise and set skip independently.
    expect(rises).toBeGreaterThanOrEqual(56);
    expect(rises).toBeLessThanOrEqual(60);
    expect(sets).toBeGreaterThanOrEqual(56);
    expect(sets).toBeLessThanOrEqual(60);
  });

  it('consecutive moonrises drift by the lunar day (~24 h 50 min)', () => {
    const rises = [];
    const start = Date.UTC(2026, 4, 1, 12, 0);
    for (let day = 0; day < 30; day++) {
      const t = moonTimes(new Date(start + day * DAY_MS), LAT, LON);
      if (t.rise) rises.push(t.rise.valueOf());
    }
    for (let i = 1; i < rises.length; i++) {
      const gapH = (rises[i] - rises[i - 1]) / 3_600_000;
      // One skip day doubles the gap; anything outside these bands
      // means the root-finder produced a phantom or missed crossing.
      const singleGap = gapH > 23 && gapH < 27.5;
      const skipGap = gapH > 46 && gapH < 55;
      expect(singleGap || skipGap).toBe(true);
    }
  });

  it('nextMoonEvent returns a strictly future event and alternates kinds', () => {
    let now = new Date(Date.UTC(2026, 7, 21, 12, 0));
    let prev;
    for (let i = 0; i < 8; i++) {
      const ev = nextMoonEvent(now, LAT, LON);
      expect(ev).toBeDefined();
      expect(ev.time.valueOf()).toBeGreaterThan(now.valueOf());
      if (prev) expect(ev.kind).not.toBe(prev.kind);
      prev = ev;
      now = new Date(ev.time.valueOf() + 60_000);
    }
  });
});

describe('litMoonPath — terminator geometry', () => {
  it('crescent bulges toward the lit limb, gibbous away from it', () => {
    // Sweep flags: limb flag mirrors the lit side; the terminator flag
    // equals it for gibbous and inverts for crescent.
    expect(litMoonPath(0.25, true)).toContain('A 9.5 9.5 0 0 1');
    expect(litMoonPath(0.25, true)).toContain('A 4.750 9.5 0 0 0');
    expect(litMoonPath(0.75, true)).toContain('A 4.750 9.5 0 0 1');
    expect(litMoonPath(0.25, false)).toContain('A 9.5 9.5 0 0 0');
    expect(litMoonPath(0.25, false)).toContain('A 4.750 9.5 0 0 1');
  });

  it('quarter moon has a straight terminator (rx 0), full moon a full-radius one', () => {
    expect(litMoonPath(0.5, true)).toContain('A 0.000 9.5');
    expect(litMoonPath(1, true)).toContain('A 9.500 9.5 0 0 1');
  });
});
