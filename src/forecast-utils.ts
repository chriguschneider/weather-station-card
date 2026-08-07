// Pure helpers for hourly-forecast rendering. Kept in their own module so
// they can be unit-tested without pulling in Lit, Chart.js, or HA — vitest
// runs in node (no jsdom) and these stay fully exercisable there.

/** Forecast entry shape consumed by the chart. Both data sources
 *  (`MeasuredDataSource`, `ForecastDataSource`) emit objects matching
 *  this contract; the sunshine overlay decorates them with `sunshine`
 *  and `day_length` after the fact. Numeric fields are nullable when
 *  the upstream source has no reading for that day / hour. */
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
  /** Source unit of `wind_speed` / `wind_gust_speed` for THIS entry.
   *  Forecast entries from `ForecastDataSource` carry the weather
   *  entity's unit (typically km/h), while `MeasuredDataSource`
   *  emits values in the station sensor's unit. Without this per-
   *  entry tag the renderer would use the synthetic-weather unit
   *  (always the station's), silently mis-converting forecast wind
   *  by the m/s↔km/h factor (~3.6). Optional for backwards
   *  compatibility; missing falls back to the station unit. */
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
  /** Cloud coverage as a percentage 0..100, sourced from HA's
   *  weather/subscribe_forecast payload (HA Forecast TypedDict
   *  `cloud_coverage` slot — not all providers populate it; Met.no
   *  and AccuWeather do, OpenWeatherMap on daily does not).
   *  Used by `sunshineFromCloudCoverage` as a last-resort sunshine
   *  estimator when no recorder sensor or Open-Meteo overlay
   *  resolves a value (#6 Option F3). */
  cloud_coverage?: number | null;
}

interface PickHourlyTickOpts {
  /** Override the bucketing heuristic with a fixed step in hours. */
  stepHours?: number;
  /** Force every midnight to carry a label even if the step skips it. */
  alwaysIncludeMidnight?: boolean;
}

/** Decide which entry indices should carry an x-axis tick label when the
 *  forecast is hourly. Strategy depends on horizon length so a 1-day chart
 *  shows every hour and a 7-day chart doesn't try to render 168 labels:
 *
 *    1–24 entries → step 1  (every hour)
 *    25–48        → step 3
 *    49–96        → step 6
 *    ≥97          → step 12, plus every midnight forced in (so day
 *                    boundaries always carry a label even if step skips)
 *
 *  First entry is always included (so "now" carries a label). The last
 *  entry is added only if it is at least step/2 away from the previous
 *  kept index — otherwise it crowds the right edge.
 *
 *  Inputs are accepted as ISO strings or Date objects; invalid timestamps
 *  just won't trigger the midnight-force branch. */
export function pickHourlyTickIndices(
  datetimes: ReadonlyArray<string | Date>,
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

  // Allow tests / future callers to override the heuristic.
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
      if (d.getHours() === 0 && d.getMinutes() === 0) kept.add(i);
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
  /** Always populated, one entry per input. Nullish (null /
   *  undefined / non-finite) values pass through unchanged so
   *  Chart.js draws a gap (Math.round(null) returns 0, which would
   *  paint a fake "0°" label there). */
  tempHigh: ReadonlyArray<number | null | undefined>;
  /** Null when NO entry carries `templow` (pure hourly). Otherwise a
   *  positional array with nullish entries for any individual day
   *  where the recorder had no `min` reading (sensor offline that
   *  day) — Chart.js draws a gap there instead of dropping the whole
   *  second line. */
  tempLow: ReadonlyArray<number | null | undefined> | null;
}

/** Decide what the temperature line(s) of the forecast chart should look
 *  like for the given entries. Daily forecasts carry both `temperature`
 *  (high) and `templow`; hourly forecasts carry only `temperature`. The
 *  caller draws two datasets either way — when tempLow is null it should
 *  hide / skip the second dataset instead of pushing an empty array
 *  (which would otherwise leave a dangling legend / pointless gap).
 *
 *  Use "some have low" rather than all-or-nothing: a single offline
 *  day shows as a gap, not as a vanished dataset across combination +
 *  station modes. */
