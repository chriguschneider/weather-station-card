// Forecast pipeline: turns the station series, the weather entity's
// forecast and the Open-Meteo source into the chart's entries, plus the
// source plan that says which part comes from where. main.ts wires the
// data sources and owns the state; the decisions live here, so the
// Open-Meteo fetch gate (ADR-0015/0027/0028) and the info popup's
// legend read the same plan instead of re-deriving the rules. Pure.

import type { CardConfig } from './card-config.js';
import type { SunshineParts } from './chart-legend.js';
import {
  aggregateThreeHourCalendar,
  filterMidnightStaleForecast,
  normalizeForecastMode,
  startOfTodayMs,
  trimLeadingEmptyBlocks,
  trimToWholeDayEnd,
  trimToWholeDayStart,
  trimTrailingEmptyBlocks,
} from './forecast-utils.js';
import { pastFromOpenMeteo, hasStationSensor } from './past-source.js';
import { forecastHasProbability, overlayPrecipProbability, type ProbabilitySource } from './precip-probability.js';
import {
  attachEntitySunshine,
  entitySunshineHours,
  overlayFromOpenMeteo,
  type SunshineSource,
} from './sunshine-source.js';
import type { Calendar } from './utils/time-zone.js';

export type ForecastType = 'daily' | 'hourly' | 'today';
export type Granularity = 'daily' | 'hourly';

export interface PipelineEntry {
  datetime?: string;
  sunshine?: number | null;
  sunshine_duration?: unknown;
  [k: string]: unknown;
}

// The part of OpenMeteoSource the pipeline reads.
export type OpenMeteoReader = Partial<SunshineSource> & Partial<ProbabilitySource> & {
  getDailyStationForecast?: () => PipelineEntry[] | null;
  getHourlyStationForecast?: () => PipelineEntry[] | null;
};

// Kasten exponent for the cloud-cover sunshine estimate (F3) when
// `condition_mapping.sunshine_cloud_exponent` is unset (ADR-0002).
const DEFAULT_CLOUD_EXPONENT = 1.7;

export interface SourcePlan {
  type: ForecastType;
  granularity: Granularity;
  // Past block: the recorder (station sensors), Open-Meteo (ADR-0015),
  // or null when the block is off.
  past: 'recorder' | 'openmeteo' | null;
  // The weather entity's forecast, cut to the visible window.
  forecastSlice: PipelineEntry[];
  // Where each part of the sunshine bar comes from (ADR-0028).
  sunshine: SunshineParts;
  // Exponent of the cloud-cover estimate that fills sunshine gaps; null
  // when the estimate is off (hourly / today, or disabled in YAML).
  cloudExponent: number | null;
  // Chance-of-rain row on (ADR-0027).
  precipProbability: boolean;
  // Why the Open-Meteo source is needed; none true = no request.
  openMeteo: { past: boolean; sunshine: boolean; precipProbability: boolean };
}

export interface ForecastEntries {
  entries: PipelineEntry[];
  stationCount: number;
  forecastCount: number;
}

export interface PipelineContext {
  plan: SourcePlan;
  calendar: Calendar;
  hass: unknown;
  openMeteo: OpenMeteoReader | null;
  location: unknown;
}

function typeOf(cfg: CardConfig): ForecastType {
  return normalizeForecastMode(cfg).config.forecast.type as ForecastType;
}

/** The entity forecast cut to the chart window. `days` / `forecast_days`
 *  define it in daily and hourly mode alike (24 slots per day when
 *  hourly); 'today' (the day pager) uses the hourly window. */
export function sliceForecast(
  cfg: CardConfig,
  forecastData: ReadonlyArray<PipelineEntry> | null | undefined,
  calendar: Calendar,
  todayStartMs: number = startOfTodayMs(calendar),
): PipelineEntry[] {
  if (cfg.show_forecast !== true || !cfg.weather_entity) return [];
  const hourlyish = typeOf(cfg) !== 'daily';
  const limit = cfg.forecast_days * (hourlyish ? 24 : 1);
  const sliced = filterMidnightStaleForecast(forecastData ?? [], todayStartMs).slice(0, limit);
  // Hourly-ish modes end on a whole calendar day: the count cap lands
  // mid-day and would grow a one-hour sliver on the day timeline.
  return hourlyish ? trimToWholeDayEnd(sliced, calendar) : sliced;
}

function cloudExponent(cfg: CardConfig, granularity: Granularity): number | null {
  if (granularity !== 'daily') return null;
  const exp = cfg.condition_mapping?.sunshine_cloud_exponent;
  return exp != null && Number.isFinite(exp) ? Number(exp) : DEFAULT_CLOUD_EXPONENT;
}

