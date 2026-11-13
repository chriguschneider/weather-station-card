// Sun column rows: sun strength (UV / illuminance), sunrise + sunset,
// moon. Sun and moon are computed in-card from the card location
// (src/moon.ts, ADR-0022). Each row derives its data once; the template
// and the sources-popup text both read from it.

import { html } from 'lit';
import { classifySunStrength, formatLux } from '../sun-strength.js';
import { resolveLocation } from '../location.js';
import { litMoonPath, moonIllumination, nextMoonEvent, sunTimes } from '../moon.js';
import { getDateTimeFormat, getNumberFormat } from '../utils/intl-cache.js';
import { attrEntity, isPresent, type LivePanelCtx } from './context.js';

export function uvText(uv: number): string {
  return `UV ${Math.round(uv * 10) / 10}`;
}

/** Site lat/lon for the clear-sky reference and the moon events: the
 *  card's `location`, else HA's. */
export function siteCoords(ctx: LivePanelCtx): { lat: number | null; lon: number | null } {
  const loc = resolveLocation(ctx.config, ctx.hass);
  return { lat: loc ? loc.latitude : null, lon: loc ? loc.longitude : null };
}

function clockFormat(ctx: LivePanelCtx) {
  return getDateTimeFormat(ctx.language, {
    hour12: ctx.config.use_12hour_format,
    hour: 'numeric',
    minute: 'numeric',
    timeZone: ctx.calendar.timeZone,
  });
}

function sunStrengthTitle(
  ctx: LivePanelCtx,
  out: ReturnType<typeof classifySunStrength>,
  showUvSegment: boolean,
  showLuxSegment: boolean,
): string {
  if (out.mode === 'night') return ctx.str('sun_strength_night_reason');
  const parts: string[] = [];
  if (out.bandLocaleKey && showUvSegment) parts.push(`${uvText(out.uv ?? 0)} (${ctx.str(out.bandLocaleKey)})`);
  if (out.cloudPct != null && showLuxSegment) parts.push(`${out.cloudPct}% of clear sky`);
  if (out.protectionAdvised && showUvSegment) parts.push(ctx.str('sun_strength_protection_advised'));
  return parts.join(' · ');
}

export function sunRowSunStrength(
  ctx: LivePanelCtx,
  showUv: boolean,
  showLux: boolean,
  uvIndex: unknown,
  illuminance: unknown,
  lat: number | null,
  lon: number | null,
) {
  const uvWired = isPresent(uvIndex);
  const luxWired = isPresent(illuminance);
  if (!showUv && !showLux) return null;
  if (!uvWired && !luxWired) return null;

  const uvNum = uvWired ? parseFloat(String(uvIndex)) : NaN;
  const luxNum = luxWired ? parseFloat(String(illuminance)) : NaN;
  const out = classifySunStrength({
    uv: Number.isFinite(uvNum) ? uvNum : null,
    lux: Number.isFinite(luxNum) ? luxNum : null,
    lat,
    lon,
    calendar: ctx.calendar,
  });

  const showUvSegment = showUv && out.uv != null;
  const showLuxSegment = showLux && out.lux != null;
  if (!showUvSegment && !showLuxSegment) return null;

  const title = sunStrengthTitle(ctx, out, showUvSegment, showLuxSegment);
  const valueText = [
    showUvSegment ? uvText(out.uv ?? 0) : '',
    showLuxSegment ? formatLux(out.lux) : '',
  ].filter(Boolean).join(' / ');

  // Link priority mirrors the value's own precedence: the UV sensor when
  // the UV segment shows, else the illuminance sensor, else the weather
  // entity the UV fallback came from.
  const sensors = ctx.config.sensors ?? {};
  const strengthEntity = (showUvSegment && typeof sensors.uv_index === 'string' && sensors.uv_index)
    || (typeof sensors.illuminance === 'string' && sensors.illuminance)
    || attrEntity(ctx.config, 'uv_index');
  return html`<span title=${title} aria-label=${title}>${ctx.entityLink(strengthEntity || undefined,
    html`<ha-icon icon="hass:${out.iconShape}"></ha-icon> ${valueText}`)}</span>`;
}

