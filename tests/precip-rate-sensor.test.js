// @vitest-environment jsdom
// Dedicated live rate sensor — `sensors.precipitation_rate` (#253).
//
// Stations that expose rate and daily total as separate entities
// (ESPHome rain gauges, Ecowitt, WeatherFlow) wire both slots: the
// counter keeps feeding the chart bars, the rate feeds the live cell
// and the condition classifier. What matters here:
//
//   - the measured rate wins over the cumulative reconstruction, and
//     shuts that machinery down (buffer + 30-s tick) so it cannot
//     overwrite the measured value;
//   - display-unit conversion still applies (in/h -> mm, units.*);
//   - the classifier finally SEES a rate next to a cumulative counter,
//     which alone can never classify rain;
//   - an unavailable rate sensor degrades to the counter rather than
//     blanking the cell.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '../src/main.js';

const makeHass = (states) => ({
  states,
  config: { latitude: 46.9, longitude: 7.4 },
  language: 'en',
});

// Fresh relative to Date.now() — the derivation prunes samples older
// than 15 min, and a pruned sample would itself dirty the buffer.
const recent = () => new Date(Date.now() - 60_000).toISOString();

const states = (overrides = {}) => ({
  'sensor.t': { state: '15.0', attributes: { unit_of_measurement: '°C' } },
  'sensor.rain_total': {
    state: '5.2',
    attributes: { unit_of_measurement: 'mm' },
    last_updated: recent(),
  },
  'sensor.rain_rate': { state: '3.4', attributes: { unit_of_measurement: 'mm/h' } },
  'sun.sun': { state: 'above_horizon', attributes: {} },
  ...overrides,
});

function makeCard(configOverrides = {}) {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_station: false,
    show_forecast: false,
    show_precipitation: true,
    sensors: {
      temperature: 'sensor.t',
      precipitation: 'sensor.rain_total',
      precipitation_rate: 'sensor.rain_rate',
    },
    ...configOverrides,
  });
  return card;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sensors.precipitation_rate — display value', () => {
  it('shows the measured rate, not the value reconstructed from the counter', () => {
    const card = makeCard();
    card.hass = makeHass(states());
    expect(card.precipitation).toBe('3.4');
    expect(card.precipitation_unit).toBe('mm/h');
  });

  it('labels a bare-mm rate sensor as a rate anyway (slot contract)', () => {
    const card = makeCard();
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: '1.7', attributes: { unit_of_measurement: 'mm' } },
    }));
    expect(card.precipitation).toBe('1.7');
    expect(card.precipitation_unit).toBe('mm/h');
  });

  it('converts an in/h sensor into the configured display unit', () => {
    const card = makeCard({ units: { precipitation: 'mm' } });
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: '0.10', attributes: { unit_of_measurement: 'in/h' } },
    }));
    // 0.10 in/h -> 2.54 mm/h
    expect(card.precipitation).toBe('2.5');
    expect(card.precipitation_unit).toBe('mm/h');
  });

  it('defaults the display unit to an inch station own base with no counter', () => {
    const card = makeCard({
      sensors: {
        temperature: 'sensor.t',
        precipitation_rate: 'sensor.rain_rate',
      },
    });
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: '0.25', attributes: { unit_of_measurement: 'in/h' } },
    }));
    expect(card.precipitation).toBe('0.25');
    expect(card.precipitation_unit).toBe('in/h');
  });
});

