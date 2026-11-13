// @vitest-environment jsdom
// Unit tests for the live-panel row renderers (src/live-panel/, #449):
// each row is a plain function over a LivePanelCtx, so the tests build
// one by hand instead of mounting the card.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, html } from 'lit';
import en from '../src/locales/en.js';
import { Calendar } from '../src/utils/time-zone.js';
import {
  attrEntity, formatEntityNumber, isPresent, oneDecimal, unitLabel,
} from '../src/live-panel/context.js';
import {
  climateRowDewPoint, climateRowNextRain, climateRowPrecip, climateRowPressure,
  dewPointText, displayPressure, precipitationText, pressureText,
} from '../src/live-panel/climate-rows.js';
import {
  climateRowZeroDegree, climateRowZeroDegree48h, formatMetres, zeroDegreeElevation,
  zeroDegreeFormat, zeroDegreePlace, zeroDegreeWhen,
} from '../src/live-panel/zero-degree-rows.js';
import {
  moonText, renderMoonLine, renderSun, siteCoords, sunEventTimes, sunRowSun, sunRowSunStrength, sunText, uvText,
} from '../src/live-panel/sun-rows.js';
import {
  convertWind, displayWindSpeed, gustSpeed, renderForecastWind, spriteIcon, windDirIcon, windDirText,
  windRowDirection, windRowGust, windRowSpeed, windSpeedText,
} from '../src/live-panel/wind-rows.js';
import { renderAttributeColumn, renderAttributeLine, renderAttributes } from '../src/live-panel/attributes.js';
import { sourceValueText } from '../src/live-panel/source-values.js';

const BERN = { latitude: 46.95, longitude: 7.45 };

function makeCtx({ config = {}, hass = {}, values = {}, ...rest } = {}) {
  return {
    config,
    hass: { states: {}, config: {}, ...hass },
    language: 'en',
    calendar: new Calendar('Europe/Zurich'),
    str: (k) => (typeof en[k] === 'string' ? en[k] : ''),
    units: en.units,
    cardinalDirections: en.cardinalDirections,
    unitPressure: 'hPa',
    unitSpeed: 'km/h',
    weatherUnits: { temperature: '°C', windSpeed: 'km/h', pressure: 'hPa' },
    sourceTempUnit: '°C',
    values,
    entityLink: (eid, content) => (eid ? html`<a data-eid=${eid}>${content}</a>` : content),
    zeroDegreeLink: (eid, content) => html`<b data-eid=${eid}>${content}</b>`,
    ...rest,
  };
}

