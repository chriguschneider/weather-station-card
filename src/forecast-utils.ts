// Pure helpers for forecast rendering: entry shape, hourly / 3-hour
// aggregation, day-pager geometry, forecast datetime normalisation
// (ADR-0030). No Lit, uPlot or HA, so they run under plain node.

import { pad2, type Calendar } from './utils/time-zone.js';

/** Forecast entry shape consumed by the chart; emitted by both data
 *  sources. Numeric fields are null when upstream has no reading. */
export interface ForecastEntry {
  /** ISO-8601 timestamp at the start of the bucket (local midnight at
   *  daily mode, hour-start at hourly). */
  datetime: string;
  temperature: number | null;
  /** Daily-min — undefined / null on hourly entries (hourly carries a
   *  single mean temperature instead). */
  templow?: number | null;
  precipitation: number | null;
  wind_speed: number | null;
  wind_gust_speed: number | null;
  wind_bearing: number | null;
  /** Unit of `wind_speed` / `wind_gust_speed` for this entry: forecast
   *  entries carry the weather entity's unit, measured ones the sensor's.
   *  Without the tag the station unit is assumed and forecast wind would
   *  be mis-converted. Missing falls back to the station unit. */
  wind_speed_unit?: string;
  pressure: number | null;
  humidity: number | null;
  uv_index: number | null;
  /** HA condition ID — see `ConditionId` in const.ts. */
  condition: string;
  /** Daily sunshine in hours (Open-Meteo or `sensors.sunshine_duration`).
   *  Attached by the sunshine overlay; not present until then. */
  sunshine?: number | null;
  /** Astronomical day length in hours (sunrise to sunset) — used as the
   *  denominator for the sunshine bar's 0..1 fraction. */
  day_length?: number | null;
  /** Cloud coverage 0..100 %, HA's Forecast `cloud_coverage` slot (not
   *  every provider fills it). Last-resort input of the sunshine
   *  estimate (#6 Option F3). */
  cloud_coverage?: number | null;
  /** Chance of precipitation, integer 0..100 %. Standard HA Forecast
   *  slot; the Open-Meteo overlay fills it for providers without
   *  (ADR-0027). Never on measured station entries. */
  precipitation_probability?: number | null;
}

interface PickHourlyTickOpts {
  /** Override the bucketing heuristic with a fixed step in hours. */
  stepHours?: number;
  /** Force every midnight to carry a label even if the step skips it. */
  alwaysIncludeMidnight?: boolean;
}

/** Entry indices that carry an x-axis tick label on an hourly forecast:
 *  step 1 up to 24 entries, 3 up to 48, 6 up to 96, else 12 with every
 *  midnight forced in. The first entry is always kept, the last only if
 *  it is at least step/2 from the previous one. */
export function pickHourlyTickIndices(
  datetimes: ReadonlyArray<string | Date>,
  calendar: Calendar,
  opts: PickHourlyTickOpts = {},
): number[] {
  if (!Array.isArray(datetimes) || datetimes.length === 0) return [];
  const n = datetimes.length;

  let step: number;
  let forceMidnights: boolean;
  if (n <= 24)      { step = 1;  forceMidnights = false; }
  else if (n <= 48) { step = 3;  forceMidnights = false; }
  else if (n <= 96) { step = 6;  forceMidnights = false; }
  else              { step = 12; forceMidnights = true;  }

  if (Number.isFinite(opts.stepHours) && (opts.stepHours as number) > 0) step = opts.stepHours as number;
  if (typeof opts.alwaysIncludeMidnight === 'boolean') forceMidnights = opts.alwaysIncludeMidnight;

  const kept = new Set<number>();
  kept.add(0);
  for (let i = 0; i < n; i++) {
    if (i % step === 0) kept.add(i);
  }
  if (forceMidnights) {
    for (let i = 0; i < n; i++) {
      const dt = datetimes[i];
      const d = dt instanceof Date ? dt : new Date(dt);
      if (!Number.isFinite(d.getTime())) continue;
      if (calendar.hourOf(d) === 0 && calendar.minuteOf(d) === 0) kept.add(i);
    }
  }

  const sorted = Array.from(kept).sort((a, b) => a - b);
  const last = n - 1;
  if (sorted[sorted.length - 1] !== last) {
    const prev = sorted[sorted.length - 1];
    if (last - prev >= step / 2) sorted.push(last);
  }
  return sorted;
}