// Station sunshine: the sensor (or the lux derivation) fills it only
// in daily mode; the hourly recorder builder carries none. `needsOm`
// is true when Open-Meteo has to fill the station columns.
function stationSunshine(cfg: CardConfig, type: ForecastType, om: boolean): { part: SunshineParts['station']; needsOm: boolean } {
  if (cfg.show_station === false || !hasStationSensor(cfg.sensors)) return { part: null, needsOm: false };
  const fromSensor = type === 'daily' && (!!cfg.sensors.sunshine_duration || !!cfg.sensors.illuminance);
  if (fromSensor) return { part: 'sensor', needsOm: false };
  return { part: om ? 'openmeteo' : null, needsOm: true };
}

// Forecast sunshine: the entity's `sunshine_duration` where it has one,
// Open-Meteo for the gaps unless the master switch is off.
function forecastSunshine(covered: number, total: number, om: boolean): SunshineParts['forecast'] {
  if (total === 0) return null;
  if (covered === total) return 'entity';
  if (covered > 0) return om ? 'mixed' : 'entity';
  return om ? 'openmeteo' : null;
}

function pastPart(cfg: CardConfig, pastOm: boolean): SourcePlan['past'] {
  if (cfg.show_station === false) return null;
  return pastOm ? 'openmeteo' : 'recorder';
}

/** Which part of the chart comes from which upstream, and whether the
 *  Open-Meteo source is needed at all. An absent forecast counts as
 *  "the entity covers it": the plan is re-made on every arrival. */
export function planSources(
  cfg: CardConfig,
  forecastData: ReadonlyArray<PipelineEntry> | null | undefined,
  calendar: Calendar,
): SourcePlan {
  const type = typeOf(cfg);
  const granularity: Granularity = type === 'daily' ? 'daily' : 'hourly';
  const om = cfg.forecast?.openmeteo !== false;
  const pastOm = pastFromOpenMeteo(cfg);
  const slice = sliceForecast(cfg, forecastData, calendar);
  const station = stationSunshine(cfg, type, om);
  const covered = slice.filter((e) => entitySunshineHours(e) != null).length;
  const showSunshine = cfg.forecast?.show_sunshine === true;
  const precipProbability = cfg.forecast?.show_precip_probability === true;
  const raw = Array.isArray(forecastData) ? forecastData : [];

  return {
    type,
    granularity,
    past: pastPart(cfg, pastOm),
    forecastSlice: slice,
    sunshine: { station: station.part, forecast: forecastSunshine(covered, slice.length, om) },
    cloudExponent: cloudExponent(cfg, granularity),
    precipProbability,
    openMeteo: {
      past: pastOm,
      sunshine: om && showSunshine && (station.needsOm || covered < slice.length),
      precipProbability: om && precipProbability && raw.length > 0 && !forecastHasProbability(raw),
    },
  };
}

export function needsOpenMeteo(plan: SourcePlan): boolean {
  return plan.openMeteo.past || plan.openMeteo.sunshine || plan.openMeteo.precipProbability;
}

/** Chance-of-rain overlay (ADR-0027) on the entries from `fromIndex` on;
 *  measured station entries never get a probability. */
export function withPrecipProbability(
  entries: PipelineEntry[],
  fromIndex: number,
  ctx: PipelineContext,
  granularity: Granularity,
): PipelineEntry[] {
  if (!ctx.plan.precipProbability) return entries;
  if (!entries.length || fromIndex >= entries.length) return entries;
  const head = entries.slice(0, fromIndex);
  const tail = overlayPrecipProbability(entries.slice(fromIndex), ctx.openMeteo, ctx.calendar, granularity);
  return head.length ? [...head, ...tail] : tail;
}

function overlaySunshine(entries: PipelineEntry[], ctx: PipelineContext, granularity: Granularity): PipelineEntry[] {
  return overlayFromOpenMeteo(
    entries,
    ctx.hass as Parameters<typeof overlayFromOpenMeteo>[1],
    ctx.openMeteo,
    ctx.calendar,
    granularity,
    granularity === 'daily' ? ctx.plan.cloudExponent : null,
    ctx.location,
  );
}

function datetimeMs(entry: PipelineEntry | undefined): number {
  return new Date(entry?.datetime ?? '').getTime();
}

// 'today' (day pager): hourly sunshine per entry, then calendar-aligned
// 3-hour blocks over the merged series, gap-filled to whole days. A
// boundary block holding both measured and forecast hours counts as
// station (measured wins).
function buildToday(station: PipelineEntry[], forecast: PipelineEntry[], ctx: PipelineContext): ForecastEntries {
  const { calendar } = ctx;
  const merged = overlaySunshine(
    [...station, ...withPrecipProbability(forecast, 0, ctx, 'hourly')],
    ctx,
    'hourly',
  );
  const allBlocks = aggregateThreeHourCalendar(merged, calendar);
  // Drop data-less leading blocks: whole empty days always, and without
  // a station side the empty start of the first day too, so an evening
  // mount doesn't open on a near-blank page.
  const blocks = trimTrailingEmptyBlocks(
    trimLeadingEmptyBlocks(allBlocks, station.length === 0),
    forecast.length === 0,
  );
  for (const e of blocks) e.day_length = 3;

  let lastStationAnchorMs = -Infinity;
  const lastMs = station.length ? datetimeMs(station[station.length - 1]) : NaN;
  if (Number.isFinite(lastMs)) {
    const d = new Date(lastMs);
    lastStationAnchorMs = calendar.withHour(d, Math.floor(calendar.hourOf(d) / 3) * 3).getTime();
  }
  let stationCount = 0;
  for (const b of blocks) {
    if (new Date(b.datetime).getTime() <= lastStationAnchorMs) stationCount++;
    else break;
  }
  return { entries: blocks as unknown as PipelineEntry[], stationCount, forecastCount: blocks.length - stationCount };
}

