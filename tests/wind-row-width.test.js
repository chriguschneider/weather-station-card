// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import '../src/main.js';

// A station wind sensor in km/h sets the display unit unless
// `units.speed` names another one.
function makeCard(items, units = {}) {
  const card = document.createElement('weather-station-card');
  card.setConfig({ show_station: false, sensors: { wind_speed: 'sensor.wind' }, units });
  card.hass = {
    states: { 'sensor.wind': { state: '12', attributes: { unit_of_measurement: 'km/h' } } },
    config: { unit_system: {} },
    language: 'en',
  };
  card.forecasts = items;
  return card;
}
const speeds = (card) => {
  const host = document.createElement('div');
  render(card.renderWind({ config: card.config, forecastItems: 10 }), host);
  return [...host.querySelectorAll('.wind-speed')];
};

describe('wind row width', () => {
  // Entries are m/s (ADR-0035); the cells show km/h.
  it('gives every speed the width of the longest one', () => {
    const cells = speeds(makeCard([2, 2.5, 3, 8].map((wind_speed, i) => ({ datetime: `2026-10-0${i + 1}T12:00:00Z`, wind_speed }))));
    expect(cells.map((c) => c.textContent)).toEqual(['7', '9', '11', '29']);
    cells.forEach((c) => expect(c.style.minWidth).toBe('2ch'));
  });

  it('ignores cells without a speed', () => {
    const cells = speeds(makeCard([{ datetime: '2026-10-01T12:00:00Z', wind_bearing: 90 }, { datetime: '2026-10-02T12:00:00Z', wind_speed: 2 }]));
    expect(cells).toHaveLength(1);
    expect(cells[0].style.minWidth).toBe('1ch');
  });

  it('renders without any speed', () => {
    expect(speeds(makeCard([{ datetime: '2026-10-01T12:00:00Z', wind_bearing: 90 }]))).toHaveLength(0);
  });
});

describe('forecast Beaufort (#438)', () => {
  it('reads an m/s forecast entry in m/s even when the station uses km/h', () => {
    // 10 m/s = 36 km/h → Bft 5; read as km/h it would be Bft 2.
    const card = makeCard([{ datetime: '2026-10-01T12:00:00Z', wind_speed: 10 }], { speed: 'Bft' });
    expect(speeds(card).map((c) => c.textContent)).toEqual(['5']);
  });
});
