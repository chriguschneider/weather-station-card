// Drift guard for the localized editor blocks (v2.4 editor i18n).
//
// Every locale ships an `editor` block translating the ACTIVE editor
// surface. Three checks per language:
//   1. Completeness — every key the editor actually looks up exists
//      (missing keys silently fall back to English at runtime, so a
//      forgotten key never fails loudly without this test).
//   2. Typo guard — no key unknown to en.ts (a misspelled key would
//      otherwise be dead weight that LOOKS translated).
//   3. Placeholder preservation — parameterized strings keep their
//      {tokens}, which the editor fills via String.replace.
//
// en.ts may carry extra legacy keys (kept for third-party translation
// compat) — the superset direction is deliberately not checked.

import { describe, it, expect } from 'vitest';
import en from '../src/locales/en.js';
import de from '../src/locales/de.js';
import bg from '../src/locales/bg.js';
import ca from '../src/locales/ca.js';
import cs from '../src/locales/cs.js';
import da from '../src/locales/da.js';
import el from '../src/locales/el.js';
import es from '../src/locales/es.js';
import fi from '../src/locales/fi.js';
import fr from '../src/locales/fr.js';
import hu from '../src/locales/hu.js';
import it_ from '../src/locales/it.js';
import ko from '../src/locales/ko.js';
import lt from '../src/locales/lt.js';
import nb from '../src/locales/nb.js';
import nl from '../src/locales/nl.js';
import pl from '../src/locales/pl.js';
import pt from '../src/locales/pt.js';
import ro from '../src/locales/ro.js';
import ru from '../src/locales/ru.js';
import sk from '../src/locales/sk.js';
import sr from '../src/locales/sr.js';
import srLatn from '../src/locales/sr-Latn.js';
import sv from '../src/locales/sv.js';
import uk from '../src/locales/uk.js';

const LOCALES = {
  bg, ca, cs, da, de, el, es, fi, fr, hu, it: it_,
  ko, lt, nb, nl, pl, pt, ro, ru, sk, sr, 'sr-Latn': srLatn, sv, uk,
};

// The required surface is derived from en.editor, minus two explicit,
// shrinking exclusion lists, so a key added to en is enforced in every
// language without touching this file.
//
// Legacy en.ts keys: kept for third-party translation compat, no
// current editor partial looks them up.
const LEGACY_EDITOR_KEYS = new Set([
  'setup_heading', 'sensors_heading', 'layout_heading', 'style_heading',
  'advanced_heading', 'card_setup_heading', 'weather_forecast_heading',
  'mode_question_heading', 'display_question_heading', 'appearance_heading',
  'tap_behavior_heading', 'card_heading', 'display_heading', 'chart_heading',
  'show_time', 'show_time_seconds', 'openmeteo_history',
  'disable_animation_hint', 'number_of_forecasts_hint', 'locale',
]);

// Used by the editor but not yet translated beyond en and de; they fall
// back to English. The self-check below fails once a key is fully
// translated, so this list only ever shrinks.
const PENDING_TRANSLATION = new Set([
  'location_timed_out', 'location_coordinates_changed',
  'location_coordinates_stale', 'location_determine_next',
]);

const REQUIRED_EDITOR_KEYS = Object.keys(en.editor).filter(
  (k) => !LEGACY_EDITOR_KEYS.has(k) && !PENDING_TRANSLATION.has(k),
);

const PLACEHOLDERS = {
  sunshine_availability: ['{past}', '{future}'],
  sunshine_availability_warning: ['{req}', '{gap}'],
  summary_connected: ['{n}'],
  location_determined: ['{place}'],
};

describe('locale editor blocks (parity with en)', () => {
  const enKeys = new Set(Object.keys(en.editor));

  it('the exclusion lists only name keys en knows (test self-check)', () => {
    for (const key of [...LEGACY_EDITOR_KEYS, ...PENDING_TRANSLATION]) {
      expect(enKeys.has(key), `excluded key "${key}" missing from en.ts`).toBe(true);
    }
  });

  it('every pending-translation key is still untranslated somewhere', () => {
    for (const key of PENDING_TRANSLATION) {
      const missing = Object.values(LOCALES).some((t) => typeof t.editor?.[key] !== 'string');
      expect(missing, `${key} is translated everywhere; drop it from PENDING_TRANSLATION`).toBe(true);
    }
  });

  for (const [lang, table] of Object.entries(LOCALES)) {
    it(`${lang}: editor block is complete`, () => {
      const block = table.editor;
      expect(block, `${lang} has no editor block`).toBeTruthy();
      for (const key of REQUIRED_EDITOR_KEYS) {
        expect(
          typeof block[key],
          `${lang}.editor.${key} missing (falls back to English silently)`,
        ).toBe('string');
      }
    });

    it(`${lang}: no editor keys unknown to en (typo guard)`, () => {
      for (const key of Object.keys(table.editor ?? {})) {
        expect(enKeys.has(key), `${lang}.editor.${key} is not a key en.ts knows`).toBe(true);
      }
    });

    it(`${lang}: parameterized strings keep their placeholders`, () => {
      for (const [key, tokens] of Object.entries(PLACEHOLDERS)) {
        const value = table.editor?.[key];
        if (typeof value !== 'string') continue; // completeness test covers absence
        for (const token of tokens) {
          expect(
            value.includes(token),
            `${lang}.editor.${key} lost placeholder ${token}`,
          ).toBe(true);
        }
      }
    });
  }
});
