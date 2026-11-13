// Zero-degree rows: the current level of the 0 °C isotherm (the snow
// line) and its 48 h trend (#330, #333). Sensor-only; the unit is
// whatever the entity reports. Every number goes through
// `formatEntityNumber`, so the row, its tooltip and the popup agree.

import { html, nothing } from 'lit';
import { getDateTimeFormat } from '../utils/intl-cache.js';
import {
  classifySiteState,
  classifyZeroDegreeTrend,
  metresPerUnit,
  reachesSite,
  resolveElevation,
  siteStateIcon,
  snowLine,
  zeroDegreeTrendIcon,
} from '../zero-degree-trend.js';
import { attrEntity, formatEntityNumber, isPresent, type LivePanelCtx } from './context.js';

const CURRENT = 'zero_degree_level';
const TREND = 'zero_degree_level_48h';

/** Site elevation in metres (card option > sensor attribute > HA config). */
export function zeroDegreeElevation(ctx: LivePanelCtx): number | undefined {
  const attrsOf = (key: string) => {
    const eid = attrEntity(ctx.config, key, false);
    return eid ? ctx.hass?.states?.[eid]?.attributes : undefined;
  };
  return resolveElevation(ctx.config, [attrsOf(TREND), attrsOf(CURRENT)], ctx.hass);
}

/** A curve level as the 48 h sensor would show it; axis ticks drop the unit. */
export function zeroDegreeFormat(ctx: LivePanelCtx, level: number, withUnit = true): string {
  return formatEntityNumber(ctx, attrEntity(ctx.config, TREND, false), level, {
    unit: ctx.values.zero_degree_48h_unit,
    withUnit,
  });
}

/** Metres in the user's HA number format. The snow-line estimate and the
 *  elevation are always metres, whatever unit the sensor reports. */
export function formatMetres(ctx: LivePanelCtx, metres: number): string {
  const eid = attrEntity(ctx.config, CURRENT, false) || attrEntity(ctx.config, TREND, false);
  return formatEntityNumber(ctx, eid, metres, { unitOverride: 'm' });
}

/** "Köniz 581 m": the card title names the place when there is one. */
export function zeroDegreePlace(ctx: LivePanelCtx, elevation: number): string {
  const metres = formatMetres(ctx, elevation);
  const name = typeof ctx.config.title === 'string' ? ctx.config.title.trim() : '';
  return name ? `${name} ${metres}` : metres;
}

/** Weekday + clock of a curve point; the weekday sits in its own span so
 *  the narrow-card breakpoint can drop it and keep the time. */
export function zeroDegreeWhen(ctx: LivePanelCtx, t: number): { day: string; time: string } {
  const d = new Date(t);
  const timeZone = ctx.calendar.timeZone;
  return {
    day: getDateTimeFormat(ctx.language, { weekday: 'short', timeZone }).format(d),
    time: getDateTimeFormat(ctx.language, {
      hour: 'numeric', minute: 'numeric', hour12: ctx.config.use_12hour_format, timeZone,
    }).format(d),
  };
}

// The icon tells where the estimated snow line lies relative to the site
// (#333); without a known elevation it stays the plain snowflake.
export function climateRowZeroDegree(ctx: LivePanelCtx, show: boolean, value: unknown, unit: string | undefined) {
  if (!show || !isPresent(value)) return null;
  const eid = attrEntity(ctx.config, CURRENT, false);
  const text = formatEntityNumber(ctx, eid, value, { unit });
  const level = Number(value);
  const elevation = zeroDegreeElevation(ctx);
  const perUnit = metresPerUnit(unit);
  const state = classifySiteState(Number.isFinite(level) ? level : undefined, elevation, perUnit);
  const row = html`${ctx.zeroDegreeLink(eid,
    html`<ha-icon icon="${siteStateIcon(state)}"></ha-icon> ${text}`)}`;
  if (state === 'unknown' || elevation === undefined) return row;
  const line = formatMetres(ctx, Math.round(snowLine(level, perUnit)));
  const title = `${ctx.str('zero_degree_snow_line').replace('{level}', line)}, `
    + `${zeroDegreePlace(ctx, elevation)} · ${ctx.str(`zero_degree_site_${state}`)}`;
  return html`<span title=${title} aria-label=${title}>${row}</span>`;
}

type TrendView = NonNullable<ReturnType<typeof classifyZeroDegreeTrend>>;