const host = (tpl) => {
  const el = document.createElement('div');
  render(tpl, el);
  return el;
};
const text = (tpl) => host(tpl).textContent.replace(/\s+/g, ' ').trim();
const attr = (tpl, sel, name) => host(tpl).querySelector(sel)?.getAttribute(name);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('context helpers', () => {
  it('attrEntity: sensor first, weather entity as fallback', () => {
    expect(attrEntity({ sensors: { pressure: 'sensor.p' }, weather_entity: 'weather.w' }, 'pressure')).toBe('sensor.p');
    expect(attrEntity({ weather_entity: 'weather.w' }, 'pressure')).toBe('weather.w');
    expect(attrEntity({ weather_entity: 'weather.w' }, 'pressure', false)).toBeUndefined();
    expect(attrEntity(null, 'pressure')).toBeUndefined();
  });

  it('unitLabel uses the locale table, else the raw unit', () => {
    const ctx = makeCtx();
    expect(unitLabel(ctx, 'hPa')).toBe(en.units.hPa);
    expect(unitLabel(ctx, 'furlong')).toBe('furlong');
    expect(unitLabel(ctx, undefined)).toBe('');
  });

  it('oneDecimal / isPresent', () => {
    expect(oneDecimal('12.345')).toBe('12.3');
    expect(oneDecimal(12)).toBe('12');
    expect(oneDecimal('n/a')).toBe('n/a');
    expect(oneDecimal(undefined)).toBe('');
    expect(oneDecimal(null)).toBe('');
    expect(isPresent('')).toBe(false);
    expect(isPresent(0)).toBe(true);
  });

  describe('formatEntityNumber', () => {
    const states = { 'sensor.z': { state: '2450.4', attributes: { unit_of_measurement: 'm' } } };
    const fmt = (s) => `${s.state}|${s.attributes?.unit_of_measurement}`;

    it('uses HA\'s formatter on a copy carrying the value', () => {
      const ctx = makeCtx({ hass: { states, formatEntityState: fmt } });
      expect(formatEntityNumber(ctx, 'sensor.z', 1800)).toBe('1800|m');
      expect(formatEntityNumber(ctx, 'sensor.z', 581, { unitOverride: 'ft' })).toBe('581|ft');
    });

    it('drops the unit suffix on request', () => {
      const ctx = makeCtx({ hass: { states, formatEntityState: (s) => `${s.state} m` } });
      expect(formatEntityNumber(ctx, 'sensor.z', 1800, { unit: 'm', withUnit: false })).toBe('1800');
      expect(formatEntityNumber(makeCtx(), 'sensor.z', 1800, { unit: 'm', withUnit: false })).toBe('1,800');
    });

    it('takes the Intl path without HA, for an unavailable entity and on a throw', () => {
      expect(formatEntityNumber(makeCtx(), 'sensor.z', 2450.4, { unit: 'm' })).toBe('2,450 m');
      const down = { 'sensor.z': { state: 'unavailable', attributes: {} } };
      expect(formatEntityNumber(makeCtx({ hass: { states: down, formatEntityState: fmt } }), 'sensor.z', 2450, { unit: 'm' }))
        .toBe('2,450 m');
      const boom = () => { throw new Error('x'); };
      expect(formatEntityNumber(makeCtx({ hass: { states, formatEntityState: boom } }), 'sensor.z', 1.26, { maxFractionDigits: 1 }))
        .toBe('1.3');
      expect(formatEntityNumber(makeCtx(), undefined, 'n/a', { unit: 'm' })).toBe('n/a m');
    });
  });
});

describe('climate rows', () => {
  it('pressure: hidden without a number, tooltip with trend', () => {
    const ctx = makeCtx({ config: { sensors: { pressure: 'sensor.p' } } });
    expect(climateRowPressure(ctx, false, 1013, null)).toBeNull();
    expect(climateRowPressure(ctx, true, undefined, null)).toBeNull();
    const row = climateRowPressure(ctx, true, 1013, -2.4);
    expect(text(row)).toBe(`1013 ${en.units.hPa}`);
    const title = attr(row, 'span[title]', 'title');
    expect(title).toContain('-2.4');
    expect(attr(row, 'a', 'data-eid')).toBe('sensor.p');
    expect(attr(climateRowPressure(ctx, true, 1013, null), 'span', 'title')).toBe('');
  });

  it('pressure converts and formats its text', () => {
    const ctx = makeCtx({ weatherUnits: { pressure: 'hPa' }, unitPressure: 'hPa' });
    expect(displayPressure(ctx, '1013.4')).toBe(1013);
    expect(displayPressure(ctx, null)).toBeUndefined();
    expect(pressureText({ ...ctx, unitPressure: undefined }, 1013)).toBe('1013');
  });

  it('dew point: band tooltip, one decimal, humidity segment', () => {
    const ctx = makeCtx({ values: { temperature: 20 } });
    const row = climateRowDewPoint(ctx, true, '12.345', true, 60);
    expect(text(row)).toBe('12.3 °C 60 %');
    expect(attr(row, 'span[title]', 'title')).toMatch(/12/);
    expect(text(climateRowDewPoint(ctx, false, 12, true, 60))).toBe('60 %');
    expect(text(climateRowDewPoint(ctx, true, 12, false, 60))).toBe('12 °C');
  });

  it('dew point converts °F sources for the classifier', () => {
    const ctx = makeCtx({ sourceTempUnit: '°F', weatherUnits: { temperature: '°F' }, values: { temperature: 68 } });
    const row = climateRowDewPoint(ctx, true, 54, false, undefined);
    expect(text(row)).toBe('54 °F');
    expect(attr(row, 'span[title]', 'title')).toContain('°F');
    expect(attr(climateRowDewPoint(makeCtx(), true, 12, false, undefined), 'span', 'title')).toBe('');
    expect(dewPointText(makeCtx({ weatherUnits: {} }), 12)).toBe('12');
  });

  it('precipitation: rate icon, link to the rate sensor', () => {
    const ctx = makeCtx({ config: { sensors: { precipitation: 'sensor.rain', precipitation_rate: 'sensor.rate' } } });
    expect(climateRowPrecip(ctx, true, false, '', 'mm/h')).toBeNull();
    const rate = climateRowPrecip(ctx, true, true, '1.4', 'mm/h');
    expect(text(rate)).toBe('1.4 mm/h');
    expect(attr(rate, 'a', 'data-eid')).toBe('sensor.rate');
    const plain = climateRowPrecip(makeCtx({ config: { sensors: { precipitation: 'sensor.rain' } } }), true, true, '3', 'mm');
    expect(attr(plain, 'ha-icon', 'icon')).toBe('hass:weather-rainy');
    expect(attr(plain, 'a', 'data-eid')).toBe('sensor.rain');
    expect(precipitationText(3, undefined)).toBe('3');
  });

  it('next rain: hidden without text, tooltip otherwise', () => {
    const ctx = makeCtx();
    expect(climateRowNextRain(ctx, '', 'mdi:x', '')).toBeNull();
    const row = climateRowNextRain(ctx, 'in 10 min.', 'mdi:weather-pouring', 'Radar');
    expect(text(row)).toBe('in 10 min.');
    expect(attr(row, 'span', 'title')).toBe('Radar');
    expect(attr(climateRowNextRain(ctx, 'Now', 'mdi:x', ''), 'span', 'aria-label')).toBe('Now');
  });
});

