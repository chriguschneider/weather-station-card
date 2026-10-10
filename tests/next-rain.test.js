// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classifyNextRain,
  formatNextRain,
  formatCheckedUntil,
  nextRainIcon,
  findNextRainEntity,
  radarNowcastDisabled,
} from '../src/next-rain.js';
import '../src/main.js';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const iso = (minutes) => new Date(NOW + minutes * 60_000).toISOString();
const STRINGS = { now: 'Now', none: 'No rain', checked_until: 'Checked until {time}' };
const radarState = (attrs, state = 'x') => ({ state, attributes: { source: null, at: null, checked_until: null, ...attrs } });

describe('classifyNextRain', () => {
  it('returns null for missing / unavailable states', () => {
    expect(classifyNextRain(undefined, NOW)).toBeNull();
    expect(classifyNextRain({ state: 'unavailable' }, NOW)).toBeNull();
    expect(classifyNextRain({ state: 'unknown' }, NOW)).toBeNull();
  });

  it('counts down in minutes inside the radar hour', () => {
    expect(classifyNextRain(radarState({ at: iso(11.5), source: 'radar' }), NOW))
      .toEqual({ kind: 'minutes', minutes: 12, source: 'radar' });
  });

  it('reads a passed timestamp as raining now', () => {
    expect(classifyNextRain(radarState({ at: iso(-3), source: 'radar' }), NOW))
      .toEqual({ kind: 'now', source: 'radar' });
  });

  // An hourly model answer must not pretend to minute precision.
  it('never turns a forecast answer into a countdown', () => {
    const view = classifyNextRain(radarState({ at: iso(40), source: 'forecast' }), NOW);
    expect(view.kind).toBe('time');
    expect(view.withWeekday).toBe(false);
  });

  it('adds the weekday beyond 24 h', () => {
    expect(classifyNextRain(radarState({ at: iso(26 * 60), source: 'forecast' }), NOW).withWeekday).toBe(true);
  });

  it('reports dry until the end of the searched forecast', () => {
    const view = classifyNextRain(radarState({ checked_until: iso(48 * 60) }, 'No rain'), NOW);
    expect(view.kind).toBe('none');
    expect(view.until.getTime()).toBe(NOW + 48 * 3_600_000);
  });

  it('falls back to the state text without a timestamp or search horizon', () => {
    expect(classifyNextRain(radarState({}, 'No data'), NOW)).toEqual({ kind: 'text', text: 'No data' });
  });

  it('reads a foreign timestamp sensor like `at`', () => {
    const view = classifyNextRain({ state: iso(20), attributes: { device_class: 'timestamp' } }, NOW);
    expect(view).toEqual({ kind: 'minutes', minutes: 20, source: '' });
  });

  // The station's own rain gauge is first-hand; a dry radar / forecast
  // answer next to a live rate above zero would contradict the row above.
  it('says "now" when the station measures rain, whatever the sensor says', () => {
    const dry = radarState({ checked_until: iso(48 * 60) }, 'No rain');
    expect(classifyNextRain(dry, NOW, true)).toEqual({ kind: 'now', source: 'station' });
    expect(classifyNextRain(radarState({ at: iso(30), source: 'radar' }), NOW, true))
      .toEqual({ kind: 'now', source: 'station' });
    expect(classifyNextRain({ state: 'unavailable' }, NOW, true)).toEqual({ kind: 'now', source: 'station' });
    expect(classifyNextRain(dry, NOW, false).kind).toBe('none');
  });
});

describe('formatNextRain', () => {
  it('formats each view kind', () => {
    expect(formatNextRain({ kind: 'now', source: 'radar' }, 'en', false, STRINGS)).toBe('Now');
    expect(formatNextRain({ kind: 'minutes', minutes: 12, source: 'radar' }, 'en', false, STRINGS))
      .toBe('in 12 min.');
    expect(formatNextRain({ kind: 'text', text: 'Kein Regen' }, 'en', false, STRINGS)).toBe('Kein Regen');
  });

  it('marks forecast times as approximate', () => {
    const at = new Date(NOW + 5 * 3_600_000);
    const out = formatNextRain({ kind: 'time', at, withWeekday: false, source: 'forecast' }, 'en', false, STRINGS);
    expect(out.startsWith('~')).toBe(true);
    expect(formatNextRain({ kind: 'time', at, withWeekday: false, source: 'radar' }, 'en', false, STRINGS))
      .toBe(out.slice(1));
  });

  // The search horizon is the end of the model run, not weather — it
  // belongs in the tooltip, not the row.
  it('keeps the dry text plain and puts the horizon in the tooltip', () => {
    const view = { kind: 'none', until: new Date(NOW + 3 * 3_600_000) };
    expect(formatNextRain(view, 'en', false, STRINGS)).toBe('No rain');
    expect(formatCheckedUntil(view, NOW, 'en', false, STRINGS)).toMatch(/^Checked until \d/);
  });
});