export function hourlyTempSeries(
  entries: ReadonlyArray<Partial<ForecastEntry>>,
  opts: HourlyTempSeriesOpts = {},
): HourlyTempSeriesResult {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { tempHigh: [], tempLow: null };
  }
  const round = opts.roundTemp === true;
  // Preserve null / undefined / non-finite values through rounding —
  // Math.round(null) returns 0 (because null coerces to 0), which would
  // turn "no data for this hour" into a fake 0° label. Chart.js draws a
  // gap on null values, which is the desired behaviour.
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

  // tempHigh = per-entry temperature, tempLow = per-entry templow when
  // provided. For 'today' mode the 3-hour aggregator (aggregateThreeHour)
  // populates both fields with real source-hour max / min before reaching
  // this helper, so a single code path covers daily AND today; the
  // synthetic rolling-window approach was removed (it computed each
  // entry's high/low from overlapping windows that didn't correspond
  // to any actual data point).
  for (let i = 0; i < entries.length; i++) {
    tempHigh[i] = rawTemp[i];
  }
  return {
    tempHigh,
    tempLow: anyHaveLow ? tempLow : null,
  };
}

/** Returned by `normalizeForecastMode`. `warnings` carries i18n keys
 *  the caller (or the editor preview) can translate. */
export interface NormalizeResult<T> {
  config: T;
  warnings: string[];
}

/** Project a card config onto a render-ready shape. The single rule
 *  today is forecast.type validation: typo'd / unset values fall back
 *  to 'daily' so downstream code can read the field unconditionally.
 *  (Earlier drafts forced show_station off at hourly — that constraint
 *  was dropped once MeasuredDataSource learned to fetch hourly station
 *  aggregates, so combination mode at hourly is a coherent view: past
 *  hours of measurements + future hours of forecast.)
 *
 *  Idempotent. */
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

/** Three-way cycle for the in-card mode-toggle button: daily → today
 *  → hourly → daily. Unknown / unset input cycles to 'today' so a
 *  freshly-configured card with no forecast.type behaves predictably.
 *  Pure function — no side effects on the config. The caller (main.ts
 *  `_onModeToggleClick`) merges the result back into `forecast.type`. */
export function nextForecastType(current: string | undefined | null): 'daily' | 'today' | 'hourly' {
  if (current === 'daily') return 'today';
  if (current === 'today') return 'hourly';
  if (current === 'hourly') return 'daily';
  return 'today';
}

/** Lazy-cache key for the MeasuredDataSource's recorder fetch.
 *  Both 'hourly' and 'today' fetch the same hourly buckets — the
 *  difference is purely render-time aggregation — so they share a
 *  cache slot. Toggling between hourly and today therefore needs no
 *  refetch at all. */
export function stationFetchKey(cfg: { forecast?: { type?: string } | null } | null | undefined): 'day' | 'hour' {
  const type = cfg?.forecast?.type;
  return (type === 'hourly' || type === 'today') ? 'hour' : 'day';
}

/** Lazy-cache key for the ForecastDataSource's weather/subscribe_forecast
 *  call. Mirrors the API's `forecast_type` parameter. 'today' shares the
 *  'hourly' subscription per the same hour-buckets reasoning. */
export function forecastFetchKey(cfg: { forecast?: { type?: string } | null } | null | undefined): 'daily' | 'hourly' {
  const type = cfg?.forecast?.type;
  return (type === 'hourly' || type === 'today') ? 'hourly' : 'daily';
}

/** Estimate sunshine duration in hours from a forecast's cloud-coverage
 *  fraction (Kasten-style empirical formula).
 *
 *    sunshine_h ≈ day_length × (1 − (cloud_coverage / 100)^p)
 *
 *  with p ≈ 1.7 by default (configurable via
 *  `condition_mapping.sunshine_cloud_exponent`). A higher exponent
 *  gives full days more sunshine for the same cloud coverage —
 *  appropriate for thin-cirrus-prone climates; the 1.7 default is the
 *  middle of the 1.5–2.0 range Kasten suggests.
 *
 *  Used as the LAST-RESORT estimator on the forecast tier when no
 *  WMO-conformant source resolves: a recorder \`sensors.sunshine_duration\`
 *  wins, then the Open-Meteo overlay, then this estimate. The result
 *  is honest about being a proxy — the chart still calls it "sunshine"
 *  but the documentation flags the precision differential.
 *
 *  Returns null when either input is missing / out-of-range. The chart
 *  draws nothing for null entries (matching the existing convention). */
