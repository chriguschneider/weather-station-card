// @vitest-environment jsdom
// #355: daily forecast entries sit at the card's midnight, like the
// station's daily entries. The forecast's own today shares the
// station's last datetime and must survive the de-overlap — that is
// the doubled-today column of combination mode.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  card._sources.syncCalendar('Europe/Zurich');
  return card;
}

const entry = (d, temperature) => ({ datetime: d.toISOString(), temperature, condition: 'sunny' });

describe('daily de-overlap', () => {
  // The hourly view keeps whole days only, so the fixture must not depend
  // on the wall clock: near midnight the next hour is a lone-hour day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T11:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the forecast today next to the station today', () => {
    const card = makeCard('daily');
    const cal = card.calendar;
    const today = cal.startOfDay(Date.now());
    card._sources.stationData = [entry(cal.addDays(today, -1), 10), entry(today, 11)];
    card._sources.forecastData = [entry(today, 20), entry(cal.addDays(today, 1), 21)];
    card._refreshForecastsUnsafe();
    expect(card.forecasts.map((e) => e.temperature)).toEqual([10, 11, 20, 21]);
  });

  it('still drops an hourly forecast hour the station already covers', () => {
    const card = makeCard('hourly');
    const cal = card.calendar;
    const hour = cal.startOfHour(Date.now());
    const next = new Date(hour.getTime() + 3600_000);
    card._sources.stationData = [entry(hour, 11)];
    card._sources.forecastData = [entry(hour, 20), entry(next, 21)];
    card._refreshForecastsUnsafe();
    expect(card.forecasts.map((e) => e.temperature)).toEqual([11, 21]);
  });

  it('keeps whole days only: station hour plus the next day at 23:30 Zurich', () => {
    vi.setSystemTime(new Date('2026-11-16T22:30:00Z'));
    const card = makeCard('hourly');
    const cal = card.calendar;
    const hour = cal.startOfHour(Date.now());
    card._sources.stationData = [entry(hour, 11)];
    card._sources.forecastData = Array.from({ length: 31 }, (_, i) =>
      entry(new Date(hour.getTime() + i * 3600_000), 20 + i),
    );
    card._refreshForecastsUnsafe();
    expect(card.forecasts).toHaveLength(25);
  });
});
