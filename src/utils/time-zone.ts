// Calendar math in the Home Assistant server's time zone (issue #285).
//
// The card shows the weather at the HA location — station sensors,
// the forecast for home, and the recorder's daily statistics, which HA
// buckets by the SERVER's midnight. Doing day boundaries in the
// browser's zone made a remote viewer's day columns cut at the wrong
// midnight, so every day / hour computation goes through here instead
// of Date's local getters and setters.
//
// One zone per page: every card on a dashboard talks to the same HA
// instance, so the zone is module state set from `set hass` rather
// than threaded through every helper. When it matches the browser's
// own zone (the common case) the helpers take Date's native path, so
// behaviour there is identical to the pre-#285 code.

const DAY_MS = 86_400_000;

let activeZone: string | undefined;
let browserZoneCache: string | undefined;
const validZones = new Map<string, boolean>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function browserZone(): string {
  browserZoneCache ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
  return browserZoneCache;
}

function isValidZone(tz: string): boolean {
  let ok = validZones.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    validZones.set(tz, ok);
  }
  return ok;
}

/** Set from `hass.config.time_zone`. Anything missing or unknown to
 *  the browser's Intl falls back to the browser's own zone. */
export function setCardTimeZone(tz: unknown): void {
  activeZone = typeof tz === 'string' && tz !== '' && isValidZone(tz) ? tz : undefined;
}

/** The configured server zone, or undefined while none is set — the
 *  shape `Intl.DateTimeFormat`'s `timeZone` option expects. */
export function configuredTimeZone(): string | undefined {
  return activeZone;
}

export function cardTimeZone(): string {
  return activeZone ?? browserZone();
}

function isNative(): boolean {
  return activeZone === undefined || activeZone === browserZone();
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const toMs = (d: Date | number): number => (typeof d === 'number' ? d : d.getTime());

export function zonedParts(d: Date | number): ZonedParts {
  const ms = toMs(d);
  if (isNative()) {
    const x = new Date(ms);
    return {
      year: x.getFullYear(),
      month: x.getMonth() + 1,
      day: x.getDate(),
      hour: x.getHours(),
      minute: x.getMinutes(),
      second: x.getSeconds(),
    };
  }
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(cardTimeZone()).formatToParts(new Date(ms))) {
    if (part.type in out) out[part.type as keyof ZonedParts] = Number(part.value);
  }
  return out;
}

// Wall-clock offset of the zone at `ms`, in ms (UTC+2 → +7 200 000).
function offsetAt(ms: number): number {
  const p = zonedParts(ms);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/** The instant a wall-clock time occurs in the card's zone. Out-of-range
 *  fields roll over like `Date.UTC` (day 32 → next month), which is
 *  what `addDays` relies on. A time skipped by a DST jump resolves to
 *  the instant after the jump. */
export function zonedDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  if (isNative()) return new Date(year, month - 1, day, hour, minute);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetAt(guess - offsetAt(guess));
  let t = guess - first;
  // Second pass settles the DST case where the guess and the result
  // sit on different sides of a transition.
  const second = offsetAt(t);
  if (second !== first) t = guess - second;
  return new Date(t);
}

export function startOfDay(d: Date | number): Date {
  const p = zonedParts(d);
  return zonedDate(p.year, p.month, p.day);
}

/** Same wall-clock time (to the minute) `n` calendar days later — a
 *  23- or 25-hour DST day still advances exactly one day. */
export function addDays(d: Date | number, n: number): Date {
  const p = zonedParts(d);
  return zonedDate(p.year, p.month, p.day + n, p.hour, p.minute);
}

/** `hour`:00 on the same calendar day. */
export function withHour(d: Date | number, hour: number): Date {
  const p = zonedParts(d);
  return zonedDate(p.year, p.month, p.day, hour);
}

/** Floor to the full hour. Done arithmetically so the repeated hour of
 *  a DST fall-back keeps its own instant. */
export function startOfHour(d: Date | number): Date {
  const ms = toMs(d);
  const p = zonedParts(ms);
  return new Date(ms - (p.minute * 60 + p.second) * 1000 - (((ms % 1000) + 1000) % 1000));
}

export function hourOf(d: Date | number): number {
  return zonedParts(d).hour;
}

export function minuteOf(d: Date | number): number {
  return zonedParts(d).minute;
}

/** `YYYY-MM-DD` of the calendar day in the card's zone. */
export function dayKey(d: Date | number): string {
  const p = zonedParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function isSameDay(a: Date | number, b: Date | number): boolean {
  return dayKey(a) === dayKey(b);
}

/** 1 on 1 January. */
export function dayOfYear(d: Date | number): number {
  const p = zonedParts(d);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 0)) / DAY_MS);
}
