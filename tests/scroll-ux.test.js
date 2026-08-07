// Unit tests for scroll-ux.js — the v1.1 extraction of main.js's
// scroll wiring. We don't load JSDOM globally (would slow the rest of
// the suite); instead each test wires a minimal mock that mimics
// just the slice of DOM the function under test pokes.
//
// What we cover:
//   - updateScrollIndicators visibility math (left chevron,
//     right chevron, jump-to-now)
//   - setupScrollUx idempotency on re-bind to the same wrapper

import { describe, it, expect, vi } from 'vitest';
import {
  setupScrollUx,
  updateScrollIndicators,
} from '../src/scroll-ux.js';

// ── Mock builders ─────────────────────────────────────────────────────
// Each "element" mock just tracks the attributes scroll-ux pokes:
// hidden, textContent, style.left. Buttons get addEventListener stubs
// so setupScrollUx's bindings don't throw.

function mockEl() {
  const attrs = {};
  const listeners = [];
  return {
    _attrs: attrs,
    _listeners: listeners,
    style: {},
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
    hasAttribute(name) { return name in attrs; },
    addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      listeners.filter((l) => l.type === ev.type).forEach((l) => l.fn(ev));
    },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
  };
}

function mockBlock({
  scrollWidth = 1000, clientWidth = 200, scrollLeft = 0,
  hasLeftIndicator = true, hasRightIndicator = true,
  hasJumpToNow = true, hasScrollDates = true,
} = {}) {
  const wrapper = {
    ...mockEl(),
    scrollWidth, clientWidth, scrollLeft,
    classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
    setPointerCapture: vi.fn(),
    scrollBy: vi.fn(),
    scrollTo: vi.fn(),
    parentElement: null, // set after block construction
  };
  // Make wrapper match `.forecast-scroll.scrolling`
  wrapper.classList = (() => {
    const set = new Set(['forecast-scroll', 'scrolling']);
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
  })();
  const left = hasLeftIndicator ? mockEl() : null;
  const right = hasRightIndicator ? mockEl() : null;
  const jump = hasJumpToNow ? mockEl() : null;
  const dateLeft = hasScrollDates ? mockEl() : null;
  const dateRight = hasScrollDates ? mockEl() : null;
  if (left) left.setAttribute('hidden', '');
  if (right) right.setAttribute('hidden', '');
  if (jump) jump.setAttribute('hidden', '');
  if (dateLeft) dateLeft.setAttribute('hidden', '');
  if (dateRight) dateRight.setAttribute('hidden', '');

  const block = {
    querySelector(selector) {
      switch (selector) {
        case '.forecast-scroll.scrolling': return wrapper;
        case '.scroll-indicator-left': return left;
        case '.scroll-indicator-right': return right;
        case '.jump-to-now': return jump;
        case '.scroll-date-left': return dateLeft;
        case '.scroll-date-right': return dateRight;
        default: return null;
      }
    },
  };
  wrapper.parentElement = block;
  return { block, wrapper, left, right, jump, dateLeft, dateRight };
}

function mockCard({ block, stationCount = 0, forecastCount = 0, forecasts = [] } = {}) {
  return {
    shadowRoot: {
      querySelector(selector) {
        if (selector === '.forecast-scroll.scrolling') return block.querySelector('.forecast-scroll.scrolling');
        if (selector === '.forecast-scroll-block') return block;
        return null;
      },
    },
    _stationCount: stationCount,
    _forecastCount: forecastCount,
    forecasts,
    config: { locale: 'en' },
    language: 'en',
    _dragMoved: false,
    _scrollUxTeardown: null,
  };
}

// ── updateScrollIndicators ────────────────────────────────────────────

