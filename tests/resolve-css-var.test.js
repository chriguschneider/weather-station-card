// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { resolveCssVar } from '../src/utils/resolve-css-var.js';

afterEach(() => {
  document.body.removeAttribute('style');
  document.body.replaceChildren();
});

describe('resolveCssVar', () => {
  it('returns the default for empty input', () => {
    expect(resolveCssVar('', 'red')).toBe('red');
    expect(resolveCssVar(undefined)).toBe('');
    expect(resolveCssVar(null, 'blue')).toBe('blue');
  });

  it('passes plain colours through untouched', () => {
    expect(resolveCssVar('#abc')).toBe('#abc');
    expect(resolveCssVar('rgba(1, 2, 3, 0.5)')).toBe('rgba(1, 2, 3, 0.5)');
  });

  it('passes through var() that is not a custom property or is malformed', () => {
    expect(resolveCssVar('var(foo)')).toBe('var(foo)');
    expect(resolveCssVar('var(--x')).toBe('var(--x');
  });

  it('resolves a defined token', () => {
    document.body.style.setProperty('--wsc-test', ' #123456 ');
    expect(resolveCssVar('var(--wsc-test, red)')).toBe('#123456');
  });

  it('reads the token from the given host element', () => {
    const host = document.createElement('div');
    host.style.setProperty('--wsc-host', 'green');
    document.body.appendChild(host);
    expect(resolveCssVar('var(--wsc-host, red)', '', host)).toBe('green');
  });

  it('uses the inline fallback, commas included, when the token is unset', () => {
    expect(resolveCssVar('var(--wsc-unset, rgba(68, 115, 158, 1.0))'))
      .toBe('rgba(68, 115, 158, 1.0)');
  });

  it('uses the default when there is neither token nor fallback', () => {
    expect(resolveCssVar('var(--wsc-unset)', 'orange')).toBe('orange');
  });

  describe('nested var()', () => {
    it('resolves the outer token when it is defined', () => {
      document.body.style.setProperty('--wsc-outer', 'purple');
      expect(resolveCssVar('var(--wsc-outer, var(--wsc-inner, red))')).toBe('purple');
    });

    // Documents current behaviour: the fallback is returned verbatim,
    // an inner var() is not resolved a second time.
    it('returns an inner var() fallback unresolved when the outer is unset', () => {
      document.body.style.setProperty('--wsc-inner', 'teal');
      expect(resolveCssVar('var(--wsc-unset, var(--wsc-inner, red))'))
        .toBe('var(--wsc-inner, red)');
    });
  });
});
