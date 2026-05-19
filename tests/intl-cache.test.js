import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDateTimeFormat,
  getNumberFormat,
  _clearIntlCaches,
} from '../src/utils/intl-cache.js';

describe('intl-cache', () => {
  beforeEach(() => {
    _clearIntlCaches();
  });

  describe('getDateTimeFormat', () => {
    it('returns the same instance for identical (lang, options) pairs', () => {
      const a = getDateTimeFormat('de', { hour: '2-digit', minute: '2-digit' });
      const b = getDateTimeFormat('de', { hour: '2-digit', minute: '2-digit' });
      expect(a).toBe(b);
    });

    it('returns distinct instances for different languages', () => {
      const de = getDateTimeFormat('de', { weekday: 'short' });
      const en = getDateTimeFormat('en', { weekday: 'short' });
      expect(de).not.toBe(en);
    });

    it('returns distinct instances for different options', () => {
      const short = getDateTimeFormat('en', { weekday: 'short' });
      const long = getDateTimeFormat('en', { weekday: 'long' });
      expect(short).not.toBe(long);
    });

    it('formats correctly via the cached instance', () => {
      const fmt = getDateTimeFormat('en', { year: 'numeric' });
      const out = fmt.format(new Date('2026-05-18T12:00:00Z'));
      expect(out).toBe('2026');
    });

    it('handles undefined options', () => {
      const a = getDateTimeFormat('de');
      const b = getDateTimeFormat('de');
      expect(a).toBe(b);
    });
  });

  describe('getNumberFormat', () => {
    it('returns the same instance for identical (lang, options) pairs', () => {
      const a = getNumberFormat('en', { maximumFractionDigits: 1 });
      const b = getNumberFormat('en', { maximumFractionDigits: 1 });
      expect(a).toBe(b);
    });

    it('formats correctly via the cached instance', () => {
      const fmt = getNumberFormat('en', { maximumFractionDigits: 1 });
      expect(fmt.format(3.14159)).toBe('3.1');
    });
  });
});
