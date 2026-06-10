// Editor render partial — Section 4: "Diagramm" (Chart).
// Single home for everything chart-related: time range / resolution,
// which rows render, visual style, sizes, and the collapsed colours
// override block. Replaces the chart-rows portion of the old "Was wird
// angezeigt?" section and the chart-related portions of the old
// "Aussehen" section.
//
// Always visible — the chart renders in every mode (station = past
// chart, forecast = future chart, combination = both side-by-side).
//
// Schema-driven via <ha-form>. Three logical groups, each its own form
// so the visual subsection headings stay between:
//   - Title + time range (top-level + forecast.number_of_forecasts)
//   - Chart rows (forecast.* booleans)
//   - Style (forecast.style + 2 forecast.* booleans)

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';
import { renderSectionHeader } from './section-header.js';

interface SchemaField {
  name: string;
  required?: boolean;
  selector: object;
}

// Top-level chart fields: title + the two day-window numbers.
// Days/forecast_days appear conditionally based on the current mode
// (station-only doesn't show forecast_days, forecast-only doesn't
// show days).
function buildChartTopSchema(showsStation: boolean, showsForecast: boolean): SchemaField[] {
  const schema: SchemaField[] = [
    { name: 'title', selector: { text: {} } },
  ];
  if (showsStation) {
    schema.push({ name: 'days', selector: { number: { min: 1, max: 14, mode: 'box' } } });
  }
  if (showsForecast) {
    schema.push({ name: 'forecast_days', selector: { number: { min: 1, max: 14, mode: 'box' } } });
  }
  return schema;
}

// forecast.* numeric: how many forecast columns to show at once.
const FORECAST_COUNT_SCHEMA: SchemaField[] = [
  { name: 'number_of_forecasts', selector: { number: { min: 0, mode: 'box' } } },
];

// forecast.* booleans: which auxiliary chart rows render.
const CHART_ROWS_SCHEMA: SchemaField[] = [
  { name: 'condition_icons', selector: { boolean: {} } },
  { name: 'show_wind_arrow', selector: { boolean: {} } },
  { name: 'show_wind_speed', selector: { boolean: {} } },
  { name: 'show_date', selector: { boolean: {} } },
  { name: 'show_sunshine', selector: { boolean: {} } },
  { name: 'show_mode_toggle', selector: { boolean: {} } },
];

// forecast.* style + appearance toggles.
function buildChartStyleSchema(t: (k: string) => string): SchemaField[] {
  return [
    { name: 'style', selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'style2', label: t('chart_style_without_boxes') },
          { value: 'style1', label: t('chart_style_with_boxes') },
        ],
      },
    } },
    { name: 'round_temp', selector: { boolean: {} } },
    { name: 'disable_animation', selector: { boolean: {} } },
  ];
}

export function renderChartSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, fcfg, showsStation, showsForecast } = ctx;

  const chartTopSchema = buildChartTopSchema(showsStation, showsForecast);
  const chartStyleSchema = buildChartStyleSchema(t);

  const chartTopData = {
    title: cfg.title || '',
    days: cfg.days,
    forecast_days: cfg.forecast_days,
  };
  const forecastCountData = {
    number_of_forecasts: fcfg.number_of_forecasts,
  };
  const chartRowsData = {
    condition_icons: fcfg.condition_icons !== false,
    show_wind_arrow: fcfg.show_wind_arrow !== false,
    show_wind_speed: fcfg.show_wind_speed !== false,
    show_date: fcfg.show_date !== false,
    show_sunshine: fcfg.show_sunshine === true,
    show_mode_toggle: fcfg.show_mode_toggle !== false,
  };
  const chartStyleData = {
    style: fcfg.style || 'style2',
    round_temp: fcfg.round_temp === true,
    disable_animation: fcfg.disable_animation === true,
  };

  const labelFor = (schema: { name: string }): string => t(schema.name);
  // Per-section labels override the default name lookup (the underlying
  // i18n key isn't always identical to the field name).
  const chartTopLabel = (schema: { name: string }): string => {
    if (schema.name === 'title') return t('title');
    if (schema.name === 'days') return t('days');
    if (schema.name === 'forecast_days') return t('forecast_days');
    return labelFor(schema);
  };
  const forecastCountLabel = (): string => t('number_of_forecasts');
  const chartRowsLabel = (schema: { name: string }): string => {
    const map: Record<string, string> = {
      condition_icons: t('show_chart_icons'),
      show_wind_arrow: t('show_chart_wind_direction'),
      show_wind_speed: t('show_chart_wind_speed'),
      show_date: t('show_chart_date'),
      show_sunshine: t('show_chart_sunshine'),
      show_mode_toggle: t('show_chart_mode_toggle'),
    };
    return map[schema.name] || labelFor(schema);
  };
  const chartStyleLabel = (schema: { name: string }): string => {
    if (schema.name === 'style') return t('chart_style');
    if (schema.name === 'round_temp') return t('round_temp');
    if (schema.name === 'disable_animation') return t('disable_animation');
    return labelFor(schema);
  };

  return html`
    ${renderSectionHeader({ editor, title: t('chart_section_heading'), sectionKey: 'chart', resetLabel: t('reset_section') })}

    <div class="textfield-container">
      <ha-form
        .data=${chartTopData}
        .schema=${chartTopSchema}
        .hass=${editor.hass}
        .computeLabel=${chartTopLabel}
        @value-changed=${editor._chartTopChanged}
      ></ha-form>
    </div>

    <h4 class="subsection">${t('chart_time_range_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${forecastCountData}
        .schema=${FORECAST_COUNT_SCHEMA}
        .hass=${editor.hass}
        .computeLabel=${forecastCountLabel}
        @value-changed=${editor._chartForecastChanged}
      ></ha-form>
      <p class="hint">${t('number_of_forecasts_hint')}</p>
    </div>

    <h4 class="subsection">${t('chart_rows_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${chartRowsData}
        .schema=${CHART_ROWS_SCHEMA}
        .hass=${editor.hass}
        .computeLabel=${chartRowsLabel}
        @value-changed=${editor._chartForecastChanged}
      ></ha-form>
      ${fcfg.show_sunshine === true ? html`
        <div class="hint" style="padding-left:20px; margin-top:8px;">
          ${t('show_chart_sunshine_hint')}
        </div>
        <div style="padding-left:20px; margin-bottom:8px;">
          ${editor._renderSunshineAvailabilityHint(cfg, t)}
        </div>
      ` : ''}
    </div>

    <h4 class="subsection">${t('chart_appearance_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${chartStyleData}
        .schema=${chartStyleSchema}
        .hass=${editor.hass}
        .computeLabel=${chartStyleLabel}
        @value-changed=${editor._chartForecastChanged}
      ></ha-form>
    </div>

    <!-- Chart sizes (chart_height, labels_font_size, precip_bar_size)
         and colour overrides (temperature1/2_color, precipitation_color,
         sunshine_color, chart_text_color, chart_datetime_color) live in
         DEFAULTS + YAML only — colours are theme-aware out of the box,
         sizes rarely need adjustment, and the editor surface stays
         cleaner without them. -->
  `;
}
