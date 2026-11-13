// @vitest-environment jsdom
// DataSourceController (#452): the card's data-source lifecycle as a Lit
// ReactiveController, driven here through a plain host object.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sources = vi.hoisted(() => ({ measured: [], forecast: [], openMeteo: [] }));

vi.mock('../src/data-source.js', async (importOriginal) => {
  const actual = await importOriginal();
  class Stub {
    constructor(hass, config, calendar) {
      this.hass = hass;
      this.config = config;
      this.calendar = calendar;
      this.unsubscribed = false;
      this.visibleCalls = 0;
    }
    subscribe(cb) {
      this.cb = cb;
      return () => { this.unsubscribed = true; };
    }
    setHass(hass) { this.hass = hass; }
    notifyVisible() { this.visibleCalls += 1; }
  }
  class MeasuredDataSource extends Stub {
    constructor(...args) { super(...args); sources.measured.push(this); }
  }
  class ForecastDataSource extends Stub {
    constructor(...args) { super(...args); sources.forecast.push(this); }
  }
  return {
    ...actual,
    MeasuredDataSource,
    ForecastDataSource,
    fetchPressure3hDelta: vi.fn(async () => -1.5),
  };
});

vi.mock('../src/openmeteo-source.js', async (importOriginal) => {
  const actual = await importOriginal();
  class OpenMeteoSource {
    constructor(opts) {
      Object.assign(this, opts);
      this.aborted = false;
      this.fresh = 0;
      sources.openMeteo.push(this);
    }
    setListener(cb) { this.listener = cb; }
    ensureFresh() { this.fresh += 1; return Promise.resolve(); }
    abort() { this.aborted = true; }
    getDailyStationForecast() { return []; }
    getHourlyStationForecast() { return []; }
  }
  return { ...actual, OpenMeteoSource };
});

import { DataSourceController } from '../src/data-source-controller.js';
import { fetchPressure3hDelta } from '../src/data-source.js';
import { normalizeConfig } from '../src/card-config.js';
import { calendarFor } from '../src/utils/time-zone.js';

const HASS = {
  states: {
    'sensor.t': { state: '15', attributes: {} },
    'sensor.p': { state: '950', attributes: {} },
  },
  config: { latitude: 46.9, longitude: 7.4, time_zone: 'Europe/Zurich' },
};

function makeHost(raw = {}) {
  const host = {
    controllers: [],
    config: normalizeConfig({
      show_forecast: true,
      weather_entity: 'weather.home',
      sensors: { temperature: 'sensor.t', pressure: 'sensor.p' },
      ...raw,
    }),
    calendar: calendarFor('Europe/Zurich'),
    _hass: HASS,
    updates: 0,
    sourceData: 0,
    overlay: 0,
    dropped: 0,
    addController(c) { this.controllers.push(c); },
    removeController() {},
    requestUpdate() { this.updates += 1; },
    get updateComplete() { return Promise.resolve(true); },
    onSourceData() { this.sourceData += 1; },
    onOverlayData() { this.overlay += 1; },
    onSourceDropped() { this.dropped += 1; },
  };
  const ctrl = new DataSourceController(host);
  return { host, ctrl };
}

const entry = (iso, t) => ({ datetime: iso, temperature: t });

