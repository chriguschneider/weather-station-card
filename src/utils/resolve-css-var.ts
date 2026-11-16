// Resolve a CSS `var(--token, fallback)` string against the computed style;
// plain colour strings pass through. uPlot takes resolved colour strings and
// does not resolve `var()` in series stroke / fill (ADR-0012).

/** Same as `resolveCssVar`, against an already computed style (or a lazy
 *  getter for one that may throw). */
export function resolveCssVarIn(
  value: string | undefined | null,
  defaultFallback: string,
  style: CSSStyleDeclaration | (() => CSSStyleDeclaration),
): string {
  if (!value) return defaultFallback;
  const trimmed = value.trim();
  // Cheap structural check — avoids a regex with backtracking risk on the
  // fallback portion which can contain its own commas (rgba(r, g, b, a)).
  if (!trimmed.startsWith('var(') || !trimmed.endsWith(')')) return value;
  const inner = trimmed.slice(4, -1).trim();
  const commaIdx = inner.indexOf(',');
  const name = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
  if (!name.startsWith('--')) return value;
  const fallback = commaIdx === -1 ? '' : inner.slice(commaIdx + 1).trim();
  let computed = '';
  try {
    const s = typeof style === 'function' ? style() : style;
    computed = s.getPropertyValue(name).trim();
  } catch {
    // SSR / non-browser environments — fall through to the inline fallback.
  }
  if (computed) return computed;
  return fallback || defaultFallback;
}

export function resolveCssVar(value: string | undefined | null, defaultFallback: string = '', host?: Element | null): string {
  return resolveCssVarIn(value, defaultFallback, () => getComputedStyle(host ?? document.body));
}
