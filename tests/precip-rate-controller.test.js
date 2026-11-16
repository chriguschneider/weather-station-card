// @vitest-environment jsdom
// PrecipRateController (#472): the counter → mm/h derivation, its buffer
// identity, persistence and the 30-s wall-clock tick, driven through a
// plain host object instead of the card.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrecipRateController } from '../src/precip-rate-controller.js';

function makeHost({ changed = true } = {}) {
  const host = {
    controllers: [],
    shown: null,
    applied: 0,
    ticks: 0,
    addController(c) { this.controllers.push(c); },
    removeController() {},
    requestUpdate() {},
    updateComplete: Promise.resolve(true),
    applyDerivedRate(rate) {
      this.shown = rate;
      this.applied++;
      return changed;
    },
    onDerivedPrecipTick() { this.ticks++; },
  };
  return host;
}

const at = (iso, v) => ({ state: String(v), last_updated: iso });

describe('PrecipRateController', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers with the host and arms the tick only on a counter sample', () => {
    const host = makeHost();
    const ctrl = new PrecipRateController(host);
    expect(host.controllers).toEqual([ctrl]);
    ctrl.derive(undefined, undefined);
    ctrl.derive('sensor.rain', { state: 'unavailable' });
    ctrl.derive('sensor.rain', { state: '1', last_updated: 'not a date' });
    expect(ctrl.timer).toBeNull();
    expect(host.shown).toBeNull();

    ctrl.derive('sensor.rain', at('2026-11-15T09:50:00Z', 1));
    expect(ctrl.timer).not.toBeNull();
    expect(ctrl.bufferEntity).toBe('sensor.rain');
    expect(host.shown).toBe(0);
  });

  it('derives a rate from two samples and persists the buffer per entity', () => {
    const host = makeHost();
    const ctrl = new PrecipRateController(host);
    ctrl.derive('sensor.rain', at('2026-11-15T09:50:00Z', 1));
    ctrl.derive('sensor.rain', at('2026-11-15T10:00:00Z', 2));
    // 1 mm in the 10 min up to now.
    expect(host.shown).toBeCloseTo(6, 9);

    // A second controller (reload) hydrates from localStorage.
    const reloaded = new PrecipRateController(makeHost());
    reloaded.derive('sensor.rain', at('2026-11-15T10:00:00Z', 2));
    expect(reloaded.buffer.length).toBe(2);
  });

  it('a duplicate sample does not rewrite localStorage', () => {
    const ctrl = new PrecipRateController(makeHost());
    ctrl.derive('sensor.rain', at('2026-11-15T09:58:00Z', 1));
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    ctrl.derive('sensor.rain', at('2026-11-15T09:58:00Z', 1));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns the rate in the counter\'s own unit, unconverted', () => {
    const host = makeHost();
    const ctrl = new PrecipRateController(host);
    // A counter in inches: 1 in in the 10 min up to now is 6 (in/h); the
    // card, not the controller, converts it.
    ctrl.derive('sensor.rain_in', at('2026-11-15T09:50:00Z', 0));
    ctrl.derive('sensor.rain_in', at('2026-11-15T10:00:00Z', 1));
    expect(host.shown).toBeCloseTo(6, 9);
  });

  it('the tick decays the rate in dry spells and tells the host', () => {
    const host = makeHost();
    const ctrl = new PrecipRateController(host);
    ctrl.derive('sensor.rain', at('2026-11-15T09:59:00Z', 1));
    ctrl.derive('sensor.rain', at('2026-11-15T10:00:00Z', 2));
    const before = host.shown;
    vi.advanceTimersByTime(30 * 60_000);
    expect(host.shown).toBeLessThan(before);
    expect(host.ticks).toBe(60);
  });

  it('the tick tells the host only when the shown text changed', () => {
    const host = makeHost({ changed: false });
    const ctrl = new PrecipRateController(host);
    ctrl.derive('sensor.rain', at('2026-11-15T09:59:00Z', 1));
    const applied = host.applied;
    vi.advanceTimersByTime(90_000);
    expect(host.applied).toBe(applied + 3);
    expect(host.ticks).toBe(0);
  });

  it('stop() releases tick and buffer; disconnect clears only the tick', () => {
    const ctrl = new PrecipRateController(makeHost());
    ctrl.derive('sensor.rain', at('2026-11-15T09:59:00Z', 1));
    ctrl.hostDisconnected();
    expect(ctrl.timer).toBeNull();
    expect(ctrl.bufferEntity).toBe('sensor.rain');

    ctrl.derive('sensor.rain', at('2026-11-15T10:00:00Z', 2));
    expect(ctrl.timer).not.toBeNull();
    ctrl.stop();
    expect(ctrl.timer).toBeNull();
    expect(ctrl.buffer).toEqual([]);
    expect(ctrl.bufferEntity).toBeUndefined();
    // An idle tick after stop() is a no-op.
    vi.advanceTimersByTime(60_000);
  });

  it('a repoint to another entity re-seeds from that entity', () => {
    const ctrl = new PrecipRateController(makeHost());
    ctrl.derive('sensor.a', at('2026-11-15T09:59:00Z', 1));
    ctrl.derive('sensor.b', at('2026-11-15T10:00:00Z', 5));
    expect(ctrl.bufferEntity).toBe('sensor.b');
    expect(ctrl.buffer).toEqual([{ t: Date.parse('2026-11-15T10:00:00Z'), v: 5 }]);
  });
});