beforeEach(() => {
  sources.measured.length = 0;
  sources.forecast.length = 0;
  sources.openMeteo.length = 0;
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('DataSourceController — host wiring', () => {
  it('registers itself with the host', () => {
    const { host, ctrl } = makeHost();
    expect(host.controllers).toEqual([ctrl]);
  });

  it('creates both sources on sync and hands later hass objects to them', () => {
    const { ctrl } = makeHost();
    ctrl.sync(HASS);
    expect(sources.measured).toHaveLength(1);
    expect(sources.forecast).toHaveLength(1);
    expect(ctrl.sourcesMatchConfig()).toBe(true);

    const next = { ...HASS };
    ctrl.setHass(next);
    expect(sources.measured[0].hass).toBe(next);
    expect(sources.forecast[0].hass).toBe(next);

    ctrl.sync(HASS);
    expect(sources.measured).toHaveLength(1);
  });

  it('drops a source the config no longer wants', () => {
    const { host, ctrl } = makeHost();
    ctrl.sync(HASS);
    host.config = { ...host.config, show_forecast: false };
    expect(ctrl.sourcesMatchConfig()).toBe(false);
    ctrl.sync(HASS);
    expect(ctrl.forecastSource).toBeNull();
    expect(sources.forecast[0].unsubscribed).toBe(true);
    expect(host.dropped).toBe(1);
  });

  it('tears everything down on disconnect and re-registers on reconnect', () => {
    const { host, ctrl } = makeHost();
    ctrl.hostConnected();
    ctrl.hostConnected();
    ctrl.sync(HASS);
    ctrl.ensureOpenMeteo();
    host.config = { ...host.config, forecast: { ...host.config.forecast, show_sunshine: true } };
    ctrl.ensureOpenMeteo();
    const om = ctrl.openMeteo;
    expect(om).not.toBeNull();

    ctrl.hostDisconnected();
    expect(ctrl.measured).toBeNull();
    expect(ctrl.forecastSource).toBeNull();
    expect(ctrl.openMeteo).toBeNull();
    expect(om.aborted).toBe(true);
    expect(sources.measured[0].unsubscribed).toBe(true);

    // Reconnect: the registry is filled again, so a second disconnect
    // still tears the new sources down.
    ctrl.hostConnected();
    ctrl.sync(HASS);
    ctrl.hostDisconnected();
    expect(sources.measured[1].unsubscribed).toBe(true);
  });

  it('wakes the station poll when the tab becomes visible', () => {
    const { ctrl } = makeHost();
    ctrl.notifyVisible();
    ctrl.sync(HASS);
    ctrl.notifyVisible();
    expect(sources.measured[0].visibleCalls).toBe(1);
  });
});

describe('DataSourceController — source callbacks', () => {
  it('stores new station data, caches it and tells the host', async () => {
    const { host, ctrl } = makeHost();
    ctrl.sync(HASS);
    const data = [entry('2026-08-20T00:00:00.000Z', 15)];
    sources.measured[0].cb({ forecast: data });
    expect(ctrl.stationData).toBe(data);
    expect(ctrl.stationReady).toBe(true);
    expect(host.sourceData).toBe(1);
    expect(window.localStorage.getItem(ctrl.stationSeriesKey())).toContain('2026-08-20');

    // Identical fan-out: no second refresh.
    sources.measured[0].cb({ forecast: [entry('2026-08-20T00:00:00.000Z', 15)] });
    expect(host.sourceData).toBe(1);

    // The pressure delta refresh runs on every callback.
    await Promise.resolve();
    expect(fetchPressure3hDelta).toHaveBeenCalledTimes(2);
  });

  it('keeps the error and tells the host on a forecast event', () => {
    const { host, ctrl } = makeHost();
    ctrl.sync(HASS);
    sources.forecast[0].cb({ forecast: undefined, error: 'boom' });
    expect(ctrl.forecastData).toEqual([]);
    expect(ctrl.forecastError).toBe('boom');
    expect(ctrl.forecastReady).toBe(true);
    expect(host.sourceData).toBe(1);
  });

  it('hydrates a new source from the persisted series', () => {
    const first = makeHost();
    first.ctrl.sync(HASS);
    const data = [entry('2026-08-20T00:00:00.000Z', 15)];
    sources.measured[0].cb({ forecast: data });
    sources.forecast[0].cb({ forecast: data });

    const second = makeHost();
    second.ctrl.sync(HASS);
    expect(second.ctrl.stationReady).toBe(true);
    expect(second.ctrl.forecastReady).toBe(true);
    expect(second.ctrl.stationData).toEqual(data);
    expect(second.ctrl.allExpectedDataReady()).toBe(true);
  });

  it('logs instead of throwing when the host refresh fails', () => {
    const { host, ctrl } = makeHost();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.onSourceData = () => { throw new Error('bad'); };
    ctrl.sync(HASS);
    expect(() => sources.measured[0].cb({ forecast: [entry('2026-08-20T00:00:00.000Z', 1)] })).not.toThrow();
    expect(() => sources.forecast[0].cb({ forecast: [entry('2026-08-20T00:00:00.000Z', 1)] })).not.toThrow();
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe('DataSourceController — invalidate', () => {
  it('ignores a render-only config change', () => {
    const { host, ctrl } = makeHost();
    ctrl.sync(HASS);
    const old = host.config;
    host.config = { ...old, forecast: { ...old.forecast, round_temp: true } };
    expect(ctrl.invalidate(old)).toBe(false);
    expect(ctrl.measured).not.toBeNull();
  });

  it('keeps both sources for hourly ↔ today', () => {
    const { host, ctrl } = makeHost({ forecast: { type: 'hourly' } });
    ctrl.sync(HASS);
    const old = host.config;
    host.config = { ...old, forecast: { ...old.forecast, type: 'today' } };
    expect(ctrl.invalidate(old)).toBe(false);
    expect(ctrl.measured).not.toBeNull();
    expect(ctrl.forecastSource).not.toBeNull();
  });

  it('rebuilds on a mode change and restores the cached data of the new mode', () => {
    const { host, ctrl } = makeHost();
    ctrl.sync(HASS);
    const daily = [entry('2026-08-20T00:00:00.000Z', 15)];
    sources.measured[0].cb({ forecast: daily });
    sources.forecast[0].cb({ forecast: daily });

    const dailyConfig = host.config;
    host.config = { ...dailyConfig, forecast: { ...dailyConfig.forecast, type: 'hourly' } };
    expect(ctrl.invalidate(dailyConfig)).toBe(true);
    expect(ctrl.measured).toBeNull();
    expect(ctrl.stationReady).toBe(false);
    expect(ctrl.forecastReady).toBe(false);

    // Back to daily: the daily payloads come from the lazy cache.
    const hourlyConfig = host.config;
    host.config = dailyConfig;
    expect(ctrl.invalidate(hourlyConfig)).toBe(true);
    expect(ctrl.stationData).toEqual(daily);
    expect(ctrl.stationData).not.toBe(daily);
    expect(ctrl.stationReady).toBe(true);
    expect(ctrl.forecastData).toEqual(daily);
    expect(ctrl.forecastReady).toBe(true);
  });

  it('drops the pressure delta when the pressure sensor changes', async () => {
    const { host, ctrl } = makeHost();
    await ctrl.refreshPressureDelta();
    expect(ctrl.pressureDelta3h).toBe(-1.5);
    expect(host.updates).toBe(1);

    const old = host.config;
    host.config = { ...old, sensors: { ...old.sensors, pressure: 'sensor.p2' } };
    ctrl.invalidate(old);
    expect(ctrl.pressureDelta3h).toBeNull();
  });

  it('keeps the pressure delta when only another sensor changes', async () => {
    const { host, ctrl } = makeHost();
    await ctrl.refreshPressureDelta();
    const old = host.config;
    host.config = { ...old, sensors: { ...old.sensors, humidity: 'sensor.h' } };
    ctrl.invalidate(old);
    expect(ctrl.pressureDelta3h).toBe(-1.5);
  });
});

describe('DataSourceController — pressure delta', () => {
  it('clears the delta without a pressure sensor or with the row hidden', async () => {
    const { host, ctrl } = makeHost({ show_pressure: false });
    ctrl.pressureDelta3h = 2;
    await ctrl.refreshPressureDelta();
    expect(ctrl.pressureDelta3h).toBeNull();
    expect(fetchPressure3hDelta).not.toHaveBeenCalled();
    expect(host.updates).toBe(0);
  });

  it('swallows a failed fetch', async () => {
    const { ctrl } = makeHost();
    fetchPressure3hDelta.mockRejectedValueOnce(new Error('ws down'));
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await ctrl.refreshPressureDelta();
    expect(ctrl.pressureDelta3h).toBeNull();
    expect(debug).toHaveBeenCalled();
  });
});

describe('DataSourceController — calendar', () => {
  it('replaces the host calendar and drops every source on a zone change', () => {
    const { host, ctrl } = makeHost();
    ctrl.sync(HASS);
    host.config = { ...host.config, forecast: { ...host.config.forecast, show_sunshine: true } };
    ctrl.ensureOpenMeteo();
    const om = ctrl.openMeteo;

    ctrl.syncCalendar('Europe/Zurich');
    expect(ctrl.measured).not.toBeNull();

    ctrl.syncCalendar('America/New_York');
    expect(host.calendar.timeZone).toBe('America/New_York');
    expect(ctrl.measured).toBeNull();
    expect(ctrl.forecastSource).toBeNull();
    expect(ctrl.openMeteo).toBeNull();
    expect(om.aborted).toBe(true);
  });
});

describe('DataSourceController — Open-Meteo', () => {
  it('creates no source when nothing needs it, and drops one that is no longer needed', () => {
    const { host, ctrl } = makeHost({ forecast: { show_sunshine: true } });
    ctrl.ensureOpenMeteo();
    const om = ctrl.openMeteo;
    expect(om).not.toBeNull();
    expect(om.fresh).toBe(1);

    // Same request: kept, refreshed.
    ctrl.ensureOpenMeteo();
    expect(ctrl.openMeteo).toBe(om);
    expect(om.fresh).toBe(2);

    host.config = { ...host.config, forecast: { ...host.config.forecast, show_sunshine: false } };
    ctrl.ensureOpenMeteo();
    expect(ctrl.openMeteo).toBeNull();
    expect(om.aborted).toBe(true);
  });

  it('re-creates the source when the fetch window changes', () => {
    const { host, ctrl } = makeHost({ forecast: { show_sunshine: true } });
    ctrl.ensureOpenMeteo();
    const first = ctrl.openMeteo;
    host.config = { ...host.config, days: host.config.days + 3 };
    ctrl.ensureOpenMeteo();
    expect(ctrl.openMeteo).not.toBe(first);
    expect(first.aborted).toBe(true);
  });

  it('routes a sunshine-only refresh to the overlay path', () => {
    const { host, ctrl } = makeHost({ forecast: { show_sunshine: true } });
    ctrl.ensureOpenMeteo();
    ctrl.openMeteo.listener({ ok: true });
    ctrl.openMeteo.listener({ ok: false, error: 'x' });
    expect(host.overlay).toBe(1);
    expect(host.sourceData).toBe(0);
  });

  it('feeds the station block when it is the past source (ADR-0015)', () => {
    const { host, ctrl } = makeHost({
      sensors: {},
      forecast: { openmeteo_history: true },
    });
    expect(ctrl.wanted().measured).toBe(false);
    ctrl.sync(HASS);
    expect(ctrl.measured).toBeNull();

    ctrl.ensureOpenMeteo();
    expect(ctrl.openMeteo.pastDays).toBeGreaterThan(0);
    ctrl.openMeteo.listener({ ok: false, error: 'offline' });
    expect(ctrl.stationReady).toBe(true);
    expect(ctrl.stationData).toEqual([]);
    expect(host.sourceData).toBe(1);
  });

  it('settles the station block when there is no location to fetch for', () => {
    const { host, ctrl } = makeHost({
      sensors: {},
      forecast: { openmeteo_history: true },
    });
    host._hass = { ...HASS, config: {} };
    ctrl.ensureOpenMeteo();
    expect(ctrl.openMeteo).toBeNull();
    expect(ctrl.stationReady).toBe(true);
  });
});

describe('DataSourceController — availability scan', () => {
  const down = {
    states: {
      'sensor.t': { state: 'unavailable', attributes: {} },
      'sensor.p': { state: '950', attributes: {} },
    },
    config: {},
  };

  it('requests a render only when a list changed', () => {
    vi.useFakeTimers();
    const { host, ctrl } = makeHost({ show_forecast: false });
    host._hass = down;
    ctrl.scanAvailability(down);
    expect(ctrl.staleSensors).toEqual(['temperature (sensor.t)']);
    expect(host.updates).toBe(1);

    ctrl.scanAvailability(down);
    expect(host.updates).toBe(1);

    // The grace timer re-scans without a new hass tick.
    vi.advanceTimersByTime(6 * 60_000);
    expect(ctrl.missingSensors).toEqual(['temperature (sensor.t)']);
    expect(ctrl.overdueIds.has('sensor.t')).toBe(true);
    expect(host.updates).toBe(2);
  });

  it('clears the grace timer on disconnect', () => {
    vi.useFakeTimers();
    const { host, ctrl } = makeHost({ show_forecast: false });
    host._hass = down;
    ctrl.hostConnected();
    ctrl.scanAvailability(down);
    ctrl.hostDisconnected();
    vi.advanceTimersByTime(10 * 60_000);
    expect(ctrl.missingSensors).toEqual([]);
  });
});
