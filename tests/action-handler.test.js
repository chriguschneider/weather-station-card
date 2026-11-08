// @vitest-environment jsdom
// Per-file jsdom override — the runAction tests poke window.history /
// window.open / window.dispatchEvent. The rest of the suite stays on
// node for speed.
//
// Unit tests for action-handler.js — the v1.1 extraction of the
// whole-card pointer-tap/hold/double dispatcher.
//
// Two-layer coverage:
//   1. setupActionHandler — pointer-event sequencing on a mock ha-card.
//      Uses Vitest fake timers so the 250 ms tap delay and 500 ms hold
//      threshold are deterministic.
//   2. runAction — the dispatcher itself, exercised directly across
//      every action branch the editor exposes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupActionHandler, runAction } from '../src/action-handler.js';

// ── Mock builders ─────────────────────────────────────────────────────

function mockHaCard() {
  const listeners = [];
  return {
    style: {},
    _wsActionHandlerBound: false,
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      listeners.filter((l) => l.type === ev.type).forEach((l) => l.fn(ev));
    },
    _listeners: listeners,
  };
}

function mockCard({ haCard, config = {}, hass = null } = {}) {
  const fired = [];
  return {
    shadowRoot: {
      querySelector: (s) => s === 'ha-card' ? haCard : null,
    },
    config,
    _hass: hass,
    _dragMoved: false,
    _actionHandlerTeardown: null,
    _firedEvents: fired,
    _fire(type, detail) {
      fired.push({ type, detail });
      return { type, detail };
    },
  };
}

// Fake event factory — anything outside `target` and `type` is ignored
// by the handlers.
function pointerEvent(type, target = { closest: () => null }) {
  return { type, target };
}

// ── setupActionHandler ────────────────────────────────────────────────

