// Diagnostic panel (ADR-0034), rendered only with `debug: true` in YAML:
// resolved sensor entities, render mode, data-source status and why a
// chart column may be empty. No editor row on purpose.

import { html, type TemplateResult } from 'lit';
import { pastFromOpenMeteo } from '../past-source.js';
import type { CardConfig } from '../card-config.js';

/** The data-source state the panel reads (DataSourceController fits). */
export interface DebugSources {
  readonly openMeteo: unknown;
  readonly measured: unknown;
  readonly forecastSource: unknown;
  readonly stationError: string | null;
  readonly forecastError: string | null;
  readonly stationReady: boolean;
  readonly forecastReady: boolean;
  readonly stationData: readonly unknown[] | null | undefined;
  readonly forecastData: readonly unknown[] | null | undefined;
  readonly missingSensors: readonly string[] | null | undefined;
  allExpectedDataReady(): boolean;
}

export interface DebugPanelCtx {
  config: Partial<CardConfig> | null | undefined;
  /** Entity ids present in `hass.states`. */
  hasEntity: (entityId: string) => boolean;
  haVersion: string | undefined;
  cardVersion: string;
  sources: DebugSources;
  chartBuilt: boolean;
}

function sourceStatus(
  want: boolean,
  source: unknown,
  error: string | null,
  ready: boolean,
  count: number,
): string {
  if (!want) return 'not requested (block disabled)';
  if (error) return `error — ${error}`;
  if (!source) return 'not subscribed';
  if (!ready) return 'subscribed, no data yet';
  return `subscribed, ${count} point(s)`;
}

function renderModeOf(wantStation: boolean, wantForecast: boolean): string {
  if (wantStation && wantForecast) return 'combination (station + forecast)';
  if (wantStation) return 'station-only';
  if (wantForecast) return 'forecast-only';
  return 'none (both blocks disabled)';
}

type Cfg = Partial<CardConfig>;

function stationConfigReason(cfg: Cfg): string | null {
  const sensors: Record<string, unknown> = cfg.sensors || {};
  if (cfg.show_station === false || pastFromOpenMeteo(cfg) || sensors.temperature) return null;
  return 'Station block on, but sensors.temperature is unset — past chart has no data.';
}

function forecastConfigReason(cfg: Cfg): string | null {
  if (cfg.show_forecast !== true || cfg.weather_entity) return null;
  return 'show_forecast is true, but weather_entity is unset — forecast block cannot load.';
}

function stationDataReason(cfg: Cfg, src: DebugSources): string | null {
  if (cfg.show_station === false || !src.stationReady) return null;
  if ((src.stationData?.length ?? 0) !== 0 || src.stationError) return null;
  return pastFromOpenMeteo(cfg)
    ? 'Open-Meteo returned no past data — check the browser network connection and the HA location.'
    : 'Station source returned 0 points — the recorder has no history for the configured window.';
}

function forecastDataReason(cfg: Cfg, src: DebugSources): string | null {
  const wantForecast = cfg.show_forecast === true && !!cfg.weather_entity;
  if (!wantForecast || !src.forecastReady) return null;
  if ((src.forecastData?.length ?? 0) !== 0 || src.forecastError) return null;
  return 'Forecast source returned 0 points — the weather entity published an empty forecast.';
}

/** Why a chart column might be empty, the most common support question,
 *  in priority order. */
export function emptyColumnReasons(ctx: DebugPanelCtx): string[] {
  const cfg = ctx.config || {};
  const src = ctx.sources;
  const missing = src.missingSensors?.length
    ? `Sensors unavailable in HA: ${src.missingSensors.join(', ')}.`
    : null;
  return [
    stationConfigReason(cfg),
    forecastConfigReason(cfg),
    stationDataReason(cfg, src),
    forecastDataReason(cfg, src),
    missing,
  ].filter((r): r is string => r !== null);
}

export function renderDebugPanel(ctx: DebugPanelCtx): TemplateResult {
  const cfg = ctx.config || {};
  const sensors: Record<string, unknown> = cfg.sensors || {};
  const src = ctx.sources;
  // Same gates as render() and the chart pipeline.
  const wantStation = cfg.show_station !== false;
  const wantForecast = cfg.show_forecast === true && !!cfg.weather_entity;
  // ADR-0015: the past block comes from Open-Meteo, not the recorder.
  const stationFromOpenMeteo = pastFromOpenMeteo(cfg);

  const stationStatus = sourceStatus(
    wantStation,
    stationFromOpenMeteo ? src.openMeteo : src.measured,
    src.stationError,
    src.stationReady, src.stationData?.length ?? 0,
  );
  const forecastStatus = sourceStatus(
    wantForecast, src.forecastSource, src.forecastError,
    src.forecastReady, src.forecastData?.length ?? 0,
  );
  const emptyReasons = emptyColumnReasons(ctx);

  // Only the slots the user actually set.
  const sensorRows = Object.entries(sensors)
    .filter(([, eid]) => typeof eid === 'string' && eid)
    .map(([key, eid]) => {
      const exists = ctx.hasEntity(eid as string);
      return html`<div>
        <code>${key}</code>: <code>${eid}</code>
        ${exists ? '✓ in HA' : '✗ not found in HA'}
      </div>`;
    });

  const row = (label: string, value: unknown) => html`
    <div><strong>${label}:</strong> ${String(value)}</div>
  `;

  return html`
    <details class="ws-debug-panel" style="
      margin: 8px;
      padding: 6px 10px;
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.5;
      font-family: var(--code-font-family, monospace);
      color: var(--secondary-text-color, #888);
    ">
      <summary style="cursor: pointer; font-weight: bold;">
        weather-station-card diagnostics (debug: true)
      </summary>
      <div style="margin-top: 6px;">
        ${row('Card version', ctx.cardVersion)}
        ${row('HA version', ctx.haVersion ?? 'unknown')}
        ${row('Render mode', renderModeOf(wantStation, wantForecast))}
        ${row('Forecast type', cfg.forecast?.type ?? 'daily')}
        ${row('Weather entity', cfg.weather_entity || '(unset)')}
        ${row('Station source', stationStatus)}
        ${row('Forecast source', forecastStatus)}
        ${row('All expected data ready', src.allExpectedDataReady())}
        ${row('Chart built', ctx.chartBuilt)}
        <div style="margin-top: 4px;"><strong>Resolved sensors:</strong></div>
        ${sensorRows.length ? sensorRows : html`<div>(none configured)</div>`}
        <div style="margin-top: 4px;"><strong>Empty-column diagnostics:</strong></div>
        ${emptyReasons.length
          ? emptyReasons.map((r) => html`<div>• ${r}</div>`)
          : html`<div>No empty-column issues detected.</div>`}
      </div>
    </details>
  `;
}
