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

import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('sensors.precipitation_rate — derivation shutdown', () => {
  it('never persists a sample buffer while the rate sensor drives the cell', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const card = makeCard();
    card.hass = makeHass(states());
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(card._precipRecomputeTimer).toBeNull();
    expect(card._precipBuffer).toEqual([]);
  });

  it('stops an already-armed derivation tick when the rate sensor appears', () => {
    // Counter only: the derivation arms its 30-s wall-clock tick.
    const card = makeCard({
      sensors: { temperature: 'sensor.t', precipitation: 'sensor.rain_total' },
    });
    card.hass = makeHass(states());
    expect(card._precipRecomputeTimer).not.toBeNull();

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
    expect(card._precipRecomputeTimer).toBeNull();
    expect(card._precipBufferEntity).toBeUndefined();
    expect(card.precipitation).toBe('3.4');
  });

  it('falls back to the counter derivation when the rate sensor is unavailable', () => {
    const card = makeCard();
    card.hass = makeHass(states({
      'sensor.rain_rate': { state: 'unavailable', attributes: {} },
    }));
    // Derivation took over — buffer identity proves which path ran.
    expect(card._precipBufferEntity).toBe('sensor.rain_total');
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
