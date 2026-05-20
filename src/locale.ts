// Locale registry + on-demand loader. Each language ships in its
// own chunk under `src/locales/<lang>.ts`; only English is eager so
// the card has a guaranteed fallback string for any key before the
// user's language has finished loading.
//
// Shape stays the loose dictionary we had before: keys are scalar
// strings, an inner `units` map, the 17-element `cardinalDirections`
// array, and an optional `editor` block with visual-editor labels.
// Loose-on-purpose — a tight type would force every contributor
// adding a language to fill in every editor key, and the fallback
// resolvers in `ll()` / `tEditor()` already tolerate missing keys
// at runtime.
// Types live in `./locale-types.ts` so per-language tables can
// import them without creating a cycle. Re-exported here so
// existing `import { LocaleEntry } from '../locale.js'` callers
// keep working.
export type { LocaleEntry, Locale } from './locale-types.js';
import type { LocaleEntry, Locale } from './locale-types.js';

// English is the eager fallback every other language falls back to.
// Imported statically so the registry always has a usable entry
// before any dynamic import has resolved.
import en from './locales/en.js';

// One static dynamic-import per language. Rollup expands each
// `import(...)` into its own content-hashed chunk at build time —
// a template-literal import (e.g. `./locales/${lang}.js`) would
// stay literal in the output without `@rollup/plugin-dynamic-
// import-vars`, so the explicit dictionary is the lowest-friction
// shape that still produces one-chunk-per-language. Keep the keys
// here in sync with the files under `src/locales/`.
const loaders: Record<string, () => Promise<{ default: LocaleEntry }>> = {
  bg: () => import('./locales/bg.js'),
  ca: () => import('./locales/ca.js'),
  cs: () => import('./locales/cs.js'),
  da: () => import('./locales/da.js'),
  de: () => import('./locales/de.js'),
  el: () => import('./locales/el.js'),
  es: () => import('./locales/es.js'),
  fi: () => import('./locales/fi.js'),
  fr: () => import('./locales/fr.js'),
  hu: () => import('./locales/hu.js'),
  it: () => import('./locales/it.js'),
  ko: () => import('./locales/ko.js'),
  lt: () => import('./locales/lt.js'),
  nb: () => import('./locales/nb.js'),
  nl: () => import('./locales/nl.js'),
  pl: () => import('./locales/pl.js'),
  pt: () => import('./locales/pt.js'),
  ro: () => import('./locales/ro.js'),
  ru: () => import('./locales/ru.js'),
  sk: () => import('./locales/sk.js'),
  sv: () => import('./locales/sv.js'),
  uk: () => import('./locales/uk.js'),
};

const registry: Locale = { en };

// Inflight promises so concurrent `ensureLocaleLoaded` calls for the
// same lang share one fetch. Keyed by base language tag.
const inflight = new Map<string, Promise<void>>();

// Trigger the chunk for `lang` to load and populate the registry.
// Idempotent: returns the existing promise (or a resolved one) if
// the language is already loaded or in flight.
//
// `lang` is accepted as either a base tag (`de`) or a regional
// variant (`de-CH`); both resolve to the same chunk via the base
// tag. Unknown languages resolve silently — the caller's `ll()`
// lookup will fall through to English via the same mechanism that
// covers missing keys.
export async function ensureLocaleLoaded(lang: string): Promise<void> {
  if (!lang) return;
  const baseLang = lang.split('-')[0];
  if (registry[baseLang]) return;
  const loader = loaders[baseLang];
  if (!loader) return;
  const existing = inflight.get(baseLang);
  if (existing) return existing;
  const p = loader().then(
    (m) => { registry[baseLang] = m.default; },
    () => { /* fetch / parse error — fall through to en */ },
  );
  inflight.set(baseLang, p);
  return p;
}

// Synchronous registry access for `ll()` / `tEditor()`. Reads
// return `undefined` for languages whose chunk hasn't loaded yet;
// the resolvers already cover that fallback path.
const locale: Locale = registry;
export default locale;
