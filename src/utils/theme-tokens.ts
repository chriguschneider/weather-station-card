// Memoises the four theme CSS variables the chart re-reads on every redraw
// (one getComputedStyle per theme per host). HA writes them on
// `document.body`, a view-level `theme:` on `hui-view-container`, so callers
// pass the card element, which inherits both.
// A MutationObserver on <html> (class, style) bumps `generation`, which
// invalidates every cached host.

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

// Entries carry the generation they were read in; the <html> observer
// bumps `generation` so every host (body or a view-themed card) goes
// stale at once. A WeakMap can be neither cleared nor enumerated.
const cache = new WeakMap<HTMLElement, { tokens: ThemeTokens; gen: number }>();
let generation = 0;
let observer: MutationObserver | null = null;
let observedElement: HTMLElement | null = null;

function ensureInvalidationObserver(): void {
  if (typeof MutationObserver === 'undefined') return;
  // <html> is the change signal: HA toggles its class / style on theme switch.
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root || root === observedElement) return;
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    generation += 1;
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

/** The four theme tokens for `host` (default `document.body`), memoised
 *  until the theme changes. */
export function getThemeTokens(host?: HTMLElement | null): ThemeTokens {
  const el = host ?? (typeof document !== 'undefined' ? document.body : null);
  if (!el) {
    return { backgroundColor: '', textColor: '', dividerColor: '', secondaryTextColor: '' };
  }
  const hit = cache.get(el);
  if (hit?.gen === generation) return hit.tokens;
  const tokens = readTokens(el);
  cache.set(el, { tokens, gen: generation });
  ensureInvalidationObserver();
  return tokens;
}

/** Drop the entry for `host`, for a caller that knows the theme just
 *  changed before the observer fired. */
export function invalidateThemeTokens(host?: HTMLElement | null): void {
  const el = host ?? (typeof document !== 'undefined' ? document.body : null);
  if (!el) return;
  cache.delete(el);
}
