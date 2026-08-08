// Browser-side fake-hass implementation. Loaded by the harness page
// (card.html) and exposed via window.__wsc.createMock. The Node-side
// spec layer constructs a FixtureBag, passes it via page.evaluate,
// and this module rebuilds the mock with closures that the card
// instance can interact with synchronously.
//
// Type contract is in tests-e2e/hass-mock.types.ts. Keep that file in
// sync if you change a callWS branch or service-call signature.

const DEFAULT_CONFIG = Object.freeze({
  latitude: 46.91,
  longitude: 7.42,
  language: 'en',
  unit_system: {
    temperature: '°C',
    length: 'km',
  },
});

/** Build a HassMock from a fixture bag.
 *
 *  Behaviour:
 *    - `callWS` matches on `msg.type` and returns the fixture-shaped
 *      response. Unrecognised types reject so a spec catches a typo
 *      rather than silently returning undefined.
 *    - `connection.subscribeMessage` for `weather/subscribe_forecast`
 *      invokes the callback synchronously with the matching fixture
 *      forecast, then returns a no-op unsubscribe. Specs that need to
 *      simulate a forecast push later call `__pushForecast`. */
export function createHassMock(fixture = {}) {
  const config = { ...DEFAULT_CONFIG, ...(fixture.config || {}) };
  const language = fixture.language || config.language || 'en';
  const states = { ...(fixture.states || {}) };

  const subscribers = new Map();
  const __serviceCalls = [];

  return {
    config,
    language,
    states,

    callService(domain, service, data, target) {
      __serviceCalls.push({ domain, service, data, target, at: Date.now() });
    },

    async callWS(msg) {
      if (msg.type === 'recorder/statistics_during_period') {
        const period = msg.period;
        const ids = msg.statistic_ids || [];
        const source = period === 'hour' ? fixture.recorderHourly : fixture.recorderDaily;
        const out = {};
        for (const id of ids) {
          out[id] = (source && source[id]) || [];
        }
        return out;
      }
      if (msg.type === 'history/history_during_period') {
        // Compact recorder-history shape the B2 lux-sunshine
        // derivation consumes: { [entity_id]: [{ s, lu }, …] }.
        // Like the stats branch, no time-window filtering — fixtures
        // provide exactly the window the card asks for.
        const ids = msg.entity_ids || [];
        const out = {};
        for (const id of ids) {
          out[id] = (fixture.luxHistory && fixture.luxHistory[id]) || [];
        }
        return out;
      }
      if (msg.type === 'config/auth_provider/list') {
        return [];
      }
      throw new Error(`hass-mock: unhandled callWS type "${msg.type}"`);
    },

    connection: {
      async subscribeMessage(cb, msg) {
        if (msg.type === 'weather/subscribe_forecast') {
          const forecastType = msg.forecast_type;
          const fixtureKey = `weather:${forecastType}`;
          if (!subscribers.has(fixtureKey)) subscribers.set(fixtureKey, []);
          subscribers.get(fixtureKey).push(cb);
          // Initial emit synchronously (matches live behaviour after
          // the first `subscribe_forecast` message lands).
          const initial = forecastType === 'hourly' ? fixture.forecastHourly : fixture.forecastDaily;
          if (initial) cb({ forecast: initial });
          return () => {
            const arr = subscribers.get(fixtureKey);
            if (arr) {
              const idx = arr.indexOf(cb);
              if (idx >= 0) arr.splice(idx, 1);
            }
          };
        }
        throw new Error(`hass-mock: unhandled subscribeMessage type "${msg.type}"`);
      },
    },

    __serviceCalls,

    __pushForecast(forecast, type = 'daily') {
      const fixtureKey = `weather:${type}`;
      const arr = subscribers.get(fixtureKey) || [];
      for (const cb of arr) cb({ forecast });
    },
  };
}