/** The chart entries: station history, then the forecast trimmed to
 *  start after the station's last bucket, with sunshine and chance of
 *  rain overlaid as the plan says. */
export function buildForecastEntries(
  stationData: ReadonlyArray<PipelineEntry> | null | undefined,
  ctx: PipelineContext,
): ForecastEntries {
  const { plan } = ctx;
  const station = plan.past ? [...(stationData ?? [])] : [];
  // Providers anchor forecasts differently (MeteoSwiss at the next full
  // hour, Open-Meteo at the current one, already in the station's last
  // bucket); a doubled boundary column would also misalign the icon
  // row. Station is observed truth, so trim the forecast. Daily entries
  // on both sides sit at the card's midnight (#355): the forecast's own
  // today stays, which is the doubled-today column.
  const lastStationMs = station.length ? datetimeMs(station[station.length - 1]) : -Infinity;
  const isDaily = plan.type === 'daily';
  const trimmed = Number.isFinite(lastStationMs)
    ? plan.forecastSlice.filter((e) => {
        const t = datetimeMs(e);
        return !Number.isFinite(t) || t > lastStationMs || (isDaily && t === lastStationMs);
      })
    : plan.forecastSlice;
  // The entity's own sunshine goes on first (ADR-0028); the overlays
  // keep it and only fill the entries without one.
  const forecast = attachEntitySunshine(trimmed);

  if (plan.type === 'today') return buildToday(station, forecast, ctx);
  return {
    entries: overlaySunshine(
      [...station, ...withPrecipProbability(forecast, 0, ctx, plan.granularity)],
      ctx,
      plan.granularity,
    ),
    stationCount: station.length,
    forecastCount: forecast.length,
  };
}

/** Re-run the sunshine and chance-of-rain overlays on already-built
 *  daily / hourly entries after an Open-Meteo arrival. Not for 'today',
 *  whose 3-hour blocks need a full rebuild. */
export function overlayOnEntries(
  entries: ReadonlyArray<PipelineEntry>,
  stationCount: number,
  ctx: PipelineContext,
): PipelineEntry[] {
  const { granularity } = ctx.plan;
  return withPrecipProbability(overlaySunshine([...entries], ctx, granularity), stationCount, ctx, granularity);
}

/** The past window of the Open-Meteo series, shaped like the recorder
 *  output for the chart mode: the last `days` daily entries up to
 *  today, or the last `days * 24` hourly entries up to the current
 *  hour, the oldest day trimmed to a whole day. Future entries belong
 *  to the weather entity's forecast and would trim it away. */
export function openMeteoStationWindow(
  src: OpenMeteoReader | null | undefined,
  cfg: CardConfig,
  calendar: Calendar,
  nowMs: number = Date.now(),
): PipelineEntry[] {
  if (!src) return [];
  const before = (all: PipelineEntry[] | null | undefined, limitMs: number, inclusive: boolean) =>
    (all ?? []).filter((e) => {
      const t = datetimeMs(e);
      return Number.isFinite(t) && (inclusive ? t <= limitMs : t < limitMs);
    });

  if (typeOf(cfg) === 'daily') {
    if (typeof src.getDailyStationForecast !== 'function') return [];
    const tomorrowMs = calendar.addDays(calendar.startOfDay(nowMs), 1).getTime();
    return before(src.getDailyStationForecast(), tomorrowMs, false).slice(-cfg.days);
  }
  if (typeof src.getHourlyStationForecast !== 'function') return [];
  const nowHourMs = calendar.startOfHour(nowMs).getTime();
  const past = before(src.getHourlyStationForecast(), nowHourMs, true);
  return trimToWholeDayStart(past.slice(-cfg.days * 24), calendar);
}

/** The Open-Meteo request window. Each value is baked into the URL. */
export function openMeteoFetchWindow(cfg: CardConfig): { pastDays: number; forecastDays: number; includeHourly: boolean } {
  return {
    // +1 covers today's column when the station block ends at today's
    // local midnight. 92 / 16 are Open-Meteo's past_days / forecast_days
    // maxima (https://open-meteo.com/en/docs).
    pastDays: Math.min(92, cfg.days + 1),
    forecastDays: Math.min(16, cfg.forecast_days + 1),
    includeHourly: typeOf(cfg) !== 'daily',
  };
}
