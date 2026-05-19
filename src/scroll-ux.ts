// Scroll UX wiring for the forecast block: drag-to-scroll on desktop,
// left/right indicator chevrons, the jump-to-now floating button, the
// leftmost / rightmost visible-date overlay at hourly mode, and the
// indicator visibility tracking via the wrapper's scroll event.
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
import { getDateTimeFormat } from './utils/intl-cache.js';
import type { ForecastEntry } from './forecast-utils.js';

const DRAG_THRESHOLD = 5;
const STEP_BY = 0.85; // scroll about one viewport, leave a hint of overlap
const TEXT_HALF = 30; // half-width reserved so date stamps stay inside card edges

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
    // Same element, already bound — only refresh indicator visibility
    // (which depends on current scrollLeft / scrollWidth).
    updateScrollIndicators(card);
    return;
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

  const onPointerDown = (ev: PointerEvent): void => {
    isDown = true;
    dragMoved = false;
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
      wrapper.scrollLeft = startScrollLeft - dx;
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
    }
  };

  wrapper.addEventListener('pointerdown', onPointerDown);
  wrapper.addEventListener('pointermove', onPointerMove);
  wrapper.addEventListener('pointerup', onPointerEnd);
  wrapper.addEventListener('pointercancel', onPointerEnd);

  // ── Indicator + jump-to-now click ─────────────────────────────────
  // stopPropagation prevents the action handler (bound on ha-card)
  // from interpreting the indicator click as a card-level tap.
  const stopDown = (ev: Event): void => { ev.stopPropagation(); };
  const onLeftClick = (ev: Event): void => {
    ev.stopPropagation();
    wrapper.scrollBy({ left: -wrapper.clientWidth * STEP_BY, behavior: 'smooth' });
  };
  const onRightClick = (ev: Event): void => {
    ev.stopPropagation();
    wrapper.scrollBy({ left: wrapper.clientWidth * STEP_BY, behavior: 'smooth' });
  };
  const onJumpClick = (ev: Event): void => {
    ev.stopPropagation();
    const target = computeInitialScrollLeft({
      stationCount: card._stationCount || 0,
      forecastCount: card._forecastCount || 0,
      contentWidth: wrapper.scrollWidth,
      viewportWidth: wrapper.clientWidth,
    });
    wrapper.scrollTo({ left: target, behavior: 'smooth' });
  };
  if (leftBtn) {
    leftBtn.addEventListener('click', onLeftClick);
    leftBtn.addEventListener('pointerdown', stopDown);
  }
  if (rightBtn) {
    rightBtn.addEventListener('click', onRightClick);
    rightBtn.addEventListener('pointerdown', stopDown);
  }
  if (jumpBtn) {
    jumpBtn.addEventListener('click', onJumpClick);
    jumpBtn.addEventListener('pointerdown', stopDown);
  }

  // ── Indicator visibility on scroll ───────────────────────────────
  // Also nudge the chart to redraw so the dailyTickLabelsPlugin
  // recomputes its leftmost-visible date label against the new
  // scrollLeft. chart.draw() reruns all plugins (~5 ms at hourly with
  // 168 ticks); on a touch device scroll events fire at 60+ Hz, so
  // bare-bones `chart.draw()` per event would overload the main thread
  // and produce visible jank. Coalesce via requestAnimationFrame:
  // multiple scroll events between two paint frames collapse into a
  // single redraw. The latest scrollLeft is read from the wrapper
  // inside the rAF callback, so the redraw always sees the freshest
  // position even when several scroll events arrived in the same frame.
  let scrollRafId: number | null = null;
  const onScroll = (): void => {
    updateScrollIndicators(card);
    if (scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      const chart = (card as { forecastChart?: { draw?: () => void } }).forecastChart;
      if (chart && typeof chart.draw === 'function') chart.draw();
    });
  };
  wrapper.addEventListener('scroll', onScroll, { passive: true });
  updateScrollIndicators(card);

  card._scrollUxTeardown = () => {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    wrapper.removeEventListener('pointerdown', onPointerDown);
    wrapper.removeEventListener('pointermove', onPointerMove);
    wrapper.removeEventListener('pointerup', onPointerEnd);
    wrapper.removeEventListener('pointercancel', onPointerEnd);
    wrapper.removeEventListener('scroll', onScroll);
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
  updateScrollDateStamps(block, wrapper, card);
}

