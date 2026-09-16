// @vitest-environment jsdom
// Readings that fall back to the weather entity carry the entity's
// units, not the station defaults (discussion #253). A PirateWeather
// entity in mph with no station wind sensor used to render 13 mph as
// "13 m/s", and the inflated value tripped the windy classification.

import { describe, it, expect } from 'vitest';
import '../src/main.js';

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
    expect(card._sourceWindUnit).toBe('mph');
    expect(card.unitSpeed).toBe('mph');
    expect(card._sourcePressureUnit).toBe('inHg');
    expect(card._sourceTempUnit).toBe('°F');
    expect(card.windSpeed).toBe('13.16');
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
    expect(card._sourceWindUnit).toBe('km/h');
    expect(parseFloat(card.windSpeed)).toBeCloseTo(13.16 * 1.60934, 2);
    expect(card.wind_gust_speed).toBe('30');
  });

  it('rescales entity dew point into the station temperature unit', () => {
    const card = makeCard({ temperature: 'sensor.t' });
    card.hass = makeHass({
      'weather.pirateweather': pirateWeather,
      'sensor.t': { state: '21', attributes: { unit_of_measurement: '°C' } },
    });
    expect(card._sourceTempUnit).toBe('°C');
    expect(parseFloat(card.dew_point)).toBeCloseTo(10, 5);
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
