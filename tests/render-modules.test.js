// @vitest-environment jsdom
// Unit tests for the card-section renderers split out of main.ts
// (src/render/, #472). Each is a plain function over a small context, so
// the tests build the context by hand instead of mounting the card.
import { describe, it, expect, vi } from 'vitest';
import { render, html } from 'lit';
import en from '../src/locales/en.js';
import { Calendar } from '../src/utils/time-zone.js';
import { LIVE_READING_KEYS } from '../src/live-panel/context.js';
import {
  bannerErrors, renderAvailabilityNote, renderErrorBanner, renderNoWeather, renderOnboarding,
} from '../src/render/banners.js';
import { emptyColumnReasons, renderDebugPanel } from '../src/render/debug-panel.js';
import {
  forecastAnimClass, forecastRowsGenKey, renderForecastBlock, renderForecastConditionIcons,
  renderModeToggle, renderScrollTimeline, timelineSegments,
} from '../src/render/forecast-block.js';
import {
  dayPagerRealignLeft, initialScrollDataReady, initialScrollGeneration, resolveInitialScrollLeft,
} from '../src/render/scroll-position.js';
import {
  entityName, sourceLabelFor, sourceLegend, sourceLines, sourceLiveKeys, sourcesAlert,
} from '../src/render/source-lines.js';

const ZURICH = new Calendar('Europe/Zurich');

