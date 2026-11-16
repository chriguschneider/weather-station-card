// @vitest-environment jsdom
// Readings that fall back to the weather entity carry the entity's
// units, not the station defaults (discussion #253). A PirateWeather
// entity in mph with no station wind sensor used to render 13 mph as
// "13 m/s", and the inflated value tripped the windy classification.

import { describe, it, expect } from 'vitest';
import '../src/main.js';
import { shownText, shownValue } from '../src/live-panel/context.js';

// The text a live row shows for `key`.
const shown = (card, key) => shownText(shownValue(card._liveCtx(), key));

const makeHass = (states) => ({
  states,
  config: { latitude: 51.5, longitude: -0.1 },
  language: 'en',
});

const pirateWeather = {
  state: 'partlycloudy',
  attributes: {
    temperature: 70,
    temperature_unit: '°F',
    dew_point: 50,
    wind_speed: 13.16,
    wind_gust_speed: 23,
    wind_speed_unit: 'mph',
    pressure: 30.07,
    pressure_unit: 'inHg',
  },
};

function makeCard(sensors) {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_station: false,
    show_forecast: false,
    weather_entity: 'weather.pirateweather',
    sensors,
  });
  return card;
}

describe('weather-entity fallback units', () => {
  it('takes wind, pressure and temperature units from the entity when no sensor is wired', () => {
    const card = makeCard({});
    card.hass = makeHass({ 'weather.pirateweather': pirateWeather });
    expect(card.unitSpeed).toBe('mph');
    // The card's default `units.pressure: hPa` wins over the entity's unit.
    expect(card.unitPressure).toBe('hPa');
    expect(card.unitTemperature).toBe('°F');
    expect(card.windSpeed).toBe('13.16');
    expect(card._readings.wind_speed.canonical).toBeCloseTo(5.883, 3);
    expect(card._readings.pressure.canonical).toBeCloseTo(1018.29, 2);
    expect(card._readings.temperature.canonical).toBeCloseTo(21.11, 2);
    expect(shown(card, 'wind_speed')).toBe('13 mph');
    expect(shown(card, 'pressure')).toBe('1018 hPa');
  });

  it('does not classify a 13 mph breeze as windy', () => {
    const card = makeCard({});
    card.hass = makeHass({ 'weather.pirateweather': pirateWeather });
    // 13.16 mph ≈ 5.9 m/s, 23 mph gust ≈ 10.3 m/s — below both thresholds.
    expect(card._liveCondition).not.toMatch(/^windy/);
  });

  it('rescales entity wind into the unit of a wired gust sensor', () => {
    const card = makeCard({ gust_speed: 'sensor.gust' });
    card.hass = makeHass({
      'weather.pirateweather': pirateWeather,
      'sensor.gust': { state: '30', attributes: { unit_of_measurement: 'km/h' } },
    });
    expect(card.unitSpeed).toBe('km/h');
    expect(card._readings.wind_speed.canonical).toBeCloseTo(5.883, 3);
    expect(shown(card, 'wind_speed')).toBe('21 km/h');
    expect(card.wind_gust_speed).toBe('30');
    expect(shown(card, 'gust_speed')).toBe('30 km/h');
  });

  it('rescales entity dew point into the station temperature unit', () => {
    const card = makeCard({ temperature: 'sensor.t' });
    card.hass = makeHass({
      'weather.pirateweather': pirateWeather,
      'sensor.t': { state: '21', attributes: { unit_of_measurement: '°C' } },
    });
    expect(card.unitTemperature).toBe('°C');
    expect(card._readings.dew_point.canonical).toBeCloseTo(10, 5);
    expect(shown(card, 'dew_point')).toBe('10 °C');
  });
});

