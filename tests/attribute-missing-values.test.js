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

describe('wind rows with missing values (#438)', () => {
  const windCard = (unit = 'm/s') => {
    const card = makeCard();
    card.weather = { attributes: { wind_speed_unit: 'm/s' } };
    card.unitSpeed = unit;
    return card;
  };
  for (const raw of [undefined, null, '', 'unavailable']) {
    for (const unit of ['m/s', 'km/h', 'Bft']) {
      it(`hides speed and gust for ${String(raw)} in ${unit}`, () => {
        const card = windCard(unit);
        expect(card._windRow_speed(true, card._convertDisplayWindSpeed(raw))).toBeNull();
        expect(card._windRow_gust(true, raw)).toBeNull();
      });
    }
  }

  it('renders numeric speed and gust', () => {
    const card = windCard('km/h');
    const speed = text(card._windRow_speed(true, card._convertDisplayWindSpeed('10')));
    const gust = text(card._windRow_gust(true, '5'));
    expect(speed).toContain('36');
    expect(gust).toContain('18');
    expect(speed + gust).not.toContain('NaN');
  });

  it('hides a non-numeric pressure string', () => {
    expect(makeCard()._convertDisplayPressure('unavailable')).toBeUndefined();
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
