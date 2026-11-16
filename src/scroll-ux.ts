// Scroll UX for the forecast block: drag-to-scroll, indicator chevrons,
// jump-to-now, the scroll timeline and day paging for 'today' (ADR-0021).
//
// Touch uses native `overflow-x: auto` scrolling; we only detect
// movement so a swipe doesn't fire the card-level tap_action
// (`_dragMoved`, shared with action-handler).
//
// Idempotent per wrapper via `_wsScrollUxBound`: Lit reuses the wrapper
// across renders, so rebinding every time would leak listeners.

import { safeQuery } from './utils/safe-query.js';
import { computeInitialScrollLeft } from './format-utils.js';
import { computeTodayPagerScrollLeft } from './forecast-utils.js';
import type { ForecastEntry } from './forecast-utils.js';
import type { Calendar } from './utils/time-zone.js';

const DRAG_THRESHOLD = 5;
const STEP_BY = 0.85; // scroll about one viewport, leave a hint of overlap
const DAY_SNAP_DELAY_MS = 160; // settle time before snapping to a day page

/** 'today' is the day pager (ADR-0021): one calendar day per viewport,
 *  so a page is exactly `wrapper.clientWidth` wide. */
function isDayPager(card: ScrollUxCard): boolean {
  return (card.config?.forecast as { type?: string } | undefined)?.type === 'today';
}

/** Subset of the card the scroll-ux module reads / writes. */
export interface ScrollUxCard {
  shadowRoot: ShadowRoot | null;
  forecasts: ReadonlyArray<ForecastEntry> | null;
  config: { locale?: string; [k: string]: unknown };
  language?: string;
  calendar: Calendar;
  _stationCount?: number;
  _forecastCount?: number;
  _dragMoved: boolean;
  _scrollUxTeardown: (() => void) | null;
}

interface BoundWrapper extends HTMLElement {
  _wsScrollUxBound?: boolean;
  /** The `.scroll-timeline` this binding attached to (null = none).
   *  When a later render changes the live timeline on a reused
   *  wrapper, the binding must be rebuilt or the new one would have no
   *  listeners and its clicks would reach the card's tap_action. */
  _wsBoundTimeline?: HTMLElement | null;
}