describe('updateScrollIndicators', () => {
  it('hides the left chevron at scrollLeft=0', () => {
    const { block, left } = mockBlock({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 200 });
    const card = mockCard({ block });
    updateScrollIndicators(card);
    expect(left.hasAttribute('hidden')).toBe(true);
  });

  it('shows the left chevron when scrolled in', () => {
    const { block, left } = mockBlock({ scrollLeft: 50, scrollWidth: 1000, clientWidth: 200 });
    const card = mockCard({ block });
    updateScrollIndicators(card);
    expect(left.hasAttribute('hidden')).toBe(false);
  });

  it('hides the right chevron at scroll-end', () => {
    const { block, right } = mockBlock({ scrollLeft: 800, scrollWidth: 1000, clientWidth: 200 });
    const card = mockCard({ block });
    updateScrollIndicators(card);
    expect(right.hasAttribute('hidden')).toBe(true);
  });

  it('shows the right chevron when not at scroll-end', () => {
    const { block, right } = mockBlock({ scrollLeft: 100, scrollWidth: 1000, clientWidth: 200 });
    const card = mockCard({ block });
    updateScrollIndicators(card);
    expect(right.hasAttribute('hidden')).toBe(false);
  });

  it('hides the jump-to-now button when within ~10% of canonical "now"', () => {
    // 7-day daily, station 7 + forecast 0, content 700 / viewport 200.
    // computeInitialScrollLeft for station-only puts target at right
    // edge: contentWidth - viewportWidth = 500. Within 10%·viewport
    // (= 20 px) → hidden.
    const { block, jump } = mockBlock({ scrollLeft: 490, scrollWidth: 700, clientWidth: 200 });
    const card = mockCard({ block, stationCount: 7, forecastCount: 0 });
    updateScrollIndicators(card);
    expect(jump.hasAttribute('hidden')).toBe(true);
  });

  it('shows the jump-to-now button when scrolled away from "now"', () => {
    const { block, jump } = mockBlock({ scrollLeft: 50, scrollWidth: 700, clientWidth: 200 });
    const card = mockCard({ block, stationCount: 7, forecastCount: 0 });
    updateScrollIndicators(card);
    expect(jump.hasAttribute('hidden')).toBe(false);
  });

  it('returns silently when shadowRoot has no .forecast-scroll-block', () => {
    const card = { shadowRoot: { querySelector: () => null } };
    expect(() => updateScrollIndicators(card)).not.toThrow();
  });

  it('returns silently when there is no scrolling wrapper inside the block', () => {
    const block = { querySelector: () => null };
    const card = {
      shadowRoot: {
        querySelector: (s) => s === '.forecast-scroll-block' ? block : null,
      },
    };
    expect(() => updateScrollIndicators(card)).not.toThrow();
  });
});

// ── setupScrollUx ─────────────────────────────────────────────────────

describe('setupScrollUx', () => {
  it('is a no-op when there is no .forecast-scroll.scrolling wrapper', () => {
    const card = { shadowRoot: { querySelector: () => null } };
    expect(() => setupScrollUx(card)).not.toThrow();
    expect(card._scrollUxTeardown).toBeUndefined();
  });

  it('tears down a previous binding when called without a wrapper', () => {
    const teardown = vi.fn();
    const card = {
      shadowRoot: { querySelector: () => null },
      _scrollUxTeardown: teardown,
    };
    setupScrollUx(card);
    expect(teardown).toHaveBeenCalledOnce();
    expect(card._scrollUxTeardown).toBeNull();
  });

  it('is idempotent on the same wrapper element', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    const teardown1 = card._scrollUxTeardown;
    expect(teardown1).toBeTruthy();
    expect(wrapper._wsScrollUxBound).toBe(true);
    setupScrollUx(card);
    const teardown2 = card._scrollUxTeardown;
    // Second call should NOT replace the teardown — same wrapper, same binding.
    expect(teardown2).toBe(teardown1);
  });

  it('returns a teardown that removes the bound flag and listeners', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    expect(wrapper._wsScrollUxBound).toBe(true);
    card._scrollUxTeardown();
    expect(wrapper._wsScrollUxBound).toBe(false);
  });
});

