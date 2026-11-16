// Units table (ADR-0035): src/utils/units.ts. Table-driven: every unit
// of every quantity round-trips, every spelling resolves, an unknown
// unit or a non-finite value is null, and the reference values hold.

import { describe, it, expect } from 'vitest';
import {
  UNITS,
  CANONICAL_UNIT,
  BEAUFORT_KMH_UPPER,
  DAYLIGHT_EFFICACY_LM_PER_W,
  parseUnit,
  toCanonical,
  fromCanonical,
  deltaToCanonical,
  deltaFromCanonical,
  displayDecimals,
  roundForDisplay,
  toDisplay,
} from '../src/utils/units.js';

const QUANTITIES = Object.keys(UNITS);
const ALL_UNITS = QUANTITIES.flatMap((quantity) => UNITS[quantity].map((def) => [quantity, def.id, def]));
const LINEAR_UNITS = ALL_UNITS.filter(([, , def]) => 'mul' in def);

// Relative float error allowed after converting there and back.
const ROUND_TRIP_TOLERANCE = 1e-12;
const SAMPLES = [-40, -1.4, 0, 0.3, 12.5, 68, 1013.25];

const convert = (quantity, value, from, to) =>
  fromCanonical(quantity, toCanonical(quantity, value, from), to);

describe('units table', () => {
  // Home Assistant's ids at the commit the module cites.
  const HA_UNITS = {
    temperature: ['°C', '°F', 'K'],
    pressure: ['mPa', 'Pa', 'hPa', 'kPa', 'bar', 'cbar', 'mbar', 'inHg', 'inH₂O', 'psi', 'mmHg', 'atm'],
    speed: ['Beaufort', 'ft/s', 'in/s', 'm/min', 'm/s', 'km/h', 'kn', 'mph', 'mm/s'],
    precipitation: ['in', 'mm', 'cm'],
    precipitation_rate: ['in/d', 'in/h', 'mm/d', 'mm/h'],
    illuminance: ['lx', 'W/m²'],
    length: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'nmi'],
    duration: ['s', 'min', 'h', 'd'],
  };

  it.each(Object.entries(HA_UNITS))('%s holds exactly Home Assistant\'s units', (quantity, ids) => {
    expect(UNITS[quantity].map((def) => def.id).sort()).toEqual([...ids].sort());
  });

  it.each(Object.entries(CANONICAL_UNIT))('%s: the canonical unit %s converts to itself', (quantity, unit) => {
    expect(parseUnit(quantity, unit)).toBe(unit);
    for (const x of SAMPLES) {
      expect(toCanonical(quantity, x, unit)).toBe(x);
      expect(fromCanonical(quantity, x, unit)).toBe(x);
    }
  });

  it.each(LINEAR_UNITS)('%s %s round-trips', (quantity, unit) => {
    for (const x of SAMPLES) {
      const back = fromCanonical(quantity, toCanonical(quantity, x, unit), unit);
      expect(Math.abs(back - x)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE * Math.max(1, Math.abs(x)));
      const deltaBack = deltaFromCanonical(quantity, deltaToCanonical(quantity, x, unit), unit);
      expect(Math.abs(deltaBack - x)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE * Math.max(1, Math.abs(x)));
    }
  });

  it('Beaufort round-trips every force', () => {
    for (let force = 0; force <= 12; force++) {
      expect(fromCanonical('speed', toCanonical('speed', force, 'Beaufort'), 'Beaufort')).toBe(force);
    }
  });
});

