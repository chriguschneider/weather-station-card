// Whole-card tap / hold / double-tap detection on the ha-card root, plus the
// action dispatcher it fires. Shares `_dragMoved` with scroll-ux so a drag
// suppresses the trailing tap. The 250 ms double-tap window matches HA's own
// action-handler. We dispatch ourselves because HA's handle-action import
// path differs between HA versions.

import { safeQuery } from './utils/safe-query.js';

const HOLD_MS = 500;
const DBL_MS = 250;

/** A configured user action: HA's `ui_action` selector output plus the
 *  aliases `service` (`perform_action`) and `service_data` (`data`). */
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

/** The part of `HomeAssistant` this module touches. */
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

// Presses on a card-internal control (mode toggle, jump-to-now, scroll
// indicators) belong to that control and must not trigger the card action.
function isCardControl(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as Element;
  return typeof el.closest === 'function'
    && el.closest('button, ha-icon-button, [role="button"]') !== null;
}

export function setupActionHandler(card: ActionHandlerCard): void {
  const haCard = safeQuery<BoundHaCard>(card.shadowRoot, 'ha-card');
  if (!haCard) return;

  // Runs on every call, before the bound guard, so an editor change flips the cursor.
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
      // A hold during a drag-to-scroll belongs to the drag.
      if (card._dragMoved) return;
      holdFired = true;
      fire('hold');
    }, HOLD_MS);
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (isCardControl(ev.target)) return;
    clearHold();
    if (holdFired) return;
    // Drag-to-scroll consumed this gesture; scroll-ux resets _dragMoved on the next macrotask.
    if (card._dragMoved) return;
    const now = Date.now();
    if (now - lastTapAt < DBL_MS) {
      // Second tap inside the window: replaces the queued single tap.
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

// Per-action handlers; `fallback` is the entity used when the action names none.

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
  // HA renamed `service` to `perform_action` in 2024.8; accept both.
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

// `perform-action` and its legacy alias `call-service` share a handler.
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

/** Dispatches a configured action through HA's event / service contract.
 *  'none' and unconfigured actions are no-ops. */
export function runAction(card: ActionHandlerCard, actionConfig: ActionConfig | undefined): void {
  if (!actionConfig?.action || actionConfig.action === 'none') return;
  const runner = ACTION_RUNNERS[actionConfig.action];
  if (!runner) return;
  const fallbackEntity = (card.config?.sensors?.temperature) || '';
  runner(card, actionConfig, fallbackEntity);
}
