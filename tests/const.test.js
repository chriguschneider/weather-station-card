import { describe, it, expect } from 'vitest';
import { isHaVersionBelow, MIN_HA_VERSION } from '../src/const.js';

describe('MIN_HA_VERSION', () => {
  it('is a conservative CalVer floor (YYYY.M)', () => {
    expect(MIN_HA_VERSION).toMatch(/^\d{4}\.\d{1,2}$/);
  });
});

describe('isHaVersionBelow', () => {
  it('returns true for a version older than the minimum (year)', () => {
    expect(isHaVersionBelow('2022.12', '2023.4')).toBe(true);
  });

  it('returns true for a version older than the minimum (month)', () => {
    expect(isHaVersionBelow('2023.3', '2023.4')).toBe(true);
  });

  it('returns true for a version older than the minimum (patch)', () => {
    expect(isHaVersionBelow('2023.4.0', '2023.4.1')).toBe(true);
  });

  it('returns false for a version equal to the minimum', () => {
    expect(isHaVersionBelow('2023.4', '2023.4')).toBe(false);
  });

  it('treats an absent patch as .0 when comparing equal heads', () => {
    expect(isHaVersionBelow('2023.4', '2023.4.0')).toBe(false);
    expect(isHaVersionBelow('2023.4.0', '2023.4')).toBe(false);
  });

  it('returns false for a version newer than the minimum (year)', () => {
    expect(isHaVersionBelow('2026.5', '2023.4')).toBe(false);
  });

  it('returns false for a version newer than the minimum (month)', () => {
    expect(isHaVersionBelow('2023.11', '2023.4')).toBe(false);
  });

  it('returns false for a version newer than the minimum (patch)', () => {
    expect(isHaVersionBelow('2023.4.5', '2023.4.0')).toBe(false);
  });

  it('compares double-digit months numerically, not lexically', () => {
    // Lexical "2023.10" < "2023.4" would be a false-fire bug.
    expect(isHaVersionBelow('2023.10', '2023.4')).toBe(false);
  });

  it('ignores a beta/dev suffix and treats it as the base release', () => {
    expect(isHaVersionBelow('2023.4.0b3', '2023.4')).toBe(false);
    expect(isHaVersionBelow('2023.3.0b3', '2023.4')).toBe(true);
    expect(isHaVersionBelow('2024.1.0.dev0', '2023.4')).toBe(false);
  });

  it('returns false (never warns) for missing input', () => {
    expect(isHaVersionBelow(undefined, '2023.4')).toBe(false);
    expect(isHaVersionBelow(null, '2023.4')).toBe(false);
    expect(isHaVersionBelow('', '2023.4')).toBe(false);
  });

  it('returns false (never warns) for malformed input', () => {
    expect(isHaVersionBelow('garbage', '2023.4')).toBe(false);
    expect(isHaVersionBelow('not.a.version', '2023.4')).toBe(false);
    expect(isHaVersionBelow('2023', '2023.4')).toBe(false);
    expect(isHaVersionBelow('v2023.4', '2023.4')).toBe(false);
  });

  it('returns false (never warns) for a non-string current value', () => {
    // HA could in theory hand us a non-string; helper must not throw.
    expect(isHaVersionBelow(2023, '2023.4')).toBe(false);
    expect(isHaVersionBelow({}, '2023.4')).toBe(false);
  });

  it('returns false when the minimum itself is malformed', () => {
    expect(isHaVersionBelow('2020.1', 'garbage')).toBe(false);
  });

  it('never false-fires against the declared MIN_HA_VERSION on a current release', () => {
    expect(isHaVersionBelow('2026.5', MIN_HA_VERSION)).toBe(false);
    expect(isHaVersionBelow('2024.12.4', MIN_HA_VERSION)).toBe(false);
  });
});