describe('zero-degree rows', () => {
  const T0 = Date.parse('2026-10-21T05:00:00Z');
  const curve = [0, 12, 24, 36].map((h, i) => ({ t: T0 + h * 3_600_000, level: [2500, 1600, 2600, 2300][i] }));
  const zdCtx = (extra = {}) => makeCtx({
    config: { use_12hour_format: false, sensors: { zero_degree_level: 'sensor.z', zero_degree_level_48h: 'sensor.z48' }, ...extra.config },
    hass: { states: { 'sensor.z': { state: '2500', attributes: { unit_of_measurement: 'm' } } }, ...extra.hass },
    values: { zero_degree_48h_unit: 'm', ...extra.values },
  });

  it('current level: plain without elevation, tooltip with it', () => {
    expect(climateRowZeroDegree(zdCtx(), false, 2500, 'm')).toBeNull();
    expect(climateRowZeroDegree(zdCtx(), true, '', 'm')).toBeNull();
    expect(text(climateRowZeroDegree(zdCtx(), true, 2500, 'm'))).toBe('2,500 m');
    const row = climateRowZeroDegree(zdCtx({ config: { elevation: 600, title: ' Bern ' } }), true, 2500, 'm');
    expect(attr(row, 'span', 'title')).toBe('Snow line about 2,200 m (estimated), Bern 600 m · far above you');
  });

  it('helpers: elevation, place, metres, when, popup format', () => {
    const ctx = zdCtx({ config: { elevation: 581 } });
    expect(zeroDegreeElevation(ctx)).toBe(581);
    expect(zeroDegreePlace(ctx, 581)).toBe('581 m');
    expect(formatMetres(ctx, 1234)).toBe('1,234 m');
    expect(zeroDegreeFormat(ctx, 1800)).toBe('1,800 m');
    expect(zeroDegreeFormat(ctx, 1800, false)).toBe('1,800');
    expect(zeroDegreeWhen(ctx, T0)).toEqual({ day: 'Wed', time: '07:00' });
  });

  it('trend row with a curve: target, next movement and snow to site', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const ctx = zdCtx({ values: { zero_degree_curve: curve }, config: { elevation: 1500, forecast: {} } });
    const row = climateRowZeroDegree48h(ctx, 1600, 'm', -900, undefined, 2500);
    const title = attr(row, 'span[title]', 'title');
    expect(title).toMatch(/^Falls/);
    expect(title).toContain('now 2,500 m');
    expect(title).toContain('then up to 2,600 m');
    expect(title).toContain('Snow down to 1,500 m');
    expect(attr(row, '.wsc-zd-target', 'style')).toBe('color: rgba(132, 209, 253, 1.0)');
    expect(text(row)).toContain('❄');
  });

  it('trend row: a flat curve stays between, no current value uses the curve', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const flat = [0, 6, 12].map((h, i) => ({ t: T0 + h * 3_600_000, level: [2500, 2450, 2600][i] }));
    const row = climateRowZeroDegree48h(zdCtx({ values: { zero_degree_curve: flat } }), 2450, 'm', 0, undefined, '');
    expect(attr(row, 'span[title]', 'title')).toBe('Stays between 2,450 and 2,600 m');
    expect(climateRowZeroDegree48h(zdCtx(), '', 'm', 0)).toBeNull();
  });

  it('trend row without a curve: change arrow and the `at` tooltip', () => {
    const ctx = zdCtx();
    expect(attr(climateRowZeroDegree48h(ctx, 1800, 'm', 40), 'ha-icon[icon^="mdi:trending"]', 'icon')).toBe('mdi:trending-neutral');
    expect(attr(climateRowZeroDegree48h(ctx, 1800, 'm', 650), 'ha-icon[icon^="mdi:trending"]', 'icon')).toBe('mdi:trending-up');
    expect(host(climateRowZeroDegree48h(ctx, 1800, 'm', undefined)).querySelector('[title]')).toBeNull();
    const row = climateRowZeroDegree48h(ctx, 1585, 'm', -865, '2026-10-22T05:00:00Z', 2450);
    expect(attr(row, 'span[title]', 'title')).toBe('Lowest 1,585 m Thu 07:00 · now 2,450 m');
    expect(attr(climateRowZeroDegree48h(ctx, 1585, 'm', -865, 'garbage'), 'span[title]', 'title')).toBeUndefined();
  });
});

