// Card-level banners and placeholders (ADR-0010, ADR-0034): the red error
// band, the amber config-warning band, the availability hint and the two
// placeholder cards.

import { html, type TemplateResult } from 'lit';
import { MIN_HA_VERSION, isHaVersionBelow } from '../const.js';

export interface BannerCtx {
  haVersion: string | undefined;
  configError: string | null;
  stationError: string | null;
  forecastError: string | null;
  chartError: string | null;
  refreshError: string | null;
  sectionError: string | null;
  configWarnings: readonly string[];
}

export function bannerErrors(ctx: BannerCtx): string[] {
  const errors: string[] = [];
  // First: a too-old HA frontend may be the cause of the data-fetch errors
  // below. isHaVersionBelow never fires on a current or unreadable version.
  if (isHaVersionBelow(ctx.haVersion, MIN_HA_VERSION)) {
    errors.push(`This card expects Home Assistant ${MIN_HA_VERSION} or newer.`);
  }
  if (ctx.configError) errors.push(ctx.configError);
  if (ctx.stationError) errors.push(`Statistics fetch failed: ${ctx.stationError}`);
  if (ctx.forecastError) errors.push(`Forecast unavailable: ${ctx.forecastError}`);
  if (ctx.chartError) errors.push(`Chart render failed: ${ctx.chartError}`);
  if (ctx.refreshError) errors.push(ctx.refreshError);
  if (ctx.sectionError) errors.push(ctx.sectionError);
  // Unavailable sensors are deliberately NOT in this red band (#213); see
  // renderAvailabilityNote.
  return errors;
}

export function renderErrorBanner(ctx: BannerCtx): TemplateResult {
  const errors = bannerErrors(ctx);
  // Config-schema warnings are advisory: a separate amber band, never a stop.
  const warnings = ctx.configWarnings ?? [];
  const errorBanner = errors.length
    ? html`
    <div style="background: var(--error-color, #b71c1c); color: var(--text-primary-color, #fff); padding: 8px 12px; margin: 8px; border-radius: 4px; font-size: 13px;">
      ${errors.map((e) => html`<div>${e}</div>`)}
    </div>
  `
    : html``;
  const warningBanner = warnings.length
    ? html`
    <div style="background: var(--warning-color, #ffa600); color: var(--text-primary-color, #fff); padding: 8px 12px; margin: 8px; border-radius: 4px; font-size: 13px;">
      <div style="font-weight: 600;">Card configuration</div>
      ${warnings.map((w) => html`<div>${w}</div>`)}
    </div>
  `
    : html``;
  return html`${errorBanner}${warningBanner}`;
}

// Subtle availability hint (#213): one slim row, the full sensor list in
// the tooltip. In-grace (typical HA restart) is neutral with a clock
// icon, overdue uses the warning colour. Nothing when all sensors are live.
export function renderAvailabilityNote(
  overdue: readonly string[] | undefined,
  inGrace: readonly string[] | undefined,
): TemplateResult {
  const over = overdue ?? [];
  const grace = inGrace ?? [];
  if (!over.length && !grace.length) return html``;
  const isOverdue = over.length > 0;
  const all = [...over, ...grace];
  const text = isOverdue
    ? `${over.length} sensor${over.length === 1 ? '' : 's'} unavailable`
    : 'Waiting for sensor data…';
  const title = `${isOverdue ? 'Unavailable' : 'Recently unavailable (updating)'}: ${all.join(', ')}`;
  return html`
    <div class="wsc-availability ${isOverdue ? 'wsc-availability-overdue' : ''}"
         title=${title} aria-label=${title}>
      <ha-icon icon="${isOverdue ? 'mdi:alert-circle-outline' : 'mdi:progress-clock'}"></ha-icon>
      <span>${text}</span>
    </div>
  `;
}

// A freshly-added card with neither a temperature sensor nor a weather
// entity has nothing real to draw: a calm onboarding hint instead of a
// layout full of NaN values plus a red banner.
export function renderOnboarding(title: unknown): TemplateResult {
  return html`
        <style>
          .wsc-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 8px;
            padding: 32px 24px;
          }
          .wsc-empty ha-icon {
            --mdc-icon-size: 48px;
            color: var(--secondary-text-color, #727272);
            opacity: 0.7;
          }
          .wsc-empty-title {
            font-weight: 600;
            font-size: 15px;
            color: var(--primary-text-color, #212121);
          }
          .wsc-empty-hint {
            font-size: 13px;
            line-height: 1.4;
            color: var(--secondary-text-color, #727272);
            max-width: 260px;
          }
        </style>
        <ha-card header="${title}">
          <div class="wsc-empty">
            <ha-icon icon="mdi:weather-partly-cloudy"></ha-icon>
            <div class="wsc-empty-title">Weather Station Card</div>
            <div class="wsc-empty-hint">
              Open the card editor and choose your weather sensors to
              get started.
            </div>
          </div>
        </ha-card>
      `;
}

export function renderNoWeather(title: unknown): TemplateResult {
  return html`
        <style>
          .card {
            padding-top: ${title ? '0px' : '16px'};
            padding-right: 16px;
            padding-bottom: 16px;
            padding-left: 16px;
          }
        </style>
        <ha-card header="${title}">
          <div class="card">
            Please, check your weather entity
          </div>
        </ha-card>
      `;
}
