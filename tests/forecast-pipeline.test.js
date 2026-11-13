// Forecast pipeline (#450): the source plan, the shared past-source
// rule and the normalised card config.

import { describe, it, expect } from 'vitest';
import { normalizeConfig, positiveInt } from '../src/card-config.js';
import { hasStationSensor, pastFromOpenMeteo, pastSource } from '../src/past-source.js';
import {
  buildForecastEntries,
  needsOpenMeteo,
  openMeteoFetchWindow,
  openMeteoStationWindow,
  overlayOnEntries,
  planSources,
  sliceForecast,
} from '../src/forecast-pipeline.js';
import { Calendar } from '../src/utils/time-zone.js';

const cal = new Calendar('UTC');
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const futureDays = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  datetime: new Date(cal.startOfDay(Date.now()).getTime() + (i + 1) * DAY).toISOString(),
  ...extra,
}));
const cfg = (raw) => normalizeConfig({ weather_entity: 'weather.home', ...raw });

describe('positiveInt / normalizeConfig', () => {
  it('parses positive integers and falls back otherwise', () => {
    expect(positiveInt('5', 7)).toBe(5);
    expect(positiveInt(3.9, 7)).toBe(3);
    expect(positiveInt('abc', 7)).toBe(7);
    expect(positiveInt(0, 7)).toBe(7);
    expect(positiveInt(-2, 7)).toBe(7);
    expect(positiveInt(undefined, 7)).toBe(7);
  });

  it('normalises days and forecast_days once', () => {
    expect(normalizeConfig({}).days).toBe(7);
    expect(normalizeConfig({ days: '10' }).days).toBe(10);
    expect(normalizeConfig({ days: 'x' }).days).toBe(7);
    expect(normalizeConfig({ days: 4 }).forecast_days).toBe(7);
    expect(normalizeConfig({ days: 4, forecast_days: null }).forecast_days).toBe(4);
    expect(normalizeConfig({ forecast_days: '3' }).forecast_days).toBe(3);
  });

  it('merges defaults and keeps the legacy top-level speed', () => {
    const c = normalizeConfig({ speed: 'km/h', forecast: { type: 'hourly' }, units: { pressure: 'mmHg' } });
    expect(c.units.speed).toBe('km/h');
    expect(c.units.pressure).toBe('mmHg');
    expect(c.forecast.type).toBe('hourly');
    expect(c.forecast.show_sunshine).toBe(false);
    expect(c.sensors).toEqual({});
  });
});

describe('pastSource', () => {
  it('lets any station sensor win', () => {
    expect(hasStationSensor({ temperature: ' ' })).toBe(false);
    expect(hasStationSensor({ temperature: 'sensor.t' })).toBe(true);
    expect(pastSource({ sensors: { temperature: 'sensor.t' }, forecast: { openmeteo_history: true } })).toBe('sensors');
  });

  it('falls back to the Open-Meteo opt-in unless the master switch is off', () => {
    expect(pastSource({ forecast: { openmeteo_history: true } })).toBe('openmeteo');
    expect(pastSource({ forecast: { openmeteo_history: true, openmeteo: false } })).toBe(null);
    expect(pastSource({})).toBe(null);
    expect(pastSource(null)).toBe(null);
  });

  it('feeds the card past block from Open-Meteo only with a weather entity and the block on', () => {
    const base = { weather_entity: 'weather.home', forecast: { openmeteo_history: true } };
    expect(pastFromOpenMeteo(base)).toBe(true);
    expect(pastFromOpenMeteo({ ...base, weather_entity: '' })).toBe(false);
    expect(pastFromOpenMeteo({ ...base, show_station: false })).toBe(false);
    expect(pastFromOpenMeteo({ ...base, sensors: { temperature: 'sensor.t' } })).toBe(false);
  });
});