describe('parseUnit', () => {
  it.each(ALL_UNITS)('%s %s: id and spellings resolve', (quantity, id, def) => {
    for (const spelling of [id, ...(def.spellings ?? [])]) {
      expect(parseUnit(quantity, spelling)).toBe(id);
      expect(parseUnit(quantity, `  ${spelling}\t`)).toBe(id);
    }
  });

  // The spellings integrations and templates use beyond HA's ids.
  it.each([
    ['temperature', 'C', '°C'], ['temperature', '℃', '°C'],
    ['temperature', 'F', '°F'], ['temperature', '℉', '°F'],
    ['speed', 'kph', 'km/h'], ['speed', 'kmh', 'km/h'], ['speed', 'km/hr', 'km/h'],
    ['speed', 'mps', 'm/s'],
    ['speed', 'kt', 'kn'], ['speed', 'kts', 'kn'], ['speed', 'knots', 'kn'],
    ['speed', 'Bft', 'Beaufort'],
    ['precipitation', 'inch', 'in'], ['precipitation', 'inches', 'in'], ['precipitation', '"', 'in'],
    ['precipitation_rate', 'mm/hr', 'mm/h'], ['precipitation_rate', 'mm/hour', 'mm/h'],
    ['precipitation_rate', 'in/hr', 'in/h'], ['precipitation_rate', 'in/hour', 'in/h'],
    ['precipitation_rate', 'inch/h', 'in/h'], ['precipitation_rate', 'inches/hr', 'in/h'],
    ['precipitation_rate', '"/h', 'in/h'],
    ['pressure', 'mm Hg', 'mmHg'],
    ['illuminance', 'lux', 'lx'],
    ['illuminance', 'W/m2', 'W/m²'], ['illuminance', 'W/㎡', 'W/m²'],
    ['illuminance', 'Wm-2', 'W/m²'], ['illuminance', 'W*m-2', 'W/m²'],
    ['length', 'feet', 'ft'],
    ['length', 'meter', 'm'], ['length', 'metre', 'm'], ['length', 'meters', 'm'], ['length', 'metres', 'm'],
  ])('%s: "%s" is %s', (quantity, spelling, id) => {
    expect(parseUnit(quantity, spelling)).toBe(id);
  });

  it.each([
    ['speed', 'KM/H', 'km/h'], ['speed', 'MPH', 'mph'], ['speed', 'Knots', 'kn'],
    ['speed', 'km / h', 'km/h'],
    ['precipitation', 'IN', 'in'], ['precipitation', 'Inches', 'in'],
    ['precipitation_rate', 'IN/H', 'in/h'], ['precipitation_rate', 'MM/Hr', 'mm/h'],
    ['illuminance', 'W / M²', 'W/m²'], ['illuminance', 'LUX', 'lx'],
    ['pressure', 'HPA', 'hPa'], ['pressure', 'inhg', 'inHg'],
    ['temperature', '°f', '°F'],
    ['length', 'Feet', 'ft'],
  ])('%s: "%s" matches without regard to case and spaces', (quantity, spelling, id) => {
    expect(parseUnit(quantity, spelling)).toBe(id);
  });

  it('keeps mPa apart from MPa', () => {
    expect(parseUnit('pressure', 'mPa')).toBe('mPa');
    expect(parseUnit('pressure', 'MPa')).toBeNull();
    expect(parseUnit('pressure', 'mpa')).toBeNull();
    expect(toCanonical('pressure', 1, 'MPa')).toBeNull();
  });

  it.each(QUANTITIES)('%s: no two units share a spelling once case and spaces are ignored', (quantity) => {
    const owner = new Map();
    for (const def of UNITS[quantity]) {
      for (const spelling of [def.id, ...(def.spellings ?? [])]) {
        const key = spelling.toLowerCase().replace(/\s+/g, '');
        expect(owner.get(key) ?? def.id).toBe(def.id);
        owner.set(key, def.id);
      }
    }
  });
});

describe('unknown and missing units', () => {
  const NOT_A_UNIT = ['', '   ', 'furlong', undefined, null, 42, true, {}, ['m/s']];

  it.each(QUANTITIES)('%s: null from every function', (quantity) => {
    for (const unit of NOT_A_UNIT) {
      expect(parseUnit(quantity, unit)).toBeNull();
      expect(toCanonical(quantity, 20, unit)).toBeNull();
      expect(fromCanonical(quantity, 20, unit)).toBeNull();
      expect(deltaToCanonical(quantity, 20, unit)).toBeNull();
      expect(deltaFromCanonical(quantity, 20, unit)).toBeNull();
      expect(displayDecimals(quantity, unit)).toBeNull();
      expect(roundForDisplay(quantity, 20, unit)).toBeNull();
      expect(toDisplay(quantity, 20, unit)).toBeNull();
    }
  });

  it('a unit of another quantity is unknown, not passed through', () => {
    expect(toCanonical('pressure', 20, 'kn')).toBeNull();
    expect(toCanonical('speed', 1013, 'hPa')).toBeNull();
    expect(toCanonical('precipitation', 2, 'mm/h')).toBeNull();
    expect(toCanonical('precipitation_rate', 2, 'mm')).toBeNull();
    expect(toCanonical('duration', 2, 'm')).toBeNull();
    expect(toCanonical('temperature', 20, '%')).toBeNull();
  });
});