export function setupScrollUx(card: ScrollUxCard): void {
  const wrapper = safeQuery<BoundWrapper>(card.shadowRoot, '.forecast-scroll.scrolling');
  if (!wrapper) {
    // Non-scrolling render (daily default fits all). Detach any
    // already bound so a daily↔hourly toggle doesn't leak.
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

  // All pointer types set `card._dragMoved`, which the ha-card action
  // handler checks before firing tap_action / hold_action. Only the
  // mouse path drives scrollLeft and captures the pointer; doing so for
  // touch would interfere with native scrolling.
  let isDown = false;
  let dragMoved = false;
  let startX = 0;
  let startScrollLeft = 0;
  let activePointerId: number | null = null;

  // Day-page snapping (today mode): free scrolling settles on the
  // nearest whole-day page. Programmatic navigations declare their
  // destination in `pendingTarget` and the snap stands down until it is
  // reached; smooth-scroll events thin out near the end of an
  // animation, so the debounce would otherwise fire mid-flight and
  // round back to the origin page. A 1.2 s failsafe clears a stale
  // target and re-arms the snap, since an interrupted animation can
  // rest mid-page with no further scroll events.
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
      // The far end is a valid resting page even when it is not a
      // multiple of the page width (station-only ends at the "now"
      // block).
      const maxLeft = Math.max(0, wrapper.scrollWidth - w);
      if (maxLeft - wrapper.scrollLeft <= 2) return;
      const nearest = clampLeft(Math.round(wrapper.scrollLeft / w) * w);
      if (Math.abs(nearest - wrapper.scrollLeft) > 2) {
        programmaticScrollTo(nearest);
      }
    }, DAY_SNAP_DELAY_MS);
  };

  const onPointerDown = (ev: PointerEvent): void => {
    isDown = true;
    dragMoved = false;
    // A user gesture supersedes any in-flight programmatic navigation.
    pendingTarget = null;
    activePointerId = ev.pointerId;
    startX = ev.clientX;
    startScrollLeft = wrapper.scrollLeft;
    if (ev.pointerType === 'mouse') {
      try {
        wrapper.setPointerCapture(ev.pointerId);
      } catch (err) {
        // Older WebViews throw; drag still works without capture.
        void err;
      }
    }
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!isDown || ev.pointerId !== activePointerId) return;
    const dx = ev.clientX - startX;
    if (!dragMoved && Math.abs(dx) > DRAG_THRESHOLD) {
      dragMoved = true;
      card._dragMoved = true;
      wrapper.classList.add('dragging');
    }
    if (dragMoved && ev.pointerType === 'mouse') {
      // Whole pixels: fractional scrollLeft makes the chart shimmer.
      wrapper.scrollLeft = Math.round(startScrollLeft - dx);
      ev.preventDefault();
    }
  };

  const onPointerEnd = (ev: PointerEvent): void => {
    if (!isDown || (ev && ev.pointerId !== activePointerId)) return;
    isDown = false;
    activePointerId = null;
    wrapper.classList.remove('dragging');
    // pointercancel (browser claims the gesture for native scroll)
    // counts as a drag even below the move threshold.
    if (ev?.type === 'pointercancel') {
      dragMoved = true;
      card._dragMoved = true;
    }
    if (dragMoved) {
      // Macrotask, not microtask: the ha-card pointerup listener runs
      // after this one in the same dispatch, and microtasks flush
      // between listeners, so a promise reset would clear the flag
      // before the action handler reads it.
      setTimeout(() => { card._dragMoved = false; }, 0);
      if (isDayPager(card)) scheduleDaySnap();
    }
  };

  // Only pointermove calls preventDefault (mouse drag), so it alone
  // must stay non-passive; the others are passive so touch scrolling
  // never waits on us.
  wrapper.addEventListener('pointerdown', onPointerDown, { passive: true });
  wrapper.addEventListener('pointermove', onPointerMove, { passive: false });
  wrapper.addEventListener('pointerup', onPointerEnd, { passive: true });
  wrapper.addEventListener('pointercancel', onPointerEnd, { passive: true });

  // stopPropagation keeps the ha-card action handler from reading a
  // control click as a card-level tap. The day pager pages exactly one
  // viewport; other modes step by STEP_BY.
  const stopDown = (ev: Event): void => { ev.stopPropagation(); };
  const stepPx = (): number =>
    isDayPager(card) ? wrapper.clientWidth : wrapper.clientWidth * STEP_BY;
  const chevronTarget = (direction: -1 | 1): number => {
    let target = wrapper.scrollLeft + direction * stepPx();
    // Land on a page boundary even when the position is mid-page.
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
    // Day pager: the anchor page; other modes: the station/forecast
    // boundary.
    const dayPage = isDayPager(card)
      ? computeTodayPagerScrollLeft({
          forecasts: card.forecasts,
          stationCount: card._stationCount || 0,
          forecastCount: card._forecastCount || 0,
          contentWidth: wrapper.scrollWidth,
          viewportWidth: wrapper.clientWidth,
        }, card.calendar)
      : null;
    const target = dayPage ?? computeInitialScrollLeft({
      stationCount: card._stationCount || 0,
      forecastCount: card._forecastCount || 0,
      contentWidth: wrapper.scrollWidth,
      viewportWidth: wrapper.clientWidth,
    });
    programmaticScrollTo(target);
  };
  // These pointerdown handlers never preventDefault, so passive is safe.
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

  // Timeline: a click centres on the clicked position, holding scrubs
  // live; the day pager rounds targets to a whole-day page.
  // stopPropagation keeps the gesture out of ha-card's tap/hold detection.
  const timeline = block ? block.querySelector<HTMLElement>('.scroll-timeline') : null;
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
      // Live scrub tracks the pointer; snapping happens on release.
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

  // Scroll events are rAF-coalesced: both consumers force layout reads
  // or canvas work. Once per frame: update the indicators and timeline
  // thumb, then `setScrollWindow` on the virtualized chart (ADR-0019).
  let scrollRafId: number | null = null;
  const onScroll = (): void => {
    // Release the snap suppression once the navigation arrives.
    if (pendingTarget !== null && Math.abs(wrapper.scrollLeft - pendingTarget) <= 2) {
      pendingTarget = null;
    }
    // Free scroll motion re-arms the snap; drags, timeline scrubs and
    // programmatic navigations snap (or stand down) on their own.
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

/** Refresh chevron, jump-to-now and timeline-thumb state. Called on
 *  scroll and after data refreshes (scrollWidth may have changed). */
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
  // Hidden within 10 % of a viewport width of `computeInitialScrollLeft`.
  // That is the non-pager "now" position; the day pager's jump target is
  // `computeTodayPagerScrollLeft`, so the two can differ there.
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
  // Positioned imperatively so the scroll path never triggers a Lit render.
  const timeline = block.querySelector<HTMLElement>('.scroll-timeline');
  if (timeline && wrapper.scrollWidth > 0) {
    const thumb = timeline.querySelector<HTMLElement>('.tl-thumb');
    if (thumb) {
      thumb.style.left = `${(wrapper.scrollLeft / wrapper.scrollWidth) * 100}%`;
      thumb.style.width = `${(wrapper.clientWidth / wrapper.scrollWidth) * 100}%`;
    }
  }
}

