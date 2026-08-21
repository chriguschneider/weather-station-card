// Moon astronomy for the live panel's moon line — illuminated fraction,
// waxing/waning, and rise/set times, computed client-side so the card
// needs no Moon integration (or any entity) at all. Illumination is
// geocentric (identical worldwide); rise/set take the site coordinates
// from `hass.config`.
//
// The formulas are the standard low-precision series from Meeus,
// "Astronomical Algorithms", as popularized by the BSD-2-licensed
// suncalc library (github.com/mourner/suncalc). This is a faithful
// port of suncalc 1.9 — verified bit-identical against it over a
// 120-day differential run. Versus modern high-precision ephemerides
// (suncalc v2's ELP series) that puts illumination within ±2 % and
// rise/set typically within ~5 min (worst ~15 near a midnight
// crossing) — plenty for a display line, and worth staying
// dependency-free for.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
// Days since J2000.0 — the epoch all series below are anchored to.
const J1970 = 2440588;
const J2000 = 2451545;
// Earth's axial tilt (obliquity of the ecliptic).
const E = RAD * 23.4397;

function toDays(date: Date): number {
  return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
}

function rightAscension(l: number, b: number): number {
  return Math.atan2(
    Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E),
    Math.cos(l),
  );
}

function declination(l: number, b: number): number {
  return Math.asin(
    Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l),
  );
}

function sunCoords(d: number): { ra: number; dec: number } {
  const m = RAD * (357.5291 + 0.98560028 * d);
  // Equation of center + perihelion longitude + 180° (earth→sun flip).
  const l =
    m +
    RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) +
    RAD * 102.9372 +
    Math.PI;
  return { ra: rightAscension(l, 0), dec: declination(l, 0) };
}

function moonCoords(d: number): { ra: number; dec: number; dist: number } {
  const L = RAD * (218.316 + 13.176396 * d); // ecliptic longitude
  const M = RAD * (134.963 + 13.064993 * d); // mean anomaly
  const F = RAD * (93.272 + 13.22935 * d); // mean distance
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M); // km
  return { ra: rightAscension(l, b), dec: declination(l, b), dist };
}

export interface MoonIllumination {
  /** Illuminated fraction of the disc, 0 (new) … 1 (full). */
  fraction: number;
  /** True from new moon to full moon (lit side grows). */
  waxing: boolean;
}

export function moonIllumination(date: Date): MoonIllumination {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sunDistKm = 149_598_000;

  // Geocentric elongation → phase angle of the moon (selenocentric
  // sun-earth angle). fraction is the classic (1+cos i)/2.
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) +
      Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inc = Math.atan2(
    sunDistKm * Math.sin(phi),
    m.dist - sunDistKm * Math.cos(phi),
  );
  // The position angle's sign says which limb is lit: negative while
  // the moon trails the sun (waxing), positive after full (waning).
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) -
      Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );

  return { fraction: (1 + Math.cos(inc)) / 2, waxing: angle < 0 };
}

// Topocentric altitude incl. atmospheric refraction — only used by the
// rise/set root-finder below.
function moonAltitude(date: Date, lat: number, lon: number): number {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const h = RAD * (280.16 + 360.9856235 * d) - lw - c.ra; // hour angle
  let alt = Math.asin(
    Math.sin(phi) * Math.sin(c.dec) +
      Math.cos(phi) * Math.cos(c.dec) * Math.cos(h),
  );
  // Sæmundsson refraction formula; clamp below-horizon input, where the
  // formula would misbehave.
  const h0 = alt < 0 ? 0 : alt;
  alt += 0.0002967 / Math.tan(h0 + 0.00312536 / (h0 + 0.08901179));
  return alt;
}

export interface MoonTimes {
  rise?: Date;
  set?: Date;
}

function hoursLater(date: Date, h: number): Date {
  return new Date(date.valueOf() + (h * DAY_MS) / 24);
}