describe('sun rows', () => {
  const NOW = new Date('2026-07-01T10:00:00Z');

  it('sun strength: UV + lux by day, night reason, links', () => {
    const ctx = makeCtx({ config: { sensors: { uv_index: 'sensor.uv', illuminance: 'sensor.lux' } } });
    expect(sunRowSunStrength(ctx, false, false, 3, 1000, null, null)).toBeNull();
    expect(sunRowSunStrength(ctx, true, true, '', '', null, null)).toBeNull();
    expect(sunRowSunStrength(ctx, true, false, 'n/a', '', null, null)).toBeNull();
    const day = sunRowSunStrength(ctx, true, true, 6.24, 80000, null, null);
    expect(text(day)).toMatch(/^UV 6.2 \/ /);
    expect(attr(day, 'span', 'title')).toContain('UV 6.2 (High)');
    expect(attr(day, 'a', 'data-eid')).toBe('sensor.uv');
    const lux = sunRowSunStrength(ctx, false, true, 6, 80000, null, null);
    expect(attr(lux, 'a', 'data-eid')).toBe('sensor.lux');
    const night = sunRowSunStrength(ctx, true, true, 0, 0, null, null);
    expect(attr(night, 'span', 'title')).toBe(en.sun_strength_night_reason);
    const wx = sunRowSunStrength(makeCtx({ config: { weather_entity: 'weather.w' } }), true, false, 3, '', null, null);
    expect(attr(wx, 'a', 'data-eid')).toBe('weather.w');
  });

  it('sun line, coordinates and text', () => {
    vi.useFakeTimers({ now: NOW });
    const ctx = makeCtx({ config: { location: BERN, use_12hour_format: false } });
    expect(siteCoords(ctx)).toEqual({ lat: 46.95, lon: 7.45 });
    expect(siteCoords(makeCtx())).toEqual({ lat: null, lon: null });
    const t = sunEventTimes(ctx);
    expect(sunText(ctx)).toBe(`${t.rise} ${t.set}`);
    expect(text(renderSun(ctx))).toBe(`${t.rise} ${t.set}`);
    expect(text(sunRowSun(ctx, true))).toBe(`${t.rise} ${t.set}`);
    expect(sunRowSun(ctx, false)).toBeNull();
    expect(sunRowSun(makeCtx(), true)).toBeNull();
    expect(sunText(makeCtx())).toBe('');
  });

  it('moon line: text matches the rendered line, with and without a location', () => {
    vi.useFakeTimers({ now: NOW });
    const ctx = makeCtx({ config: { location: BERN, use_12hour_format: false } });
    expect(text(renderMoonLine(ctx))).toBe(moonText(ctx));
    expect(moonText(ctx)).toMatch(/^\d+% \d\d:\d\d$/);
    const south = makeCtx({ config: { location: { latitude: -33.9, longitude: 18.4 } } });
    expect(text(renderMoonLine(south))).toBe(moonText(south));
    expect(moonText(makeCtx())).toMatch(/^\d+%$/);
    expect(uvText(3.14)).toBe('UV 3.1');
  });
});

