// Zero-degree trend and site state (#333).

import { describe, it, expect } from 'vitest';
import {
  classifyZeroDegreeTrend,
  classifySiteState,
  reachesSite,
  resolveElevation,
  metresPerUnit,
  snowLine,
  siteStateIcon,
  zeroDegreeTrendIcon,
} from '../src/zero-degree-trend.js';

const H = 3_600_000;
const ms = (iso) => Date.parse(iso);

// Hourly curve through the issue's figures (#333): 2'506 m on Wed
// 21 Oct 07:00, down to 1'586 m on Thu 05:00, up to 2'556 m on Fri 06:00,
// then easing to 2'300 m by Sat 12:00. Linear between the anchors.
const ANCHORS = [
  [ms('2026-10-21T07:00:00+02:00'), 2506],
  [ms('2026-10-22T05:00:00+02:00'), 1586],
  [ms('2026-10-23T06:00:00+02:00'), 2556],
  [ms('2026-10-24T12:00:00+02:00'), 2300],
];
function buildCurve(anchors) {
  const out = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [t0, l0] = anchors[i];
    const [t1, l1] = anchors[i + 1];
    for (let t = t0; t < t1; t += H) {
      out.push({ t, level: Math.round(l0 + ((l1 - l0) * (t - t0)) / (t1 - t0)) });
    }
  }
  const [tl, ll] = anchors[anchors.length - 1];
  out.push({ t: tl, level: ll });
  return out;
}
const CURVE = buildCurve(ANCHORS);
const levelAt = (t) => CURVE.find((p) => p.t === t).level;

describe('classifyZeroDegreeTrend', () => {
  it('today: falls fast to 1586 m Thu 05:00, then up to 2556 m Fri 06:00', () => {
    const now = ANCHORS[0][0];
    const r = classifyZeroDegreeTrend(CURVE, 2506, now);
    expect(r.trend).toBe('falling_fast');
    expect(r.target).toEqual({ t: ms('2026-10-22T05:00:00+02:00'), level: 1586 });
    expect(r.next).toEqual({ t: ms('2026-10-23T06:00:00+02:00'), level: 2556 });
    expect(zeroDegreeTrendIcon(r.trend)).toBe('mdi:arrow-down');
  });

  it('20 h later: rises to 2556 m Fri 06:00 (the nearby minimum is too small)', () => {
    const now = ANCHORS[0][0] + 20 * H;
    const r = classifyZeroDegreeTrend(CURVE, levelAt(now), now);
    expect(r.trend).toBe('rising');
    expect(r.target).toEqual({ t: ms('2026-10-23T06:00:00+02:00'), level: 2556 });
    // The window ends Sat 03:00; the dip after Fri stays under 200 m.
    expect(r.next).toBeNull();
    expect(zeroDegreeTrendIcon(r.trend)).toBe('mdi:arrow-top-right');
  });

  it('a flat curve is stable, target = the window minimum, range reported', () => {
    const t0 = ANCHORS[0][0];
    const flat = [0, 6, 12, 24, 36].map((h, i) => ({ t: t0 + h * H, level: [2500, 2450, 2600, 2480, 2550][i] }));
    const r = classifyZeroDegreeTrend(flat, 2500, t0);
    expect(r.trend).toBe('stable');
    expect(r.target).toEqual(flat[1]);
    expect(r.next).toBeNull();
    expect([r.min, r.max]).toEqual([2450, 2600]);
    expect(zeroDegreeTrendIcon(r.trend)).toBe('mdi:arrow-right');
  });

  it('both extremes under 200 m stay stable', () => {
    const t0 = 0;
    const curve = [{ t: 0, level: 2000 }, { t: 5 * H, level: 1801 }, { t: 10 * H, level: 2199 }];
    expect(classifyZeroDegreeTrend(curve, 2000, t0).trend).toBe('stable');
  });

  it('the earlier extreme wins when it reaches 200 m, even if the later one is larger', () => {
    const curve = [{ t: 0, level: 2000 }, { t: 10 * H, level: 2300 }, { t: 30 * H, level: 1000 }];
    const r = classifyZeroDegreeTrend(curve, 2000, 0);
    expect(r.trend).toBe('rising');
    expect(r.target.level).toBe(2300);
    expect(r.next.level).toBe(1000);
  });

  it('pace: >= 40 m/h is fast, exactly at the boundary too', () => {
    const fast = classifyZeroDegreeTrend([{ t: 0, level: 2000 }, { t: 10 * H, level: 2400 }], 2000, 0);
    expect(fast.trend).toBe('rising_fast');
    const slow = classifyZeroDegreeTrend([{ t: 0, level: 2000 }, { t: 10 * H, level: 1610 }], 2000, 0);
    expect(slow.trend).toBe('falling');
    expect(zeroDegreeTrendIcon('rising_fast')).toBe('mdi:arrow-up');
    expect(zeroDegreeTrendIcon('falling')).toBe('mdi:arrow-bottom-right');
  });

  it('an extreme at "now" is never fast', () => {
    const r = classifyZeroDegreeTrend([{ t: 0, level: 1500 }, { t: 10 * H, level: 1600 }], 2000, 0);
    expect(r.trend).toBe('falling');
    expect(r.target.t).toBe(0);
  });

  it('ignores points before now and after 48 h', () => {
    const curve = [{ t: -H, level: 500 }, { t: 0, level: 2000 }, { t: 49 * H, level: 500 }];
    expect(classifyZeroDegreeTrend(curve, 2000, 0).trend).toBe('stable');
    expect(classifyZeroDegreeTrend(curve, 2000, 50 * H)).toBeNull();
  });

  it('feet: thresholds scale with the unit', () => {
    const per = metresPerUnit('ft');
    expect(per).toBe(0.3048);
    // 600 ft ≈ 183 m — under the 200 m threshold.
    const curve = [{ t: 0, level: 7000 }, { t: 10 * H, level: 6400 }];
    expect(classifyZeroDegreeTrend(curve, 7000, 0, per).trend).toBe('stable');
    expect(classifyZeroDegreeTrend(curve, 7000, 0, 1).trend).toBe('falling_fast');
    expect(metresPerUnit('m')).toBe(1);
    expect(metresPerUnit(undefined)).toBe(1);
  });

  it('falling then rising, rising then falling, all four pace/direction classes', () => {
    const rf = classifyZeroDegreeTrend([{ t: 0, level: 2000 }, { t: 10 * H, level: 2300 }, { t: 20 * H, level: 2000 }], 2000, 0);
    expect(rf.trend).toBe('rising');
    expect(rf.next).toEqual({ t: 20 * H, level: 2000 });
    const ff = classifyZeroDegreeTrend([{ t: 0, level: 2000 }, { t: 5 * H, level: 1700 }], 2000, 0);
    expect(ff.trend).toBe('falling_fast');
    expect(ff.next).toBeNull();
    const rs = classifyZeroDegreeTrend([{ t: 0, level: 2000 }, { t: 20 * H, level: 2300 }], 2000, 0);
    expect(rs.trend).toBe('rising');
  });

  it('non-finite now level yields null', () => {
    expect(classifyZeroDegreeTrend(CURVE, NaN, ANCHORS[0][0])).toBeNull();
  });
});