describe('setupActionHandler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns silently when shadowRoot has no ha-card', () => {
    const card = { shadowRoot: { querySelector: () => null } };
    expect(() => setupActionHandler(card)).not.toThrow();
  });

  it('sets cursor:pointer when at least one action is configured', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: { tap_action: { action: 'more-info' } },
    });
    setupActionHandler(card);
    expect(haCard.style.cursor).toBe('pointer');
  });

  it('clears cursor when all actions are "none"', () => {
    const haCard = mockHaCard();
    haCard.style.cursor = 'pointer'; // simulate previous state
    const card = mockCard({
      haCard,
      config: {
        tap_action: { action: 'none' },
        hold_action: { action: 'none' },
        double_tap_action: { action: 'none' },
      },
    });
    setupActionHandler(card);
    expect(haCard.style.cursor).toBe('');
  });

  it('is idempotent — second call on the same ha-card is a no-op', () => {
    const haCard = mockHaCard();
    const card = mockCard({ haCard });
    setupActionHandler(card);
    const teardown1 = card._actionHandlerTeardown;
    const listenerCount = haCard._listeners.length;
    setupActionHandler(card);
    expect(card._actionHandlerTeardown).toBe(teardown1);
    expect(haCard._listeners.length).toBe(listenerCount);
  });

  it('fires tap_action 250 ms after pointerup (single tap)', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: { tap_action: { action: 'fire-dom-event', tag: 'X' } },
    });
    setupActionHandler(card);
    haCard.dispatchEvent(pointerEvent('pointerdown'));
    haCard.dispatchEvent(pointerEvent('pointerup'));
    // Before the 250 ms window expires, no fire yet.
    expect(card._firedEvents).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(card._firedEvents).toHaveLength(1);
    expect(card._firedEvents[0].type).toBe('ll-custom');
  });

  it('fires double_tap_action when a second tap arrives within 250 ms', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: {
        tap_action: { action: 'fire-dom-event', tag: 'TAP' },
        double_tap_action: { action: 'fire-dom-event', tag: 'DBL' },
      },
    });
    setupActionHandler(card);
    haCard.dispatchEvent(pointerEvent('pointerdown'));
    haCard.dispatchEvent(pointerEvent('pointerup'));
    // Second tap inside the window before the single-tap timer fires.
    vi.advanceTimersByTime(100);
    haCard.dispatchEvent(pointerEvent('pointerdown'));
    haCard.dispatchEvent(pointerEvent('pointerup'));
    expect(card._firedEvents).toHaveLength(1);
    expect(card._firedEvents[0].detail.tag).toBe('DBL');
    // The pending single-tap was cancelled — advancing time shouldn't
    // produce a second fire.
    vi.advanceTimersByTime(500);
    expect(card._firedEvents).toHaveLength(1);
  });

  it('fires hold_action after 500 ms of pointerdown without pointerup', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: { hold_action: { action: 'fire-dom-event', tag: 'HOLD' } },
    });
    setupActionHandler(card);
    haCard.dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(500);
    expect(card._firedEvents).toHaveLength(1);
    expect(card._firedEvents[0].detail.tag).toBe('HOLD');
    // pointerup after hold should NOT fire tap.
    haCard.dispatchEvent(pointerEvent('pointerup'));
    vi.advanceTimersByTime(500);
    expect(card._firedEvents).toHaveLength(1);
  });

  it('does NOT fire tap when card._dragMoved is true (drag-to-scroll)', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: { tap_action: { action: 'fire-dom-event', tag: 'X' } },
    });
    setupActionHandler(card);
    haCard.dispatchEvent(pointerEvent('pointerdown'));
    card._dragMoved = true;
    haCard.dispatchEvent(pointerEvent('pointerup'));
    vi.advanceTimersByTime(500);
    expect(card._firedEvents).toHaveLength(0);
  });

  it('does NOT fire hold when card._dragMoved is true', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: { hold_action: { action: 'fire-dom-event', tag: 'HOLD' } },
    });
    setupActionHandler(card);
    haCard.dispatchEvent(pointerEvent('pointerdown'));
    card._dragMoved = true;
    vi.advanceTimersByTime(500);
    expect(card._firedEvents).toHaveLength(0);
  });

  it('skips events whose target sits inside a card-internal button', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: { tap_action: { action: 'fire-dom-event' } },
    });
    setupActionHandler(card);
    const buttonTarget = { closest: (sel) => sel.includes('button') ? {} : null };
    haCard.dispatchEvent({ type: 'pointerdown', target: buttonTarget });
    haCard.dispatchEvent({ type: 'pointerup', target: buttonTarget });
    vi.advanceTimersByTime(500);
    expect(card._firedEvents).toHaveLength(0);
  });

  it('teardown unbinds and clears the bound flag', () => {
    const haCard = mockHaCard();
    const card = mockCard({ haCard });
    setupActionHandler(card);
    expect(haCard._wsActionHandlerBound).toBe(true);
    expect(haCard._listeners.length).toBeGreaterThan(0);
    card._actionHandlerTeardown();
    expect(haCard._wsActionHandlerBound).toBe(false);
    expect(haCard._listeners.length).toBe(0);
  });

  it('pointercancel clears any pending hold', () => {
    const haCard = mockHaCard();
    const card = mockCard({
      haCard,
      config: { hold_action: { action: 'fire-dom-event', tag: 'HOLD' } },
    });
    setupActionHandler(card);
    haCard.dispatchEvent(pointerEvent('pointerdown'));
    haCard.dispatchEvent(pointerEvent('pointercancel'));
    vi.advanceTimersByTime(500);
    expect(card._firedEvents).toHaveLength(0);
  });
});

// ── runAction ─────────────────────────────────────────────────────────