describe('wind rows', () => {
  it('direction icon and text', () => {
    expect(windDirIcon(0)).toBe('arrow-down');
    expect(windDirIcon('NE')).toBe('arrow-bottom-left');
    expect(windDirIcon('WNW')).toBe('arrow-down');
    expect(windDirIcon('??')).toBeUndefined();
    expect(windDirText(en.cardinalDirections, 90)).toBe(en.cardinalDirections[4]);
    expect(windDirText(en.cardinalDirections, 'SW')).toBe('SW');
  });

  it('live rows', () => {
    const ctx = makeCtx({ config: { sensors: { wind_direction: 'sensor.wd', wind_speed: 'sensor.ws', gust_speed: 'sensor.g' } } });
    expect(windRowDirection(ctx, true, undefined)).toBeNull();
    expect(windRowDirection(ctx, false, 90)).toBeNull();
    expect(text(windRowDirection(ctx, true, 90))).toBe(en.cardinalDirections[4]);
    expect(windRowSpeed(ctx, false, 10)).toBeNull();
    expect(text(windRowSpeed(ctx, true, displayWindSpeed(ctx, '10')))).toBe(`10 ${en.units['km/h']}`);
    expect(windRowGust(ctx, false, 5)).toBeNull();
    expect(attr(windRowGust(ctx, true, '5'), 'a', 'data-eid')).toBe('sensor.g');
    expect(gustSpeed(ctx, 'x')).toBeNull();
    expect(convertWind(ctx, 10, 'm/s')).toBe(36);
    expect(convertWind(ctx, '10')).toBeNull();
    expect(windSpeedText({ ...ctx, unitSpeed: undefined }, 4)).toBe('4');
  });

  it('sprite icon: sprite reference, else ha-icon', () => {
    expect(host(spriteIcon('hass:arrow-down', 'wind-icon')).querySelector('svg.wsc-icon.wind-icon use')).not.toBeNull();
    expect(host(spriteIcon('mdi:not-in-sprite')).querySelector('ha-icon')).not.toBeNull();
    expect(host(spriteIcon(undefined)).querySelector('ha-icon')).not.toBeNull();
  });

  it('forecast wind row toggles', () => {
    const items = [
      { datetime: '2026-10-01T12:00:00Z', wind_speed: 10, wind_speed_unit: 'km/h', wind_bearing: 90 },
      { datetime: '2026-10-02T12:00:00Z' },
    ];
    const withFc = (forecast) => makeCtx({ config: { forecast } });
    expect(text(renderForecastWind(withFc({ show_wind_forecast: false }), items, 10))).toBe('');
    expect(text(renderForecastWind(withFc({ show_wind_arrow: false, show_wind_speed: false }), items, 10))).toBe('');
    const both = host(renderForecastWind(withFc({}), items, 10));
    expect(both.querySelectorAll('.wind-detail')).toHaveLength(2);
    expect(both.querySelectorAll('.wind-speed')).toHaveLength(1);
    expect(both.querySelectorAll('.wind-icon')).toHaveLength(1);
    expect(host(renderForecastWind(makeCtx(), null, 10)).querySelectorAll('.wind-detail')).toHaveLength(0);
  });
});

