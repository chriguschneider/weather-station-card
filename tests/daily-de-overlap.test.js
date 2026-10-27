// @vitest-environment jsdom
// #355: daily forecast entries sit at the card's midnight, like the
// station's daily entries. The forecast's own today shares the
// station's last datetime and must survive the de-overlap — that is
// the doubled-today column of combination mode.

import { describe, it, expect } from 'vitest';
import '../src/main.js';

function makeCard(type) {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    sensors: { temperature: 'sensor.t' },
    weather_entity: 'weather.home',
    show_station: true,
    show_forecast: true,
    days: 2,
    forecast_days: 2,
    forecast: { type },
  });
  card._syncCalendar('Europe/Zurich');
  return card;
}

const entry = (d, temperature) => ({ datetime: d.toISOString(), temperature, condition: 'sunny' });

describe('daily de-overlap', () => {
  it('keeps the forecast today next to the station today', () => {
    const card = makeCard('daily');
    const cal = card.calendar;
    const today = cal.startOfDay(Date.now());
    card._stationData = [entry(cal.addDays(today, -1), 10), entry(today, 11)];
    card._forecastData = [entry(today, 20), entry(cal.addDays(today, 1), 21)];
    card._refreshForecastsUnsafe();
    expect(card.forecasts.map((e) => e.temperature)).toEqual([10, 11, 20, 21]);
  });

  it('still drops an hourly forecast hour the station already covers', () => {
    const card = makeCard('hourly');
    const cal = card.calendar;
    const hour = cal.startOfHour(Date.now());
    const next = new Date(hour.getTime() + 3600_000);
    card._stationData = [entry(hour, 11)];
    card._forecastData = [entry(hour, 20), entry(next, 21)];
    card._refreshForecastsUnsafe();
    expect(card.forecasts.map((e) => e.temperature)).toEqual([11, 21]);
  });
});
