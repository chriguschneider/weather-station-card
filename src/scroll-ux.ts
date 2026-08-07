// Scroll UX wiring for the forecast block: drag-to-scroll on desktop,
// left/right indicator chevrons, the jump-to-now floating button, the
// scroll timeline (day segments + visible-section thumb) below the
// chart, day paging for 'today', and the indicator visibility
// tracking via the wrapper's scroll event.
//
// Touch falls through to native `overflow-x: auto` scroll; we only
// listen for movement-detection so a swipe doesn't also fire the
// card-level tap_action. `_dragMoved` is shared with action-handler
// so a drag-to-scroll suppresses the trailing tap.
//
// Idempotent on stable wrapper elements via a `_wsScrollUxBound`
// flag — Lit reuses the wrapper across data refreshes, so re-binding
// on every render() would leak listeners. Calling setupScrollUx
// when no wrapper exists (non-scrolling render) tears down any
// prior binding.

import { safeQuery } from './utils/safe-query.js';
import { computeInitialScrollLeft } from './format-utils.js';
import { computeDayPageScrollLeft } from './forecast-utils.js';
import type { ForecastEntry } from './forecast-utils.js';

const DRAG_THRESHOLD = 5;
const STEP_BY = 0.85; // scroll about one viewport, leave a hint of overlap
const DAY_SNAP_DELAY_MS = 160; // settle time before snapping to a day page

/** 'today' is the day pager (2026-08): the viewport frames exactly one
 *  calendar day, chevrons page ±1 day and free scrolling snaps to day
 *  boundaries (page width ≡ wrapper.clientWidth, guaranteed by the
 *  gap-filled 8-blocks-per-day aggregation + effectiveVisibleBars). */
function isDayPager(card: ScrollUxCard): boolean {
  return (card.config?.forecast as { type?: string } | undefined)?.type === 'today';
}

/** Subset of the card the scroll-ux module reads / writes. */
export interface ScrollUxCard {
  shadowRoot: ShadowRoot | null;
  forecasts: ReadonlyArray<ForecastEntry> | null;
  config: { locale?: string; [k: string]: unknown };
  language?: string;
  _stationCount?: number;
  _forecastCount?: number;
  _dragMoved: boolean;
  _scrollUxTeardown: (() => void) | null;
}

interface BoundWrapper extends HTMLElement {
  _wsScrollUxBound?: boolean;
  /** The `.scroll-timeline` element the current binding attached its
   *  pointer handlers to (null = none existed at bind time). Lit can
   *  reuse the wrapper across a mode toggle while the timeline
   *  appears, disappears, or is replaced in a LATER render — when the
   *  live DOM no longer matches this reference, the binding must be
   *  torn down and rebuilt or the new timeline would sit listener-less
   *  (clicks would even fall through to the card's tap_action). */
  _wsBoundTimeline?: HTMLElement | null;
}