// ── pointer event flow (#32 coverage gap) ────────────────────────────
// scroll-ux's drag-to-scroll state machine (pointerdown → pointermove →
// pointerup/pointercancel) is the highest-impact uncovered branch
// surface (the existing tests covered the public API but stopped short
// of exercising the in-flight drag state). These tests fire synthesized
// pointer events through the mock wrapper's dispatchEvent and assert
// on card._dragMoved, scrollLeft, and dragging-class transitions.

describe('setupScrollUx pointer flow', () => {
  function fire(wrapper, type, props = {}) {
    const ev = {
      type,
      pointerId: props.pointerId ?? 1,
      pointerType: props.pointerType ?? 'mouse',
      clientX: props.clientX ?? 0,
      stopPropagation: () => {},
      preventDefault: () => {},
      ...props,
    };
    wrapper.dispatchEvent(ev);
    return ev;
  }

  it('mouse drag past DRAG_THRESHOLD sets _dragMoved and updates scrollLeft', () => {
    const { block, wrapper } = mockBlock({ scrollLeft: 100 });
    const card = mockCard({ block });
    setupScrollUx(card);

    fire(wrapper, 'pointerdown', { pointerType: 'mouse', clientX: 50 });
    expect(wrapper.setPointerCapture).toHaveBeenCalledWith(1);
    // small move below threshold — no drag yet
    fire(wrapper, 'pointermove', { pointerType: 'mouse', clientX: 52 });
    expect(card._dragMoved).toBe(false);
    // bigger move — past threshold (5px), drag engages
    fire(wrapper, 'pointermove', { pointerType: 'mouse', clientX: 60 });
    expect(card._dragMoved).toBe(true);
    expect(wrapper.scrollLeft).toBe(100 - (60 - 50));
  });

  it('touch drag past threshold flips _dragMoved but does NOT scroll programmatically', () => {
    const { block, wrapper } = mockBlock({ scrollLeft: 200 });
    const card = mockCard({ block });
    setupScrollUx(card);
    fire(wrapper, 'pointerdown', { pointerType: 'touch', clientX: 100 });
    // touch path skips setPointerCapture (mouse-only branch).
    expect(wrapper.setPointerCapture).not.toHaveBeenCalled();
    fire(wrapper, 'pointermove', { pointerType: 'touch', clientX: 120 });
    expect(card._dragMoved).toBe(true);
    // scrollLeft must NOT be touched — native overflow-x scroll handles it.
    expect(wrapper.scrollLeft).toBe(200);
  });

  it('pointermove with mismatched pointerId is ignored', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    fire(wrapper, 'pointerdown', { pointerId: 1, clientX: 0 });
    fire(wrapper, 'pointermove', { pointerId: 99, clientX: 100 });
    expect(card._dragMoved).toBe(false);
  });

  it('pointermove without an active pointerdown is ignored', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    fire(wrapper, 'pointermove', { clientX: 100 });
    expect(card._dragMoved).toBe(false);
  });

  it('pointercancel marks the gesture as a drag even before the threshold', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    fire(wrapper, 'pointerdown', { clientX: 0 });
    // No move at all — but a cancel still escalates _dragMoved so the
    // tap-suppression rule holds for native-scroll-claimed gestures.
    fire(wrapper, 'pointercancel', { clientX: 0 });
    expect(card._dragMoved).toBe(true);
  });

  it('pointerup after a drag schedules a macrotask reset of _dragMoved', () => {
    vi.useFakeTimers();
    try {
      const { block, wrapper } = mockBlock();
      const card = mockCard({ block });
      setupScrollUx(card);
      fire(wrapper, 'pointerdown', { clientX: 0 });
      fire(wrapper, 'pointermove', { clientX: 50 });
      expect(card._dragMoved).toBe(true);
      fire(wrapper, 'pointerup', { clientX: 50 });
      // Macrotask hasn't run yet — flag still true so the bubbled
      // ha-card pointerup listener can still see it.
      expect(card._dragMoved).toBe(true);
      vi.advanceTimersByTime(0);
      expect(card._dragMoved).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('setPointerCapture failure does not abort the drag handler chain', () => {
    const { block, wrapper } = mockBlock();
    wrapper.setPointerCapture = vi.fn(() => { throw new Error('not supported'); });
    const card = mockCard({ block });
    setupScrollUx(card);
    expect(() => fire(wrapper, 'pointerdown', { clientX: 0 })).not.toThrow();
    // Subsequent move still works — drag state is unaffected by the
    // capture-failure path.
    fire(wrapper, 'pointermove', { clientX: 50 });
    expect(card._dragMoved).toBe(true);
  });
});

// ── passive-listener wiring (Slice 8 interaction polish) ────────────
// Touch scrolling must never block on the main thread waiting for a
// possible preventDefault. Every listener that does NOT call
// preventDefault is registered { passive: true }; pointermove (the one
// that DOES call preventDefault on the mouse drag path) stays
// non-passive. These tests read the opts recorded by the mock's
// addEventListener stub.

describe('setupScrollUx passive listeners', () => {
  function optsFor(listeners, type) {
    const entry = listeners.find((l) => l.type === type);
    return entry ? entry.opts : undefined;
  }

  it('registers pointerdown / pointerup / pointercancel as passive', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    expect(optsFor(wrapper._listeners, 'pointerdown')).toEqual({ passive: true });
    expect(optsFor(wrapper._listeners, 'pointerup')).toEqual({ passive: true });
    expect(optsFor(wrapper._listeners, 'pointercancel')).toEqual({ passive: true });
  });

  it('registers pointermove as explicitly non-passive (it calls preventDefault)', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    expect(optsFor(wrapper._listeners, 'pointermove')).toEqual({ passive: false });
  });

  it('keeps the scroll listener passive', () => {
    const { block, wrapper } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    expect(optsFor(wrapper._listeners, 'scroll')).toEqual({ passive: true });
  });

  it('registers the indicator pointerdown guards as passive', () => {
    const { block, left, right, jump } = mockBlock();
    const card = mockCard({ block });
    setupScrollUx(card);
    expect(optsFor(left._listeners, 'pointerdown')).toEqual({ passive: true });
    expect(optsFor(right._listeners, 'pointerdown')).toEqual({ passive: true });
    expect(optsFor(jump._listeners, 'pointerdown')).toEqual({ passive: true });
  });
});

