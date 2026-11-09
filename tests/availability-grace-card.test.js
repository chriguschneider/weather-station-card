// @vitest-environment jsdom
// Card-level behaviour of the unavailable-sensor grace period (#213):
// last-good value, stale (in grace) vs missing (overdue), and the
// "HA is still starting" hold.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../src/main.js';

const MIN = 60_000;

function makeCard() {
  const card = document.createElement('weather-station-card');
  card.setConfig({ sensors: { temperature: 'sensor.t' } });
  return card;
}

function hassWith(state, coreState = 'RUNNING') {
  return {
    states: { 'sensor.t': { state, attributes: { unit_of_measurement: '°C' } } },
    language: 'en',
    config: { time_zone: 'Europe/Zurich', state: coreState },
    callWS: async () => ({}),
    callService: async () => undefined,
    connection: { subscribeMessage: async () => () => {} },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-07-01T12:00:00Z') });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('last-good value and grace period', () => {
  it('keeps 19.4 while unavailable and flags it stale, not missing', () => {
    const card = makeCard();
    card.hass = hassWith('19.4');
    expect(card.temperature).toBe('19.4');
    expect(card._staleSensors).toEqual([]);

    card.hass = hassWith('unavailable');
    expect(card.temperature).toBe('19.4');
    expect(card._staleSensors).toEqual(['temperature (sensor.t)']);
    expect(card._missingSensors).toEqual([]);
  });

  it('keeps the last-good value through "unknown" too', () => {
    const card = makeCard();
    card.hass = hassWith('19.4');
    card.hass = hassWith('unknown');
    expect(card.temperature).toBe('19.4');
  });

  it('turns overdue after five minutes without a new hass tick', () => {
    const card = makeCard();
    card.hass = hassWith('19.4');
    card.hass = hassWith('unavailable');
    vi.advanceTimersByTime(4 * MIN);
    expect(card._missingSensors).toEqual([]);

    vi.advanceTimersByTime(MIN + 2000);
    expect(card._missingSensors).toEqual(['temperature (sensor.t)']);
    expect(card._staleSensors).toEqual([]);
    expect(card.temperature).toBe('19.4');
  });

  it('a recovered sensor clears both hints', () => {
    const card = makeCard();
    card.hass = hassWith('19.4');
    card.hass = hassWith('unavailable');
    card.hass = hassWith('20.1');
    expect(card.temperature).toBe('20.1');
    expect(card._staleSensors).toEqual([]);
    expect(card._missingSensors).toEqual([]);
  });

  it('stays in grace for as long as HA is not RUNNING', () => {
    const card = makeCard();
    card.hass = hassWith('19.4');
    card.hass = hassWith('unavailable', 'NOT_RUNNING');
    vi.advanceTimersByTime(10 * MIN);
    expect(card._missingSensors).toEqual([]);
    expect(card._staleSensors).toEqual(['temperature (sensor.t)']);
  });

  it('turns overdue once HA reports RUNNING after the grace has elapsed', () => {
    const card = makeCard();
    card.hass = hassWith('19.4');
    card.hass = hassWith('unavailable', 'NOT_RUNNING');
    vi.advanceTimersByTime(10 * MIN);
    card.hass = hassWith('unavailable', 'RUNNING');
    expect(card._missingSensors).toEqual(['temperature (sensor.t)']);
  });

  it('never saw a good value: nothing to fall back to', () => {
    const card = makeCard();
    card.hass = hassWith('unavailable');
    expect(card.temperature).toBeUndefined();
  });
});
