// @vitest-environment jsdom
// ADR-0035, point 6: one weather situation written in three unit sets
// enters through the card's doors and leaves through its exits. The
// canonical values, the classifications and the texts must not depend on
// the unit the value came in.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, html } from 'lit';
import en from '../src/locales/en.js';
import { Calendar } from '../src/utils/time-zone.js';
import { clearDedupeCaches } from '../src/utils/shared-requests.js';
import { WeatherEntityFeature } from '../src/const.js';
import { extractSensorReadings } from '../src/sensor-readings.js';
import { MeasuredDataSource, ForecastDataSource, fetchPressure3hDelta } from '../src/data-source.js';
import { getPressureTrend } from '../src/pressure-trend.js';
import { getDewPointComfort } from '../src/dew-point-comfort.js';
import { shownText, shownValue } from '../src/live-panel/context.js';
import { climateRowDewPoint, climateRowPressure } from '../src/live-panel/climate-rows.js';
import { renderForecastWind } from '../src/live-panel/wind-rows.js';
import { toDisplayData } from '../src/chart/orchestrator.js';

const cal = new Calendar('Europe/Zurich');
const NOW = new Date('2026-05-12T14:23:45Z');
const START = cal.zonedDate(2026, 5, 11);
const DAY = cal.addDays(START, 1).toISOString();
const SENSORS = {
  temperature: 'sensor.t', dew_point: 'sensor.dew', pressure: 'sensor.p',
  wind_speed: 'sensor.wind', gust_speed: 'sensor.gust', precipitation: 'sensor.rain',
};
const INPUTS = {
  metric: {
    units: { temperature: '°C', pressure: 'hPa', speed: 'm/s', precipitation: 'mm' },
    live: { t: '17.43', dew: '15.07', p: '1013.2', wind: '5.2', gust: '9.4', rain: '12.7' },
    day: { tMax: 24.6, tMin: 13.8, rain: 12.7 },
    pressure3h: [1014.9, 1013.2],
    forecast: { temperature: 21.6, templow: 11.9, precipitation: 3.2 },
  },
  us: {
    units: { temperature: '°F', pressure: 'inHg', speed: 'mph', precipitation: 'in' },
    live: { t: '63.37', dew: '59.13', p: '29.92', wind: '11.63', gust: '21.03', rain: '0.5' },
    day: { tMax: 76.28, tMin: 56.84, rain: 0.5 },
    pressure3h: [29.9702, 29.92],
    forecast: { temperature: 70.88, templow: 53.42, precipitation: 0.126 },
  },
  exotic: {
    units: { temperature: 'K', pressure: 'kPa', speed: 'kn', precipitation: 'cm' },
    live: { t: '290.58', dew: '288.22', p: '101.32', wind: '10.11', gust: '18.27', rain: '1.27' },
    day: { tMax: 297.75, tMin: 286.95, rain: 1.27 },
    pressure3h: [101.49, 101.32],
    forecast: { temperature: 294.75, templow: 285.05, precipitation: 0.32 },
  },
};
const CANONICAL = {
  live: { temperature: 17.43, dew_point: 15.07, pressure: 1013.2, wind_speed: 5.2, gust_speed: 9.4 },
  past: { temperature: 24.6, templow: 13.8, precipitation: 12.7, pressure: 1013.2, wind_speed: 5.2, wind_gust_speed: 9.4 },
  forecast: { temperature: 21.6, templow: 11.9, precipitation: 3.2, pressure: 1013.2, wind_speed: 5.2, wind_gust_speed: 9.4 },
  pressureDelta: -1.7,
};
const TOLERANCE = {
  temperature: 0.005, templow: 0.005, dew_point: 0.005, pressure: 0.01,
  wind_speed: 0.002, gust_speed: 0.002, wind_gust_speed: 0.002, precipitation: 0.001,
};
const EXPECTED = {
  metric: {
    temperature: '17.4 °C', dew_point: '15.1 °C', pressure: '1013 hPa', wind_speed: '5 m/s', gust_speed: '9 m/s',
    pressureTooltip: 'Pressure falling · Δ3h -1.7 hPa · deteriorating',
    dewTooltip: 'Dew point 15 °C · Spread 2 °C · dew likely',
    windRow: '9 m/s', tempHigh: [25, 22], tempLow: [14, 12], precip: [12.7, 3.2],
  },
  us: {
    temperature: '63.4 °F', dew_point: '59.1 °F', pressure: '29.92 inHg', wind_speed: '12 mph', gust_speed: '21 mph',
    pressureTooltip: 'Pressure falling · Δ3h -0.05 inHg · deteriorating',
    dewTooltip: 'Dew point 59 °F · Spread 4 °F · dew likely',
    windRow: '21 mph', tempHigh: [76, 71], tempLow: [57, 53], precip: [0.5, 0.126],
  },
  exotic: {
    temperature: '290.6 K', dew_point: '288.2 K', pressure: '101.3 kPa', wind_speed: '10 kn', gust_speed: '18 kn',
    pressureTooltip: 'Pressure falling · Δ3h -0.17 kPa · deteriorating',
    dewTooltip: 'Dew point 288 K · Spread 2 K · dew likely',
    windRow: '18 kn', tempHigh: [298, 295], tempLow: [287, 285], precip: [1.27, 0.32],
  },
};

