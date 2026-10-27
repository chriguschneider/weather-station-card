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
      const a = getDateTimeFormat('de', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      const b = getDateTimeFormat('de', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      expect(a).toBe(b);
    });

    it('returns distinct instances for different languages', () => {
      const de = getDateTimeFormat('de', { weekday: 'short', timeZone: 'UTC' });
      const en = getDateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
      expect(de).not.toBe(en);
    });

    it('returns distinct instances for different options', () => {
      const short = getDateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
      const long = getDateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' });
      expect(short).not.toBe(long);
    });

    it('formats correctly via the cached instance', () => {
      const fmt = getDateTimeFormat('en', { year: 'numeric', timeZone: 'UTC' });
      const out = fmt.format(new Date('2026-05-18T12:00:00Z'));
      expect(out).toBe('2026');
    });

    it('keys on the time zone, so cards in two zones never share an instance', () => {
      const zurich = getDateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
      const denver = getDateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Denver' });
      expect(zurich).not.toBe(denver);
      const t = new Date(Date.UTC(2026, 9, 8, 15, 0));
      expect(zurich.format(t)).toBe('17:00');
      expect(denver.format(t)).toBe('09:00');
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