describe('classifySiteState', () => {
  // Elevation 581 m: snow line = level − 300.
  it('boundaries', () => {
    expect(classifySiteState(1181, 581)).toBe('near'); // line 881 = elev + 300
    expect(classifySiteState(1182, 581)).toBe('far');
    expect(classifySiteState(882, 581)).toBe('near'); // line 582
    expect(classifySiteState(881, 581)).toBe('at'); // line 581 = elev
    expect(classifySiteState(500, 581)).toBe('at');
  });

  it('missing input is unknown', () => {
    expect(classifySiteState(undefined, 581)).toBe('unknown');
    expect(classifySiteState(2000, undefined)).toBe('unknown');
    expect(classifySiteState(NaN, 581)).toBe('unknown');
  });

  it('icons', () => {
    expect(siteStateIcon('far')).toBe('mdi:snowflake-thermometer');
    expect(siteStateIcon('near')).toBe('mdi:snowflake-alert');
    expect(siteStateIcon('at')).toBe('mdi:snowflake');
    expect(siteStateIcon('unknown')).toBe('mdi:snowflake-thermometer');
  });

  it('feet levels are converted before comparing with metres', () => {
    // 3000 ft = 914 m, line 614 m: within 300 m above 581 m.
    expect(classifySiteState(3000, 581, 0.3048)).toBe('near');
    expect(snowLine(2506)).toBe(2206);
  });
});

describe('reachesSite', () => {
  it('true when target − 300 <= elevation', () => {
    expect(reachesSite(881, 581)).toBe(true);
    expect(reachesSite(882, 581)).toBe(false);
    expect(reachesSite(1586, undefined)).toBe(false);
    expect(reachesSite(NaN, 581)).toBe(false);
    expect(reachesSite(881, 581, 1)).toBe(true);
    expect(reachesSite(3000, 581, 0.3048)).toBe(false);
  });
});

describe('resolveElevation', () => {
  const hass = { config: { elevation: 540 } };
  it('card option wins (numeric strings too)', () => {
    expect(resolveElevation({ elevation: 581 }, [{ elevation: 600 }], hass)).toBe(581);
    expect(resolveElevation({ elevation: '581' }, [], hass)).toBe(581);
  });
  it('then the 48 h sensor, then the current sensor', () => {
    expect(resolveElevation({}, [{ elevation: 600 }, { elevation: 610 }], hass)).toBe(600);
    expect(resolveElevation({}, [{}, { elevation: 610 }], hass)).toBe(610);
    expect(resolveElevation({ elevation: '' }, [undefined, { elevation: 'x' }], hass)).toBe(540);
  });
  it('then HA, else undefined', () => {
    expect(resolveElevation(undefined, [], hass)).toBe(540);
    expect(resolveElevation(null, [], { config: {} })).toBeUndefined();
    expect(resolveElevation({}, [], null)).toBeUndefined();
    expect(resolveElevation({ elevation: NaN }, [], { config: { elevation: '12.5' } })).toBe(12.5);
    expect(resolveElevation({ elevation: {} }, [], { config: { elevation: '  ' } })).toBeUndefined();
  });
});