interface DateStampInfo {
  date: string;
  isMidnight: boolean;
}

/** At hourly: surface the date of the leftmost and rightmost visible
 *  bar by overlaying it directly above the corresponding tick — same
 *  visual style as the chart's own midnight marker (e.g. "May 6" above
 *  "00:00"). The chart only prints a date at midnight ticks, so a
 *  viewport that doesn't span 00:00 would otherwise leave the user
 *  without context which day they're looking at.
 *
 *  When the leftmost / rightmost visible IS a midnight, the chart
 *  already shows the date there — we hide our overlay to avoid a
 *  duplicate.
 *
 *  Exported for unit-test reach; the runtime call goes through
 *  `updateScrollIndicators` above. */
export function updateScrollDateStamps(
  block: HTMLElement,
  wrapper: HTMLElement,
  card: ScrollUxCard,
): void {
  const leftEl = block.querySelector<HTMLElement>('.scroll-date-left');
  const rightEl = block.querySelector<HTMLElement>('.scroll-date-right');
  if (!leftEl || !rightEl) return;

  const total = (card.forecasts ?? []).length;
  if (!total || wrapper.scrollWidth <= 0) {
    leftEl.setAttribute('hidden', '');
    rightEl.setAttribute('hidden', '');
    return;
  }

  const barWidth = wrapper.scrollWidth / total;
  if (barWidth <= 0) return;

  // floor(scrollLeft / barWidth) is the leftmost partially-visible
  // bar; floor((scrollLeft + clientWidth - 1) / barWidth) is the
  // rightmost. Each bar's tick label sits centred at (idx + 0.5) ×
  // barWidth in canvas-pixel coordinates; subtract scrollLeft to
  // map to viewport-pixel coordinates.
  const leftIdx = Math.max(0, Math.min(total - 1, Math.floor(wrapper.scrollLeft / barWidth)));
  const rightIdx = Math.max(0, Math.min(total - 1, Math.floor((wrapper.scrollLeft + wrapper.clientWidth - 1) / barWidth)));
  const rawLeftCenterX = (leftIdx + 0.5) * barWidth - wrapper.scrollLeft;
  const rawRightCenterX = (rightIdx + 0.5) * barWidth - wrapper.scrollLeft;
  const leftCenterX = Math.max(TEXT_HALF, rawLeftCenterX);
  const rightCenterX = Math.min(wrapper.clientWidth - TEXT_HALF, rawRightCenterX);

  const lang = card.config.locale || card.language || 'en';
  const dateFmt = getDateTimeFormat(lang, { day: 'numeric', month: 'short' });
  const fmt = (idx: number): DateStampInfo => {
    const item = card.forecasts ? card.forecasts[idx] : undefined;
    if (!item?.datetime) return { date: '', isMidnight: false };
    try {
      const d = new Date(item.datetime);
      const isMidnight = d.getHours() === 0 && d.getMinutes() === 0;
      return {
        date: dateFmt.format(d),
        isMidnight,
      };
    } catch (err) {
      // Malformed datetime in the forecast entry — fall back to empty
      // labels rather than letting one bad bucket break the chart.
      void err;
      return { date: '', isMidnight: false };
    }
  };

  // Collect the dates of every midnight tick that's currently inside
  // the viewport — those dates are already drawn by the chart's own
  // tick callback as a "May 6" stamp above the 00:00 tick. If our
  // edge overlay would show the same date, it's redundant.
  const visibleMidnightDates = new Set<string>();
  for (let i = leftIdx; i <= rightIdx; i++) {
    const info = fmt(i);
    if (info.isMidnight) visibleMidnightDates.add(info.date);
  }

  const leftInfo = fmt(leftIdx);
  const rightInfo = fmt(rightIdx);

  const apply = (el: HTMLElement, info: DateStampInfo, centerX: number): void => {
    if (!info.date || info.isMidnight || visibleMidnightDates.has(info.date)) {
      el.setAttribute('hidden', '');
      return;
    }
    el.textContent = info.date;
    el.style.left = `${Math.round(centerX)}px`;
    el.removeAttribute('hidden');
  };
  apply(leftEl, leftInfo, leftCenterX);
  if (rightIdx === leftIdx) rightEl.setAttribute('hidden', '');
  else apply(rightEl, rightInfo, rightCenterX);
}
