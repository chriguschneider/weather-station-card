// Forecast block of the card (#472, ADR-0010 amendment): the chart
// container with its per-column rows, the mode toggle, the scroll
// controls, the scroll timeline and the loading skeleton. Plain
// functions over `ForecastBlockCtx`; main.ts builds the context and
// keeps the chart lifecycle, the animation state and the event wiring.

import { html, type TemplateResult } from 'lit';
import { guard } from 'lit/directives/guard.js';
import { weatherIcons } from '../const.js';
import { sanitizeForecastEntries } from '../chart/sanitize.js';
import { renderChartSkeleton } from '../chart/skeleton.js';
import { spriteIcon } from '../live-panel/wind-rows.js';
import { startOfTodayMs } from '../forecast-utils.js';
import { getDateTimeFormat } from '../utils/intl-cache.js';
import type { Calendar } from '../utils/time-zone.js';

export interface ForecastBlockConfig {
  show_station?: boolean;
  show_forecast?: boolean;
  show_main?: boolean;
  weather_entity?: string;
  forecast: {
    type?: string;
    show_mode_toggle?: boolean;
    disable_animation?: boolean;
    condition_icons?: boolean;
    show_wind_forecast?: boolean;
    show_wind_arrow?: boolean;
    show_wind_speed?: boolean;
    chart_height?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ForecastEntryLike {
  datetime?: string;
  condition?: string;
}

export interface ForecastBlockCtx {
  config: ForecastBlockConfig;
  /** Every expected data source produced a value; else the skeleton. */
  ready: boolean;
  scrolling: boolean;
  contentWidthPct: number;
  visibleBars: number;
  forecasts: readonly unknown[] | null | undefined;
  forecastItems: number | undefined;
  unitSpeed: string | undefined;
  calendar: Calendar;
  language: string;
  /** Start animation has played (see the card's view-change tracking). */
  mountAnimationPlayed: boolean;
  /** forecast.type of the last rendered block. */
  lastForecastType: string | undefined;
  /** Generation key whose rows are fully rendered (ADR-0016). */
  rowsReadyGen: string;
  onModeToggle: (ev: Event) => void;
  /** Lazy, so the wind row stays under the guard below. */
  renderWind: () => unknown;
  /** The sources info button for the chart corner, or ''. */
  renderSourcesButton: () => unknown;
}

// Changes with the forecast mode or the column count (cold mount, mode
// toggle, data-shape change), so each fresh chart re-defers its rows
// (ADR-0016). A same-shape refresh keeps the key and the rows.
export function forecastRowsGenKey(
  type: string | undefined,
  forecasts: readonly unknown[] | null | undefined,
): string {
  return `${type ?? 'daily'}|${forecasts?.length ?? 0}`;
}

// Animation class for this render: never rendered → 'first-mount'
// (slide-up + fade-in); forecast.type just changed → 'view-changing'
// (opacity dip); otherwise none.
export function forecastAnimClass(
  mountAnimationPlayed: boolean,
  lastForecastType: string | undefined,
  type: string | undefined,
): string {
  if (!mountAnimationPlayed) return 'first-mount';
  if (lastForecastType !== type) return 'view-changing';
  return '';
}

function rowsEnabled(config: ForecastBlockConfig): { conditions: boolean; wind: boolean } {
  const fc = config.forecast;
  return {
    conditions: fc.condition_icons !== false,
    wind: fc.show_wind_forecast !== false
      && (fc.show_wind_arrow !== false || fc.show_wind_speed !== false),
  };
}

interface ModeToggleCopy { icon: string; label: string }

// 3-way cycle daily → today → hourly → daily. The icon shows the NEXT
// mode, so the click is predictable.
function modeToggleCopy(type: string | undefined): ModeToggleCopy {
  if (type === 'today') return { icon: 'mdi:weather-sunset', label: 'Switch to hourly (7-day) forecast' };
  if (type === 'hourly') return { icon: 'mdi:calendar-month-outline', label: 'Switch to daily forecast' };
  return { icon: 'mdi:clock-time-eight-outline', label: 'Switch to today (24-hour) forecast' };
}

// Small circular button on the chart at the precipitation baseline.
// Shown whenever a station or forecast block renders: forecast.type
// drives both the recorder period and the forecast subscription.
export function renderModeToggle(
  config: Pick<ForecastBlockConfig, 'show_station' | 'show_forecast' | 'weather_entity'> & { forecast?: ForecastBlockConfig['forecast'] },
  onToggle: (ev: Event) => void,
): TemplateResult {
  // Opt-out keeps the card pinned to the configured forecast.type.
  if (config.forecast?.show_mode_toggle === false) return html``;
  const showsStation = config.show_station !== false;
  const showsForecast = config.show_forecast === true && !!config.weather_entity;
  if (!showsStation && !showsForecast) return html``;
  const { icon, label } = modeToggleCopy(config.forecast?.type);
  return html`
    <button type="button" class="mode-toggle" aria-label="${label}"
            title="${label}"
            @click=${onToggle}>
      <ha-icon icon=${icon} aria-hidden="true"></ha-icon>
    </button>
  `;
}

interface TimelineSeg { start: number; count: number; ms: number }

/** One segment per calendar day of the series, in column units. */
export function timelineSegments(
  forecasts: readonly ForecastEntryLike[],
  calendar: Calendar,
): TimelineSeg[] {
  const segs: TimelineSeg[] = [];
  let curKey = '';
  for (let i = 0; i < forecasts.length; i++) {
    const dt = forecasts[i]?.datetime;
    if (!dt) continue;
    const d = new Date(dt);
    if (!Number.isFinite(d.getTime())) continue;
    const key = calendar.dayKey(d);
    if (key !== curKey) {
      curKey = key;
      segs.push({ start: i, count: 0, ms: calendar.startOfDay(d).getTime() });
    }
    segs[segs.length - 1].count++;
  }
  return segs;
}

// Scroll timeline / minimap for the scrolling hourly-ish modes: one
// segment per day (width = its share of the columns), today bold, and a
// thumb for the visible section. scroll-ux positions the thumb and binds
// the pointer interaction; this renders only the static track.
export function renderScrollTimeline(
  forecasts: readonly unknown[] | null | undefined,
  calendar: Calendar,
  language: string,
  visibleBars: number,
): TemplateResult {
  const fc = (forecasts ?? []) as readonly ForecastEntryLike[];
  const total = fc.length;
  if (total < 2) return html``;
  const segs = timelineSegments(fc, calendar);
  if (!segs.length) return html``;

  const todayMs = startOfTodayMs(calendar);
  const wdFmt = getDateTimeFormat(language, { weekday: 'short', timeZone: calendar.timeZone });
  const dayFmt = getDateTimeFormat(language, { day: 'numeric', timeZone: calendar.timeZone });
  const thumbPct = visibleBars > 0 ? Math.min(100, (visibleBars / total) * 100) : 100;

  // The track is NOT aria-hidden: it carries real day labels, and an
  // interactive element hidden from assistive tech is a WCAG smell.
  // Keyboard users use the chevron buttons; the thumb is decoration.
  return html`
    <div class="scroll-timeline">
      ${segs.map((s) => html`
        <div class="tl-seg ${s.ms === todayMs ? 'tl-today' : ''}"
             style="left:${(s.start / total) * 100}%;width:${(s.count / total) * 100}%">
          <span class="tl-seg-label">${wdFmt.format(new Date(s.ms))} ${dayFmt.format(new Date(s.ms))}</span>
        </div>
      `)}
      <div class="tl-thumb" aria-hidden="true" style="left:0%;width:${thumbPct}%"></div>
    </div>
  `;
}

// One condition glyph per column, as an inline-SVG sprite reference
// (ADR-0018). Per-time day/night resolution is gone: both variants map
// to the same glyph, so the per-column sunrise math was dead work.
export function renderForecastConditionIcons(
  config: Pick<ForecastBlockConfig, 'forecast'>,
  forecasts: readonly unknown[] | null | undefined,
  forecastItems: number | undefined,
): TemplateResult {
  if (config.forecast.condition_icons === false) return html``;
  // Drop malformed entries (null, missing datetime) before the per-item
  // map dereferences them.
  const forecast = sanitizeForecastEntries(
    (forecasts ? forecasts.slice(0, forecastItems) : []) as ForecastEntryLike[],
  );
  const icons = weatherIcons as Readonly<Record<string, string>>;
  return html`
    <div class="conditions">
      ${forecast.map((item) => html`
        <div class="forecast-item">
          ${spriteIcon(icons[item.condition as string])}
        </div>
      `)}
    </div>
  `;
}

function renderScrollControls(): TemplateResult {
  return html`
              <button type="button" class="scroll-indicator scroll-indicator-left" aria-label="Scroll left" hidden>
                <ha-icon icon="mdi:chevron-left" aria-hidden="true"></ha-icon>
              </button>
              <button type="button" class="scroll-indicator scroll-indicator-right" aria-label="Scroll right" hidden>
                <ha-icon icon="mdi:chevron-right" aria-hidden="true"></ha-icon>
              </button>
              <button type="button" class="jump-to-now" aria-label="Jump to now" title="Jump to now" hidden>
                <ha-icon icon="mdi:crosshairs-gps" aria-hidden="true"></ha-icon>
              </button>
            `;
}

function renderReadyBlock(ctx: ForecastBlockCtx): TemplateResult {
  const { config, scrolling } = ctx;
  const fcType = config.forecast?.type;
  const animClass = forecastAnimClass(ctx.mountAnimationPlayed, ctx.lastForecastType, fcType);
  const disableClass = config.forecast?.disable_animation === true ? 'no-animation' : '';
  // Two-phase render (ADR-0016): when the chart scrolls, the per-column
  // condition / wind rows are the cold-mount bottleneck (~140 ms of a
  // ~235 ms hourly mount). The first paint of a new chart generation
  // gets placeholder-height rows (no layout shift); the card's reveal
  // fills the real rows after paint. Non-scrolling views never defer.
  const rowsDeferred = scrolling
    && ctx.rowsReadyGen !== forecastRowsGenKey(fcType, ctx.forecasts);
  const enabled = rowsEnabled(config);
  return html`
          <div class="forecast-scroll-block ${animClass} ${disableClass}">
            <div class="forecast-scroll ${scrolling ? 'scrolling' : ''}">
              <div class="forecast-content" style="width: ${ctx.contentWidthPct}%">
                <div class="chart-container">
                  <div id="forecastChart"></div>
                </div>
                ${rowsDeferred
                  ? html`
                    ${enabled.conditions ? html`<div class="conditions" style="height: 26px"></div>` : ''}
                    ${enabled.wind ? html`<div class="wind-details" style="height: 26px"></div>` : ''}
                  `
                  : html`
                    ${guard(
                      [ctx.forecasts, ctx.forecastItems, config],
                      () => renderForecastConditionIcons(config, ctx.forecasts, ctx.forecastItems),
                    )}
                    ${guard(
                      [ctx.forecasts, ctx.forecastItems, ctx.unitSpeed, config],
                      () => ctx.renderWind(),
                    )}
                  `}
              </div>
            </div>
            ${renderModeToggle(config, ctx.onModeToggle)}
            ${config.show_main === false ? ctx.renderSourcesButton() : ''}
            ${scrolling ? renderScrollControls() : ''}
            ${scrolling && (fcType === 'hourly' || fcType === 'today')
              ? renderScrollTimeline(ctx.forecasts, ctx.calendar, ctx.language, ctx.visibleBars)
              : ''}
          </div>
          `;
}

// Loading state: reserve the same vertical space as the rows the ready
// branch WILL render, so the swap doesn't push the page down ~50 px.
// Heights match the rendered rows (24 px icon + 2 px margin; arrow plus
// one line of speed text + 2 px). Wrapped wind text on narrow columns
// under-reserves by ~10 px; over-reserving would shift up in the common case.
function renderLoadingBlock(ctx: ForecastBlockCtx): TemplateResult {
  const { config } = ctx;
  const enabled = rowsEnabled(config);
  const condH = enabled.conditions ? 26 : 0;
  const windH = enabled.wind ? 26 : 0;
  return html`
          <div class="forecast-loading">
            <div class="chart-container">
              ${renderChartSkeleton({
                chartHeight: config.forecast.chart_height as number,
                visibleBars: ctx.visibleBars,
              })}
            </div>
            ${enabled.conditions
              ? html`<div class="conditions" style="height: ${condH}px"></div>`
              : ''}
            ${enabled.wind
              ? html`<div class="wind-details" style="height: ${windH}px"></div>`
              : ''}
          </div>
          `;
}

export function renderForecastBlock(ctx: ForecastBlockCtx): TemplateResult {
  return ctx.ready ? renderReadyBlock(ctx) : renderLoadingBlock(ctx);
}
