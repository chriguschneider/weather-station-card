// Caches the four CSS custom properties the chart code re-reads on
// every redraw: `--card-background-color`, `--primary-text-color`,
// `--divider-color`, `--secondary-text-color`. HA-Frontend writes
// these on `document.body` (per the Material You theming convention);
// the values are stable within a theme session, so `getComputedStyle`
// only has to run once per session per host.
//
// Why this exists: scrolling through hourly mode triggers many
// chart redraws per second. Each redraw used to call
// `getComputedStyle(document.body).getPropertyValue(...)` four
// times — a style-resolution roundtrip per call. Cached, that drops
// to one resolution per theme.
//
// Invalidation: HA-Frontend mutates `document.documentElement`'s
// `class` attribute when the user switches theme (light/dark/custom).
// A single MutationObserver on `<html>` clears the cache when the
// class list changes, so the next read sees the new tokens.

export interface ThemeTokens {
  /** `--card-background-color` */
  backgroundColor: string;
  /** `--primary-text-color` */
  textColor: string;
  /** `--divider-color` */
  dividerColor: string;
  /** `--secondary-text-color` */
  secondaryTextColor: string;
}

const cache = new WeakMap<HTMLElement, ThemeTokens>();
let observer: MutationObserver | null = null;
let observedElement: HTMLElement | null = null;

function ensureInvalidationObserver(): void {
  if (typeof MutationObserver === 'undefined') return;
  // Use the document's <html> element as the change signal — HA-Frontend
  // toggles classes there on theme switch. Body's style attribute may
  // also change inline; observe both via the html-root observer.
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root || root === observedElement) return;
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    // WeakMap has no clear(); the only realistic host is document.body,
    // so deleting that single entry is enough.
    if (typeof document !== 'undefined' && document.body) {
      cache.delete(document.body);
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
  observedElement = root;
}

function readTokens(host: HTMLElement): ThemeTokens {
  const style = (typeof getComputedStyle === 'function')
    ? getComputedStyle(host)
    : null;
  return {
    backgroundColor: style?.getPropertyValue('--card-background-color') ?? '',
    textColor: style?.getPropertyValue('--primary-text-color') ?? '',
    dividerColor: style?.getPropertyValue('--divider-color') ?? '',
    secondaryTextColor: style?.getPropertyValue('--secondary-text-color') ?? '',
  };
}

/** Returns the four theme tokens for `host`, computed lazily and
 *  memoised across calls until HA-Frontend swaps the theme.
 *
 *  `host` defaults to `document.body` (where HA-Frontend writes the
 *  card theme). Tests can pass a synthesised element to keep the
 *  read deterministic. */
export function getThemeTokens(host?: HTMLElement | null): ThemeTokens {
  const el = host ?? (typeof document !== 'undefined' ? document.body : null);
  if (!el) {
    return { backgroundColor: '', textColor: '', dividerColor: '', secondaryTextColor: '' };
  }
  const hit = cache.get(el);
  if (hit) return hit;
  const tokens = readTokens(el);
  cache.set(el, tokens);
  ensureInvalidationObserver();
  return tokens;
}

/** Force the cache to drop its entry for `host`. Exported for tests
 *  and for the rare case where a caller knows the theme just changed
 *  but the MutationObserver hasn't fired yet. */
export function invalidateThemeTokens(host?: HTMLElement | null): void {
  const el = host ?? (typeof document !== 'undefined' ? document.body : null);
  if (!el) return;
  cache.delete(el);
}
