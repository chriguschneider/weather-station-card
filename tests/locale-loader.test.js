import { describe, it, expect } from 'vitest';
import locale, { ensureLocaleLoaded, resolveLocaleKey } from '../src/locale.js';
import sr from '../src/locales/sr.js';
import srLatn from '../src/locales/sr-Latn.js';

describe('ensureLocaleLoaded — Serbian scripts', () => {
  it('sr loads the Cyrillic table', async () => {
    await ensureLocaleLoaded('sr');
    expect(locale.sr).toBe(sr);
  });

  it('sr-Latn loads the Latin table', async () => {
    await ensureLocaleLoaded('sr-Latn');
    expect(locale['sr-Latn']).toBe(srLatn);
  });

  it('sr-Latn-RS resolves to the Latin table', async () => {
    expect(resolveLocaleKey('sr-Latn-RS')).toBe('sr-Latn');
    expect(resolveLocaleKey('sr-RS')).toBe('sr');
    expect(resolveLocaleKey('de-CH')).toBe('de');
    await ensureLocaleLoaded('sr-Latn-RS');
    expect(locale['sr-Latn-RS']).toBeUndefined();
    expect(locale['sr-Latn']).toBe(srLatn);
  });

  it('keeps north as С in Cyrillic', () => {
    expect(sr.cardinalDirections[0]).toBe('С');
    expect(sr.cardinalDirections[8]).toBe('Ј');
  });
});
