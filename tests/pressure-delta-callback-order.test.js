// @vitest-environment jsdom
// Regression coverage for the station-callback ordering of the 3-h
// pressure-tendency refresh.
//
// Since the v2.2.0 stale-while-revalidate hydration, the first live
// recorder result after a page load usually matches the persisted
// payload, so the identical-payload guard early-returns on the very
// first callback. `_refreshPressureDelta()` used to sit BEHIND that
// guard — the delta fetch never fired and the pressure row stuck on
// the legacy gauge icon until the next hour bucket changed the
// payload. The refresh must run on every callback, before the guard;
// its own hourly cache makes redundant invocations free.

import { describe, it, expect, vi, afterEach } from 'vitest';

// Capture the MeasuredDataSource subscribe callback so tests can fire
// station events by hand. `vi.mock` is hoisted above imports, so the
// shared holder must be hoisted too.
const captured = vi.hoisted(() => ({ cbs: [] }));

vi.mock('../src/data-source.js', async (importOriginal) => {
  const actual = await importOriginal();
  class MeasuredDataSourceStub {
    constructor(hass, config) {
      this.hass = hass;
      this.config = config;
    }
    subscribe(cb) {
      captured.cbs.push(cb);
      return () => {};
    }
    setHass(hass) {
      this.hass = hass;
    }
  }
  return { ...actual, MeasuredDataSource: MeasuredDataSourceStub };
});

import '../src/main.js';

const makeHass = (states) => ({
  states,
  config: { latitude: 46.9, longitude: 7.4 },
  language: 'en',
});

const baseStates = () => ({
  'sensor.t': { state: '15.0', attributes: { unit_of_measurement: '°C' } },
  'sensor.p': { state: '941.8', attributes: { unit_of_measurement: 'hPa' } },
  'sun.sun': { state: 'above_horizon', attributes: {} },
});

// A minimal station payload; the guard compares via forecastsEqual, so
// structural equality with fresh object identity is what matters.
const payload = () => ([
  { datetime: '2026-08-20T00:00:00.000Z', temperature: 15, templow: 9 },
  { datetime: '2026-08-21T00:00:00.000Z', temperature: 16, templow: 10 },
]);

// show_forecast off keeps ForecastDataSource out of the test; the
// MeasuredDataSource stub above captures the station callback without
// touching the network.
function makeCard() {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_forecast: false,
    sensors: { temperature: 'sensor.t', pressure: 'sensor.p' },
  });
  // The real refresh would hit the recorder; the callback-ordering
  // contract under test only needs the invocation count. Chart
  // rebuilds are equally out of scope.
  const refreshDelta = vi.spyOn(card, '_refreshPressureDelta').mockResolvedValue(undefined);
  const refreshForecasts = vi.spyOn(card, '_refreshForecasts').mockImplementation(() => {});
  card.hass = makeHass(baseStates());
  // `set hass` itself runs a first `_refreshForecasts` pass; zero both
  // counters so the assertions below count callback-driven calls only.
  refreshDelta.mockClear();
  refreshForecasts.mockClear();
  return { card, refreshDelta, refreshForecasts };
}

afterEach(() => {
  captured.cbs.length = 0;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('station callback — pressure delta refresh ordering', () => {
  it('refreshes the delta on a first callback whose payload matches the hydrated data', () => {
    const { card, refreshDelta, refreshForecasts } = makeCard();
    expect(captured.cbs).toHaveLength(1);

    // Simulate the stale-while-revalidate hydration: the persisted
    // payload is already in place when the live result arrives.
    card._stationData = payload();
    card._stationDataReady = true;

    captured.cbs[0]({ forecast: payload() });

    // The guard must still absorb the no-op render path…
    expect(refreshForecasts).not.toHaveBeenCalled();
    // …but the delta refresh must have fired regardless.
    expect(refreshDelta).toHaveBeenCalledTimes(1);
  });

  it('refreshes the delta on every callback, changed or identical', () => {
    const { card, refreshDelta, refreshForecasts } = makeCard();
    const first = payload();

    captured.cbs[0]({ forecast: first });
    expect(card._stationData).toBe(first);
    expect(refreshForecasts).toHaveBeenCalledTimes(1);
    expect(refreshDelta).toHaveBeenCalledTimes(1);

    // Identical fan-out (sibling-card resubscribe): render path skipped,
    // delta refresh still invoked — its hourly cache absorbs the cost.
    captured.cbs[0]({ forecast: payload() });
    expect(card._stationData).toBe(first);
    expect(refreshForecasts).toHaveBeenCalledTimes(1);
    expect(refreshDelta).toHaveBeenCalledTimes(2);
  });
});
