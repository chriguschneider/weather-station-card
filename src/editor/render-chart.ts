// Editor render partial — "Diagramm" (Chart) panel.
//
// v2.4 redesign (ADR-0023): number fields and dropdowns pair up in
// 2-column ha-form grids, the six chart-row toggles collapse into one
// multi-select field, and the long visible hints became one-line
// helper texts. `title` moved to the basics section; `chart_height`
// (previously YAML-only) joins the editor here.
//
// Two config levels feed the panel — top-level (days, forecast_days)
// via _chartTopChanged and forecast.* via _chartForecastChanged /
// _applyTogglePaths. Each ha-form owns exactly one level.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, TogglePath } from './types.js';
import { renderEditorPanel } from './expansion-panel.js';

// The six auxiliary chart rows, as multi-select entries. `def` mirrors
// DEFAULTS_FORECAST (opt-out rows are true, sunshine is opt-in).
const CHART_ROW_PATHS: ReadonlyArray<TogglePath & { labelKey: string }> = [
  { path: 'forecast.condition_icons',  def: true,  labelKey: 'show_chart_icons' },
  { path: 'forecast.show_wind_arrow',  def: true,  labelKey: 'show_chart_wind_direction' },
  { path: 'forecast.show_wind_speed',  def: true,  labelKey: 'show_chart_wind_speed' },
  { path: 'forecast.show_date',        def: true,  labelKey: 'show_chart_date' },
  { path: 'forecast.show_sunshine',    def: false, labelKey: 'show_chart_sunshine' },
  { path: 'forecast.show_mode_toggle', def: true,  labelKey: 'show_chart_mode_toggle' },
];

const leafOf = (path: string): string => path.split('.').pop() as string;

/** Chart rows currently enabled, as leaf names — shared with the
 *  panel-summary count. */
export function activeChartRows(fcfg: Record<string, unknown>): string[] {
  return CHART_ROW_PATHS
    .filter(({ path, def }) => {
      const v = fcfg[leafOf(path)];
      return def ? v !== false : v === true;
    })
    .map(({ path }) => leafOf(path));
}

export function renderChartSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, fcfg, showsStation, showsForecast } = ctx;

  // ── Time range: top-level pair + forecast.* pair, each 2-col ──────
  const daysSchema = [{
    name: '',
    type: 'grid',
    schema: [
      ...(showsStation ? [{ name: 'days', selector: { number: { min: 1, max: 14, mode: 'box' } } }] : []),
      ...(showsForecast ? [{ name: 'forecast_days', selector: { number: { min: 1, max: 14, mode: 'box' } } }] : []),
    ],
  }];
  const resolutionSchema = [{
    name: '',
    type: 'grid',
    schema: [
      { name: 'number_of_forecasts', selector: { number: { min: 0, mode: 'box' } } },
      { name: 'chart_height', selector: { number: { min: 80, max: 600, mode: 'box' } } },
    ],
  }];

  // ── Rows: one multi-select over the six auxiliary chart rows ──────
  const rowsSchema = [{
    name: 'chart_rows',
    selector: {
      select: {
        mode: 'dropdown',
        multiple: true,
        options: CHART_ROW_PATHS.map(({ path, labelKey }) => ({
          value: leafOf(path),
          label: t(labelKey),
        })),
      },
    },
  }];

  // ── Appearance: style dropdown + two booleans ─────────────────────
  const appearanceSchema = [
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

  const labelMap: Record<string, string> = {
    days: t('days'),
    forecast_days: t('forecast_days'),
    number_of_forecasts: t('number_of_forecasts'),
    chart_height: t('chart_height'),
    chart_rows: t('chart_rows_heading'),
    style: t('chart_style'),
    round_temp: t('round_temp'),
    disable_animation: t('disable_animation'),
  };
  const labelFor = (schema: { name: string }): string => labelMap[schema.name] || t(schema.name);

  const handleRowsChanged = (event: CustomEvent<{ value: { chart_rows?: string[] } }>): void => {
    editor._applyTogglePaths(CHART_ROW_PATHS, event.detail.value?.chart_rows ?? []);
  };

  const selectedRows = activeChartRows(fcfg);

  const daysPart = [
    ...(showsStation ? [String(cfg.days ?? 7)] : []),
    ...(showsForecast ? [String(cfg.forecast_days ?? 7)] : []),
  ].join('+');
  const cols = fcfg.number_of_forecasts ?? 8;
  const summary = `${daysPart} ${t('summary_days')} · ${cols} ${t('summary_columns')} · ${selectedRows.length} ${t('summary_rows')}`;

  const body = html`
    <h4 class="subsection">${t('chart_time_range_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{ days: cfg.days, forecast_days: cfg.forecast_days }}
        .schema=${daysSchema}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._chartTopChanged}
      ></ha-form>
      <ha-form
        .data=${{ number_of_forecasts: fcfg.number_of_forecasts, chart_height: fcfg.chart_height }}
        .schema=${resolutionSchema}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._chartForecastChanged}
      ></ha-form>
      <p class="hint">${t('number_of_forecasts_helper')}</p>
    </div>

    <h4 class="subsection">${t('chart_rows_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{ chart_rows: selectedRows }}
        .schema=${rowsSchema}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${handleRowsChanged}
      ></ha-form>
      ${fcfg.show_sunshine === true ? html`
        <div class="hint">${t('show_chart_sunshine_hint')}</div>
        <div>${editor._renderSunshineAvailabilityHint(cfg, t)}</div>
      ` : ''}
    </div>

    <h4 class="subsection">${t('chart_appearance_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{
          style: fcfg.style || 'style2',
          round_temp: fcfg.round_temp === true,
          disable_animation: fcfg.disable_animation === true,
        }}
        .schema=${appearanceSchema}
        .hass=${editor.hass}
        .computeLabel=${labelFor}
        @value-changed=${editor._chartForecastChanged}
      ></ha-form>
    </div>

    <!-- Remaining chart sizes (labels_font_size, precip_bar_size) and
         colour overrides (temperature1/2_color, precipitation_color,
         sunshine_color, chart_text_color, chart_datetime_color) live
         in DEFAULTS + YAML only — colours are theme-aware out of the
         box and the editor surface stays cleaner without them. -->
  `;

  return renderEditorPanel({
    editor,
    sectionKey: 'chart',
    icon: 'mdi:chart-line',
    title: t('chart_section_heading'),
    summary,
    resetLabel: t('reset_section'),
    body,
  });
}
