// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import '../src/main.js';

function makeCard(items) {
  const card = document.createElement('weather-station-card');
  card.setConfig({});
  card.weather = { attributes: { wind_speed_unit: 'km/h' } };
  card.unitSpeed = 'km/h';
  card.forecasts = items;
  return card;
}
const speeds = (card) => {
  const host = document.createElement('div');
  render(card.renderWind({ config: card.config, forecastItems: 10 }), host);
  return [...host.querySelectorAll('.wind-speed')];
};

describe('wind row width', () => {
  it('gives every speed the width of the longest one', () => {
    const cells = speeds(makeCard([8, 9, 10, 29].map((wind_speed, i) => ({ datetime: `2026-10-0${i + 1}T12:00:00Z`, wind_speed, wind_speed_unit: 'km/h' }))));
    expect(cells).toHaveLength(4);
    cells.forEach((c) => expect(c.style.minWidth).toBe('2ch'));
  });

  it('ignores cells without a speed', () => {
    const cells = speeds(makeCard([{ datetime: '2026-10-01T12:00:00Z', wind_bearing: 90 }, { datetime: '2026-10-02T12:00:00Z', wind_speed: 7, wind_speed_unit: 'km/h' }]));
    expect(cells).toHaveLength(1);
    expect(cells[0].style.minWidth).toBe('1ch');
  });

  it('renders without any speed', () => {
    expect(speeds(makeCard([{ datetime: '2026-10-01T12:00:00Z', wind_bearing: 90 }]))).toHaveLength(0);
  });
});