const SETS = ['metric', 'us', 'exotic'];
const PAIRS = SETS.flatMap((input) => SETS.map((display) => [input, display]));

function statesOf(set) {
  const { units, live } = INPUTS[set];
  return {
    'sensor.t': { state: live.t, attributes: { unit_of_measurement: units.temperature } },
    'sensor.dew': { state: live.dew, attributes: { unit_of_measurement: units.temperature } },
    'sensor.p': { state: live.p, attributes: { unit_of_measurement: units.pressure } },
    'sensor.wind': { state: live.wind, attributes: { unit_of_measurement: units.speed } },
    'sensor.gust': { state: live.gust, attributes: { unit_of_measurement: units.speed } },
    'sensor.rain': { state: live.rain, attributes: { unit_of_measurement: units.precipitation } },
    'weather.home': {
      state: 'cloudy',
      attributes: {
        supported_features: WeatherEntityFeature.FORECAST_DAILY,
        temperature_unit: units.temperature,
        pressure_unit: units.pressure,
        wind_speed_unit: units.speed,
        precipitation_unit: units.precipitation,
      },
    },
  };
}

function readingsOf(set) {
  return extractSensorReadings({
    sensors: SENSORS, states: statesOf(set), weatherEntity: 'weather.home', lastGood: {},
  });
}

function pastEntry(set) {
  const { live, day } = INPUTS[set];
  const stats = {
    'sensor.t': [{ start: DAY, max: day.tMax, min: day.tMin }],
    'sensor.dew': [{ start: DAY, mean: Number(live.dew) }],
    'sensor.p': [{ start: DAY, mean: Number(live.p) }],
    'sensor.wind': [{ start: DAY, mean: Number(live.wind) }],
    'sensor.gust': [{ start: DAY, max: Number(live.gust) }],
    'sensor.rain': [{ start: DAY, change: day.rain }],
  };
  return new MeasuredDataSource(
    { config: { latitude: 46.95, longitude: 7.45 }, states: statesOf(set), callWS: vi.fn() },
    { sensors: SENSORS, days: 1 },
    cal,
  )._buildForecast(stats, SENSORS, START, 1)[0];
}

async function forecastEntry(set) {
  const { live, forecast } = INPUTS[set];
  const conn = { subscribeMessage: vi.fn().mockResolvedValue(vi.fn()) };
  const hass = { connection: conn, states: statesOf(set), config: { time_zone: 'Europe/Zurich' } };
  const events = [];
  new ForecastDataSource(hass, { weather_entity: 'weather.home' }, cal).subscribe((e) => events.push(e));
  await Promise.resolve();
  conn.subscribeMessage.mock.calls[0][0]({
    forecast: [{
      datetime: '2026-05-13T00:00:00+02:00',
      ...forecast,
      pressure: Number(live.p),
      wind_speed: Number(live.wind),
      wind_gust_speed: Number(live.gust),
    }],
  });
  return events.at(-1).forecast[0];
}

async function pressureDelta(set) {
  const endMs = cal.startOfHour(NOW).getTime();
  const [older, newest] = INPUTS[set].pressure3h;
  const hass = {
    states: statesOf(set),
    callWS: vi.fn().mockResolvedValue({
      'sensor.p': [
        { start: new Date(endMs - 4 * 3600_000).toISOString(), mean: older },
        { start: new Date(endMs - 3600_000).toISOString(), mean: newest },
      ],
    }),
  };
  return fetchPressure3hDelta(hass, 'sensor.p', cal);
}