// ── drag tuning (Slice 8 interaction polish) ────────────────────────

describe('setupScrollUx drag tuning', () => {
  function fire(wrapper, type, props = {}) {
    const ev = {
      type,
      pointerId: props.pointerId ?? 1,
      pointerType: props.pointerType ?? 'mouse',
      clientX: props.clientX ?? 0,
      stopPropagation: () => {},
      preventDefault: () => {},
      ...props,
    };
    wrapper.dispatchEvent(ev);
    return ev;
  }

  it('rounds scrollLeft to whole pixels during a fractional mouse drag', () => {
    const { block, wrapper } = mockBlock({ scrollLeft: 100 });
    const card = mockCard({ block });
    setupScrollUx(card);
    fire(wrapper, 'pointerdown', { pointerType: 'mouse', clientX: 0 });
    // Fractional cursor delta — 7.4 px past the start. Raw scrollLeft
    // would be 100 - 7.4 = 92.6; the handler must round it.
    fire(wrapper, 'pointermove', { pointerType: 'mouse', clientX: 7.4 });
    expect(card._dragMoved).toBe(true);
    expect(Number.isInteger(wrapper.scrollLeft)).toBe(true);
    expect(wrapper.scrollLeft).toBe(93);
  });
});

// ── click + scroll-event handlers (#32 coverage gap) ────────────────

