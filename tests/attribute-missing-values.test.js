// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import '../src/main.js';
import { climateRowDewPoint, climateRowPressure, displayPressure } from '../src/live-panel/climate-rows.js';
import { displayWindSpeed, windRowGust, windRowSpeed } from '../src/live-panel/wind-rows.js';

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
      const ctx = makeCard()._liveCtx();
      const out = climateRowPressure(ctx, true, displayPressure(ctx, raw), null);
      expect(out).toBeNull();
    });
  }

  it('renders a numeric pressure', () => {
    const ctx = makeCard()._liveCtx();
    const out = climateRowPressure(ctx, true, displayPressure(ctx, '1013.4'), null);
    expect(text(out)).toContain('1013');
    expect(text(out)).not.toContain('NaN');
  });
});

describe('wind rows with missing values (#438)', () => {
  const windCtx = (unit = 'm/s') => {
    const card = makeCard();
    card.weather = { attributes: { wind_speed_unit: 'm/s' } };
    card.unitSpeed = unit;
    return card._liveCtx();
  };
  for (const raw of [undefined, null, '', 'unavailable']) {
    for (const unit of ['m/s', 'km/h', 'Bft']) {
      it(`hides speed and gust for ${String(raw)} in ${unit}`, () => {
        const ctx = windCtx(unit);
        expect(windRowSpeed(ctx, true, displayWindSpeed(ctx, raw))).toBeNull();
        expect(windRowGust(ctx, true, raw)).toBeNull();
      });
    }
  }

  it('renders numeric speed and gust', () => {
    const ctx = windCtx('km/h');
    const speed = text(windRowSpeed(ctx, true, displayWindSpeed(ctx, '10')));
    const gust = text(windRowGust(ctx, true, '5'));
    expect(speed).toContain('36');
    expect(gust).toContain('18');
    expect(speed + gust).not.toContain('NaN');
  });

  it('hides a non-numeric pressure string', () => {
    expect(displayPressure(makeCard()._liveCtx(), 'unavailable')).toBeUndefined();
  });
});

describe('dew point and humidity rows with missing values', () => {
  for (const raw of [undefined, null, 'unavailable']) {
    it(`hides both for ${String(raw)}`, () => {
      expect(climateRowDewPoint(makeCard()._liveCtx(), true, raw, true, raw)).toBeNull();
    });
  }
});