describe('non-finite values', () => {
  it.each(ALL_UNITS)('%s %s: null', (quantity, unit) => {
    for (const value of [NaN, Infinity, -Infinity, null, undefined, '20']) {
      expect(toCanonical(quantity, value, unit)).toBeNull();
      expect(fromCanonical(quantity, value, unit)).toBeNull();
      expect(deltaToCanonical(quantity, value, unit)).toBeNull();
      expect(deltaFromCanonical(quantity, value, unit)).toBeNull();
      expect(roundForDisplay(quantity, value, unit)).toBeNull();
      expect(toDisplay(quantity, value, unit)).toBeNull();
    }
  });
});

describe('reference values', () => {
  // [quantity, value, unit, expected, expected unit, absolute tolerance].
  // A tolerance of half the last printed digit means the reference is
  // itself a rounded figure (29.92 inHg, 10.29 m/s).
  const EXACT = 1e-9;
  it.each([
    ['pressure', 1013.25, 'hPa', 29.92, 'inHg', 0.005],
    ['pressure', 1013.25, 'hPa', 760, 'mmHg', 0.001],
    ['pressure', 1013.25, 'hPa', 101.325, 'kPa', EXACT],
    ['pressure', 1013.25, 'hPa', 1013.25, 'mbar', 0],
    ['pressure', 1013.25, 'hPa', 101325, 'Pa', EXACT],
    ['pressure', 1013.25, 'hPa', 1, 'atm', EXACT],
    ['pressure', 1013.25, 'hPa', 1.01325, 'bar', EXACT],
    ['pressure', 1013.25, 'hPa', 101.325, 'cbar', EXACT],
    ['pressure', 1013.25, 'hPa', 14.696, 'psi', 0.0005],
    ['pressure', 1, 'hPa', 100000, 'mPa', EXACT],
    ['pressure', 1, 'inH₂O', 249.0889083333348, 'Pa', EXACT],
    ['pressure', 29.92, 'inHg', 1013.2, 'hPa', 0.05],
    ['speed', 20, 'kn', 37.04, 'km/h', EXACT],
    ['speed', 20, 'kn', 10.29, 'm/s', 0.005],
    ['speed', 1, 'mph', 0.44704, 'm/s', EXACT],
    ['speed', 36, 'km/h', 10, 'm/s', EXACT],
    ['speed', 60, 'm/min', 1, 'm/s', EXACT],
    ['speed', 1, 'ft/s', 304.8, 'mm/s', EXACT],
    ['speed', 1, 'ft/s', 12, 'in/s', EXACT],
    ['temperature', 68, '°F', 20, '°C', 0],
    ['temperature', 20, '°C', 293.15, 'K', EXACT],
    ['temperature', 68, '°F', 293.15, 'K', EXACT],
    ['temperature', -40, '°F', -40, '°C', 0],
    ['precipitation', 1, 'in', 25.4, 'mm', 0],
    ['precipitation', 1, 'in', 2.54, 'cm', EXACT],
    ['precipitation_rate', 1, 'in/h', 25.4, 'mm/h', 0],
    ['precipitation_rate', 24, 'mm/d', 1, 'mm/h', 0],
    ['precipitation_rate', 24, 'in/d', 25.4, 'mm/h', EXACT],
    ['duration', 45, 'min', 0.75, 'h', 0],
    ['duration', 2700, 's', 0.75, 'h', 0],
    ['duration', 1, 'd', 24, 'h', 0],
    ['length', 1000, 'ft', 304.8, 'm', EXACT],
    ['length', 1, 'mi', 1609.344, 'm', 0],
    ['length', 1, 'nmi', 1852, 'm', 0],
    ['length', 1, 'yd', 3, 'ft', EXACT],
    ['length', 1, 'ft', 12, 'in', EXACT],
    ['length', 1, 'km', 100000, 'cm', EXACT],
    ['length', 1, 'm', 1000, 'mm', EXACT],
    ['illuminance', 1000, 'W/m²', 120000, 'lx', 0],
  ])('%s: %d %s = %d %s', (quantity, value, from, expected, to, tolerance) => {
    expect(Math.abs(convert(quantity, value, from, to) - expected)).toBeLessThanOrEqual(tolerance);
  });

  it('the daylight efficacy and the Beaufort bands', () => {
    expect(DAYLIGHT_EFFICACY_LM_PER_W).toBe(120);
    expect(BEAUFORT_KMH_UPPER).toEqual([1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]);
  });
});

