// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getThemeTokens, invalidateThemeTokens } from '../src/utils/theme-tokens.js';

function setVars(el, vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

describe('getThemeTokens', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.body.removeAttribute('style');
    invalidateThemeTokens(document.body);
  });

  it('reads the four tokens off the host computed style', () => {
    setVars(document.body, {
      '--card-background-color': 'rgb(10, 20, 30)',
      '--primary-text-color': 'rgb(255, 255, 255)',
      '--divider-color': 'rgba(255, 255, 255, 0.12)',
      '--secondary-text-color': 'rgb(170, 170, 170)',
    });
    const t = getThemeTokens(document.body);
    expect(t.backgroundColor).toBe('rgb(10, 20, 30)');
    expect(t.textColor).toBe('rgb(255, 255, 255)');
    expect(t.dividerColor).toBe('rgba(255, 255, 255, 0.12)');
    expect(t.secondaryTextColor).toBe('rgb(170, 170, 170)');
  });

  it('memoises across calls on the same host (one getComputedStyle resolve per session)', () => {
    setVars(document.body, { '--primary-text-color': 'rgb(1, 2, 3)' });
    const spy = vi.spyOn(globalThis, 'getComputedStyle');
    getThemeTokens(document.body);
    getThemeTokens(document.body);
    getThemeTokens(document.body);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('invalidateThemeTokens drops the cache so the next read re-resolves', () => {
    setVars(document.body, { '--primary-text-color': 'rgb(1, 2, 3)' });
    getThemeTokens(document.body);
    invalidateThemeTokens(document.body);
    const spy = vi.spyOn(globalThis, 'getComputedStyle');
    getThemeTokens(document.body);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('returns empty strings when no host is available', () => {
    const t = getThemeTokens(null);
    expect(t.backgroundColor).toBe('');
    expect(t.secondaryTextColor).toBe('');
  });

  it('returns an empty string for a token the active theme does not define', () => {
    // A custom HA theme that omits, say, --divider-color must not crash
    // the chart code: readTokens yields '' and the draw path / CSS
    // fallbacks (Slice 6) then supply the default-theme literal.
    setVars(document.body, { '--primary-text-color': 'rgb(9, 9, 9)' });
    const t = getThemeTokens(document.body);
    expect(t.textColor).toBe('rgb(9, 9, 9)');
    expect(t.dividerColor).toBe('');
    expect(t.backgroundColor).toBe('');
    expect(t.secondaryTextColor).toBe('');
  });

  it('re-resolves to the new palette after a theme switch', () => {
    setVars(document.body, { '--primary-text-color': 'rgb(0, 0, 0)' });
    expect(getThemeTokens(document.body).textColor).toBe('rgb(0, 0, 0)');
    // Simulate HA-Frontend swapping to a dark/custom theme.
    setVars(document.body, { '--primary-text-color': 'rgb(255, 255, 255)' });
    invalidateThemeTokens(document.body);
    expect(getThemeTokens(document.body).textColor).toBe('rgb(255, 255, 255)');
  });
});
