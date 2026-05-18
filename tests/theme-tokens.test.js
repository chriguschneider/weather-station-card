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
});