interface HourlyTempSeriesOpts {
  /** Round every value to integer °C / °F. */
  roundTemp?: boolean;
}

interface HourlyTempSeriesResult {
  /** One entry per input; nullish values pass through so uPlot draws a gap. */
  tempHigh: ReadonlyArray<number | null | undefined>;
  /** Null when no entry carries `templow` (pure hourly); otherwise
   *  positional, with nullish entries where one day has no `min`. */
  tempLow: ReadonlyArray<number | null | undefined> | null;
}

/** High / low temperature series of the chart. `tempLow` is non-null when
 *  any entry has a `templow`, so one offline day is a gap, not a vanished
 *  second line. */
export function hourlyTempSeries(
  entries: ReadonlyArray<Partial<ForecastEntry>>,
  opts: HourlyTempSeriesOpts = {},
): HourlyTempSeriesResult {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { tempHigh: [], tempLow: null };
  }
  const round = opts.roundTemp === true;
  // Math.round(null) is 0, which would turn "no data" into a fake 0°.
  const r = (v: unknown): number | null | undefined => {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return round ? Math.round(v) : v;
  };

  const rawTemp: (number | null | undefined)[] = new Array(entries.length);
  const tempHigh: (number | null | undefined)[] = new Array(entries.length);
  const tempLow: (number | null | undefined)[] = new Array(entries.length);
  let anyHaveLow = false;

  for (let i = 0; i < entries.length; i++) {
    const d = entries[i] || {};
    rawTemp[i] = r(d.temperature);
    if (typeof d.templow === 'undefined' || d.templow === null) {
      tempLow[i] = null;
    } else {
      tempLow[i] = r(d.templow);
      anyHaveLow = true;
    }
  }

  // 'today' blocks arrive with real max / min already in both fields
  // (aggregateThreeHourCalendar), so daily and today share this path.
  for (let i = 0; i < entries.length; i++) {
    tempHigh[i] = rawTemp[i];
  }
  return {
    tempHigh,
    tempLow: anyHaveLow ? tempLow : null,
  };
}

/** `warnings` are i18n keys. */
export interface NormalizeResult<T> {
  config: T;
  warnings: string[];
}

/** Validates forecast.type: invalid or unset values fall back to 'daily'
 *  (invalid ones also warn). Idempotent. */
export function normalizeForecastMode<T = unknown>(rawConfig: T): NormalizeResult<T> {
  const warnings: string[] = [];
  if (!rawConfig || typeof rawConfig !== 'object') {
    return { config: rawConfig, warnings };
  }
  const raw = rawConfig as { forecast?: { type?: string } } & Record<string, unknown>;
  const config = { ...raw, forecast: { ...(raw.forecast ?? {}) } };

  const t = config.forecast.type;
  if (t !== 'daily' && t !== 'hourly' && t !== 'today') {
    if (t !== undefined) warnings.push('forecast_type_invalid');
    config.forecast.type = 'daily';
  }
  return { config: config as unknown as T, warnings };
}

/** Mode-toggle cycle: daily → today → hourly → daily; unknown or unset
 *  goes to 'today'. */
export function nextForecastType(current: string | undefined | null): 'daily' | 'today' | 'hourly' {
  if (current === 'daily') return 'today';
  if (current === 'today') return 'hourly';
  if (current === 'hourly') return 'daily';
  return 'today';
}

/** Cache key of the recorder fetch. 'hourly' and 'today' read the same
 *  hourly buckets (they differ only in aggregation), so they share a slot. */
export function stationFetchKey(cfg: { forecast?: { type?: string } | null } | null | undefined): 'day' | 'hour' {
  const type = cfg?.forecast?.type;
  return (type === 'hourly' || type === 'today') ? 'hour' : 'day';
}

/** `forecast_type` of the weather/subscribe_forecast call; 'today' shares
 *  the 'hourly' subscription. */
export function forecastFetchKey(cfg: { forecast?: { type?: string } | null } | null | undefined): 'daily' | 'hourly' {
  const type = cfg?.forecast?.type;
  return (type === 'hourly' || type === 'today') ? 'hourly' : 'daily';
}

/** 3-hour blocks for the 'today' day pager, anchored to the local
 *  calendar (00-03 … 21-24) so recorder gaps cannot shift them. The
 *  series is gap-filled to whole days of exactly 8 blocks (empty blocks
 *  are all-null), so one page is one viewport. Field rules: see
 *  `aggregateBlock`. */