describe('runAction', () => {
  it('is a no-op for null actionConfig', () => {
    const card = mockCard({ haCard: mockHaCard() });
    expect(() => runAction(card, null)).not.toThrow();
    expect(card._firedEvents).toHaveLength(0);
  });

  it('is a no-op for action: "none"', () => {
    const card = mockCard({ haCard: mockHaCard() });
    runAction(card, { action: 'none' });
    expect(card._firedEvents).toHaveLength(0);
  });

  it('more-info fires hass-more-info with the configured entity', () => {
    const card = mockCard({ haCard: mockHaCard() });
    runAction(card, { action: 'more-info', entity: 'sensor.foo' });
    expect(card._firedEvents).toEqual([
      { type: 'hass-more-info', detail: { entityId: 'sensor.foo' } },
    ]);
  });

  it('more-info falls back to sensors.temperature when entity is missing', () => {
    const card = mockCard({
      haCard: mockHaCard(),
      config: { sensors: { temperature: 'sensor.fallback' } },
    });
    runAction(card, { action: 'more-info' });
    expect(card._firedEvents[0].detail.entityId).toBe('sensor.fallback');
  });

  it('more-info is a no-op when neither entity nor fallback is set', () => {
    const card = mockCard({ haCard: mockHaCard() });
    runAction(card, { action: 'more-info' });
    expect(card._firedEvents).toHaveLength(0);
  });

  it('navigate pushes state and dispatches location-changed', () => {
    const card = mockCard({ haCard: mockHaCard() });
    const pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    runAction(card, { action: 'navigate', navigation_path: '/lovelace/0' });
    expect(pushSpy).toHaveBeenCalledWith(null, '', '/lovelace/0');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0][0].type).toBe('location-changed');
    pushSpy.mockRestore();
    dispatchSpy.mockRestore();
  });

  it('navigate is a no-op when navigation_path is missing', () => {
    const card = mockCard({ haCard: mockHaCard() });
    const pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    runAction(card, { action: 'navigate' });
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it('toggle calls hass.callService(domain, "toggle", { entity_id })', () => {
    const callService = vi.fn();
    const card = mockCard({ haCard: mockHaCard(), hass: { callService } });
    runAction(card, { action: 'toggle', entity: 'switch.light1' });
    expect(callService).toHaveBeenCalledWith('switch', 'toggle', { entity_id: 'switch.light1' });
  });

  it('toggle is a no-op without hass', () => {
    const card = mockCard({ haCard: mockHaCard() });
    expect(() => runAction(card, { action: 'toggle', entity: 'switch.x' })).not.toThrow();
  });

  it('perform-action splits the dotted service id and forwards data + target', () => {
    const callService = vi.fn();
    const card = mockCard({ haCard: mockHaCard(), hass: { callService } });
    runAction(card, {
      action: 'perform-action',
      perform_action: 'light.turn_on',
      data: { brightness: 200 },
      target: { entity_id: 'light.kitchen' },
    });
    expect(callService).toHaveBeenCalledWith(
      'light', 'turn_on', { brightness: 200 }, { entity_id: 'light.kitchen' },
    );
  });

  it('perform-action accepts the legacy `service` key (pre-2024.8)', () => {
    const callService = vi.fn();
    const card = mockCard({ haCard: mockHaCard(), hass: { callService } });
    runAction(card, { action: 'call-service', service: 'script.foo' });
    expect(callService).toHaveBeenCalledWith('script', 'foo', {}, undefined);
  });

  it('assist fires hass-action-assist with the full config', () => {
    const card = mockCard({ haCard: mockHaCard() });
    const cfg = { action: 'assist', start_listening: true };
    runAction(card, cfg);
    expect(card._firedEvents).toEqual([{ type: 'hass-action-assist', detail: cfg }]);
  });

  it('fire-dom-event fires ll-custom with the full config', () => {
    const card = mockCard({ haCard: mockHaCard() });
    const cfg = { action: 'fire-dom-event', tag: 'CUSTOM', payload: { foo: 'bar' } };
    runAction(card, cfg);
    expect(card._firedEvents).toEqual([{ type: 'll-custom', detail: cfg }]);
  });

  it('url opens a new window with noopener when url_path is set', () => {
    const card = mockCard({ haCard: mockHaCard() });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    runAction(card, { action: 'url', url_path: 'https://example.com' });
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('url opens http and relative links', () => {
    const card = mockCard({ haCard: mockHaCard() });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    runAction(card, { action: 'url', url_path: 'http://example.com/a' });
    runAction(card, { action: 'url', url_path: '/lovelace/energy' });
    runAction(card, { action: 'url', url_path: 'lovelace/0' });
    expect(openSpy.mock.calls.map((c) => c[0])).toEqual([
      'http://example.com/a',
      '/lovelace/energy',
      'lovelace/0',
    ]);
    openSpy.mockRestore();
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://example.com/file',
    'https://',
  ])('url refuses unsafe or unparseable url_path %j', (url_path) => {
    const card = mockCard({ haCard: mockHaCard() });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    runAction(card, { action: 'url', url_path });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