describe('nextRainIcon', () => {
  it('tells radar and forecast apart', () => {
    expect(nextRainIcon({ kind: 'minutes', minutes: 5, source: 'radar' })).toBe('mdi:radar');
    expect(nextRainIcon({ kind: 'time', at: new Date(), withWeekday: false, source: 'forecast' }))
      .toBe('mdi:weather-cloudy-clock');
    expect(nextRainIcon({ kind: 'none', until: new Date() })).toBe('mdi:umbrella-closed-outline');
  });
});

describe('detection', () => {
  it('prefers registry identity over the id pattern', () => {
    const hass = {
      entities: { 'sensor.renamed': { platform: 'meteoswiss_radar', translation_key: 'next_rain' } },
      states: { 'sensor.other_next_rain': {}, 'sensor.renamed': {} },
    };
    expect(findNextRainEntity(hass)).toBe('sensor.renamed');
  });

  it('falls back to the id pattern', () => {
    expect(findNextRainEntity({ states: { 'sensor.home_next_rain': {} } })).toBe('sensor.home_next_rain');
    expect(findNextRainEntity({ states: { 'sensor.rain_today': {} } })).toBeUndefined();
  });

  it('flags a loaded radar integration without a next-rain sensor', () => {
    expect(radarNowcastDisabled({ config: { components: ['meteoswiss_radar'] }, states: {} })).toBe(true);
    expect(radarNowcastDisabled({
      config: { components: ['meteoswiss_radar'] },
      states: { 'sensor.meteoswiss_radar_next_rain': {} },
    })).toBe(false);
    expect(radarNowcastDisabled({ config: { components: [] }, states: {} })).toBe(false);
  });
});

describe('card row', () => {
  const flat = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(flat).join('');
    if (v.strings && 'values' in v) return v.strings.reduce((a, s, i) => a + s + flat(v.values[i]), '');
    return String(v);
  };

  afterEach(() => vi.useRealTimers());

  function mount(nextRainState, extraSensors = {}, extraStates = {}) {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      sensors: { temperature: 'sensor.t', next_rain: 'sensor.next_rain', ...extraSensors },
      show_attributes: true,
      show_next_rain: true,
    });
    card.hass = {
      states: { 'sensor.t': { state: '19', attributes: {} }, 'sensor.next_rain': nextRainState, ...extraStates },
      config: {},
      language: 'en',
    };
    return card;
  }

  it('shows "Now" while the station rain rate is above zero, even if the sensor says dry', () => {
    const dry = radarState({ checked_until: iso(48 * 60) }, 'No rain');
    const rate = (state) => ({ state, attributes: { unit_of_measurement: 'mm/h' } });
    const wet = mount(dry, { precipitation_rate: 'sensor.rate' }, { 'sensor.rate': rate('1.4') });
    expect(wet.next_rain_text).toBe('Now');
    expect(wet.next_rain_icon).toBe('mdi:weather-pouring');
    expect(wet.next_rain_title).toBe('Your station — rain rate above zero right now');

    const stopped = mount(dry, { precipitation_rate: 'sensor.rate' }, { 'sensor.rate': rate('0') });
    expect(stopped.next_rain_text).toBe('No rain');
  });

  it('renders the countdown and keeps it ticking between updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const card = mount(radarState({ at: iso(10), source: 'radar' }, '10 min'));
    expect(flat(card.renderAttributes())).toContain('in 10 min.');
    expect(card._nextRainTimer).not.toBeNull();
    vi.advanceTimersByTime(4 * 60_000);
    expect(card.next_rain_text).toBe('in 6 min.');
    card.disconnectedCallback();
  });

  it('stops the tick once there is no countdown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const card = mount(radarState({ at: iso(10), source: 'radar' }));
    vi.advanceTimersByTime(11 * 60_000);
    expect(card.next_rain_text).toBe('Now');
    expect(card._nextRainTimer).toBeNull();
  });

  it('renders nothing while the sensor is unavailable', () => {
    const card = mount({ state: 'unavailable', attributes: {} });
    expect(card.next_rain_text).toBe('');
    expect(flat(card.renderAttributes())).not.toContain('mdi:');
  });
});