describe('differences', () => {
  it('ignore the temperature offset', () => {
    expect(deltaFromCanonical('temperature', 10, '°F')).toBe(18);
    expect(fromCanonical('temperature', 10, '°F')).toBe(50);
    expect(deltaToCanonical('temperature', 18, '°F')).toBe(10);
    expect(deltaFromCanonical('temperature', 10, 'K')).toBe(10);
    expect(deltaToCanonical('temperature', 10, 'K')).toBe(10);
  });

  it('convert with the factor of the unit', () => {
    expect(deltaFromCanonical('pressure', -1.4, 'hPa')).toBe(-1.4);
    expect(deltaFromCanonical('pressure', -1.4, 'kPa')).toBeCloseTo(-0.14, 12);
    expect(deltaToCanonical('length', 1, 'ft')).toBe(0.3048);
  });

  it('do not exist in Beaufort', () => {
    expect(deltaToCanonical('speed', 2, 'Beaufort')).toBeNull();
    expect(deltaFromCanonical('speed', 2, 'Bft')).toBeNull();
    expect(displayDecimals('speed', 'Bft', 'delta')).toBeNull();
    expect(roundForDisplay('speed', 2, 'Bft', 'delta')).toBeNull();
    expect(toDisplay('speed', 2, 'Bft', 'delta')).toBeNull();
  });
});

describe('Beaufort', () => {
  it.each(BEAUFORT_KMH_UPPER.map((kmh, force) => [kmh, force]))(
    'shown: %d km/h is where force %d ends',
    (kmh, force) => {
      expect(fromCanonical('speed', toCanonical('speed', kmh - 0.01, 'km/h'), 'Bft')).toBe(force);
      expect(fromCanonical('speed', toCanonical('speed', kmh, 'km/h'), 'Bft')).toBe(force + 1);
    },
  );

  it('shown: calm is 0, a hurricane stays 12', () => {
    expect(fromCanonical('speed', 0, 'Bft')).toBe(0);
    expect(fromCanonical('speed', toCanonical('speed', 250, 'km/h'), 'Bft')).toBe(12);
  });

  it('as a source: Home Assistant\'s 0.836 · B^1.5 in m/s', () => {
    expect(toCanonical('speed', 0, 'Beaufort')).toBe(0);
    expect(toCanonical('speed', 1, 'Beaufort')).toBe(0.836);
    expect(toCanonical('speed', 4, 'Beaufort')).toBeCloseTo(6.688, 12);
    expect(toCanonical('speed', 7, 'Bft')).toBeCloseTo(15.483, 3);
    expect(convert('speed', 4, 'Beaufort', 'km/h')).toBeCloseTo(24.0768, 9);
  });

  it('as a source: a negative force is no speed', () => {
    expect(toCanonical('speed', -1, 'Beaufort')).toBeNull();
  });
});