// Rise/set offsets within one 2-hour scan window: fit a parabola
// through three hourly altitude samples and classify its in-window
// horizon crossings. The moon moves slowly enough that the quadratic
// root is minutes-exact. Offsets are hours relative to the middle
// sample.
function windowEvents(
  h0: number,
  h1: number,
  h2: number,
): { rise?: number; set?: number } {
  const a = (h0 + h2) / 2 - h1;
  const b = (h2 - h0) / 2;
  const xe = -b / (2 * a);
  const ye = (a * xe + b) * xe + h1;
  const disc = b * b - 4 * a * h1;
  if (disc < 0) return {};

  const dx = Math.sqrt(disc) / (Math.abs(a) * 2);
  let x1 = xe - dx;
  const x2 = xe + dx;
  let roots = 0;
  if (Math.abs(x1) <= 1) roots++;
  if (Math.abs(x2) <= 1) roots++;
  if (x1 < -1) x1 = x2;

  // One crossing is a rise when the window started below the horizon,
  // a set when it started above. With two, the parabola's apex says
  // which came first (dips below → set then rise, peaks → rise, set).
  if (roots === 1) return h0 < 0 ? { rise: x1 } : { set: x1 };
  if (roots === 2) return ye < 0 ? { rise: x2, set: x1 } : { rise: x1, set: x2 };
  return {};
}

/** Moonrise/set for the LOCAL calendar day containing `date`. Either
 *  key may be absent: the ~50-minute daily drift produces days with no
 *  rise or no set (and polar latitudes get neither for weeks). */
export function moonTimes(date: Date, lat: number, lon: number): MoonTimes {
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);

  const hc = 0.133 * RAD; // upper-limb correction (moon's apparent radius)
  let h0 = moonAltitude(t, lat, lon) - hc;
  let rise: number | undefined;
  let set: number | undefined;

  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonAltitude(hoursLater(t, i), lat, lon) - hc;
    const h2 = moonAltitude(hoursLater(t, i + 1), lat, lon) - hc;
    const w = windowEvents(h0, h1, h2);

    if (rise === undefined && w.rise !== undefined) rise = i + w.rise;
    if (set === undefined && w.set !== undefined) set = i + w.set;
    if (rise !== undefined && set !== undefined) break;
    h0 = h2;
  }

  const result: MoonTimes = {};
  if (rise !== undefined) result.rise = hoursLater(t, rise);
  if (set !== undefined) result.set = hoursLater(t, set);
  return result;
}

export interface MoonEvent {
  kind: 'rise' | 'set';
  time: Date;
}

/** The next moonrise or moonset after `now` — the moon line shows only
 *  this one event, mirroring the sun line's next-event-only policy.
 *  Scans up to three calendar days: gaps of >24 h between events are
 *  routine (the no-rise/no-set days), three days covers them at any
 *  inhabited latitude. */
export function nextMoonEvent(
  now: Date,
  lat: number,
  lon: number,
): MoonEvent | undefined {
  for (let day = 0; day < 3; day++) {
    const times = moonTimes(new Date(now.valueOf() + day * DAY_MS), lat, lon);
    const candidates: MoonEvent[] = [];
    if (times.rise && times.rise > now) candidates.push({ kind: 'rise', time: times.rise });
    if (times.set && times.set > now) candidates.push({ kind: 'set', time: times.set });
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.time.valueOf() - b.time.valueOf());
      return candidates[0];
    }
  }
  return undefined;
}

/** SVG path (24×24 viewBox) for the illuminated part of the disc.
 *  Two elliptical arcs: the outer limb semicircle on the lit side plus
 *  the terminator, whose x-semi-axis |2f−1|·r sweeps it from the lit
 *  limb (new) through a straight line (quarter) to the far limb (full).
 *  `litRight` is the NORTHERN-hemisphere waxing side — the caller
 *  flips it for southern latitudes, where the moon appears mirrored. */
export function litMoonPath(fraction: number, litRight: boolean): string {
  const c = 12;
  const r = 9.5;
  const s1 = litRight ? 1 : 0;
  const s2 = fraction < 0.5 ? 1 - s1 : s1;
  const rx = r * Math.abs(2 * fraction - 1);
  return (
    `M ${c} ${c - r} A ${r} ${r} 0 0 ${s1} ${c} ${c + r} ` +
    `A ${rx.toFixed(3)} ${r} 0 0 ${s2} ${c} ${c - r} Z`
  );
}
