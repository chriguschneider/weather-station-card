// Calendar math in one IANA time zone (issue #285, ADR-0030).
//
// The card shows the weather at a location — station sensors, the
// forecast for that place, and the recorder's daily statistics, which
// HA buckets by the SERVER's midnight. Doing day boundaries in the
// browser's zone made a remote viewer's day columns cut at the wrong
// midnight, so every day / hour computation goes through a `Calendar`
// instead of Date's local getters and setters.
//
// Each card owns one `Calendar` and passes it explicitly: clock ticks,
// fetch callbacks and chart plugins run asynchronously, so a page-wide
// zone would let two cards in two zones read each other's. When the
// zone matches the browser's own (the common case) the methods take
// Date's native path, so behaviour there is identical to the pre-#285
// code.

const DAY_MS = 86_400_000;

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

/** The given IANA zone when it is a non-empty string the browser's Intl
 *  knows, else undefined. */
export function validTimeZone(tz: unknown): string | undefined {
  return typeof tz === 'string' && tz !== '' && isValidZone(tz) ? tz : undefined;
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

/** Calendar parts of an instant in an explicit IANA zone. Callers pass
 *  a zone already checked with `validTimeZone`. */
export function zonedPartsIn(d: Date | number, tz: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(tz).formatToParts(new Date(toMs(d)))) {
    if (part.type in out) out[part.type as keyof ZonedParts] = Number(part.value);
  }
  return out;
}

/** Calendar math in one IANA zone. Immutable: a zone change means a
 *  new instance. */
export class Calendar {
  /** The resolved IANA zone — always set, ready for `Intl`'s `timeZone`. */
  readonly timeZone: string;
  private readonly native: boolean;

  /** Anything missing or unknown to the browser's Intl falls back to
   *  the browser's own zone. */
  constructor(tz?: unknown) {
    this.timeZone = validTimeZone(tz) ?? browserZone();
    this.native = this.timeZone === browserZone();
  }

  zonedParts(d: Date | number): ZonedParts {
    const ms = toMs(d);
    if (this.native) {
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
    return zonedPartsIn(ms, this.timeZone);
  }

  // Wall-clock offset of the zone at `ms`, in ms (UTC+2 → +7 200 000).
  private offsetAt(ms: number): number {
    const p = this.zonedParts(ms);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return wall - (ms - (((ms % 1000) + 1000) % 1000));
  }

  /** The instant a wall-clock time occurs in this zone. Out-of-range
   *  fields roll over like `Date.UTC` (day 32 → next month), which is
   *  what `addDays` relies on. A time skipped by a DST jump resolves to
   *  the instant after the jump. */
  zonedDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
    if (this.native) return new Date(year, month - 1, day, hour, minute);
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const first = this.offsetAt(guess - this.offsetAt(guess));
    let t = guess - first;
    // Second pass settles the DST case where the guess and the result
    // sit on different sides of a transition.
    const second = this.offsetAt(t);
    if (second !== first) t = guess - second;
    return new Date(t);
  }

  startOfDay(d: Date | number): Date {
    const p = this.zonedParts(d);
    return this.zonedDate(p.year, p.month, p.day);
  }

  /** Same wall-clock time (to the minute) `n` calendar days later — a
   *  23- or 25-hour DST day still advances exactly one day. */
  addDays(d: Date | number, n: number): Date {
    const p = this.zonedParts(d);
    return this.zonedDate(p.year, p.month, p.day + n, p.hour, p.minute);
  }

  /** `hour`:00 on the same calendar day. */
  withHour(d: Date | number, hour: number): Date {
    const p = this.zonedParts(d);
    return this.zonedDate(p.year, p.month, p.day, hour);
  }

  /** Floor to the full hour. Done arithmetically so the repeated hour of
   *  a DST fall-back keeps its own instant. Zones with a half-hour
   *  offset floor to their own :30 UTC. */
  startOfHour(d: Date | number): Date {
    const ms = toMs(d);
    const p = this.zonedParts(ms);
    return new Date(ms - (p.minute * 60 + p.second) * 1000 - (((ms % 1000) + 1000) % 1000));
  }

  hourOf(d: Date | number): number {
    return this.zonedParts(d).hour;
  }

  minuteOf(d: Date | number): number {
    return this.zonedParts(d).minute;
  }

  /** `YYYY-MM-DD` of the calendar day in this zone. */
  dayKey(d: Date | number): string {
    const p = this.zonedParts(d);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  isSameDay(a: Date | number, b: Date | number): boolean {
    return this.dayKey(a) === this.dayKey(b);
  }

  /** 1 on 1 January. */
  dayOfYear(d: Date | number): number {
    const p = this.zonedParts(d);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 0)) / DAY_MS);
  }
}
