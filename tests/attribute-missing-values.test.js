// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import '../src/main.js';

function makeCard() {
  const card = document.createElement('weather-station-card');
  card.setConfig({});
  card.weather = { attributes: { pressure_unit: 'hPa', temperature_unit: '°C' } };
  card.unitPressure = 'hPa';
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
      const card = makeCard();
      const out = card._climateRow_pressure(true, card._convertDisplayPressure(raw), null);
      expect(out).toBeNull();
    });
  }

  it('renders a numeric pressure', () => {
    const card = makeCard();
    const out = card._climateRow_pressure(true, card._convertDisplayPressure('1013.4'), null);
    expect(text(out)).toContain('1013');
    expect(text(out)).not.toContain('NaN');
  });
});

describe('dew point and humidity rows with missing values', () => {
  for (const raw of [undefined, null, 'unavailable']) {
    it(`hides both for ${String(raw)}`, () => {
      const card = makeCard();
      expect(card._climateRow_dewpoint(true, raw, true, raw)).toBeNull();
    });
  }
});