/** Today's sunrise + sunset for the card's calendar day, tomorrow's once
 *  both are past. Null without a location or when the sun does not cross
 *  the horizon (polar day / night). */
export function sunEventTimes(ctx: LivePanelCtx): { rise: string; set: string } | null {
  const loc = resolveLocation(ctx.config, ctx.hass);
  if (!loc) return null;
  const now = new Date();
  const noon = ctx.calendar.withHour(now, 12);
  let { sunrise, sunset } = sunTimes(noon, loc.latitude, loc.longitude);
  if (sunrise && sunset && sunrise < now && sunset < now) {
    ({ sunrise, sunset } = sunTimes(ctx.calendar.addDays(noon, 1), loc.latitude, loc.longitude));
  }
  if (!sunrise || !sunset) return null;
  const fmt = clockFormat(ctx);
  return { rise: fmt.format(sunrise), set: fmt.format(sunset) };
}

// Both sun events share one line (rise first, set second); the moon is
// its own line since ADR-0025.
export function renderSun(ctx: LivePanelCtx) {
  const t = sunEventTimes(ctx);
  if (!t) return null;
  return html`
    <ha-icon icon="mdi:weather-sunset-up"></ha-icon>
      ${t.rise}
    <ha-icon icon="mdi:weather-sunset-down"></ha-icon>
      ${t.set}
  `;
}

export function sunRowSun(ctx: LivePanelCtx, show: boolean) {
  if (!show) return null;
  const tpl = renderSun(ctx);
  return tpl === null ? null : html`<span>${tpl}</span>`;
}

export function sunText(ctx: LivePanelCtx): string {
  const t = sunEventTimes(ctx);
  return t ? `${t.rise} ${t.set}` : '';
}

interface MoonLine {
  fraction: number;
  litRight: boolean;
  pct: string;
  event?: { icon: string; time: string };
}

function moonLine(ctx: LivePanelCtx): MoonLine {
  const now = new Date();
  const { fraction, waxing } = moonIllumination(now);
  // Missing coordinates drop the rise/set part; the illumination is
  // geocentric and renders regardless.
  const { lat, lon } = siteCoords(ctx);
  // Southern-hemisphere observers see the moon mirrored.
  const litRight = lat !== null && lat < 0 ? !waxing : waxing;
  const pct = getNumberFormat(ctx.language, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
  const ev = lat !== null && lon !== null ? nextMoonEvent(now, lat, lon, ctx.calendar) : undefined;
  if (!ev) return { fraction, litRight, pct };
  return {
    fraction,
    litRight,
    pct,
    event: {
      icon: ev.kind === 'rise' ? 'mdi:weather-moonset-up' : 'mdi:weather-moonset-down',
      time: clockFormat(ctx).format(ev.time),
    },
  };
}

// Moon line: the illuminated fraction as a drawn disc + percentage, then
// the next moonrise or moonset. Text-free by design, so no locale strings.
export function renderMoonLine(ctx: LivePanelCtx) {
  const m = moonLine(ctx);
  const evPart = m.event
    ? html` <ha-icon icon="${m.event.icon}"></ha-icon>
        ${m.event.time}`
    : html``;
  // True-to-nature colours in both themes (lit = white, shadow = black);
  // only the outline uses currentColor so the edge shows on any background.
  return html`<svg class="wsc-moon" viewBox="0 0 24 24" aria-hidden="true"><circle
        cx="12" cy="12" r="9.5" fill="#000"></circle><path
        d=${litMoonPath(m.fraction, m.litRight)} fill="#fff"></path><circle
        cx="12" cy="12" r="9.5" fill="none" stroke="currentColor"
        stroke-width="1"></circle></svg>
      ${m.pct}${evPart}`;
}

export function moonText(ctx: LivePanelCtx): string {
  const m = moonLine(ctx);
  return m.event ? `${m.pct} ${m.event.time}` : m.pct;
}