export function aggregateThreeHourCalendar<T extends Partial<ForecastEntry>>(
  entries: ReadonlyArray<T>,
  calendar: Calendar,
): ForecastEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const buckets = new Map<number, T[]>();
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const e of entries) {
    if (!e?.datetime) continue;
    const d = new Date(e.datetime);
    const t = d.getTime();
    if (!Number.isFinite(t)) continue;
    const key = calendar.withHour(d, Math.floor(calendar.hourOf(d) / 3) * 3).getTime();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
    if (key < minMs) minMs = key;
    if (key > maxMs) maxMs = key;
  }
  if (!Number.isFinite(minMs)) return [];

  // Calendar iteration keeps a 23/25-hour DST day at exactly 8 blocks.
  const out: ForecastEntry[] = [];
  const lastDayMs = calendar.startOfDay(maxMs).getTime();
  for (let cursor = calendar.startOfDay(minMs); cursor.getTime() <= lastDayMs; cursor = calendar.addDays(cursor, 1)) {
    for (let blk = 0; blk < 8; blk++) {
      const anchor = calendar.withHour(cursor, blk * 3);
      const slice = buckets.get(anchor.getTime()) ?? [];
      out.push(aggregateBlock(slice, anchor.toISOString()));
    }
  }
  return out;
}

/** True for the all-null padding blocks of `aggregateThreeHourCalendar`. */
function isEmptyBlock(b: ForecastEntry): boolean {
  return b.temperature == null
    && b.templow == null
    && b.precipitation == null
    && b.sunshine == null
    && b.wind_speed == null
    && b.wind_gust_speed == null
    && b.wind_bearing == null
    && b.pressure == null
    && b.humidity == null
    && b.uv_index == null
    && !b.condition;
}

/** Drops whole leading days (8 blocks) that are entirely empty. With
 *  `allowPartialDayStart` (forecast-only) the empty leading blocks of the
 *  first day go too: pages become rolling next-24-h windows instead of a
 *  near-empty current day on an evening mount. */
export function trimLeadingEmptyBlocks(
  blocks: ReadonlyArray<ForecastEntry>,
  allowPartialDayStart: boolean,
): ForecastEntry[] {
  let start = 0;
  while (blocks.length - start >= 8 && blocks.slice(start, start + 8).every(isEmptyBlock)) {
    start += 8;
  }
  if (allowPartialDayStart) {
    while (start < blocks.length && isEmptyBlock(blocks[start])) start++;
  }
  return start ? blocks.slice(start) : [...blocks];
}

/** `trimLeadingEmptyBlocks` for the series end. With `allowPartialDayEnd`
 *  (station-only) the series ends at the "now" block, so the last page is
 *  a rolling last-24-h window. */
export function trimTrailingEmptyBlocks(
  blocks: ReadonlyArray<ForecastEntry>,
  allowPartialDayEnd: boolean,
): ForecastEntry[] {
  let end = blocks.length;
  while (end >= 8 && blocks.slice(end - 8, end).every(isEmptyBlock)) {
    end -= 8;
  }
  if (allowPartialDayEnd) {
    while (end > 0 && isEmptyBlock(blocks[end - 1])) end--;
  }
  return end < blocks.length ? blocks.slice(0, end) : [...blocks];
}

/** Local day key (y-m-d) of an entry; null for unparseable datetimes. */
function localDayKeyOf(e: { datetime?: string } | null | undefined, calendar: Calendar): string | null {
  if (!e?.datetime) return null;
  const d = new Date(e.datetime);
  if (!Number.isFinite(d.getTime())) return null;
  return calendar.dayKey(d);
}

/** Whole-day windowing for hourly-ish modes: a count-based slice ends
 *  mid-day and would grow a sliver "day" of one hour. If the last day
 *  stops before 23:00, drop it, unless it is the only day. */
export function trimToWholeDayEnd<T extends { datetime?: string }>(
  entries: ReadonlyArray<T>,
  calendar: Calendar,
): T[] {
  if (entries.length === 0) return [];
  const last = entries[entries.length - 1];
  const lastKey = localDayKeyOf(last, calendar);
  if (lastKey === null) return [...entries];
  const lastHour = calendar.hourOf(new Date(last.datetime as string));
  if (lastHour >= 23) return [...entries];
  let cut = entries.length;
  while (cut > 0 && localDayKeyOf(entries[cut - 1], calendar) === lastKey) cut--;
  if (cut === 0) return [...entries]; // single-day series — keep
  return entries.slice(0, cut);
}

