import { describe, it, expect } from 'vitest';
import { resolveDisplayUnits, displayNumber } from '../src/display-units.js';

const none = { temperature: [], pressure: [], speed: [], precipitation: [] };

describe('resolveDisplayUnits', () => {
  it('takes the id of a known spelling', () => {
    expect(resolveDisplayUnits({ ...none, speed: ['Bft'] }).speed).toBe('Beaufort');
  });

  it('skips a missing candidate', () => {
    expect(resolveDisplayUnits({ ...none, speed: [undefined, 'kph'] }).speed).toBe('km/h');
  });

  it('skips an unknown candidate', () => {
    expect(resolveDisplayUnits({ ...none, speed: ['foo', 'mph'] }).speed).toBe('mph');
  });

  it('falls back to the canonical units', () => {
    expect(resolveDisplayUnits(none)).toEqual({
      temperature: '°C', pressure: 'hPa', speed: 'm/s', precipitation: 'mm',
    });
  });

  it('reads a precipitation rate unit as its depth unit', () => {
    expect(resolveDisplayUnits({ ...none, precipitation: [undefined, 'in/h'] }).precipitation).toBe('in');
  });

  it('takes a depth unit as it is', () => {
    expect(resolveDisplayUnits({ ...none, precipitation: ['cm', 'in/h'] }).precipitation).toBe('cm');
  });

  it('skips an unknown precipitation unit', () => {
    expect(resolveDisplayUnits({ ...none, precipitation: ['foo/h', 'in'] }).precipitation).toBe('in');
  });
});

describe('displayNumber', () => {
  it('rounds a same-unit value without a round trip', () => {
    expect(displayNumber('speed', 30.5, 'km/h', 'km/h')).toBe(31);
  });

  it('treats two spellings of one unit as the same unit', () => {
    expect(displayNumber('speed', 30.5, 'kph', 'km/h')).toBe(31);
  });

  it('converts into another unit', () => {
    expect(displayNumber('speed', 20, 'kn', 'km/h')).toBe(37);
    expect(displayNumber('pressure', 1013, 'hPa', 'inHg')).toBe(29.91);
  });

  it('shows Beaufort as the force band', () => {
    expect(displayNumber('speed', 20, 'km/h', 'Beaufort')).toBe(4);
  });

  it('is null for an unknown unit', () => {
    expect(displayNumber('speed', 20, 'foo', 'km/h')).toBeNull();
  });

  it('is null for an unknown display unit', () => {
    expect(displayNumber('speed', 20, 'km/h', 'foo')).toBeNull();
  });
});
