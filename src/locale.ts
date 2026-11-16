// Locale registry + on-demand loader (ADR-0013). Each file in
// `src/locales/` is one language and one lazy chunk; only English is eager,
// as the fallback for any missing key or not-yet-loaded language.
// The shape is a loose dictionary on purpose: a tight type would force every
// new language to fill in every editor key, and `ll()` / `tEditor()` already
// tolerate missing keys. Types live in `./locale-types.ts` so the language
// files can import them without a cycle.
export type { LocaleEntry, Locale } from './locale-types.js';
import type { LocaleEntry, Locale } from './locale-types.js';

// Imported statically so the registry has an entry before any chunk loads.
import en from './locales/en.js';

// One static `import()` per language: Rollup turns each into a chunk, which a
// template-literal import would not. Keep in sync with `src/locales/`.
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
  sr: () => import('./locales/sr.js'),
  'sr-Latn': () => import('./locales/sr-Latn.js'),
  sv: () => import('./locales/sv.js'),
  uk: () => import('./locales/uk.js'),
};

const registry: Locale = { en };

// Concurrent `ensureLocaleLoaded` calls for one language share one fetch.
const inflight = new Map<string, Promise<void>>();

// Registry key for a BCP 47 tag: the most specific table we ship
// (`sr-Latn-RS` → `sr-Latn`, `de-CH` → `de`). Home Assistant reports
// Serbian Latin as `sr-Latn`, which needs its own table.
export function resolveLocaleKey(lang: string): string {
  const [base, script] = lang.split('-');
  const withScript = script ? `${base}-${script}` : base;
  return loaders[lang] ? lang : loaders[withScript] ? withScript : base;
}

// Loads the chunk for `lang` (`de` or `de-CH`) into the registry.
// Idempotent; unknown languages resolve silently and fall through to English.
export async function ensureLocaleLoaded(lang: string): Promise<void> {
  if (!lang) return;
  const key = resolveLocaleKey(lang);
  if (registry[key]) return;
  const loader = loaders[key];
  if (!loader) return;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = loader().then(
    (m) => { registry[key] = m.default; },
    () => { /* fetch / parse error — fall through to en */ },
  );
  inflight.set(key, p);
  return p;
}

// Synchronous registry access; `undefined` until a chunk has loaded.
const locale: Locale = registry;
export default locale;