/** If the first day does not start at 00:00, drop it, unless it is the
 *  only day. Keeps the oldest station segment a full day. */
export function trimToWholeDayStart<T extends { datetime?: string }>(
  entries: ReadonlyArray<T>,
  calendar: Calendar,
): T[] {
  if (entries.length === 0) return [];
  const first = entries[0];
  const firstKey = localDayKeyOf(first, calendar);
  if (firstKey === null) return [...entries];
  if (calendar.hourOf(new Date(first.datetime as string)) === 0) return [...entries];
  let cut = 0;
  while (cut < entries.length && localDayKeyOf(entries[cut], calendar) === firstKey) cut++;
  if (cut >= entries.length) return [...entries]; // single-day series — keep
  return entries.slice(cut);
}

/** Initial-scroll / jump-to-now target of the 'today' pager: the far end
 *  for station-only, 0 for forecast-only (both trimmed to the "now"
 *  block), else today's page. Null when no block sits at today's local
 *  midnight; the caller then centres on the boundary. */
export function computeTodayPagerScrollLeft(opts: {
  forecasts: ReadonlyArray<{ datetime?: string }> | null | undefined;
  stationCount: number;
  forecastCount: number;
  contentWidth: number;
  viewportWidth: number;
  now?: Date;
}, calendar: Calendar): number | null {
  const { forecasts, stationCount, forecastCount, contentWidth, viewportWidth } = opts;
  if (!forecasts?.length || !Number.isFinite(contentWidth) || contentWidth <= 0) return null;
  if (forecastCount <= 0 && stationCount > 0) {
    const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
    return Math.max(0, contentWidth - vw);
  }
  if (stationCount <= 0 && forecastCount > 0) return 0;
  return computeDayPageScrollLeft(forecasts, contentWidth, calendar, opts.now ?? new Date());
}

/** Viewport size in bars. 'today' always frames one day (8 blocks),
 *  whatever `number_of_forecasts` says; other modes use it (0 = fit all). */
