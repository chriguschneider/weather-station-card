// Whole-card action handler: pointer-based tap / hold / double-tap
// detection on the ha-card root, plus the HA-action dispatcher that
// it fires. Shares `_dragMoved` with scroll-ux so a drag-to-scroll
// suppresses the trailing tap.
//
// Why pointer events vs. plain click: we need hold detection (fires
// before pointerup) and a way to suppress the trailing tap. A 250 ms
// tap delay is required to disambiguate single from double — that's
// the same window HA's own action-handler uses.
//
// Why we don't import HA's frontend handle-action: the import path
// has changed names across HA versions; doing the dispatch ourselves
// keeps the card portable.

import { safeQuery } from './utils/safe-query.js';

const HOLD_MS = 500;
const DBL_MS = 250;

/** A single configured user action. Mirrors HA's `ui_action` selector
 *  output — every shape the editor can produce, plus a few legacy
 *  aliases (`service` for `perform_action`, `service_data` for `data`)
 *  that older YAML may carry. */
export interface ActionConfig {
  action?: 'none' | 'more-info' | 'navigate' | 'url' | 'toggle'
    | 'perform-action' | 'call-service' | 'assist' | 'fire-dom-event'
    | string;
  entity?: string;
  navigation_path?: string;
  navigation_replace?: boolean;
  url_path?: string;
  perform_action?: string;
  service?: string;
  data?: Record<string, unknown>;
  service_data?: Record<string, unknown>;
  target?: { entity_id?: string | string[]; device_id?: string | string[]; area_id?: string | string[] };
  [k: string]: unknown;
}

/** Subset of HA's `HomeAssistant` we touch: just `callService`. The
 *  full type lives in custom-card-helpers — keeping it loose here
 *  avoids a cross-cutting dependency at this layer. */
interface HassLike {
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: ActionConfig['target']): unknown;
}

/** Subset of the card the handler reads/writes. */
export interface ActionHandlerCard {
  shadowRoot: ShadowRoot | null;
  config: {
    tap_action?: ActionConfig;
    hold_action?: ActionConfig;
    double_tap_action?: ActionConfig;
    sensors?: { temperature?: string };
    [k: string]: unknown;
  } | null;
  _hass: HassLike | null;
  _dragMoved: boolean;
  _actionHandlerTeardown: (() => void) | null;
  _fire(eventName: string, detail: unknown): void;
}

interface BoundHaCard extends HTMLElement {
  _wsActionHandlerBound?: boolean;
}

// Pointer events that originate on a card-internal control button
// (mode-toggle, jump-to-now, scroll indicators) are part of that
// control's own gesture — they must NOT trigger the card-level
// tap/hold/double-tap action.
function isCardControl(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as Element;
  return typeof el.closest === 'function'
    && el.closest('button, ha-icon-button, [role="button"]') !== null;
}

export function setupActionHandler(card: ActionHandlerCard): void {
  const haCard = safeQuery<BoundHaCard>(card.shadowRoot, 'ha-card');
  if (!haCard) return;

  // Cursor reflects "is anything wired" — refresh on every call so
  // toggling tap_action in the editor flips the hand cursor on/off
  // immediately, not only on first render.
  const cfg0 = card.config ?? ({});
  const isLive = (a: ActionConfig | undefined): boolean => !!(a?.action && a.action !== 'none');
  haCard.style.cursor = (isLive(cfg0.tap_action) || isLive(cfg0.hold_action) || isLive(cfg0.double_tap_action))
    ? 'pointer' : '';

  if (haCard._wsActionHandlerBound) return;
  haCard._wsActionHandlerBound = true;

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdFired = false;
  let lastTapAt = 0;
  let pendingTap: ReturnType<typeof setTimeout> | null = null;

  const fire = (kind: 'tap' | 'hold' | 'double_tap'): void => {
    const cfg = card.config ?? ({});
    const map: Record<typeof kind, ActionConfig | undefined> = {
      tap: cfg.tap_action,
      hold: cfg.hold_action,
      double_tap: cfg.double_tap_action,
    };
    runAction(card, map[kind]);
  };

  const clearHold = (): void => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  };

  const onPointerDown = (ev: PointerEvent): void => {
    if (isCardControl(ev.target)) return;
    holdFired = false;
    clearHold();
    holdTimer = setTimeout(() => {
      // If the user has been dragging the chart to scroll, the hold
      // is part of that gesture — don't fire a hold_action for it.
      if (card._dragMoved) return;
      holdFired = true;
      fire('hold');
    }, HOLD_MS);
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (isCardControl(ev.target)) return;
    clearHold();
    if (holdFired) return;
    // Drag-to-scroll consumed this gesture; suppress the trailing tap.
    // _dragMoved is reset on the next macrotask by the scroll-ux drag
    // handler, so a fresh gesture immediately afterwards still detects
    // normally.
    if (card._dragMoved) return;
    const now = Date.now();
    if (now - lastTapAt < DBL_MS) {
      // Second tap inside the double-tap window — cancel the queued
      // single tap and fire double_tap instead.
      lastTapAt = 0;
      if (pendingTap) { clearTimeout(pendingTap); pendingTap = null; }
      fire('double_tap');
      return;
    }
    lastTapAt = now;
    pendingTap = setTimeout(() => {
      pendingTap = null;
      fire('tap');
    }, DBL_MS);
  };

  const onPointerCancel = (): void => {
    clearHold();
    holdFired = false;
  };

  haCard.addEventListener('pointerdown', onPointerDown);
  haCard.addEventListener('pointerup', onPointerUp);
  haCard.addEventListener('pointercancel', onPointerCancel);
  haCard.addEventListener('pointerleave', onPointerCancel);

  card._actionHandlerTeardown = () => {
    haCard.removeEventListener('pointerdown', onPointerDown);
    haCard.removeEventListener('pointerup', onPointerUp);
    haCard.removeEventListener('pointercancel', onPointerCancel);
    haCard.removeEventListener('pointerleave', onPointerCancel);
    clearHold();
    if (pendingTap) clearTimeout(pendingTap);
    haCard._wsActionHandlerBound = false;
  };
}

