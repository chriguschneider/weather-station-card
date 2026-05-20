// Resolve a CSS `var(--token, fallback)` string against the document's
// computed style. Pass-through for plain colour strings (rgb/hex/hsl/…)
// so chart consumers don't need to care whether a default is theme-
// aware or a literal.
//
// Used by chart/orchestrator to expand the theme-aware colour defaults
// in DEFAULTS_FORECAST (e.g. `var(--info-color, rgba(68, 115, 158, 1.0))`)
// at draw time. uPlot — like Chart.js before it (ADR-0012) — takes
// resolved colour strings and does not resolve `var()` natively in
// series stroke / fill colours.

export function resolveCssVar(value: string | undefined | null, defaultFallback: string = ''): string {
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
    computed = getComputedStyle(document.body).getPropertyValue(name).trim();
  } catch {
    // SSR / non-browser environments — fall through to the inline fallback.
  }
  if (computed) return computed;
  return fallback || defaultFallback;
}