export function effectiveVisibleBars(
  cfg: { forecast?: { type?: string; number_of_forecasts?: number | string } | null } | null | undefined,
): number {
  if (cfg?.forecast?.type === 'today') return 8;
  const n = parseInt(String(cfg?.forecast?.number_of_forecasts ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** ScrollLeft that puts the current local day's first block at the left
 *  edge; null when no block sits at today's local midnight. */
export function computeDayPageScrollLeft(
  forecasts: ReadonlyArray<{ datetime?: string }> | null | undefined,
  contentWidth: number,
  calendar: Calendar,
  now: Date = new Date(),
): number | null {
  if (!forecasts?.length || !Number.isFinite(contentWidth) || contentWidth <= 0) return null;
  const targetMs = calendar.startOfDay(now).getTime();
  const idx = forecasts.findIndex((e) => {
    if (!e?.datetime) return false;
    return new Date(e.datetime).getTime() === targetMs;
  });
  if (idx < 0) return null;
  return (idx / forecasts.length) * contentWidth;
}

/** Deep equality of two forecast arrays, so the subscribe callbacks skip
 *  re-renders when HA re-broadcasts an identical payload (a sibling
 *  card's resubscribe does that). JSON.stringify suffices: entries are
 *  flat primitives in a fixed key order. */
export function forecastsEqual(
  a: ReadonlyArray<unknown> | null | undefined,
  b: ReadonlyArray<unknown> | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Start of today in the card zone (#285) as ms since epoch. */
export function startOfTodayMs(calendar: Calendar): number {
  return calendar.startOfDay(Date.now()).getTime();
}

// Forecast datetimes (#355): `weather/subscribe_forecast` documents `datetime` only as "UTC, RFC
// 3339" and leaves daily semantics open (core issue #166294 and
// architecture issue #221 closed without a change). Integrations
// differ: core Open-Meteo writes UTC midnight (`T00:00:00+00:00`),
// MeteoSwiss a bare date, AccuWeather the provider's local midnight
// expressed in UTC, NWS the local offset. A daily entry is therefore
// read as a calendar day, not as an instant.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_TIME_RE = /^[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?/i;
const ISO_OFFSET_RE = /^(?:Z|([+-])(\d{2}):?(\d{2})?)$/i;

interface IsoParts {
  year: number;
  month: number;
  day: number;
  /** undefined for a bare date */
  hour?: number;
  minute: number;
  second: number;
  /** Offset in minutes; undefined when the string has none. */
  offsetMin?: number;
}

function parseIso(s: string): IsoParts | null {
  let rest = s.trim();
  const date = ISO_DATE_RE.exec(rest);
  if (!date) return null;
  const out: IsoParts = {
    year: Number(date[1]), month: Number(date[2]), day: Number(date[3]), minute: 0, second: 0,
  };
  rest = rest.slice(date[0].length);
  if (rest === '') return out;
  const time = ISO_TIME_RE.exec(rest);
  if (!time) return null;
  out.hour = Number(time[1]);
  out.minute = Number(time[2]);
  out.second = Number(time[3] ?? 0);
  rest = rest.slice(time[0].length);
  if (rest === '') return out;
  const off = ISO_OFFSET_RE.exec(rest);
  if (!off) return null;
  const sign = off[1] === '-' ? -1 : 1;
  out.offsetMin = off[1] === undefined ? 0 : sign * (Number(off[2]) * 60 + Number(off[3] ?? 0));
  return out;
}

const isMidnightIn = (cal: Calendar, t: number): boolean => cal.startOfDay(t).getTime() === t;

/** `YYYY-MM-DD` day key of a daily forecast entry's `datetime`, a day of
 *  the card's calendar (ADR-0030, #355, #377):
 *    - bare date → that date
 *    - no offset → wall time in the card calendar, i.e. the written date
 *    - explicit non-zero offset → the date in that offset (as written)
 *    - UTC at exactly midnight (core Open-Meteo) → the UTC date
 *    - UTC at another hour → the card-calendar date, except an instant
 *      that is midnight in the server zone but not in the card's: that
 *      is a server-zone provider writing its local midnight in UTC
 *      (AccuWeather), so the server date.
 *  null when the string is not a date. */
export function normalizeDailyEntry(
  datetime: string,
  cardCalendar: Calendar,
  serverCalendar: Calendar,
): string | null {
  const p = parseIso(datetime);
  if (!p) {
    const t = Date.parse(datetime);
    return Number.isFinite(t) ? cardCalendar.dayKey(t) : null;
  }
  const written = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  if (p.hour === undefined || p.offsetMin === undefined) return written;
  if (p.offsetMin !== 0) return written;
  if (p.hour === 0 && p.minute === 0 && p.second === 0) return written;
  const t = Date.parse(datetime);
  if (!isMidnightIn(cardCalendar, t) && isMidnightIn(serverCalendar, t)) {
    return serverCalendar.dayKey(t);
  }
  return cardCalendar.dayKey(t);
}

/** Daily forecast `datetime` re-anchored at the card-calendar midnight
 *  of its day key, the same convention as the station's daily entries.
 *  null when the string is not a date. */
export function anchorDailyDatetime(
  datetime: string,
  calendar: Calendar,
  serverCalendar: Calendar,
): string | null {
  const key = normalizeDailyEntry(datetime, calendar, serverCalendar);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  return calendar.zonedDate(y, m, d).toISOString();
}

let warnedBareHourly = false;

/** Hourly forecast `datetime` as an absolute ISO instant. Core requires
 *  an offset; a string without one is read as wall time of the card's
 *  calendar (warned once per page) instead of the browser's zone.
 *  Strings with an offset, and anything unparseable, pass through
 *  unchanged. */
export function normalizeHourlyDatetime(datetime: string, calendar: Calendar): string {
  const p = parseIso(datetime);
  if (!p || p.offsetMin !== undefined) return datetime;
  if (!warnedBareHourly) {
    warnedBareHourly = true;
    console.warn(
      `[weather-station-card] hourly forecast datetime "${datetime}" has no UTC offset; reading it in ${calendar.timeZone}`,
    );
  }
  return calendar.zonedDate(p.year, p.month, p.day, p.hour ?? 0, p.minute).toISOString();
}

/** Drop entries before today's local midnight. Just after midnight an
 *  integration that has not refreshed yet can still lead with
 *  yesterday's daily entry. Idempotent. */
export function filterMidnightStaleForecast<T extends { datetime?: string }>(
  forecast: ReadonlyArray<T>,
  todayStartMs: number,
): T[] {
  if (!Array.isArray(forecast)) return [];
  if (!Number.isFinite(todayStartMs)) return forecast.slice();
  return forecast.filter((entry) => {
    if (!entry?.datetime) return true;
    const t = new Date(entry.datetime).getTime();
    if (!Number.isFinite(t)) return true;
    return t >= todayStartMs;
  });
}

/** Index-anchored 3-hour blocks (consecutive runs of 3 entries; a short
 *  tail becomes a partial block). See `aggregateBlock`. */
export function aggregateThreeHour<T extends Partial<ForecastEntry>>(
  entries: ReadonlyArray<T>,
): ForecastEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const blocks: ForecastEntry[] = [];
  for (let i = 0; i < entries.length; i += 3) {
    const slice = entries.slice(i, i + 3);
    if (!slice.length) continue;
    blocks.push(aggregateBlock(slice, (slice[0] as ForecastEntry).datetime));
  }
  return blocks;
}

function collectNumeric<T>(slice: ReadonlyArray<T>, key: keyof ForecastEntry): number[] {
  const values: number[] = [];
  for (const e of slice) {
    const v = (e as Record<string, unknown>)[key as string];
    if (v != null && typeof v === 'number' && Number.isFinite(v)) values.push(v);
  }
  return values;
}

function meanOf<T>(slice: ReadonlyArray<T>, key: keyof ForecastEntry): number | null {
  const values = collectNumeric(slice, key);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function sumOf<T>(slice: ReadonlyArray<T>, key: keyof ForecastEntry): number | null {
  const values = collectNumeric(slice, key);
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10;
}

// The chance that ANY hour of a block is wet is at least the wettest
// hour's chance — the max is the conservative block figure, and the
// same rule MeteoSwiss uses to derive its daily value from the hourly
// 3-hour windows. Summing or averaging would be wrong for a probability.
function maxOf<T>(slice: ReadonlyArray<T>, key: keyof ForecastEntry): number | null {
  const values = collectNumeric(slice, key);
  if (!values.length) return null;
  return Math.max(...values);
}

function modeOf<T>(slice: ReadonlyArray<T>, key: keyof ForecastEntry): string {
  const counts = new Map<string, number>();
  for (const e of slice) {
    const v = (e as Record<string, unknown>)[key as string];
    if (v == null) continue;
    const s = String(v);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

/** One block from a slice of hourly entries: temperature = max and
 *  templow = min of the pooled real hourly values, precipitation and
 *  sunshine summed, probability maxed, other numerics averaged (1
 *  decimal), condition = most frequent. An empty slice gives an
 *  all-null block. */
function aggregateBlock<T extends Partial<ForecastEntry>>(
  slice: ReadonlyArray<T>,
  datetime: string,
): ForecastEntry {
  // One pool of `temperature` and `templow`, so a source with only
  // `temperature` per hour still yields a high/low pair.
  const tempPool: number[] = [];
  for (const e of slice) {
    const t = (e as ForecastEntry).temperature;
    const l = (e as ForecastEntry).templow;
    if (typeof t === 'number' && Number.isFinite(t)) tempPool.push(t);
    if (typeof l === 'number' && Number.isFinite(l)) tempPool.push(l);
  }
  return {
    datetime,
    temperature: tempPool.length ? Math.round(Math.max(...tempPool) * 10) / 10 : null,
    templow: tempPool.length ? Math.round(Math.min(...tempPool) * 10) / 10 : null,
    precipitation: sumOf(slice, 'precipitation'),
    // 0..3 h per block; the caller sets day_length = 3 for the bar fraction.
    sunshine: sumOf(slice, 'sunshine'),
    precipitation_probability: maxOf(slice, 'precipitation_probability'),
    wind_speed: meanOf(slice, 'wind_speed'),
    wind_gust_speed: meanOf(slice, 'wind_gust_speed'),
    wind_bearing: meanOf(slice, 'wind_bearing'),
    pressure: meanOf(slice, 'pressure'),
    humidity: meanOf(slice, 'humidity'),
    uv_index: meanOf(slice, 'uv_index'),
    condition: modeOf(slice, 'condition'),
  };
}