describe('planSources', () => {
  it('attributes forecast sunshine to the entity when it covers every column', () => {
    const plan = planSources(cfg({ show_station: false, forecast: { show_sunshine: true } }),
      futureDays(5, { sunshine_duration: 300 }), cal);
    expect(plan.sunshine).toEqual({ station: null, forecast: 'entity' });
    expect(plan.openMeteo.sunshine).toBe(false);
    expect(needsOpenMeteo(plan)).toBe(false);
  });

  it('marks partly covered forecasts mixed and asks Open-Meteo', () => {
    const data = futureDays(5, { sunshine_duration: 300 });
    delete data[2].sunshine_duration;
    const plan = planSources(cfg({ show_station: false, forecast: { show_sunshine: true } }), data, cal);
    expect(plan.sunshine.forecast).toBe('mixed');
    expect(plan.openMeteo.sunshine).toBe(true);
  });

  it('keeps the entity part and skips Open-Meteo with the master switch off', () => {
    const data = futureDays(5, { sunshine_duration: 300 });
    delete data[2].sunshine_duration;
    const plan = planSources(cfg({ show_station: false, forecast: { show_sunshine: true, openmeteo: false } }), data, cal);
    expect(plan.sunshine.forecast).toBe('entity');
    expect(needsOpenMeteo(plan)).toBe(false);
  });

  it('takes station sunshine from the sensor only in daily mode', () => {
    const sensors = { temperature: 'sensor.t', illuminance: 'sensor.lux' };
    const daily = planSources(cfg({ sensors, forecast: { show_sunshine: true } }), null, cal);
    expect(daily.sunshine.station).toBe('sensor');
    expect(daily.past).toBe('recorder');
    const hourly = planSources(cfg({ sensors, forecast: { show_sunshine: true, type: 'hourly' } }), null, cal);
    expect(hourly.sunshine.station).toBe('openmeteo');
    expect(hourly.openMeteo.sunshine).toBe(true);
  });

  it('plans the Open-Meteo past block', () => {
    const plan = planSources(cfg({ forecast: { openmeteo_history: true } }), null, cal);
    expect(plan.past).toBe('openmeteo');
    expect(plan.openMeteo.past).toBe(true);
    expect(planSources(cfg({ show_station: false }), null, cal).past).toBe(null);
  });

  it('asks Open-Meteo for the chance of rain only when the entity has none', () => {
    const c = cfg({ show_station: false, forecast: { show_precip_probability: true } });
    expect(planSources(c, futureDays(3), cal).openMeteo.precipProbability).toBe(true);
    expect(planSources(c, futureDays(3, { precipitation_probability: 40 }), cal).openMeteo.precipProbability).toBe(false);
    expect(planSources(c, null, cal).openMeteo.precipProbability).toBe(false);
  });

  it('turns the cloud-cover estimate on in daily mode only', () => {
    expect(planSources(cfg({}), null, cal).cloudExponent).toBe(1.7);
    expect(planSources(cfg({ condition_mapping: { sunshine_cloud_exponent: 2 } }), null, cal).cloudExponent).toBe(2);
    expect(planSources(cfg({ forecast: { type: 'hourly' } }), null, cal).cloudExponent).toBe(null);
  });

  it('falls back to daily for an unknown forecast.type', () => {
    const plan = planSources(cfg({ forecast: { type: 'weekly' } }), null, cal);
    expect(plan.type).toBe('daily');
    expect(plan.granularity).toBe('daily');
  });
});

describe('sliceForecast', () => {
  it('caps daily mode at forecast_days', () => {
    expect(sliceForecast(cfg({ forecast_days: 3 }), futureDays(10), cal)).toHaveLength(3);
  });

  it('is empty without a forecast block', () => {
    expect(sliceForecast(cfg({ show_forecast: false }), futureDays(10), cal)).toEqual([]);
    expect(sliceForecast(normalizeConfig({}), futureDays(10), cal)).toEqual([]);
  });
});

