// Content of the sources popup (show_sources, ADR-0031): which live keys
// the card shows, one line per value with its origin, and the chart
// legend section.

import { attrEntity, type LivePanelCtx } from '../live-panel/context.js';
import { sourceValueText } from '../live-panel/source-values.js';
import { isSensorProblem, labelText, sensorDownId, sourceLabel, type LiveSource, type SourceLabels } from '../live-source.js';
import { resolveAttributesLayout, type AttributeToken } from '../attributes-layout.js';
import { buildChartLegend, type LegendItem, type SunshineParts } from '../chart-legend.js';
import type { SourceLine } from '../sources-popup.js';
import { getDateTimeFormat } from '../utils/intl-cache.js';

// Attribute-row token → live-source keys it displays. Zero-degree and
// next-rain rows carry forecast / radar data from a sensor, so neither
// "station" nor "weather service" fits them.
const SOURCE_KEYS_BY_TOKEN: Readonly<Partial<Record<AttributeToken, ReadonlyArray<string>>>> = {
  pressure: ['pressure'],
  dew_point_humidity: ['dew_point', 'humidity'],
  dew_point: ['dew_point'],
  humidity: ['humidity'],
  precipitation: ['precipitation'],
  uv_illuminance: ['uv_index', 'illuminance'],
  uv_index: ['uv_index'],
  illuminance: ['illuminance'],
  sun: ['sun'],
  moon: ['moon'],
  wind_direction: ['wind_direction'],
  wind_speed: ['wind_speed'],
  wind_gust_speed: ['gust_speed'],
};

type LayoutConfig = Parameters<typeof resolveAttributesLayout>[0];

/** Live keys the card shows, in the card's order: main temperature,
 *  then the attribute layout column by column. */
export function sourceLiveKeys(cfg: Record<string, unknown> | null | undefined): string[] {
  const c = cfg || {};
  const keys: string[] = [];
  if (c.show_main !== false && c.show_temperature !== false) keys.push('temperature');
  if (c.show_attributes !== false) {
    for (const token of resolveAttributesLayout(c as LayoutConfig).flat()) {
      keys.push(...(SOURCE_KEYS_BY_TOKEN[token] ?? []));
    }
  }
  return keys;
}

/** True when a shown value fell back or its sensor is overdue; the info
 *  button turns to its alert look. */
export function sourcesAlert(
  cfg: Record<string, unknown> | null | undefined,
  liveSources: Readonly<Record<string, LiveSource | undefined>>,
  overdueIds: ReadonlySet<string>,
): boolean {
  return sourceLiveKeys(cfg).some((k) => isSensorProblem(liveSources[k], overdueIds));
}

/** Popup line label: the editor's sensor-field names double as the
 *  live-panel vocabulary; sun and moon have their own key. */
export function sourceLabelFor(
  key: string,
  str: (k: string) => string,
  editorLabels: Readonly<Record<string, string | undefined>>,
  enEditorLabels: Readonly<Record<string, string | undefined>>,
): string {
  if (key === 'sun' || key === 'moon') return str(`sources_label_${key}`);
  return editorLabels[key] || enEditorLabels[key] || key;
}

export interface EntityNameHass {
  states?: Record<string, { attributes?: { friendly_name?: unknown } } | undefined>;
  formatEntityName?: (stateObj: unknown) => string;
}

/** Display name as HA shows it: `hass.formatEntityName(stateObj)` (newer
 *  HA, device + entity composition), then friendly_name, then the id. */
export function entityName(hass: EntityNameHass | null | undefined, entityId: string): string {
  const stateObj = hass?.states?.[entityId];
  if (stateObj && typeof hass?.formatEntityName === 'function') {
    try {
      const formatted = hass.formatEntityName(stateObj);
      if (typeof formatted === 'string' && formatted.trim()) return formatted.trim();
    } catch {
      // fall through to friendly_name
    }
  }
  const name = stateObj?.attributes?.friendly_name;
  return typeof name === 'string' && name.trim() ? name.trim() : entityId;
}

export interface SourceLinesCtx {
  live: LivePanelCtx;
  liveSources: Readonly<Record<string, LiveSource | undefined>>;
  overdueIds: ReadonlySet<string>;
  labelFor: (key: string) => string;
  entityName: (entityId: string) => string;
}