export function setupScrollUx(card: ScrollUxCard): void {
  const wrapper = safeQuery<BoundWrapper>(card.shadowRoot, '.forecast-scroll.scrolling');
  if (!wrapper) {
    // Non-scrolling render (daily default fits all). Detach any
    // previously bound handlers so a daily↔hourly toggle doesn't leak.
    if (card._scrollUxTeardown) {
      card._scrollUxTeardown();
      card._scrollUxTeardown = null;
    }
    return;
  }
  if (wrapper._wsScrollUxBound) {
    const liveTimeline = wrapper.parentElement?.querySelector<HTMLElement>('.scroll-timeline') ?? null;
    if (liveTimeline === (wrapper._wsBoundTimeline ?? null)) {
      // Same element, same timeline — only refresh indicator visibility
      // (which depends on current scrollLeft / scrollWidth).
      updateScrollIndicators(card);
      return;
    }
    // Wrapper survived a render that changed the timeline (mode toggle
    // daily↔hourly/today on a reused element) — rebind from scratch.
    if (card._scrollUxTeardown) {
      card._scrollUxTeardown();
      card._scrollUxTeardown = null;
    }
  }
  wrapper._wsScrollUxBound = true;

  const block = wrapper.parentElement; // .forecast-scroll-block
  const leftBtn = block ? block.querySelector<HTMLElement>('.scroll-indicator-left') : null;
  const rightBtn = block ? block.querySelector<HTMLElement>('.scroll-indicator-right') : null;
  const jumpBtn = block ? block.querySelector<HTMLElement>('.jump-to-now') : null;

  // ── Drag-to-scroll + tap suppression ──────────────────────────────
  // We listen to ALL pointer types so a swipe / drag — whether mouse
  // or touch — sets `card._dragMoved`, which the action handler on
  // ha-card checks before firing tap_action / hold_action. Without
  // that gate, a horizontal touch-swipe to scroll the chart on mobile
  // would also fire the configured tap action on pointerup.
  //
  // The actual scrollLeft manipulation (and pointer capture) is still
  // mouse-only — touch falls through to the native `overflow-x: auto`
  // scroll, and calling preventDefault or capturing the pointer
  // would interfere with that native gesture.
  let isDown = false;
  let dragMoved = false;
  let startX = 0;
  let startScrollLeft = 0;
  let activePointerId: number | null = null;

  // ── Day-page snapping (today mode) ────────────────────────────────
  // Free scrolling (touch momentum, wheel, released drags) settles on
  // the nearest whole-day page. Programmatic navigations (chevrons,
  // jump-to-now, timeline, the snap itself) declare their destination
  // via `pendingTarget` and the snap stands down until it's reached —
  // without this, browser smooth-scroll events thin out near the end
  // of an animation, the debounce fires MID-FLIGHT, rounds back to the
  // origin page and cancels the navigation (worst case: two smooth
  // scrolls cancelling each other in a loop). A 1.2 s failsafe clears
  // a stale target if the animation was interrupted (user wheel) —
  // and re-arms the day snap, because an interrupted animation can
  // rest mid-page with no further scroll events to trigger one.
  let snapTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingTarget: number | null = null;
  let pendingClear: ReturnType<typeof setTimeout> | null = null;
  const clampLeft = (left: number): number =>
    Math.min(Math.max(0, wrapper.scrollWidth - wrapper.clientWidth), Math.max(0, left));
  const programmaticScrollTo = (left: number): void => {
    const target = clampLeft(left);
    pendingTarget = target;
    if (pendingClear) clearTimeout(pendingClear);
    pendingClear = setTimeout(() => {
      pendingTarget = null;
      if (isDayPager(card)) scheduleDaySnap();
    }, 1200);
    wrapper.scrollTo({ left: target, behavior: 'smooth' });
  };
  const scheduleDaySnap = (): void => {
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      snapTimer = null;
      const w = wrapper.clientWidth;
      if (w <= 0 || isDown || pendingTarget !== null) return;
      const nearest = clampLeft(Math.round(wrapper.scrollLeft / w) * w);
      if (Math.abs(nearest - wrapper.scrollLeft) > 2) {
        programmaticScrollTo(nearest);
      }
    }, DAY_SNAP_DELAY_MS);
  };

  const onPointerDown = (ev: PointerEvent): void => {
    isDown = true;
    dragMoved = false;
    // A fresh user gesture supersedes any in-flight programmatic
    // navigation — release the snap suppression.
    pendingTarget = null;
    activePointerId = ev.pointerId;
    startX = ev.clientX;
    startScrollLeft = wrapper.scrollLeft;
    if (ev.pointerType === 'mouse') {
      try {
        wrapper.setPointerCapture(ev.pointerId);
      } catch (err) {
        // setPointerCapture is gated by browser support for pointer
        // events; older WebViews throw — drag still works without it.
        void err;
      }
    }
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!isDown || ev.pointerId !== activePointerId) return;
    const dx = ev.clientX - startX;
    if (!dragMoved && Math.abs(dx) > DRAG_THRESHOLD) {
      dragMoved = true;
      // Shared with the action handler so that a drag/swipe gesture
      // doesn't also fire a tap_action on pointerup.
      card._dragMoved = true;
      wrapper.classList.add('dragging');
    }
    if (dragMoved && ev.pointerType === 'mouse') {
      // Round to whole pixels — sub-pixel scrollLeft values produced
      // by a fractional cursor delta make the chart shimmer during a
      // slow drag. Integer scroll positions keep the drag crisp.
      wrapper.scrollLeft = Math.round(startScrollLeft - dx);
      ev.preventDefault();
    }
  };

  const onPointerEnd = (ev: PointerEvent): void => {
    if (!isDown || (ev && ev.pointerId !== activePointerId)) return;
    isDown = false;
    activePointerId = null;
    wrapper.classList.remove('dragging');
    // pointercancel from the browser claiming the gesture for native
    // scroll counts as a drag, even if our pointermove threshold
    // wasn't crossed yet — any pointerup that may bubble up to the
    // ha-card afterwards must skip its tap-detection branch.
    if (ev?.type === 'pointercancel') {
      dragMoved = true;
      card._dragMoved = true;
    }
    if (dragMoved) {
      // Reset via setTimeout(0) — a macrotask, not a microtask. The
      // ha-card's pointerup listener bubbles up AFTER this one in the
      // same event dispatch, and microtasks flush between listener
      // invocations in V8/Blink, so a Promise.resolve().then(reset)
      // would fire before the action handler reads the flag and the
      // tap would still trigger. setTimeout(0) defers the reset to
      // the next macrotask, after the entire event dispatch is done.
      setTimeout(() => { card._dragMoved = false; }, 0);
      // Day pager: settle the released drag onto a whole-day page.
      if (isDayPager(card)) scheduleDaySnap();
    }
  };

  // Listener passiveness is chosen per handler so a touch swipe never
  // blocks on the main thread waiting to see if we'll preventDefault:
  //   - pointerdown / pointerup / pointercancel never call
  //     preventDefault → { passive: true } lets the browser start the
  //     native momentum scroll immediately.
  //   - pointermove DOES call preventDefault (mouse drag-to-scroll
  //     path) → it must stay non-passive, marked explicitly so a
  //     future edit doesn't silently flip it and break mouse drag.
  wrapper.addEventListener('pointerdown', onPointerDown, { passive: true });
  wrapper.addEventListener('pointermove', onPointerMove, { passive: false });
  wrapper.addEventListener('pointerup', onPointerEnd, { passive: true });
  wrapper.addEventListener('pointercancel', onPointerEnd, { passive: true });

  // ── Indicator + jump-to-now click ─────────────────────────────────
  // stopPropagation prevents the action handler (bound on ha-card)
  // from interpreting the indicator click as a card-level tap.
  // Day pager: chevrons page EXACTLY one viewport (= one calendar
  // day); other modes keep the 0.85-viewport step with overlap.
  const stopDown = (ev: Event): void => { ev.stopPropagation(); };
  const stepPx = (): number =>
    isDayPager(card) ? wrapper.clientWidth : wrapper.clientWidth * STEP_BY;
  const chevronTarget = (direction: -1 | 1): number => {
    let target = wrapper.scrollLeft + direction * stepPx();
    // Day pager: land ON a page boundary even when the current
    // position is mid-page (interrupted animation, resize drift).
    if (isDayPager(card) && wrapper.clientWidth > 0) {
      target = Math.round(target / wrapper.clientWidth) * wrapper.clientWidth;
    }
    return target;
  };
  const onLeftClick = (ev: Event): void => {
    ev.stopPropagation();
    programmaticScrollTo(chevronTarget(-1));
  };
  const onRightClick = (ev: Event): void => {
    ev.stopPropagation();
    programmaticScrollTo(chevronTarget(1));
  };
  const onJumpClick = (ev: Event): void => {
    ev.stopPropagation();
    // Day pager jumps to the CURRENT day's page; other modes centre
    // the station/forecast boundary.
    const dayPage = isDayPager(card)
      ? computeDayPageScrollLeft(card.forecasts, wrapper.scrollWidth)
      : null;
    const target = dayPage ?? computeInitialScrollLeft({
      stationCount: card._stationCount || 0,
      forecastCount: card._forecastCount || 0,
      contentWidth: wrapper.scrollWidth,
      viewportWidth: wrapper.clientWidth,
    });
    programmaticScrollTo(target);
  };
  // The control pointerdown handlers only stopPropagation (never
  // preventDefault) so they're safe to mark passive — a tap on a
  // chevron then never adds main-thread latency to a scroll gesture
  // that started on the control.
  if (leftBtn) {
    leftBtn.addEventListener('click', onLeftClick);
    leftBtn.addEventListener('pointerdown', stopDown, { passive: true });
  }
  if (rightBtn) {
    rightBtn.addEventListener('click', onRightClick);
    rightBtn.addEventListener('pointerdown', stopDown, { passive: true });
  }
  if (jumpBtn) {
    jumpBtn.addEventListener('click', onJumpClick);
    jumpBtn.addEventListener('pointerdown', stopDown, { passive: true });
  }

  // ── Timeline / minimap scrubbing ─────────────────────────────────
  // Click jumps to (and centres on) the clicked position; holding and
  // moving scrubs live. Day pager rounds every target to a whole-day
  // page, so a click on a day label lands exactly on that day.
  // stopPropagation on all three phases keeps the gesture out of the
  // card-level tap/hold detection on ha-card.
  const timeline = block ? block.querySelector<HTMLElement>('.scroll-timeline') : null;
  // Remember which timeline (if any) this binding attached to — the
  // idempotency check at the top compares it against the live DOM so
  // a timeline that appears/vanishes on a reused wrapper forces a
  // rebind instead of staying listener-less.
  wrapper._wsBoundTimeline = timeline;
  let tlScrubbing = false;
  const tlScrollTo = (clientX: number, smooth: boolean): void => {
    if (!timeline) return;
    const rect = timeline.getBoundingClientRect();
    if (rect.width <= 0 || wrapper.scrollWidth <= 0) return;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    let target = frac * wrapper.scrollWidth - wrapper.clientWidth / 2;
    if (isDayPager(card)) {
      target = Math.round(target / wrapper.clientWidth) * wrapper.clientWidth;
    }
    if (smooth) {
      programmaticScrollTo(target);
    } else {
      // Live scrub — track the pointer instantly; snapping happens on
      // release via the pointer-end handler.
      pendingTarget = null;
      wrapper.scrollTo({ left: clampLeft(target), behavior: 'auto' });
    }
  };
  const onTlPointerDown = (ev: PointerEvent): void => {
    ev.stopPropagation();
    tlScrubbing = true;
    try { timeline?.setPointerCapture(ev.pointerId); } catch { /* unsupported */ }
    tlScrollTo(ev.clientX, true);
  };
  const onTlPointerMove = (ev: PointerEvent): void => {
    if (!tlScrubbing) return;
    ev.stopPropagation();
    tlScrollTo(ev.clientX, false);
  };
  const onTlPointerEnd = (ev: PointerEvent): void => {
    if (!tlScrubbing) return;
    ev.stopPropagation();
    tlScrubbing = false;
    if (isDayPager(card)) scheduleDaySnap();
  };
  if (timeline) {
    timeline.addEventListener('pointerdown', onTlPointerDown);
    timeline.addEventListener('pointermove', onTlPointerMove);
    timeline.addEventListener('pointerup', onTlPointerEnd);
    timeline.addEventListener('pointercancel', onTlPointerEnd);
  }

  // ── Scroll handling ──────────────────────────────────────────────
  // Fully rAF-coalesced (perf pass 2026-08): scroll events fire at
  // 60+ Hz on touch devices and BOTH consumers force synchronous
  // layout reads (indicator visibility → scrollWidth/clientWidth) or
  // canvas work — running them per event thrashed the main thread.
  // One rAF per frame reads the freshest scrollLeft and does:
  //   1. indicator + timeline-thumb DOM updates;
  //   2. `setScrollWindow` on the virtualized chart — an uPlot
  //      setScale pan that redraws only the ~visibleBars columns in
  //      the viewport. The former full `chart.draw()` per frame
  //      (entire 7 700-px canvas, all label plugins) is gone; the
  //      day context lives in the scroll timeline below the chart.
  let scrollRafId: number | null = null;
  const onScroll = (): void => {
    // Programmatic navigation in flight: stand down until the smooth
    // scroll reaches its declared destination, then release.
    if (pendingTarget !== null && Math.abs(wrapper.scrollLeft - pendingTarget) <= 2) {
      pendingTarget = null;
    }
    // Day pager: any FREE scroll motion (touch momentum, wheel)
    // re-arms the settle-snap — not while a programmatic navigation
    // knows its destination, and not while a pointer is actively
    // dragging the chart or scrubbing the timeline (their end
    // handlers snap).
    if (isDayPager(card) && pendingTarget === null && !isDown && !tlScrubbing) scheduleDaySnap();
    if (scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      updateScrollIndicators(card);
      const chart = (card as { forecastChart?: { setScrollWindow?: (px: number) => void } }).forecastChart;
      if (chart && typeof chart.setScrollWindow === 'function') {
        chart.setScrollWindow(wrapper.scrollLeft);
      }
    });
  };
  wrapper.addEventListener('scroll', onScroll, { passive: true });
  updateScrollIndicators(card);

  card._scrollUxTeardown = () => {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    if (snapTimer) {
      clearTimeout(snapTimer);
      snapTimer = null;
    }
    if (pendingClear) {
      clearTimeout(pendingClear);
      pendingClear = null;
    }
    wrapper.removeEventListener('pointerdown', onPointerDown);
    wrapper.removeEventListener('pointermove', onPointerMove);
    wrapper.removeEventListener('pointerup', onPointerEnd);
    wrapper.removeEventListener('pointercancel', onPointerEnd);
    wrapper.removeEventListener('scroll', onScroll);
    if (timeline) {
      timeline.removeEventListener('pointerdown', onTlPointerDown);
      timeline.removeEventListener('pointermove', onTlPointerMove);
      timeline.removeEventListener('pointerup', onTlPointerEnd);
      timeline.removeEventListener('pointercancel', onTlPointerEnd);
    }
    if (leftBtn) {
      leftBtn.removeEventListener('click', onLeftClick);
      leftBtn.removeEventListener('pointerdown', stopDown);
    }
    if (rightBtn) {
      rightBtn.removeEventListener('click', onRightClick);
      rightBtn.removeEventListener('pointerdown', stopDown);
    }
    if (jumpBtn) {
      jumpBtn.removeEventListener('click', onJumpClick);
      jumpBtn.removeEventListener('pointerdown', stopDown);
    }
    wrapper.classList.remove('dragging');
    wrapper._wsScrollUxBound = false;
    wrapper._wsBoundTimeline = null;
  };
}