describe('live precipitation rate on the units model (#478)', () => {
  const counterOnly = (extra = {}) => makeCard({
    sensors: { temperature: 'sensor.t', precipitation: 'sensor.rain_total' },
    ...extra,
  });

  // Earlier tests leave a stored buffer for the same counter entity.
  beforeEach(() => localStorage.clear());

  it('converts a rate sensor in mm/d', () => {
    const card = makeCard();
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: '24', attributes: { unit_of_measurement: 'mm/d' } },
    }));
    expect(card.precipitation).toBe('1.0');
    expect(card.precipitation_unit).toBe('mm/h');
    expect(card._precipRateMmH).toBe(1);
    expect(card._isRainingNow()).toBe(true);
  });

  it('shows a rate sensor with an unknown unit as it is, without a rate', () => {
    const card = makeCard();
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: '3', attributes: { unit_of_measurement: 'foo' } },
    }));
    expect(card.precipitation).toBe('3');
    expect(card.precipitation_unit).toBe('foo');
    expect(card._precipRateMmH).toBeNull();
    expect(card._isRainingNow()).toBe(false);
  });

  it('converts a rate unit in the precipitation slot', () => {
    const card = counterOnly({ units: { precipitation: 'mm' } });
    card.hass = makeHass(states({
      'sensor.rain_total': { state: '0.1', attributes: { unit_of_measurement: 'in/h' } },
    }));
    expect(card.precipitation).toBe('2.5');
    expect(card.precipitation_unit).toBe('mm/h');
    expect(card._precipRate.bufferEntity).toBeUndefined();
  });

  it('runs no buffer for a counter with a unit that is no depth', () => {
    const card = counterOnly();
    card.hass = makeHass(states({
      'sensor.rain_total': { state: '40', attributes: { unit_of_measurement: '%' }, last_updated: recent() },
    }));
    expect(card._precipRate.bufferEntity).toBeUndefined();
    expect(card.precipitation).toBe('40');
    expect(card.precipitation_unit).toBe('%');
    expect(card._isRainingNow()).toBe(false);
  });

  it('derives the rate of a counter without a unit in the assumed unit', () => {
    const card = counterOnly();
    card.hass = makeHass(states({
      'sensor.rain_total': { state: '5.2', attributes: {}, last_updated: recent() },
    }));
    expect(card._precipRate.bufferEntity).toBe('sensor.rain_total');
    // One fresh sample gives the rate floor, 0.1 per hour.
    expect(card.precipitation).toBe('0.1');
    expect(card.precipitation_unit).toBe('mm/h');
    expect(card._precipRateMmH).toBeCloseTo(0.1, 9);
  });

  it('converts the rate of an inch counter into the display unit', () => {
    const card = counterOnly({ units: { precipitation: 'mm' } });
    card.hass = makeHass(states({
      'sensor.rain_total': { state: '0.2', attributes: { unit_of_measurement: 'in' }, last_updated: recent() },
    }));
    // The floor of one fresh sample is 0.1 in/h, shown as 2.54 mm/h.
    expect(card.precipitation).toBe('2.5');
    expect(card.precipitation_unit).toBe('mm/h');
    expect(card._precipRateMmH).toBeCloseTo(2.54, 9);
    expect(card.applyDerivedRate(0.1)).toBe(false);
    expect(card.applyDerivedRate(0.2)).toBe(true);
    expect(card.precipitation).toBe('5.1');
  });

  it('shows nothing derived for a counter whose unit cannot convert', () => {
    const card = counterOnly();
    card.hass = makeHass(states());
    card._readings.precipitation.unit = 'foo';
    expect(card.applyDerivedRate(1)).toBe(false);
  });

  it('keeps the raw reading and no rate while the row is hidden', () => {
    const card = makeCard({ show_precipitation: false });
    card.hass = makeHass(states());
    expect(card.precipitation).toBe('5.2');
    expect(card.precipitation_unit).toBe('mm');
    expect(card._precipRateMmH).toBeNull();
  });
});

describe('sensors.precipitation_rate — derivation shutdown', () => {
  it('never persists a sample buffer while the rate sensor drives the cell', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const card = makeCard();
    card.hass = makeHass(states());
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(card._precipRate.timer).toBeNull();
    expect(card._precipRate.buffer).toEqual([]);
  });

  it('stops an already-armed derivation tick when the rate sensor appears', () => {
    // Counter only: the derivation arms its 30-s wall-clock tick.
    const card = makeCard({
      sensors: { temperature: 'sensor.t', precipitation: 'sensor.rain_total' },
    });
    card.hass = makeHass(states());
    expect(card._precipRate.timer).not.toBeNull();

    // User adds the rate sensor in the editor — setConfig, then a pass.
    card.setConfig({
      show_station: false,
      show_forecast: false,
      show_precipitation: true,
      sensors: {
        temperature: 'sensor.t',
        precipitation: 'sensor.rain_total',
        precipitation_rate: 'sensor.rain_rate',
      },
    });
    card.hass = makeHass(states());

    // The tick is released, so it can no longer overwrite the measured
    // value from the now-orphaned buffer.
    expect(card._precipRate.timer).toBeNull();
    expect(card._precipRate.bufferEntity).toBeUndefined();
    expect(card.precipitation).toBe('3.4');
  });

  it('falls back to the counter derivation when the rate sensor is unavailable', () => {
    const card = makeCard();
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: 'unavailable', attributes: {} },
    }));
    // Derivation took over — buffer identity proves which path ran.
    expect(card._precipRate.bufferEntity).toBe('sensor.rain_total');
    expect(card.precipitation_unit).toBe('mm/h');
  });
});