describe('buildForecastEntries', () => {
  const ctxFor = (config, forecastData) => {
    const plan = planSources(config, forecastData, cal);
    return { plan, calendar: cal, hass: null, openMeteo: null, location: null };
  };

  it('trims forecast entries that fall inside the station window', () => {
    const today = cal.startOfDay(Date.now()).getTime();
    const station = [
      { datetime: new Date(today - DAY).toISOString(), temperature: 10 },
      { datetime: new Date(today).toISOString(), temperature: 11 },
    ];
    const forecast = [
      { datetime: new Date(today - DAY).toISOString(), temperature: 1 },
      { datetime: new Date(today).toISOString(), temperature: 2 },
      { datetime: new Date(today + DAY).toISOString(), temperature: 3 },
    ];
    const c = cfg({ forecast: { type: 'daily' } });
    const out = buildForecastEntries(station, ctxFor(c, forecast));
    // Daily keeps the forecast's own today next to the station's today.
    expect(out.stationCount).toBe(2);
    expect(out.forecastCount).toBe(2);
    expect(out.entries.map((e) => e.temperature)).toEqual([10, 11, 2, 3]);
  });

  it('drops the station side when the block is off', () => {
    const station = [{ datetime: new Date(Date.now() - DAY).toISOString(), temperature: 10 }];
    const c = cfg({ show_station: false });
    const out = buildForecastEntries(station, ctxFor(c, futureDays(2)));
    expect(out.stationCount).toBe(0);
    expect(out.forecastCount).toBe(2);
  });

  it('carries the entity sunshine onto forecast entries', () => {
    const c = cfg({ show_station: false, forecast: { show_sunshine: true } });
    const out = buildForecastEntries([], ctxFor(c, futureDays(2, { sunshine_duration: 120 })));
    expect(out.entries.map((e) => e.sunshine)).toEqual([2, 2]);
  });

  it('builds 3-hour blocks in today mode', () => {
    const start = cal.startOfDay(Date.now()).getTime() + DAY;
    const forecast = Array.from({ length: 24 }, (_, i) => ({
      datetime: new Date(start + i * HOUR).toISOString(),
      temperature: i,
    }));
    const c = cfg({ show_station: false, forecast: { type: 'today' } });
    const out = buildForecastEntries([], ctxFor(c, forecast));
    expect(out.entries).toHaveLength(8);
    expect(out.entries.every((e) => e.day_length === 3)).toBe(true);
    expect(out.stationCount).toBe(0);
  });

  it('re-overlays existing entries without touching the station part', () => {
    const c = cfg({ show_station: false, forecast: { show_precip_probability: true } });
    const ctx = ctxFor(c, futureDays(2));
    const entries = [{ datetime: futureDays(1)[0].datetime, precipitation_probability: 30 }];
    expect(overlayOnEntries(entries, 0, ctx)[0].precipitation_probability).toBe(30);
  });
});

describe('Open-Meteo windows', () => {
  it('derives the request window from the normalised config', () => {
    expect(openMeteoFetchWindow(cfg({ days: 5, forecast_days: 4 }))).toEqual({ pastDays: 6, forecastDays: 5, includeHourly: false });
    expect(openMeteoFetchWindow(cfg({ days: 200, forecast_days: 30, forecast: { type: 'today' } })))
      .toEqual({ pastDays: 92, forecastDays: 16, includeHourly: true });
  });

  it('cuts the daily station window at today and to `days` entries', () => {
    const now = Date.now();
    const today = cal.startOfDay(now).getTime();
    const all = Array.from({ length: 10 }, (_, i) => ({ datetime: new Date(today + (i - 6) * DAY).toISOString() }));
    const src = { getDailyStationForecast: () => all };
    const win = openMeteoStationWindow(src, cfg({ days: 3 }), cal, now);
    expect(win.map((e) => e.datetime)).toEqual(all.slice(4, 7).map((e) => e.datetime));
    expect(openMeteoStationWindow(null, cfg({}), cal, now)).toEqual([]);
    expect(openMeteoStationWindow({}, cfg({}), cal, now)).toEqual([]);
  });

  it('cuts the hourly station window at the current hour', () => {
    const now = Date.now();
    const nowHour = cal.startOfHour(now).getTime();
    const all = Array.from({ length: 72 }, (_, i) => ({ datetime: new Date(nowHour + (i - 60) * HOUR).toISOString() }));
    const win = openMeteoStationWindow({ getHourlyStationForecast: () => all }, cfg({ days: 1, forecast: { type: 'hourly' } }), cal, now);
    expect(win.length).toBeLessThanOrEqual(24);
    expect(new Date(win[win.length - 1].datetime).getTime()).toBe(nowHour);
  });
});