function downNote(ctx: SourceLinesCtx, src: LiveSource, downId: string): string {
  const { live } = ctx;
  const cfg = live.config;
  // Grace period or HA starting: neutral, same as the availability note.
  if (!ctx.overdueIds.has(downId)) return live.str('sources_waiting');
  const since = live.hass?.states?.[downId]?.last_changed;
  const t = since ? Date.parse(String(since)) : NaN;
  const time = Number.isFinite(t)
    ? getDateTimeFormat(live.language, {
        hour: 'numeric', minute: 'numeric', hour12: cfg.use_12hour_format, timeZone: live.calendar.timeZone,
      }).format(new Date(t))
    : '';
  if (src.kind === 'stale') {
    return time
      ? live.str('sources_stale_since').replace('{time}', time)
      : live.str('sources_stale');
  }
  // The weather entity is already named; name the sensor it stands in for.
  return (time ? live.str('sources_sensor_down_since').replace('{time}', time) : live.str('sources_sensor_down'))
    .replace('{entity}', ctx.entityName(downId));
}

/** One popup line per value the card shows, in the card's order. */
export function sourceLines(ctx: SourceLinesCtx): SourceLine[] {
  const { live } = ctx;
  const cfg = live.config;
  const defaults = {
    station: live.str('source_station'),
    weather: live.str('source_weather'),
    computed: live.str('source_computed'),
  };
  const lines: SourceLine[] = [];
  for (const key of sourceLiveKeys(cfg)) {
    const src = ctx.liveSources[key];
    if (!src) continue;
    const value = sourceValueText(live, key);
    if (!value) continue;
    const line: SourceLine = {
      label: ctx.labelFor(key),
      value,
      kind: src.kind,
      sourceText: sourceLabel(src.kind, cfg.source_labels as SourceLabels | undefined, defaults),
      ...(src.entityId ? { entityId: src.entityId, entityName: ctx.entityName(src.entityId) } : {}),
    };
    if (isSensorProblem(src, ctx.overdueIds)) line.problem = true;
    const downId = sensorDownId(src);
    if (downId) line.note = downNote(ctx, src, downId);
    lines.push(line);
  }
  const nextRain = nextRainLine(ctx);
  if (nextRain) lines.push(nextRain);
  return lines;
}

// Next rain names its own source (radar / forecast / station) in the row
// tooltip; reuse that. Zero-degree rows have no source text.
function nextRainLine(ctx: SourceLinesCtx): SourceLine | null {
  const cfg = ctx.live.config;
  const shown = cfg.show_attributes !== false
    && resolveAttributesLayout(cfg as LayoutConfig).some((col) => col.includes('next_rain'));
  const { next_rain_text: text, next_rain_title: title } = ctx.live.values;
  if (!shown || !text || !title) return null;
  const eid = attrEntity(cfg, 'next_rain', false);
  return {
    label: ctx.labelFor('next_rain'),
    value: text,
    kind: 'info',
    sourceText: title,
    ...(eid ? { entityId: eid, entityName: ctx.entityName(eid) } : {}),
  };
}

export interface SourceLegendInputs {
  config: {
    show_station?: unknown;
    show_forecast?: unknown;
    weather_entity?: unknown;
    source_labels?: { station?: unknown; weather?: unknown } | null;
    forecast?: {
      type?: string;
      show_sunshine?: unknown;
    } | null;
  };
  /** Source plan and resolved colours, the same the chart draws with.
   *  Called only when a chart block is shown. */
  resolve: () => {
    pastFromOpenMeteo: boolean;
    sunshineParts: SunshineParts;
    colors: { high: string; low: string; precip: string; sunshine: string };
  };
  str: (key: string) => string;
}

/** Chart section of the popup: the encodings and their sources. */
export function sourceLegend(inputs: SourceLegendInputs): LegendItem[] {
  const { config, str } = inputs;
  const showStation = config.show_station !== false;
  const showForecast = config.show_forecast === true && !!config.weather_entity;
  if (!showStation && !showForecast) return [];
  const fc = config.forecast || {};
  const labels = config.source_labels || {};
  const { pastFromOpenMeteo, sunshineParts, colors } = inputs.resolve();
  return buildChartLegend({
    showStation,
    showForecast,
    pastFromOpenMeteo,
    showSunshine: fc.show_sunshine === true,
    sunshineParts,
    showTempLow: (fc.type || 'daily') === 'daily',
    colors,
    text: {
      high: str('legend_high'),
      low: str('legend_low'),
      precip: str('legend_precip'),
      sunshine: str('sunshine'),
      measured: str('legend_measured'),
      forecast: str('legend_forecast'),
      measuredNote: str('legend_measured_note'),
      forecastNote: str('legend_forecast_note'),
      stationSource: labelText(labels.station, str('source_station')),
      forecastSource: labelText(labels.weather, str('source_weather')),
      openMeteo: 'Open-Meteo',
      sunshineTitleOpenMeteo: str('legend_sunshine_openmeteo'),
    },
  });
}