describe('display decimals', () => {
  // The decimals the live panel and the zero-degree rows print.
  it.each([
    ['pressure', 'hPa', 0], ['pressure', 'mmHg', 0], ['pressure', 'inHg', 2],
    ['precipitation', 'in', 2], ['precipitation', 'mm', 1],
    ['precipitation_rate', 'in/h', 2], ['precipitation_rate', 'mm/h', 1],
    ['temperature', '°C', 1], ['temperature', '°F', 1],
    ['length', 'm', 0], ['length', 'ft', 0],
  ])('%s %s: %d for a reading', (quantity, unit, decimals) => {
    expect(displayDecimals(quantity, unit)).toBe(decimals);
    expect(displayDecimals(quantity, unit, 'value')).toBe(decimals);
  });

  it('speed has no decimals in any unit', () => {
    for (const def of UNITS.speed) expect(displayDecimals('speed', def.id)).toBe(0);
  });

  const DELTA_DECIMALS = {
    'pressure hPa': 1, 'pressure mbar': 1, 'pressure mmHg': 1, 'pressure inHg': 2, 'pressure kPa': 2,
    'temperature °C': 1, 'temperature °F': 1, 'temperature K': 1,
  };

  it.each(LINEAR_UNITS)('%s %s: a difference has its own decimals or the reading\'s', (quantity, unit) => {
    const expected = DELTA_DECIMALS[`${quantity} ${unit}`] ?? displayDecimals(quantity, unit);
    expect(displayDecimals(quantity, unit, 'delta')).toBe(expected);
  });

  it('every pressure unit resolves 1 hPa or finer (mmHg: 1.33 hPa)', () => {
    for (const def of UNITS.pressure) {
      const step = toCanonical('pressure', 10 ** -def.decimals, def.id);
      expect(step).toBeLessThanOrEqual(1.4);
    }
  });
});

describe('roundForDisplay and toDisplay', () => {
  it('reproduce the pressure row', () => {
    expect(roundForDisplay('pressure', 1013.4, 'hPa')).toBe(1013);
    expect(roundForDisplay('pressure', 1013.5, 'hPa')).toBe(1014);
    expect(roundForDisplay('pressure', 29.917, 'inHg')).toBe(29.92);
    expect(roundForDisplay('pressure', 759.6, 'mmHg')).toBe(760);
    expect(toDisplay('pressure', 1013.25, 'inHg')).toBe(29.92);
    expect(toDisplay('pressure', 1013.25, 'mmHg')).toBe(760);
    expect(toDisplay('pressure', 1013.25, 'kPa')).toBe(101.3);
  });

  it('keep the decimals of a pressure change', () => {
    expect(roundForDisplay('pressure', -1.4, 'hPa', 'delta')).toBe(-1.4);
    expect(toDisplay('pressure', -1.4, 'hPa', 'delta')).toBe(-1.4);
    expect(toDisplay('pressure', -1.4, 'inHg', 'delta')).toBe(-0.04);
    expect(toDisplay('pressure', -1.4, 'mmHg', 'delta')).toBe(-1.1);
    expect(toDisplay('pressure', -1.4, 'kPa', 'delta')).toBe(-0.14);
  });

  it('convert a reading with the offset and a difference without', () => {
    expect(toDisplay('temperature', 10, '°F')).toBe(50);
    expect(toDisplay('temperature', 10, '°F', 'delta')).toBe(18);
    expect(toDisplay('temperature', 21.44, '°C')).toBe(21.4);
  });

  it('cover the other quantities', () => {
    expect(toDisplay('speed', 10.2889, 'kn')).toBe(20);
    expect(toDisplay('speed', 10.2889, 'Bft')).toBe(5);
    expect(toDisplay('precipitation', 2.54, 'in')).toBe(0.1);
    expect(toDisplay('precipitation_rate', 12.34, 'mm/h')).toBe(12.3);
    expect(toDisplay('length', 1586, 'ft')).toBe(5203);
    expect(toDisplay('duration', 0.75, 'min')).toBe(45);
    expect(toDisplay('illuminance', 120000, 'W/m²')).toBe(1000);
  });

  it('never returns -0', () => {
    expect(Object.is(roundForDisplay('pressure', -0.004, 'inHg', 'delta'), 0)).toBe(true);
    expect(Object.is(roundForDisplay('pressure', -0.4, 'hPa'), 0)).toBe(true);
    expect(Object.is(toDisplay('temperature', -0.04, '°C'), 0)).toBe(true);
  });
});
