// @vitest-environment jsdom
// Unit coverage for the entity-delta gate in `set hass` (ADR-0017).
//
// HA replaces the hass object 2–5×/second on ANY entity change in the
// instance. The gate skips all three set-hass phases when none of the
// entities this card watches (configured sensors + weather_entity +
// sun.sun) changed — detected by state-object reference equality, which
// is exact because HA state objects are immutable.
//
// Companion behaviour under test:
//   - `weather` keeps its object identity across full passes whose
//     synthesized values are equal (a fresh object per pass would
//     trigger updateChart's full uPlot redraw per pass).
//   - The snapshot invalidates on setConfig and data-source teardown so
//     the gate can never skip a needed source rebuild.
//   - The cumulative-precip buffer only persists to localStorage when
//     its content actually changed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/main.js';

const baseStates = () => ({
  'sensor.t': { state: '15.0', attributes: { unit_of_measurement: '°C' } },
  'sun.sun': { state: 'above_horizon', attributes: {} },
});

const makeHass = (states) => ({
  states,
  config: { latitude: 46.9, longitude: 7.4 },
  language: 'en',
});

// show_station/show_forecast off keeps the test free of data-source
// network mocks — the gate logic itself is source-agnostic and the
// wantMeasured/wantForecast guard is asserted via the teardown test.
function makeCard(configOverrides = {}) {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_station: false,
    show_forecast: false,
    sensors: { temperature: 'sensor.t' },
    ...configOverrides,
  });
  return card;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('set hass — entity-delta fast path', () => {
  it('skips all three phases when no watched entity changed', () => {
    const card = makeCard();
    const states = baseStates();
    card.hass = makeHass(states);
    expect(card._watchedStatesSnapshot).not.toBeNull();

    const extractSpy = vi.spyOn(card, '_extractSensorReadings');
    const classifySpy = vi.spyOn(card, '_classifyLiveCondition');
    const syncSpy = vi.spyOn(card, '_syncDataSources');

    // Fresh hass object, fresh states bag — but every WATCHED entity
    // keeps its state-object reference. Only an unrelated entity moved.
    card.hass = makeHass({
      ...states,
      'light.kitchen': { state: 'on', attributes: {} },
    });

    expect(extractSpy).not.toHaveBeenCalled();
    expect(classifySpy).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('still stores the fresh hass handle on the fast path', () => {
    const card = makeCard();
    const states = baseStates();
    card.hass = makeHass(states);
    const second = makeHass({ ...states });
    card.hass = second;
    expect(card._hass).toBe(second);
  });

  it('runs the full pass when a watched entity changed', () => {
    const card = makeCard();
    const states = baseStates();
    card.hass = makeHass(states);

    const extractSpy = vi.spyOn(card, '_extractSensorReadings');
    card.hass = makeHass({
      ...states,
      'sensor.t': { state: '16.0', attributes: { unit_of_measurement: '°C' } },
    });

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(card.temperature).toBe('16.0');
  });

  it('runs the full pass when sun.sun changed', () => {
    const card = makeCard();
    const states = baseStates();
    card.hass = makeHass(states);

    const extractSpy = vi.spyOn(card, '_extractSensorReadings');
    card.hass = makeHass({
      ...states,
      'sun.sun': { state: 'below_horizon', attributes: {} },
    });
    expect(extractSpy).toHaveBeenCalledTimes(1);
  });

  it('setConfig invalidates the snapshot so the next tick re-runs fully', () => {
    const card = makeCard();
    const states = baseStates();
    card.hass = makeHass(states);
    expect(card._watchedStatesSnapshot).not.toBeNull();

    card.setConfig({ show_station: false, show_forecast: false, sensors: { temperature: 'sensor.t' } });
    expect(card._watchedStatesSnapshot).toBeNull();

    const extractSpy = vi.spyOn(card, '_extractSensorReadings');
    card.hass = makeHass({ ...states });
    expect(extractSpy).toHaveBeenCalledTimes(1);
  });

  it('data-source teardown invalidates the snapshot (re-entry safety)', () => {
    const card = makeCard();
    card.hass = makeHass(baseStates());
    expect(card._watchedStatesSnapshot).not.toBeNull();

    card._teardownStation();
    expect(card._watchedStatesSnapshot).toBeNull();

    card.hass = makeHass(baseStates());
    expect(card._watchedStatesSnapshot).not.toBeNull();
    card._teardownForecast();
    expect(card._watchedStatesSnapshot).toBeNull();
  });
});

describe('weather synthesis — stable object identity', () => {
  it('keeps the previous weather object when readings are value-equal', () => {
    const card = makeCard();
    const states = baseStates();
    card.hass = makeHass(states);
    const firstWeather = card.weather;
    expect(firstWeather).toBeTruthy();

    // Replace the temperature state with a CLONE — new reference, same
    // values. The full pass runs, but the synthesized stand-in must
    // keep its identity so `changedProperties.has('weather')` stays
    // quiet and updateChart is not triggered.
    card.hass = makeHass({
      ...states,
      'sensor.t': { state: '15.0', attributes: { unit_of_measurement: '°C' } },
    });
    expect(card.weather).toBe(firstWeather);
  });

  it('produces a new weather object when a reading changed', () => {
    const card = makeCard();
    const states = baseStates();
    card.hass = makeHass(states);
    const firstWeather = card.weather;

    card.hass = makeHass({
      ...states,
      'sensor.t': { state: '17.5', attributes: { unit_of_measurement: '°C' } },
    });
    expect(card.weather).not.toBe(firstWeather);
    expect(card.weather.attributes.temperature).toBe('17.5');
  });
});

describe('cumulative precip buffer — persist only on change', () => {
  // Sample timestamps must be fresh relative to Date.now() — the
  // recompute path prunes anything older than DEFAULT_MAX_AGE_MS
  // (15 min), and a pruned-away sample would itself dirty the buffer.
  const t0 = new Date(Date.now() - 60_000).toISOString();
  const t1 = new Date(Date.now() - 30_000).toISOString();
  const precipStates = (overrides = {}) => ({
    'sensor.t': { state: '15.0', attributes: { unit_of_measurement: '°C' } },
    'sensor.rain_total_a': {
      state: '5.2',
      attributes: { unit_of_measurement: 'mm' },
      last_updated: t0,
    },
    'sun.sun': { state: 'above_horizon', attributes: {} },
    ...overrides,
  });

  function makePrecipCard() {
    return makeCard({
      sensors: { temperature: 'sensor.t', precipitation: 'sensor.rain_total_a' },
    });
  }

  it('writes localStorage for a new sample, skips it for a duplicate', () => {
    const card = makePrecipCard();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const states = precipStates();
    card.hass = makeHass(states);
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    // Full pass forced by a temperature change; the precip state object
    // is UNCHANGED → appendSample dedupes (same t+v) → no new write.
    setItemSpy.mockClear();
    card.hass = makeHass({
      ...states,
      'sensor.t': { state: '15.1', attributes: { unit_of_measurement: '°C' } },
    });
    expect(setItemSpy).not.toHaveBeenCalled();

    // A genuinely new sample (new value + timestamp) persists again.
    card.hass = makeHass({
      ...states,
      'sensor.rain_total_a': {
        state: '5.4',
        attributes: { unit_of_measurement: 'mm' },
        last_updated: t1,
      },
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });
});