describe('sensors.precipitation_rate — live classifier', () => {
  // A cumulative counter alone yields precipRateNow: null, so rain can
  // never win the classifier's precipitation rule. The rate sensor is
  // what makes the live condition react to actual rainfall.
  const heavyRain = (rate) => states({
    'sensor.rain_rate': { state: rate, attributes: { unit_of_measurement: 'mm/h' } },
  });

  it('classifies pouring from the rate sensor next to a cumulative counter', () => {
    const card = makeCard();
    card.hass = makeHass(heavyRain('12.0'));
    expect(['rainy', 'pouring']).toContain(card.weather.state);
  });

  it('leaves the condition dry with a counter and no rate sensor', () => {
    const card = makeCard({
      sensors: { temperature: 'sensor.t', precipitation: 'sensor.rain_total' },
    });
    card.hass = makeHass(heavyRain('12.0'));
    expect(['rainy', 'pouring']).not.toContain(card.weather.state);
  });

  it('reads a rate sensor without a unit in the assumed precipitation unit', () => {
    const card = makeCard();
    const hass = makeHass(states({
      'sensor.rain_rate': { state: '12.0', attributes: {} },
    }));
    card.hass = hass;
    expect(card._resolveLiveClassifierInputs(hass).precipRateMmH).toBe(12);
    expect(['rainy', 'pouring']).toContain(card.weather.state);
  });

  it('takes the assumed precipitation unit from the unit system', () => {
    const card = makeCard();
    const hass = {
      ...makeHass(states({ 'sensor.rain_rate': { state: '0.5', attributes: {} } })),
    };
    hass.config.unit_system = { accumulated_precipitation: 'in' };
    card.hass = hass;
    expect(card._resolveLiveClassifierInputs(hass).precipRateMmH).toBeCloseTo(12.7, 5);
  });

  it('normalises an in/h rate before comparing against mm thresholds', () => {
    const card = makeCard();
    // 0.5 in/h = 12.7 mm/h — pouring. Read as a bare 0.5 it would be dry.
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: '0.5', attributes: { unit_of_measurement: 'in/h' } },
    }));
    expect(['rainy', 'pouring']).toContain(card.weather.state);
  });
});

describe('getStubConfig auto-detection', () => {
  const Card = customElements.get('weather-station-card');

  // Pirateweather-style naming: a `*_precipitation_rate` entity used to
  // land in the counter slot, where a rate draws garbage chart bars.
  it('routes a *_precipitation_rate entity to the rate slot, not the counter', () => {
    const ids = ['sensor.home_precipitation_rate', 'sensor.home_temperature'];
    const hass = {
      states: {
        'sensor.home_precipitation_rate': {
          state: '0.0',
          attributes: { device_class: 'precipitation_intensity', unit_of_measurement: 'mm/h' },
        },
        'sensor.home_temperature': {
          state: '15.0',
          attributes: { device_class: 'temperature', unit_of_measurement: '°C' },
        },
      },
    };
    const stub = Card.getStubConfig(hass, [], ids);
    expect(stub.sensors.precipitation_rate).toBe('sensor.home_precipitation_rate');
    expect(stub.sensors.precipitation).toBe('');
  });

  it('keeps a daily counter in the counter slot and pairs it with a rain_rate', () => {
    const ids = ['sensor.ws_precipitation_today', 'sensor.ws_rain_rate'];
    const stub = Card.getStubConfig({ states: {} }, [], ids);
    expect(stub.sensors.precipitation).toBe('sensor.ws_precipitation_today');
    expect(stub.sensors.precipitation_rate).toBe('sensor.ws_rain_rate');
  });
});

// ADR-0017: the entity-delta gate skips all three set-hass phases when
// no WATCHED entity changed. The watched set is derived from
// Object.values(config.sensors), so the new slot is covered by
// construction — this pins that, because a hardcoded list would leave
// the live cell frozen at its first value.
describe('sensors.precipitation_rate — entity-delta gate', () => {
  it('is a watched entity, so a rate change re-runs the pass', () => {
    const card = makeCard();
    card.hass = makeHass(states());
    expect(card._watchedEntityIds()).toContain('sensor.rain_rate');

    card.hass = makeHass(states({
      'sensor.rain_rate': { state: '9.9', attributes: { unit_of_measurement: 'mm/h' } },
    }));
    expect(card.precipitation).toBe('9.9');
  });
});