describe('attribute composition', () => {
  const values = {
    pressure: 1013, humidity: 60, dew_point: 12, temperature: 20, precipitation: '1.2', precipitation_unit: 'mm/h',
    windSpeed: 10, windDirection: 90, wind_gust_speed: 20, uv_index: 3, illuminance: 50000,
    zero_degree_level: 2500, zero_degree_unit: 'm', zero_degree_48h_level: 1800, zero_degree_48h_unit: 'm',
    next_rain_text: 'Now', next_rain_icon: 'mdi:x', next_rain_title: 'Radar',
  };
  const d = { dPressure: 1013, dWindSpeed: 10, lat: null, lon: null };

  it('maps every token onto a row', () => {
    vi.useFakeTimers({ now: new Date('2026-07-01T10:00:00Z') });
    const ctx = makeCtx({ values, config: { location: BERN } });
    for (const token of ['pressure', 'dew_point_humidity', 'dew_point', 'humidity', 'precipitation',
      'zero_degree_level', 'zero_degree_level_48h', 'next_rain', 'uv_illuminance', 'uv_index', 'illuminance',
      'sun', 'moon', 'wind_direction', 'wind_speed', 'wind_gust_speed']) {
      expect(renderAttributeLine(ctx, token, d), token).not.toBeNull();
    }
    expect(renderAttributeLine(ctx, 'bogus', d)).toBeNull();
  });

  it('drops empty columns and honours show_attributes', () => {
    const ctx = makeCtx({ values: {} });
    expect(renderAttributeColumn(ctx, ['pressure', 'humidity'], { ...d, dPressure: undefined })).toBeNull();
    expect(text(renderAttributes(makeCtx({ config: { show_attributes: false } })))).toBe('');
    const el = host(renderAttributes(makeCtx({ values, config: { attributes_layout: [['pressure'], ['wind_speed']] } })));
    expect(el.querySelectorAll('.attributes > div')).toHaveLength(2);
  });
});

describe('sources popup value text', () => {
  it('matches the rows for every key', () => {
    vi.useFakeTimers({ now: new Date('2026-07-01T10:00:00Z') });
    const ctx = makeCtx({
      config: { location: BERN },
      values: {
        temperature: 19.44, humidity: 60, dew_point: 12.34, pressure: 1013.4, precipitation: 0.4, precipitation_unit: 'mm/h',
        uv_index: 3.14, illuminance: 50000, windSpeed: 10, wind_gust_speed: 20, windDirection: 'SW',
      },
    });
    const v = (k) => sourceValueText(ctx, k, '°C');
    expect(v('temperature')).toBe('19.4°C');
    expect(v('humidity')).toBe('60 %');
    expect(v('dew_point')).toBe('12.3 °C');
    expect(v('pressure')).toBe(`1013 ${en.units.hPa}`);
    expect(v('precipitation')).toBe('0.4 mm/h');
    expect(v('uv_index')).toBe('UV 3.1');
    expect(v('illuminance')).not.toBe('');
    expect(v('wind_speed')).toBe(`10 ${en.units['km/h']}`);
    expect(v('gust_speed')).toBe(`20 ${en.units['km/h']}`);
    expect(v('wind_direction')).toBe('SW');
    expect(v('sun')).toBe(sunText(ctx));
    expect(v('moon')).toBe(moonText(ctx));
    expect(v('nope')).toBe('');
  });

  it('is empty for values that are not on screen', () => {
    const ctx = makeCtx({ config: {} });
    for (const k of ['temperature', 'humidity', 'dew_point', 'pressure', 'precipitation', 'uv_index',
      'illuminance', 'wind_speed', 'gust_speed', 'wind_direction', 'sun']) {
      expect(sourceValueText(ctx, k, '°C'), k).toBe('');
    }
  });
});
