// Editor partial "Basics" (ADR-0023): mode, chart type, title and weather
// entity. The only section without an expansion panel, so it stays visible.
// The weather entity shows only while a forecast is shown.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';

const WEATHER_SCHEMA = [{
  name: 'weather_entity',
  required: true,
  selector: {
    entity: { domain: 'weather' },
  },
}];

export function renderBasicsSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, fcfg, mode, showsForecast, pastDataAvailable } = ctx;

  // Built at render time so option labels follow the current locale.
  const modeSchema = [{
    name: 'mode',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'combination', label: t('mode_combination') },
          { value: 'station', label: t('mode_station') },
          { value: 'forecast', label: t('mode_forecast') },
        ],
      },
    },
  }];

  const chartTypeSchema = [{
    name: 'type',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'daily', label: t('forecast_type_daily') },
          { value: 'today', label: t('forecast_type_today') },
          { value: 'hourly', label: t('forecast_type_hourly') },
        ],
      },
    },
  }];

  const titleSchema = [{ name: 'title', selector: { text: {} } }];

  const handleModeChanged = (event: CustomEvent<{ value: { mode: 'combination' | 'station' | 'forecast' } }>): void => {
    const next = event.detail.value?.mode;
    if (next && next !== mode) editor._setMode(next);
  };

  const handleChartTypeChanged = (event: CustomEvent<{ value: { type: string } }>): void => {
    const next = event.detail.value?.type;
    if (next && next !== fcfg.type) {
      editor._valueChanged({ target: { value: next } }, 'forecast.type');
    }
  };

  const handleWeatherChanged = (event: CustomEvent<{ value: { weather_entity: string } }>): void => {
    const next = event.detail.value?.weather_entity ?? '';
    editor._valueChanged({ target: { value: next } }, 'weather_entity');
  };

  return html`
    <div class="textfield-container">
      <ha-form
        .data=${{ mode }}
        .schema=${modeSchema}
        .hass=${editor.hass}
        .disabled=${!pastDataAvailable}
        .computeLabel=${() => t('mode_label')}
        @value-changed=${handleModeChanged}
      ></ha-form>

      <div class="grid2">
        <ha-form
          .data=${{ type: fcfg.type || 'daily' }}
          .schema=${chartTypeSchema}
          .hass=${editor.hass}
          .computeLabel=${() => t('chart_type_label')}
          @value-changed=${handleChartTypeChanged}
        ></ha-form>
        <ha-form
          .data=${{ title: cfg.title || '' }}
          .schema=${titleSchema}
          .hass=${editor.hass}
          .computeLabel=${() => t('title')}
          @value-changed=${editor._chartTopChanged}
        ></ha-form>
      </div>

      ${showsForecast ? html`
        <ha-form
          .data=${{ weather_entity: cfg.weather_entity || '' }}
          .schema=${WEATHER_SCHEMA}
          .hass=${editor.hass}
          .computeLabel=${() => t('weather_entity')}
          @value-changed=${handleWeatherChanged}
        ></ha-form>
      ` : ''}
    </div>
  `;
}