describe('setupScrollUx click handlers', () => {
  it('left-indicator click scrolls one viewport left', () => {
    // Chevrons navigate via scrollTo with an explicit target (needed
    // for the day-snap coordination) — from scrollLeft 400, one
    // 0.85-viewport step left lands at 400 - 170 = 230.
    const { block, wrapper, left } = mockBlock({ clientWidth: 200, scrollLeft: 400 });
    const card = mockCard({ block });
    setupScrollUx(card);
    left.dispatchEvent({ type: 'click', stopPropagation: () => {} });
    expect(wrapper.scrollTo).toHaveBeenCalledWith({ left: 400 - 200 * 0.85, behavior: 'smooth' });
  });

  it('right-indicator click scrolls one viewport right', () => {
    const { block, wrapper, right } = mockBlock({ clientWidth: 200 });
    const card = mockCard({ block });
    setupScrollUx(card);
    right.dispatchEvent({ type: 'click', stopPropagation: () => {} });
    expect(wrapper.scrollTo).toHaveBeenCalledWith({ left: 200 * 0.85, behavior: 'smooth' });
  });

  it('jump-to-now click smooth-scrolls to the canonical "now" position', () => {
    const { block, wrapper, jump } = mockBlock({ scrollWidth: 1000, clientWidth: 200 });
    const card = mockCard({ block, stationCount: 12, forecastCount: 12 });
    setupScrollUx(card);
    jump.dispatchEvent({ type: 'click', stopPropagation: () => {} });
    expect(wrapper.scrollTo).toHaveBeenCalled();
    const arg = wrapper.scrollTo.mock.calls[0][0];
    expect(arg.behavior).toBe('smooth');
    expect(typeof arg.left).toBe('number');
  });

  it('teardown cancels a pending scroll-rAF (no zombie redraw after disconnect)', () => {
    const rafCancel = vi.fn();
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    // Stub rAF to record the handle so we can verify it gets cancelled.
    globalThis.requestAnimationFrame = (() => 42);
    globalThis.cancelAnimationFrame = rafCancel;
    try {
      const { block, wrapper } = mockBlock();
      const card = mockCard({ block });
      setupScrollUx(card);
      // Fire a scroll → rAF pending (rafId = 42).
      wrapper.dispatchEvent({ type: 'scroll' });
      // Teardown while the rAF is still pending.
      card._scrollUxTeardown();
      expect(rafCancel).toHaveBeenCalledWith(42);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCaf;
    }
  });

  it('scroll-rAF callback pans the virtualized chart via setScrollWindow', () => {
    // Perf pass 2026-08: the per-scroll full `chart.draw()` is gone —
    // the rAF callback pans the virtualized canvas by handing the
    // wrapper's current scrollLeft to setScrollWindow instead.
    const setScrollWindow = vi.fn();
    let rafCallback = null;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb) => { rafCallback = cb; return 1; });
    try {
      const { block, wrapper } = mockBlock();
      const card = mockCard({ block });
      card.forecastChart = { setScrollWindow };
      wrapper.scrollLeft = 123;
      setupScrollUx(card);
      wrapper.dispatchEvent({ type: 'scroll' });
      // Synchronously invoke the rAF callback to exercise the pan.
      expect(rafCallback).toBeTypeOf('function');
      rafCallback();
      expect(setScrollWindow).toHaveBeenCalledWith(123);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  it('scroll-rAF callback does not throw when forecastChart is missing setScrollWindow()', () => {
    let rafCallback = null;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb) => { rafCallback = cb; return 1; });
    try {
      const { block, wrapper } = mockBlock();
      const card = mockCard({ block });
      // forecastChart deliberately undefined — covers the type-guard branch.
      setupScrollUx(card);
      wrapper.dispatchEvent({ type: 'scroll' });
      expect(() => rafCallback()).not.toThrow();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });
});