function mount(tpl) {
  const el = document.createElement('div');
  render(tpl, el);
  return el;
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- banners

const noErrors = {
  haVersion: '2025.1.0',
  configError: null,
  stationError: null,
  forecastError: null,
  chartError: null,
  refreshError: null,
  sectionError: null,
  configWarnings: [],
};

describe('banners', () => {
  it('renders nothing when there is nothing to report', () => {
    expect(bannerErrors(noErrors)).toEqual([]);
    expect(text(mount(renderErrorBanner(noErrors)))).toBe('');
  });

  it('lists the errors in their fixed order, the HA version first', () => {
    const errors = bannerErrors({
      ...noErrors,
      haVersion: '2020.1.0',
      configError: 'cfg',
      stationError: 'st',
      forecastError: 'fc',
      chartError: 'init: boom',
      refreshError: 'refresh',
      sectionError: 'section',
    });
    expect(errors[0]).toMatch(/^This card expects Home Assistant /);
    expect(errors.slice(1)).toEqual([
      'cfg',
      'Statistics fetch failed: st',
      'Forecast unavailable: fc',
      'Chart render failed: init: boom',
      'refresh',
      'section',
    ]);
  });

  it('puts config warnings in their own amber band', () => {
    const el = mount(renderErrorBanner({ ...noErrors, configWarnings: ['Unknown key `foo`'] }));
    expect(text(el)).toBe('Card configuration Unknown key `foo`');
    expect(el.querySelector('div').getAttribute('style')).toContain('--warning-color');
  });

  it('availability note: neutral while in grace, warning once overdue', () => {
    expect(text(mount(renderAvailabilityNote([], [])))).toBe('');
    const grace = mount(renderAvailabilityNote([], ['temperature (sensor.t)'])).firstElementChild;
    expect(grace.classList.contains('wsc-availability-overdue')).toBe(false);
    expect(grace.getAttribute('title')).toBe('Recently unavailable (updating): temperature (sensor.t)');
    expect(text(grace)).toBe('Waiting for sensor data…');

    const over = mount(renderAvailabilityNote(['a', 'b'], ['c'])).firstElementChild;
    expect(over.classList.contains('wsc-availability-overdue')).toBe(true);
    expect(text(over)).toBe('2 sensors unavailable');
    expect(over.getAttribute('title')).toBe('Unavailable: a, b, c');
    expect(text(mount(renderAvailabilityNote(['a'], undefined)))).toBe('1 sensor unavailable');
  });

  it('placeholder cards carry the title', () => {
    const onboarding = mount(renderOnboarding('Garden'));
    expect(onboarding.querySelector('ha-card').getAttribute('header')).toBe('Garden');
    expect(text(onboarding.querySelector('.wsc-empty'))).toContain('Open the card editor');
    const noWeather = mount(renderNoWeather(''));
    expect(text(noWeather.querySelector('.card'))).toBe('Please, check your weather entity');
    expect(noWeather.querySelector('style').textContent).toContain('padding-top: 16px');
  });
});

// ------------------------------------------------------------ debug panel

function sources(overrides = {}) {
  return {
    openMeteo: null,
    measured: null,
    forecastSource: null,
    stationError: null,
    forecastError: null,
    stationReady: false,
    forecastReady: false,
    stationData: [],
    forecastData: [],
    missingSensors: [],
    allExpectedDataReady: () => false,
    ...overrides,
  };
}

function debugCtx(config, src = sources(), states = {}) {
  return {
    config,
    hasEntity: (eid) => eid in states,
    haVersion: undefined,
    cardVersion: '9.9.9',
    sources: src,
    chartBuilt: false,
  };
}

describe('debug panel', () => {
  it('walks the empty-column causes in priority order', () => {
    const reasons = emptyColumnReasons(debugCtx(
      { show_station: true, show_forecast: true, sensors: {} },
      sources({ stationReady: true, missingSensors: ['x (sensor.x)'] }),
    ));
    expect(reasons).toEqual([
      'Station block on, but sensors.temperature is unset — past chart has no data.',
      'show_forecast is true, but weather_entity is unset — forecast block cannot load.',
      'Station source returned 0 points — the recorder has no history for the configured window.',
      'Sensors unavailable in HA: x (sensor.x).',
    ]);
  });

  it('names Open-Meteo when it fills the past block', () => {
    const cfg = {
      show_station: true,
      show_forecast: true,
      weather_entity: 'weather.home',
      sensors: {},
      forecast: { openmeteo_history: true },
    };
    const reasons = emptyColumnReasons(debugCtx(cfg, sources({ stationReady: true, forecastReady: true })));
    expect(reasons).toEqual([
      'Open-Meteo returned no past data — check the browser network connection and the HA location.',
      'Forecast source returned 0 points — the weather entity published an empty forecast.',
    ]);
  });

  it('reports no issue for a healthy setup', () => {
    const cfg = { show_station: true, sensors: { temperature: 'sensor.t' } };
    const src = sources({ measured: {}, stationReady: true, stationData: [{}, {}] });
    expect(emptyColumnReasons(debugCtx(cfg, src))).toEqual([]);
    const el = mount(renderDebugPanel(debugCtx(cfg, src, { 'sensor.t': {} })));
    const body = text(el);
    expect(body).toContain('Card version: 9.9.9');
    expect(body).toContain('HA version: unknown');
    expect(body).toContain('Render mode: station-only');
    expect(body).toContain('Forecast type: daily');
    expect(body).toContain('Station source: subscribed, 2 point(s)');
    expect(body).toContain('Forecast source: not requested (block disabled)');
    expect(body).toContain('sensor.t ✓ in HA');
    expect(body).toContain('No empty-column issues detected.');
  });

  it('shows every source state and the render modes', () => {
    const mode = (cfg) => text(mount(renderDebugPanel(debugCtx(cfg)))).match(/Render mode: ([^:]+?) Forecast type/)[1];
    expect(mode({ show_station: false })).toBe('none (both blocks disabled)');
    expect(mode({ show_station: false, show_forecast: true, weather_entity: 'weather.x' })).toBe('forecast-only');
    expect(mode({ show_forecast: true, weather_entity: 'weather.x' })).toBe('combination (station + forecast)');

    const cfg = { show_forecast: true, weather_entity: 'weather.x', sensors: { temperature: 'sensor.gone' } };
    const body = text(mount(renderDebugPanel(debugCtx(cfg, sources({
      stationError: 'boom',
      forecastSource: {},
    })))));
    expect(body).toContain('Station source: error — boom');
    expect(body).toContain('Forecast source: subscribed, no data yet');
    expect(body).toContain('sensor.gone ✗ not found in HA');
    const unsubscribed = text(mount(renderDebugPanel(debugCtx(cfg))));
    expect(unsubscribed).toContain('Station source: not subscribed');
    expect(text(mount(renderDebugPanel(debugCtx(null))))).toContain('(none configured)');
  });
});

// --------------------------------------------------------- forecast block

const day = (iso, condition = 'sunny') => ({ datetime: iso, condition });

function blockCtx(overrides = {}) {
  return {
    config: {
      show_station: true,
      forecast: { type: 'daily', chart_height: 180 },
    },
    ready: true,
    scrolling: false,
    contentWidthPct: 100,
    visibleBars: 8,
    forecasts: [day('2026-11-14T00:00:00+01:00'), day('2026-11-15T00:00:00+01:00', 'rainy')],
    forecastItems: 2,
    unitSpeed: 'km/h',
    calendar: ZURICH,
    language: 'en',
    mountAnimationPlayed: true,
    lastForecastType: 'daily',
    rowsReadyGen: '',
    onModeToggle: () => {},
    renderWind: () => html`<div class="wind-details">wind</div>`,
    renderSourcesButton: () => html`<span class="src-btn"></span>`,
    ...overrides,
  };
}

describe('forecast block', () => {
  it('generation key and animation class', () => {
    expect(forecastRowsGenKey(undefined, null)).toBe('daily|0');
    expect(forecastRowsGenKey('hourly', [1, 2, 3])).toBe('hourly|3');
    expect(forecastAnimClass(false, undefined, 'daily')).toBe('first-mount');
    expect(forecastAnimClass(true, 'daily', 'hourly')).toBe('view-changing');
    expect(forecastAnimClass(true, 'daily', 'daily')).toBe('');
  });

  it('mode toggle shows the next mode and calls the handler', () => {
    const onToggle = vi.fn();
    const label = (type) => mount(renderModeToggle({ forecast: { type } }, onToggle))
      .querySelector('button').getAttribute('aria-label');
    expect(label('daily')).toBe('Switch to today (24-hour) forecast');
    expect(label('today')).toBe('Switch to hourly (7-day) forecast');
    expect(label('hourly')).toBe('Switch to daily forecast');
    mount(renderModeToggle({ forecast: {} }, onToggle)).querySelector('button').click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(mount(renderModeToggle({ forecast: { show_mode_toggle: false } }, onToggle)).querySelector('button')).toBeNull();
    expect(mount(renderModeToggle({ show_station: false, forecast: {} }, onToggle)).querySelector('button')).toBeNull();
  });

  it('condition icons: one cell per column, malformed entries dropped', () => {
    const el = mount(renderForecastConditionIcons(
      { forecast: {} },
      [day('2026-11-14T00:00:00Z'), null, day('2026-11-15T00:00:00Z', 'rainy')],
      3,
    ));
    expect(el.querySelectorAll('.conditions .forecast-item')).toHaveLength(2);
    expect(el.querySelector('use').getAttribute('href')).toBe('#wsc-i-weather-sunny');
    expect(mount(renderForecastConditionIcons({ forecast: { condition_icons: false } }, [], 0)).children).toHaveLength(0);
  });

  it('timeline: one segment per calendar day, thumb sized to the viewport', () => {
    const hours = [];
    for (let h = 0; h < 48; h += 6) hours.push(day(new Date(Date.UTC(2026, 10, 14, h)).toISOString()));
    const segs = timelineSegments([{ datetime: 'nope' }, ...hours], ZURICH);
    // 00:00Z is 01:00 in Zurich: 14 Nov holds 00/06/12/18Z, 15 Nov the rest.
    expect(segs.map((s) => [s.start, s.count])).toEqual([[1, 4], [5, 4]]);

    const el = mount(renderScrollTimeline(hours, ZURICH, 'en', 2));
    expect(el.querySelectorAll('.tl-seg')).toHaveLength(2);
    expect(el.querySelector('.tl-thumb').getAttribute('style')).toBe('left:0%;width:25%');
    expect(text(el.querySelector('.tl-seg'))).toBe('Sat 14');
    expect(mount(renderScrollTimeline([hours[0]], ZURICH, 'en', 2)).children).toHaveLength(0);
    expect(mount(renderScrollTimeline([{}, {}], ZURICH, 'en', 2)).children).toHaveLength(0);
    expect(mount(renderScrollTimeline(hours, ZURICH, 'en', 0)).querySelector('.tl-thumb').getAttribute('style'))
      .toBe('left:0%;width:100%');
  });

  it('ready, not scrolling: chart, rows, toggle, no scroll controls', () => {
    const el = mount(renderForecastBlock(blockCtx()));
    const block = el.querySelector('.forecast-scroll-block');
    expect(block.className.trim()).toBe('forecast-scroll-block');
    expect(el.querySelector('#forecastChart')).not.toBeNull();
    expect(el.querySelectorAll('.conditions .forecast-item')).toHaveLength(2);
    expect(text(el.querySelector('.wind-details'))).toBe('wind');
    expect(el.querySelector('.mode-toggle')).not.toBeNull();
    expect(el.querySelector('.scroll-indicator')).toBeNull();
    expect(el.querySelector('.src-btn')).toBeNull();
  });

  it('scrolling hourly: deferred rows until the generation is ready, timeline shown', () => {
    const cfg = { show_main: false, forecast: { type: 'hourly', chart_height: 180, disable_animation: true } };
    const deferred = mount(renderForecastBlock(blockCtx({
      config: cfg, scrolling: true, contentWidthPct: 300, mountAnimationPlayed: false,
    })));
    expect(deferred.querySelector('.forecast-scroll-block').classList.contains('first-mount')).toBe(true);
    expect(deferred.querySelector('.forecast-scroll-block').classList.contains('no-animation')).toBe(true);
    expect(deferred.querySelector('.forecast-content').getAttribute('style')).toBe('width: 300%');
    expect(deferred.querySelector('.conditions').getAttribute('style')).toBe('height: 26px');
    expect(deferred.querySelector('.forecast-item')).toBeNull();
    expect(deferred.querySelectorAll('.scroll-indicator')).toHaveLength(2);
    expect(deferred.querySelector('.jump-to-now')).not.toBeNull();
    expect(deferred.querySelector('.scroll-timeline')).not.toBeNull();
    expect(deferred.querySelector('.src-btn')).not.toBeNull();

    const ready = mount(renderForecastBlock(blockCtx({
      config: cfg, scrolling: true, rowsReadyGen: 'hourly|2',
    })));
    expect(ready.querySelectorAll('.forecast-item')).toHaveLength(2);
  });

  it('loading: skeleton plus space reserved for the enabled rows', () => {
    const el = mount(renderForecastBlock(blockCtx({ ready: false })));
    expect(el.querySelector('.forecast-loading .forecast-skeleton-wrapper').getAttribute('style'))
      .toBe('height: 180px');
    expect(el.querySelector('.conditions').getAttribute('style')).toBe('height: 26px');
    expect(el.querySelector('.wind-details').getAttribute('style')).toBe('height: 26px');
    const noRows = mount(renderForecastBlock(blockCtx({
      ready: false,
      config: { forecast: { chart_height: 120, condition_icons: false, show_wind_arrow: false, show_wind_speed: false } },
    })));
    expect(noRows.querySelector('.conditions')).toBeNull();
    expect(noRows.querySelector('.wind-details')).toBeNull();
  });
});

// -------------------------------------------------------- scroll position

describe('scroll position', () => {
  it('waits for every block the card intends to render', () => {
    expect(initialScrollDataReady({}, 0, 0)).toBe(false);
    expect(initialScrollDataReady({}, 3, 0)).toBe(true);
    expect(initialScrollDataReady({ show_forecast: true, weather_entity: 'weather.x' }, 3, 0)).toBe(false);
    expect(initialScrollDataReady({ show_station: false, show_forecast: true, weather_entity: 'weather.x' }, 0, 5)).toBe(true);
    expect(initialScrollDataReady(null, 1, 0)).toBe(true);
  });

  it('generation key follows type and viewport size', () => {
    expect(initialScrollGeneration(null)).toBe('daily|0');
    expect(initialScrollGeneration({ forecast: { type: 'hourly', number_of_forecasts: 12 } })).toBe('hourly|12');
  });

  const base = {
    config: { forecast: { type: 'daily', number_of_forecasts: 4 } },
    forecasts: [],
    stationCount: 4,
    forecastCount: 4,
    clientWidth: 400,
    scrollWidth: 800,
    calendar: ZURICH,
  };

  it('null until the layout has settled at the expected width', () => {
    expect(resolveInitialScrollLeft({ ...base, scrollWidth: 400 })).toBeNull();
    // A previous mode's width measured with the new counts.
    expect(resolveInitialScrollLeft({ ...base, scrollWidth: 2000 })).toBeNull();
  });

  it('centres the station / forecast boundary', () => {
    // Boundary at 4 of 8 columns = 400 px, centred in a 400 px viewport.
    expect(resolveInitialScrollLeft(base)).toBe(200);
  });

  it('day pager realigns only a drifted position', () => {
    expect(dayPagerRealignLeft(0, 1200, 400)).toBeNull();
    expect(dayPagerRealignLeft(401, 1200, 400)).toBeNull();
    expect(dayPagerRealignLeft(250, 1200, 400)).toBe(400);
    expect(dayPagerRealignLeft(150, 1200, 400)).toBe(0);
    expect(dayPagerRealignLeft(790, 1100, 400)).toBe(700);
    expect(dayPagerRealignLeft(10, 400, 400)).toBeNull();
    expect(dayPagerRealignLeft(10, 400, 0)).toBeNull();
  });
});

// ----------------------------------------------------------- source lines

const NO_READING = { value: undefined, unit: undefined, canonical: null };

// `readings`: key → [value, unit, canonical], as sensor-readings.ts extracts them.
function liveCtx({ config = {}, states = {}, values = {}, readings = {} } = {}) {
  const r = Object.fromEntries(LIVE_READING_KEYS.map((k) => {
    const spec = readings[k];
    return [k, spec ? { value: spec[0], unit: spec[1], canonical: spec[2] } : NO_READING];
  }));
  return {
    config,
    hass: { states },
    language: 'en',
    calendar: ZURICH,
    str: (k) => (typeof en[k] === 'string' ? en[k] : ''),
    units: en.units,
    cardinalDirections: en.cardinalDirections,
    readings: r,
    displayUnits: { temperature: '°C', pressure: 'hPa', speed: 'km/h', precipitation: 'mm' },
    stationWindUnit: 'km/h',
    values,
    entityLink: (_eid, content) => content,
    zeroDegreeLink: (_eid, content) => content,
  };
}

describe('source lines', () => {
  it('live keys follow the card order and toggles', () => {
    expect(sourceLiveKeys({ show_attributes: false })).toEqual(['temperature']);
    expect(sourceLiveKeys({ show_main: false, attributes_layout: [['pressure', 'wind_gust_speed']] }))
      .toEqual(['pressure', 'gust_speed']);
    expect(sourceLiveKeys(null)[0]).toBe('temperature');
  });

  it('alert when a shown value fell back or its sensor is overdue', () => {
    const cfg = { show_attributes: false };
    expect(sourcesAlert(cfg, { temperature: { kind: 'station', entityId: 'sensor.t' } }, new Set())).toBe(false);
    expect(sourcesAlert(cfg, { temperature: { kind: 'stale', entityId: 'sensor.t' } }, new Set(['sensor.t']))).toBe(true);
  });

  it('labels come from the editor vocabulary, sun and moon from their own key', () => {
    const str = (k) => `<${k}>`;
    expect(sourceLabelFor('sun', str, {}, {})).toBe('<sources_label_sun>');
    expect(sourceLabelFor('pressure', str, { pressure: 'Luftdruck' }, { pressure: 'Pressure' })).toBe('Luftdruck');
    expect(sourceLabelFor('pressure', str, {}, { pressure: 'Pressure' })).toBe('Pressure');
    expect(sourceLabelFor('mystery', str, {}, {})).toBe('mystery');
  });

  it('entity names: HA formatter, then friendly_name, then the id', () => {
    const states = { 'sensor.a': { attributes: { friendly_name: ' Garden ' } } };
    expect(entityName({ states }, 'sensor.a')).toBe('Garden');
    expect(entityName({ states, formatEntityName: () => ' Garden Temp ' }, 'sensor.a')).toBe('Garden Temp');
    expect(entityName({ states, formatEntityName: () => { throw new Error('x'); } }, 'sensor.a')).toBe('Garden');
    expect(entityName(null, 'sensor.b')).toBe('sensor.b');
  });

  it('one line per shown value with notes for down sensors, plus next rain', () => {
    const config = {
      show_main: true,
      attributes_layout: [['humidity', 'pressure', 'next_rain']],
      sensors: { next_rain: 'sensor.rain_next' },
      weather_entity: 'weather.home',
    };
    const states = {
      'sensor.p': { state: 'unavailable', last_changed: '2026-11-15T08:05:00Z' },
    };
    const lines = sourceLines({
      live: liveCtx({
        config,
        states,
        readings: { temperature: ['12.5', '°C', 12.5], pressure: ['1013', 'hPa', 1013] },
        values: {
          humidity: '80',
          next_rain_text: 'in 20 min', next_rain_title: 'Radar',
        },
      }),
      liveSources: {
        temperature: { kind: 'station', entityId: 'sensor.t' },
        humidity: { kind: 'stale', entityId: 'sensor.h' },
        pressure: { kind: 'weather', entityId: 'weather.home', sensorId: 'sensor.p' },
      },
      overdueIds: new Set(['sensor.p']),
      labelFor: (k) => k,
      entityName: (eid) => `name:${eid}`,
    });
    expect(lines.map((l) => l.label)).toEqual(['temperature', 'humidity', 'pressure', 'next_rain']);
    expect(lines[0]).toMatchObject({ kind: 'station', entityId: 'sensor.t', entityName: 'name:sensor.t' });
    expect(lines[0].note).toBeUndefined();
    expect(lines.map((l) => l.value).slice(0, 3)).toEqual(['12.5°C', '80 %', `1013 ${en.units.hPa}`]);
    // In grace: neutral waiting note.
    expect(lines[1].note).toBe(en.sources_waiting);
    // Overdue with a timestamp: names the sensor the weather stands in for.
    expect(lines[2].problem).toBe(true);
    expect(lines[2].note).toContain('name:sensor.p');
    expect(lines[2].note).toMatch(/\b9:05\b/);
    expect(lines[3]).toMatchObject({ kind: 'info', value: 'in 20 min', sourceText: 'Radar', entityId: 'sensor.rain_next' });
  });

  it('stale overdue sensor without a timestamp says so plainly', () => {
    const lines = sourceLines({
      live: liveCtx({ config: { show_attributes: false }, readings: { temperature: ['3', '°C', 3] } }),
      liveSources: { temperature: { kind: 'stale', entityId: 'sensor.t' } },
      overdueIds: new Set(['sensor.t']),
      labelFor: (k) => k,
      entityName: (eid) => eid,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].note).toBe(en.sources_stale);
  });

  it('legend: empty without a chart block, else resolves plan and colours once', () => {
    const resolve = vi.fn(() => ({
      pastFromOpenMeteo: false,
      sunshineParts: { station: null, forecast: null },
      colors: { high: 'red', low: 'blue', precip: 'cyan', sunshine: 'gold' },
    }));
    const str = (k) => k;
    expect(sourceLegend({ config: { show_station: false }, resolve, str })).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
    const items = sourceLegend({ config: { forecast: { type: 'daily' } }, resolve, str });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(items.length).toBeGreaterThan(0);
  });
});