// A wired sensor that is unavailable (no last-good value) keeps its
// unit_of_measurement, so the source unit stays the sensor's. The value
// borrowed from the entity must be converted into it (#438).
describe('unavailable sensor, entity value in a different unit', () => {
  const metricEntity = {
    state: 'sunny',
    attributes: {
      temperature: 20,
      temperature_unit: '°C',
      dew_point: 10,
      pressure: 1013.25,
      pressure_unit: 'hPa',
      wind_speed: 36,
      wind_speed_unit: 'km/h',
    },
  };
  const unavailable = (unit) => ({ state: 'unavailable', attributes: { unit_of_measurement: unit } });

  it('converts a °C entity temperature into a °F sensor unit', () => {
    const card = makeCard({ temperature: 'sensor.t' });
    card.hass = makeHass({
      'weather.pirateweather': metricEntity,
      'sensor.t': unavailable('°F'),
    });
    expect(card.unitTemperature).toBe('°F');
    expect(card._readings.temperature.canonical).toBeCloseTo(20, 5);
    expect(shown(card, 'temperature')).toBe('68 °F');
    expect(shown(card, 'dew_point')).toBe('50 °F');
  });

  it('converts a °F entity temperature into a °C sensor unit', () => {
    const card = makeCard({ temperature: 'sensor.t' });
    card.hass = makeHass({
      'weather.pirateweather': pirateWeather,
      'sensor.t': unavailable('°C'),
    });
    expect(card.unitTemperature).toBe('°C');
    expect(card._readings.temperature.canonical).toBeCloseTo(21.11, 2);
    expect(shown(card, 'temperature')).toBe('21.1 °C');
  });

  it('converts an hPa entity pressure into an inHg sensor unit', () => {
    const card = makeCard({ pressure: 'sensor.p' });
    card.hass = makeHass({
      'weather.pirateweather': metricEntity,
      'sensor.p': unavailable('inHg'),
    });
    expect(card._readings.pressure.canonical).toBeCloseTo(1013.25, 5);
    card.config.units = {};
    card.hass = makeHass({
      'weather.pirateweather': metricEntity,
      'sensor.p': unavailable('inHg'),
    });
    expect(card.unitPressure).toBe('inHg');
    expect(shown(card, 'pressure')).toBe('29.92 inHg');
  });

  it('converts an inHg entity pressure into an hPa sensor unit', () => {
    const card = makeCard({ pressure: 'sensor.p' });
    card.hass = makeHass({
      'weather.pirateweather': pirateWeather,
      'sensor.p': unavailable('hPa'),
    });
    expect(card.unitPressure).toBe('hPa');
    expect(card._readings.pressure.canonical).toBeCloseTo(1018.29, 2);
    expect(shown(card, 'pressure')).toBe('1018 hPa');
  });

  it('converts km/h entity wind into an m/s sensor unit', () => {
    const card = makeCard({ wind_speed: 'sensor.w' });
    card.hass = makeHass({
      'weather.pirateweather': metricEntity,
      'sensor.w': unavailable('m/s'),
    });
    expect(card.unitSpeed).toBe('m/s');
    expect(card._readings.wind_speed.canonical).toBeCloseTo(10, 5);
    expect(shown(card, 'wind_speed')).toBe('10 m/s');
  });

  it('classifies an entity dew point in the unit it was converted into', () => {
    // Dew sensor in °F is unavailable; the entity dew point is put into
    // the °C temperature unit, so the classifier must read it as °C.
    const card = makeCard({ temperature: 'sensor.t', dew_point: 'sensor.dew' });
    card.hass = makeHass({
      'weather.pirateweather': metricEntity,
      'sensor.t': { state: '20', attributes: { unit_of_measurement: '°C' } },
      'sensor.dew': unavailable('°F'),
    });
    expect(card._readings.dew_point.source.kind).toBe('weather');
    expect(card._resolveLiveClassifierInputs(card._hass).dewPointC).toBeCloseTo(10, 5);
  });

  it('keeps the dew sensor unit for a live dew sensor', () => {
    const card = makeCard({ temperature: 'sensor.t', dew_point: 'sensor.dew' });
    card.hass = makeHass({
      'weather.pirateweather': metricEntity,
      'sensor.t': { state: '20', attributes: { unit_of_measurement: '°C' } },
      'sensor.dew': { state: '50', attributes: { unit_of_measurement: '°F' } },
    });
    expect(card._readings.dew_point.source.kind).toBe('station');
    expect(card._resolveLiveClassifierInputs(card._hass).dewPointC).toBeCloseTo(10, 5);
  });

  it('keeps a wind sensor with an unknown unit away from the classifier', () => {
    const card = makeCard({ wind_speed: 'sensor.w' });
    card.hass = makeHass({
      'weather.pirateweather': metricEntity,
      'sensor.w': { state: '20', attributes: { unit_of_measurement: 'foo' } },
    });
    expect(card._resolveLiveClassifierInputs(card._hass).windMs).toBeNull();
  });
});

describe('canonical readings from the weather entity', () => {
  it('reads 13.16 mph as m/s', () => {
    const card = makeCard({});
    card.hass = makeHass({ 'weather.pirateweather': pirateWeather });
    expect(card._readings.wind_speed.canonical).toBeCloseTo(5.883, 3);
    expect(card._resolveLiveClassifierInputs(card._hass).windMs).toBeCloseTo(5.883, 3);
  });
});

describe('live sky state without an illuminance sensor', () => {
  const stationStates = (wxState, extra = {}) => ({
    'weather.pirateweather': { ...pirateWeather, state: wxState },
    'sensor.t': { state: '21', attributes: { unit_of_measurement: '°C' } },
    ...extra,
  });

  it('borrows the weather entity sky state instead of a permanent cloudy', () => {
    const card = makeCard({ temperature: 'sensor.t' });
    card.hass = makeHass(stationStates('partlycloudy'));
    expect(card._liveCondition).toBe('partlycloudy');
  });

  it('ignores a non-sky entity state (rain stays station-measured)', () => {
    const card = makeCard({ temperature: 'sensor.t' });
    card.hass = makeHass(stationStates('rainy'));
    expect(card._liveCondition).toBe('cloudy');
  });

  it('keeps the measured cloud cover when an illuminance sensor is wired', () => {
    const card = makeCard({ temperature: 'sensor.t', illuminance: 'sensor.lux' });
    card.hass = makeHass(stationStates('sunny', {
      'sensor.lux': { state: '0', attributes: { unit_of_measurement: 'lx' } },
    }));
    expect(card._liveCondition).not.toBe('sunny');
  });
});

describe('live lux for the classifier', () => {
  const luxNow = (attributes, state) => {
    const card = makeCard({ illuminance: 'sensor.lux' });
    card.hass = makeHass({
      'weather.pirateweather': pirateWeather,
      'sensor.lux': { state, attributes },
    });
    return card._resolveLiveClassifierInputs(card._hass).luxNow;
  };

  it('reads irradiance through the daylight efficacy', () => {
    expect(luxNow({ unit_of_measurement: 'W/m²' }, '650')).toBe(78000);
    expect(luxNow({ device_class: 'irradiance' }, '650')).toBe(78000);
  });

  it('reads lux as it is, a unitless sensor in its assumed lx', () => {
    expect(luxNow({ unit_of_measurement: 'lx' }, '32000')).toBe(32000);
    expect(luxNow({}, '500')).toBe(500);
  });

  it('gives no lux for an unknown unit or an unavailable sensor', () => {
    expect(luxNow({ unit_of_measurement: 'klx' }, '5')).toBeNull();
    expect(luxNow({ unit_of_measurement: 'lx' }, 'unavailable')).toBeNull();
  });
});