export function sunshineFromCloudCoverage(
  cloudPercent: number | null | undefined,
  dayLengthH: number | null | undefined,
  exponent = 1.7,
): number | null {
  if (cloudPercent == null || !Number.isFinite(cloudPercent)) return null;
  if (dayLengthH == null || !Number.isFinite(dayLengthH) || dayLengthH <= 0) return null;
  // Clamp coverage to [0, 100] — providers occasionally report 100.5
  // or other near-bound noise.
  const cc = Math.max(0, Math.min(100, cloudPercent));
  const fraction = 1 - Math.pow(cc / 100, exponent);
  // Numerical safety: 0^x in JS is 0, but float arithmetic at the
  // boundaries can yield -0 or microscopic negatives.
  if (!Number.isFinite(fraction)) return null;
  const hours = dayLengthH * Math.max(0, fraction);
  return hours;
}

/** Calendar-aligned 3-hour aggregator — the day-pager variant of
 *  `aggregateThreeHour` (2026-08, "today" mode rework). Differences:
 *
 *    - Blocks are anchored to the LOCAL calendar (00-03, 03-06, …,
 *      21-24), not to the array's first index. Recorder gaps therefore
 *      can't shift later blocks out of alignment.
 *    - The emitted series is GAP-FILLED to whole days: every day from
 *      the first entry's day through the last entry's day contributes
 *      exactly 8 blocks; blocks with no source hours carry all-null
 *      values (the chart draws gaps). This is what makes day-paging
 *      exact — 8 blocks ≡ 1 viewport ≡ 1 day, so page boundaries are
 *      integer multiples of the viewport width.
 *
 *  Field rules match `aggregateThreeHour`: temperature high/low from
 *  the pooled real hourly values, precipitation + sunshine summed,
 *  other numerics averaged, condition = most frequent. */