function ctxOf(input, display) {
  return {
    config: { sensors: SENSORS, forecast: {} },
    hass: { states: statesOf(input), config: {} },
    language: 'en',
    calendar: cal,
    str: (k) => (typeof en[k] === 'string' ? en[k] : ''),
    units: en.units,
    cardinalDirections: en.cardinalDirections,
    readings: readingsOf(input),
    displayUnits: INPUTS[display].units,
    values: {},
    entityLink: (_eid, content) => content,
    zeroDegreeLink: (_eid, content) => content,
  };
}

function host(tpl) {
  const div = document.createElement('div');
  render(html`${tpl}`, div);
  return div;
}
const text = (tpl) => host(tpl).textContent.replace(/\s+/g, ' ').trim();
const title = (tpl) => host(tpl).querySelector('span[title]').getAttribute('title');

function expectWithin(got, want, tolerance) {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tolerance);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearDedupeCaches();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('entry: every unit set gives the same canonical values', () => {
  it.each(SETS)('%s: live readings', (set) => {
    const readings = readingsOf(set);
    for (const [key, want] of Object.entries(CANONICAL.live)) {
      expectWithin(readings[key].canonical, want, TOLERANCE[key]);
    }
    expect(readings.displayUnits).toEqual(INPUTS[set].units);
  });

  it.each(SETS)('%s: past day from statistics', (set) => {
    const entry = pastEntry(set);
    for (const [key, want] of Object.entries(CANONICAL.past)) {
      expectWithin(entry[key], want, TOLERANCE[key]);
    }
  });

  it.each(SETS)('%s: forecast day from the weather entity', async (set) => {
    const entry = await forecastEntry(set);
    for (const [key, want] of Object.entries(CANONICAL.forecast)) {
      expectWithin(entry[key], want, TOLERANCE[key]);
    }
  });

  it.each(SETS)('%s: 3-hour pressure change', async (set) => {
    expectWithin(await pressureDelta(set), CANONICAL.pressureDelta, 0.001);
  });
});

describe('inside: classifications do not depend on the unit set', () => {
  it.each(SETS)('%s: condition, pressure trend, dew-point band', async (set) => {
    const readings = readingsOf(set);
    expect(pastEntry(set).condition).toBe('pouring');
    expect(getPressureTrend(await pressureDelta(set))).toBe('falling');
    expect(getDewPointComfort(readings.dew_point.canonical, readings.temperature.canonical)).toBe('tau');
  });
});

describe('exit: the texts depend on the display units only', () => {
  it.each(PAIRS)('%s input shown in %s units: live rows and tooltips', async (input, display) => {
    const ctx = ctxOf(input, display);
    const want = EXPECTED[display];
    for (const key of ['temperature', 'dew_point', 'pressure', 'wind_speed', 'gust_speed']) {
      expect(shownText(shownValue(ctx, key))).toBe(want[key]);
    }
    expect(title(climateRowPressure(ctx, true, await pressureDelta(input)))).toBe(want.pressureTooltip);
    expect(title(climateRowDewPoint(ctx, true, false, undefined))).toBe(want.dewTooltip);
  });

  it.each(PAIRS)('%s input shown in %s units: wind row and chart series', async (input, display) => {
    const ctx = ctxOf(input, display);
    const want = EXPECTED[display];
    const entries = [pastEntry(input), await forecastEntry(input)];
    expect(text(renderForecastWind(ctx, [entries[1]], 1))).toBe(want.windRow);
    const data = toDisplayData({
      tempHigh: entries.map((e) => e.temperature),
      tempLow: entries.map((e) => e.templow),
      tempLowAvailable: true,
      precip: entries.map((e) => e.precipitation),
      dateTime: entries.map((e) => e.datetime),
    }, INPUTS[display].units, true);
    expect(data.tempHigh).toEqual(want.tempHigh);
    expect(data.tempLow).toEqual(want.tempLow);
    data.precip.forEach((v, i) => expect(v).toBeCloseTo(want.precip[i], 3));
  });
});