function trendTitle(ctx: LivePanelCtx, view: TrendView, nowLevel: number | undefined, whenText: string): string {
  const fmt = (level: number, withUnit = true) => zeroDegreeFormat(ctx, level, withUnit);
  if (view.trend === 'stable') {
    return ctx.str('zero_degree_stays_between')
      .replace('{min}', fmt(view.min, false))
      .replace('{max}', fmt(view.max));
  }
  const { target, next } = view;
  const sentence = ctx.str('zero_degree_trend_to')
    .replace('{trend}', ctx.str(`zero_degree_trend_${view.trend}`))
    .replace('{level}', fmt(target.level))
    .replace('{time}', whenText);
  let title = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  if (nowLevel !== undefined) title += ` · ${ctx.str('next_rain_now').toLowerCase()} ${fmt(nowLevel)}`;
  if (next) {
    const nextWhen = zeroDegreeWhen(ctx, next.t);
    title += ` · ${ctx.str(next.level > target.level ? 'zero_degree_then_up' : 'zero_degree_then_down')
      .replace('{level}', fmt(next.level))
      .replace('{time}', `${nextWhen.day} ${nextWhen.time}`)}`;
  }
  return title;
}

// Trend row (`sensors.zero_degree_level_48h`, #333): with the sensor's
// `forecast` curve the value is the target of the next movement (lowest
// or highest level, weekday/time) and the icon its direction and pace.
// When the target's snow line reaches the site, the value takes the
// precipitation colour and a snowflake. Without a curve: the fallback.
export function climateRowZeroDegree48h(
  ctx: LivePanelCtx,
  value: unknown,
  unit: string | undefined,
  change: number | undefined,
  at?: string,
  nowValue?: unknown,
) {
  if (!isPresent(value)) return null;
  const curve = ctx.values.zero_degree_curve;
  const now = Date.now();
  const nowNum = isPresent(nowValue) ? Number(nowValue) : NaN;
  const nowLevel = Number.isFinite(nowNum) ? nowNum : curve?.find((p) => p.t >= now)?.level;
  const perUnit = metresPerUnit(unit);
  const view = curve && nowLevel !== undefined
    ? classifyZeroDegreeTrend(curve, nowLevel, now, perUnit)
    : null;
  if (!view) return zeroDegree48hFallback(ctx, value, unit, change, at, nowValue);

  const eid = attrEntity(ctx.config, TREND, false);
  const { target } = view;
  const when = zeroDegreeWhen(ctx, target.t);
  const whenText = `${when.day} ${when.time}`;
  const elevation = zeroDegreeElevation(ctx);
  const reaches = reachesSite(target.level, elevation, perUnit);

  let title = trendTitle(ctx, view, nowLevel, whenText);
  if (reaches && elevation !== undefined) {
    title += ` · ${ctx.str('zero_degree_snow_to_site')
      .replace('{place}', zeroDegreePlace(ctx, elevation))
      .replace('{time}', whenText)}`;
  }
  // The chart bars' colour, a CSS colour or var(...) from the card config.
  const reachStyle = reaches
    ? `color: ${ctx.config.forecast?.precipitation_color || 'rgba(132, 209, 253, 1.0)'}`
    : nothing;
  const row = html`${ctx.zeroDegreeLink(eid,
    html`<ha-icon icon="${zeroDegreeTrendIcon(view.trend)}"></ha-icon> <span class="wsc-zd-target" style=${reachStyle}>${reaches ? '❄ ' : ''}${zeroDegreeFormat(ctx, target.level)} <span class="wsc-zd-day">${when.day}</span> ${when.time}</span>`)}`;
  return html`<span title=${title} aria-label=${title}>${row}</span>`;
}

// Trend row without a usable curve: value + arrow from the `change`
// attribute (within ±100 m counts as steady), as in v2.12. An `at`
// attribute (ISO datetime of the minimum) adds a tooltip with the lowest
// value, its weekday/time and, when known, the current level.
export function zeroDegree48hFallback(
  ctx: LivePanelCtx,
  value: unknown,
  unit: string | undefined,
  change: number | undefined,
  at?: string,
  nowValue?: unknown,
) {
  const eid = attrEntity(ctx.config, TREND, false);
  const text = formatEntityNumber(ctx, eid, value, { unit });
  let trendIcon = '';
  if (change !== undefined) {
    if (Math.abs(change) < 100) trendIcon = 'mdi:trending-neutral';
    else trendIcon = change > 0 ? 'mdi:trending-up' : 'mdi:trending-down';
  }
  const atDate = at ? new Date(at) : null;
  let title = '';
  if (atDate && !Number.isNaN(atDate.getTime())) {
    const when = getDateTimeFormat(ctx.language, {
      weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: ctx.config.use_12hour_format,
      timeZone: ctx.calendar.timeZone,
    }).format(atDate);
    title = `${ctx.str('zero_degree_lowest')} ${text} ${when}`;
    if (isPresent(nowValue)) {
      const nowText = formatEntityNumber(ctx, attrEntity(ctx.config, CURRENT, false), nowValue, { unit });
      title += ` · ${ctx.str('next_rain_now').toLowerCase()} ${nowText}`;
    }
  }
  const row = html`${ctx.zeroDegreeLink(eid,
    html`<ha-icon icon="mdi:snowflake-thermometer"></ha-icon> <small>48 h</small> ${text}${trendIcon ? html` <ha-icon icon="${trendIcon}"></ha-icon>` : ''}`)}`;
  return title ? html`<span title=${title} aria-label=${title}>${row}</span>` : row;
}