/** Public — mainly invoked internally on scroll events, but also
 *  after data refreshes so the chevron and jump-to-now visibility
 *  reflects the new scrollWidth without waiting for the user to
 *  scroll. */
export function updateScrollIndicators(card: ScrollUxCard): void {
  const block = safeQuery<HTMLElement>(card.shadowRoot, '.forecast-scroll-block');
  if (!block) return;
  const wrapper = block.querySelector<HTMLElement>('.forecast-scroll.scrolling');
  if (!wrapper) return;
  const left = block.querySelector<HTMLElement>('.scroll-indicator-left');
  const right = block.querySelector<HTMLElement>('.scroll-indicator-right');
  if (left && right) {
    const slop = 1; // sub-pixel rounding tolerance
    const max = wrapper.scrollWidth - wrapper.clientWidth;
    if (wrapper.scrollLeft > slop) left.removeAttribute('hidden');
    else left.setAttribute('hidden', '');
    if (wrapper.scrollLeft < max - slop) right.removeAttribute('hidden');
    else right.setAttribute('hidden', '');
  }
  // Jump-to-now visibility — hidden when current scrollLeft is within
  // ~10% of one viewport width of the canonical "now" position. The
  // threshold is relative so it scales with display size; phones get a
  // tighter band than desktops in absolute pixels.
  const jump = block.querySelector<HTMLElement>('.jump-to-now');
  if (jump) {
    const target = computeInitialScrollLeft({
      stationCount: card._stationCount || 0,
      forecastCount: card._forecastCount || 0,
      contentWidth: wrapper.scrollWidth,
      viewportWidth: wrapper.clientWidth,
    });
    const offset = Math.abs(wrapper.scrollLeft - target);
    const threshold = Math.max(20, wrapper.clientWidth * 0.1);
    if (offset > threshold) jump.removeAttribute('hidden');
    else jump.setAttribute('hidden', '');
  }
  // Timeline thumb — mirrors the visible section onto the minimap.
  // Positioned imperatively (style.left/width) so the 60 Hz scroll
  // path never triggers a Lit render.
  const timeline = block.querySelector<HTMLElement>('.scroll-timeline');
  if (timeline && wrapper.scrollWidth > 0) {
    const thumb = timeline.querySelector<HTMLElement>('.tl-thumb');
    if (thumb) {
      thumb.style.left = `${(wrapper.scrollLeft / wrapper.scrollWidth) * 100}%`;
      thumb.style.width = `${(wrapper.clientWidth / wrapper.scrollWidth) * 100}%`;
    }
  }
}