/** Dispatches a configured action via the HA frontend's standard
 *  event / service contract. Mirrors the surface the editor exposes
 *  through ha-selector ui_action: more-info, navigate, url, toggle,
 *  perform-action (a.k.a. call-service), assist, fire-dom-event.
 *  'none' / unconfigured actions are no-ops.
 *
 *  Exported so unit tests can exercise each branch without rigging up
 *  pointer-event timing; the runtime path is via the fire() closure
 *  inside `setupActionHandler` above. */
// Per-action handlers. Each takes the card + the action's config (plus the
// resolved fallback entity for actions that may target a fallback) and
// performs the side-effect. None return a value; runAction is fire-and-forget.

function _runMoreInfo(card: ActionHandlerCard, cfg: ActionConfig, fallback: string): void {
  const entityId = cfg.entity || fallback;
  if (entityId) card._fire('hass-more-info', { entityId });
}

function _runNavigate(cfg: ActionConfig): void {
  if (!cfg.navigation_path) return;
  window.history.pushState(null, '', cfg.navigation_path);
  // HA listens for `location-changed` on window to drive the router;
  // bubbles:true so it reaches the panel regardless of who fired it.
  const ev = new Event('location-changed', { bubbles: true, composed: true, cancelable: false }) as Event & { detail?: unknown };
  ev.detail = { replace: cfg.navigation_replace === true };
  window.dispatchEvent(ev);
}

// Only web links may open: a javascript: or data: URL would run in the
// dashboard's origin. Relative paths resolve against Home Assistant's own origin.
function _isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw, window.location.href);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function _runUrl(cfg: ActionConfig): void {
  if (!cfg.url_path || !_isSafeUrl(cfg.url_path)) return;
  // noopener stops the opened page from reaching back into this window.
  window.open(cfg.url_path, '_blank', 'noopener,noreferrer');
}

function _runToggle(card: ActionHandlerCard, cfg: ActionConfig, fallback: string): void {
  const entityId = cfg.entity || fallback;
  if (!entityId || !card._hass) return;
  const domain = entityId.split('.')[0];
  card._hass.callService(domain, 'toggle', { entity_id: entityId });
}

function _runService(card: ActionHandlerCard, cfg: ActionConfig): void {
  // HA renamed `service` → `perform_action` in 2024.8; keep both for
  // backwards compatibility with older YAML.
  const svc = cfg.perform_action || cfg.service;
  if (!svc || !card._hass) return;
  const dot = svc.indexOf('.');
  if (dot < 0) return;
  const domain = svc.slice(0, dot);
  const service = svc.slice(dot + 1);
  const data = cfg.data ?? cfg.service_data ?? {};
  card._hass.callService(domain, service, data, cfg.target);
}

function _runAssist(card: ActionHandlerCard, cfg: ActionConfig): void {
  card._fire('hass-action-assist', cfg);
}

function _runFireDomEvent(card: ActionHandlerCard, cfg: ActionConfig): void {
  card._fire('ll-custom', cfg);
}

// Dispatcher table — keeps runAction itself a thin dispatch instead of an
// 8-arm if/else chain. `perform-action` and the legacy `call-service` alias
// share the same handler.
type ActionRunner = (card: ActionHandlerCard, cfg: ActionConfig, fallback: string) => void;
const ACTION_RUNNERS: Record<string, ActionRunner> = {
  'more-info': _runMoreInfo,
  navigate: (_card, cfg) => _runNavigate(cfg),
  url: (_card, cfg) => _runUrl(cfg),
  toggle: _runToggle,
  'perform-action': (card, cfg) => _runService(card, cfg),
  'call-service': (card, cfg) => _runService(card, cfg),
  assist: (card, cfg) => _runAssist(card, cfg),
  'fire-dom-event': (card, cfg) => _runFireDomEvent(card, cfg),
};

export function runAction(card: ActionHandlerCard, actionConfig: ActionConfig | undefined): void {
  if (!actionConfig?.action || actionConfig.action === 'none') return;
  const runner = ACTION_RUNNERS[actionConfig.action];
  if (!runner) return;
  const fallbackEntity = (card.config?.sensors?.temperature) || '';
  runner(card, actionConfig, fallbackEntity);
}
