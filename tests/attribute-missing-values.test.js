// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import '../src/main.js';
import { climateRowDewPoint, climateRowPressure, pressureText } from '../src/live-panel/climate-rows.js';
import { windRowGust, windRowSpeed } from '../src/live-panel/wind-rows.js';

// A card fed through `hass` with one sensor per key; `undefined` leaves
// the entity out of the states.
function cardWith(sensors, units = {}) {
  const card = document.createElement('weather-station-card');
  const ids = Object.fromEntries(Object.keys(sensors).map((key) => [key, `sensor.${key}`]));
  card.setConfig({ show_station: false, sensors: ids, units });
  const states = {};
  for (const [key, [state, unit]] of Object.entries(sensors)) {
    if (state === undefined) continue;
    states[`sensor.${key}`] = { state, attributes: unit ? { unit_of_measurement: unit } : {} };
  }
  card.hass = { states, config: { unit_system: {} }, language: 'en' };
  return card;
}
const text = (tpl) => {
  const host = document.createElement('div');
  render(tpl, host);
  return host.textContent;
};

describe('pressure row with missing values', () => {
  for (const [label, raw] of [['missing', undefined], ['null', null], ['non-numeric string', 'unavailable']]) {
    it(`hides the row when pressure is ${label}`, () => {
      const ctx = cardWith({ pressure: [raw, 'hPa'] })._liveCtx();
      expect(climateRowPressure(ctx, true, null)).toBeNull();
      expect(pressureText(ctx)).toBe('');
    });
  }

  it('renders a numeric pressure', () => {
    const ctx = cardWith({ pressure: ['1013.4', 'hPa'] })._liveCtx();
    const out = climateRowPressure(ctx, true, null);
    expect(text(out)).toContain('1013');
    expect(text(out)).not.toContain('NaN');
  });
});

describe('wind rows with missing values (#438)', () => {
  for (const raw of [undefined, '', 'unavailable']) {
    for (const unit of ['m/s', 'km/h', 'Bft']) {
      it(`hides speed and gust for ${String(raw)} in ${unit}`, () => {
        const ctx = cardWith({ wind_speed: [raw, 'm/s'], gust_speed: [raw, 'm/s'] }, { speed: unit })._liveCtx();
        expect(windRowSpeed(ctx, true)).toBeNull();
        expect(windRowGust(ctx, true)).toBeNull();
      });
    }
  }

  it('renders numeric speed and gust', () => {
    const ctx = cardWith({ wind_speed: ['10', 'm/s'], gust_speed: ['5', 'm/s'] }, { speed: 'km/h' })._liveCtx();
    const speed = text(windRowSpeed(ctx, true));
    const gust = text(windRowGust(ctx, true));
    expect(speed).toContain('36');
    expect(gust).toContain('18');
    expect(speed + gust).not.toContain('NaN');
  });
});

describe('dew point and humidity rows with missing values', () => {
  for (const raw of [undefined, 'unavailable']) {
    it(`hides both for ${String(raw)}`, () => {
      const card = cardWith({ dew_point: [raw, '°C'], humidity: [raw, '%'] });
      expect(climateRowDewPoint(card._liveCtx(), true, true, card.humidity)).toBeNull();
    });
  }
});