export function aggregateThreeHourCalendar<T extends Partial<ForecastEntry>>(
  entries: ReadonlyArray<T>,
): ForecastEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  // Bucket every valid entry by its local (day, hour/3) block.
  const buckets = new Map<number, T[]>();
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const e of entries) {
    if (!e?.datetime) continue;
    const d = new Date(e.datetime);
    const t = d.getTime();
    if (!Number.isFinite(t)) continue;
    const anchor = new Date(d);
    anchor.setHours(Math.floor(d.getHours() / 3) * 3, 0, 0, 0);
    const key = anchor.getTime();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
    if (key < minMs) minMs = key;
    if (key > maxMs) maxMs = key;
  }
  if (!Number.isFinite(minMs)) return [];

  // Walk whole days from the first entry's day to the last entry's
  // day, emitting all 8 blocks per day. Date iteration (setDate /
  // setHours) keeps this DST-correct — a 23/25-hour day still yields
  // exactly 8 calendar blocks.
  const out: ForecastEntry[] = [];
  const cursor = new Date(minMs);
  cursor.setHours(0, 0, 0, 0);
  const lastDay = new Date(maxMs);
  lastDay.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= lastDay.getTime()) {
    for (let blk = 0; blk < 8; blk++) {
      const anchor = new Date(cursor);
      anchor.setHours(blk * 3, 0, 0, 0);
      const slice = buckets.get(anchor.getTime()) ?? [];
      out.push(aggregateBlock(slice, anchor.toISOString()));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** True when a gap-filled block carries no data at all — every
 *  numeric field null and no condition. These are the padding blocks
 *  `aggregateThreeHourCalendar` emits for hours without source data. */
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

/** Trim data-less leading blocks off a gap-filled day-pager series.
 *
 *  Always drops WHOLE leading days (8-block groups) that are entirely
 *  empty — e.g. a recorder whose history is shorter than the `days:`
 *  window would otherwise page through blank days first.
 *
 *  With `allowPartialDayStart` (forecast-only mode), leading empty
 *  blocks of the first remaining day are dropped too: without a
 *  measured side there is nothing to anchor the calendar page to, and
 *  a card mounted in the evening would show a near-empty current-day
 *  page (data squeezed into the last blocks). Starting at the first
 *  data block turns the pages into rolling next-24-h windows — the
 *  natural framing when only a forecast exists. */
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

/** Mirror of `trimLeadingEmptyBlocks` for the series END. Always
 *  drops whole trailing empty days (defensive — the aggregator's last
 *  day always contains data); with `allowPartialDayEnd` (station-only
 *  mode) the empty evening blocks of the last day go too, so the
 *  series ends at the "now" block and the rightmost page is a full
 *  rolling last-24-h window instead of a half-blank current day. */
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

/** Initial-scroll / jump-to-now target for the 'today' day pager.
 *  The viewport must never open on a half-empty page, so the anchor
 *  depends on which sides carry data:
 *
 *    - station-only (no forecast blocks): the rolling LAST-24-h
 *      window — scroll to the far end, where the series was trimmed
 *      to finish at the "now" block.
 *    - forecast-only (no station blocks): the rolling NEXT-24-h
 *      window — scroll to the start, where the series was trimmed to
 *      begin at the first forecast block.
 *    - combination: the current calendar day's page (both sides
 *      populated); null when no block anchors at today's local
 *      midnight (caller falls back to the boundary-centred position). */
export function computeTodayPagerScrollLeft(opts: {
  forecasts: ReadonlyArray<{ datetime?: string }> | null | undefined;
  stationCount: number;
  forecastCount: number;
  contentWidth: number;
  viewportWidth: number;
  now?: Date;
}): number | null {
  const { forecasts, stationCount, forecastCount, contentWidth, viewportWidth } = opts;
  if (!forecasts?.length || !Number.isFinite(contentWidth) || contentWidth <= 0) return null;
  if (forecastCount <= 0 && stationCount > 0) {
    const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
    return Math.max(0, contentWidth - vw);
  }
  if (stationCount <= 0 && forecastCount > 0) return 0;
  return computeDayPageScrollLeft(forecasts, contentWidth, opts.now ?? new Date());
}

/** Effective viewport size in bars. 'today' is a DAY PAGER: the
 *  viewport always frames exactly one calendar day (8 × 3-h blocks),
 *  regardless of `number_of_forecasts` — that invariant is what makes
 *  "scroll one whole day" exact. Other modes keep the configured
 *  value (0 = fit-all, no scroll). */
export function effectiveVisibleBars(
  cfg: { forecast?: { type?: string; number_of_forecasts?: number | string } | null } | null | undefined,
): number {
  if (cfg?.forecast?.type === 'today') return 8;
  const n = parseInt(String(cfg?.forecast?.number_of_forecasts ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** ScrollLeft that puts the CURRENT local day's first block at the
 *  left edge — the initial position and jump-to-now target for the
 *  'today' day pager. Returns null when the series carries no block
 *  anchored at today's local midnight (caller falls back to the
 *  boundary-centred position). */
export function computeDayPageScrollLeft(
  forecasts: ReadonlyArray<{ datetime?: string }> | null | undefined,
  contentWidth: number,
  now: Date = new Date(),
): number | null {
  if (!forecasts?.length || !Number.isFinite(contentWidth) || contentWidth <= 0) return null;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const targetMs = midnight.getTime();
  const idx = forecasts.findIndex((e) => {
    if (!e?.datetime) return false;
    return new Date(e.datetime).getTime() === targetMs;
  });
  if (idx < 0) return null;
  return (idx / forecasts.length) * contentWidth;
}

/** Structural deep-equality for two forecast arrays. Used by the data
 *  source subscribe callbacks to skip re-renders when HA's
 *  WebSocket layer fan-outs an identical payload — common when one
 *  card's resubscribe causes HA to broadcast the entity's current
 *  state to every subscriber of that entity, including sibling
 *  weather-station-cards on the same dashboard.
 *
 *  Cost: ~1 ms for a 168-entry hourly forecast at typical entry size,
 *  cheaper than a full Lit re-render + Chart.js redraw. JSON.stringify
 *  is sufficient because forecast entries are flat objects with
 *  primitive values (number / string / null) in deterministic key
 *  order — no Map / Set / Date instances. */
export function forecastsEqual(
  a: ReadonlyArray<unknown> | null | undefined,
  b: ReadonlyArray<unknown> | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Returns the local-midnight start-of-today as ms-since-epoch. Pure
 *  helper used by the midnight-transition guards below — kept as a
 *  function (rather than `Date.now() - Date.now() % DAY_MS`) so each
 *  caller picks up the user's local timezone and DST behaviour. */
export function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Just past local midnight, forecast data can still carry yesterday's
// daily entry — HA weather integrations refresh on their own cadence
// (Open-Meteo a few times per day, Met.no every model run), so for
// some minutes after midnight the array can lead with a YYYY-MM-DD
// that is now yesterday's date. `filterMidnightStaleForecast` drops
// those. Applied in `_refreshForecasts` so the same today-boundary
// is used for the station + forecast merge.
//
// Earlier versions also dropped the trailing station-today entry when
// it carried no recorded data yet (temperature + templow + precipitation
// all null). That kicked the doubled-today framing off the wrong
// column and left the weekday labels stranded between ~00:00 and
// ~00:15 every day. The column is now always kept — partial values
// (e.g. 1 mm precip since midnight) render immediately, missing
// fields render as gaps just like an offline sensor on a historical
// day.

/** Drop forecast entries whose datetime is strictly before today's
 *  local midnight. Idempotent on already-clean arrays. Hourly forecasts
 *  pass through unchanged in practice (every hour from today onwards is
 *  "today or later"). */
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

/** 3-hour aggregator for the 'today' mode. Collapses each consecutive
 *  run of 3 hourly entries into one 3 h block. Temperature uses MAX
 *  and templow uses MIN across the block's real source-hour values —
 *  every chart point is an ACTUAL observed/forecast hourly value, not
 *  a derived mean. The previous mean approach gave a single line in
 *  the middle and a synthetic templow; max+min give two real lines
 *  (warmest hour, coolest hour of the 3-hour band). Other numeric
 *  fields use the mean (precipitation + sunshine: sum), the condition
 *  becomes the most-frequent value across the block, and the datetime
 *  anchors at the block's first hour. Trailing entries that don't
 *  fill a full block (e.g. station = 11 hours = 3+3+3+2) emit a
 *  partial block from whatever's left rather than dropping data.
 *
 *  Mean values are rounded to one decimal so chart-datalabels render
 *  as "11.1°" rather than "11.0666666666668°". The card's `round_temp`
 *  setting still applies on top via `hourlyTempSeries`. */
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

// ── Shared block-aggregation helpers ────────────────────────────────
// Field rules used by BOTH 3-hour aggregators (index-based above,
// calendar-aligned below): temperature high/low from the pooled real
// hourly values, precipitation + sunshine summed, other numerics
// averaged (1 decimal), condition = most frequent.

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

/** Aggregate one slice of hourly entries into a single block entry.
 *  `datetime` is caller-provided (index anchor for the classic
 *  aggregator, calendar anchor for the day-pager one). An empty slice
 *  yields an all-null block — the chart draws gaps there. */
function aggregateBlock<T extends Partial<ForecastEntry>>(
  slice: ReadonlyArray<T>,
  datetime: string,
): ForecastEntry {
  // Pool all real temperature readings in the block (both `temperature`
  // and `templow` when the source provides them). Both lines come from
  // this single pool so even a source that emits only `temperature` per
  // hour still yields a meaningful high/low pair per block.
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
    // Sum hourly sunshine duration over the block. Each hourly entry
    // carries 0..1 hours of sun (cap=day_length=1 in attachSunshine's
    // hourly path); summed across 3 hours, the block has 0..3 hours.
    // Capped against day_length=3 (set by the caller) when the chart
    // computes the bar fraction.
    sunshine: sumOf(slice, 'sunshine'),
    wind_speed: meanOf(slice, 'wind_speed'),
    wind_gust_speed: meanOf(slice, 'wind_gust_speed'),
    wind_bearing: meanOf(slice, 'wind_bearing'),
    pressure: meanOf(slice, 'pressure'),
    humidity: meanOf(slice, 'humidity'),
    uv_index: meanOf(slice, 'uv_index'),
    condition: modeOf(slice, 'condition'),
  };
}
