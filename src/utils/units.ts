// One units table per physical quantity (ADR-0035): a value enters the
// card as its quantity's canonical unit and leaves it in a display unit.
// Factors are Home Assistant's, from homeassistant/util/unit_conversion.py:
// https://github.com/home-assistant/core/blob/a55395accc9e041e0a40b7c6e44491d20d98bf09/homeassistant/util/unit_conversion.py

export type Quantity =
  | 'temperature'
  | 'pressure'
  | 'speed'
  | 'precipitation'
  | 'precipitation_rate'
  | 'illuminance'
  | 'length'
  | 'duration';

/** A reading, or the difference between two readings. */
export type ValueKind = 'value' | 'delta';

export const CANONICAL_UNIT: Readonly<Record<Quantity, string>> = {
  temperature: '°C',
  pressure: 'hPa',
  speed: 'm/s',
  precipitation: 'mm',
  precipitation_rate: 'mm/h',
  illuminance: 'lx',
  length: 'm',
  duration: 'h',
};

interface UnitBase {
  /** Home Assistant's spelling. */
  readonly id: string;
  /** Other spellings integrations use. Ids and spellings also match
   *  without regard to case and spaces, unless `exactCase` is set. */
  readonly spellings?: readonly string[];
  readonly exactCase?: boolean;
  /** Display decimals of a reading. */
  readonly decimals: number;
}

export interface LinearUnit extends UnitBase {
  /** One of this unit is `mul / div` canonical units. Two numbers, so a
   *  ratio such as 5 / 9 or 1000 / 3600 converts without a rounded factor. */
  readonly mul: number;
  readonly div: number;
  /** This unit's reading at canonical zero. A difference ignores it. */
  readonly zero?: number;
  /** Display decimals of a difference; the reading's when unset. */
  readonly deltaDecimals?: number;
}

/** A unit without a factor (Beaufort): it converts through its own
 *  functions and has no difference. */
export interface ScaleUnit extends UnitBase {
  toCanonical(value: number): number | null;
  fromCanonical(canonical: number): number;
}

export type UnitDef = LinearUnit | ScaleUnit;

const MM_PER_INCH = 25.4; // _IN_TO_M / _MM_TO_M
const M_PER_INCH = 0.0254; // _IN_TO_M
const M_PER_FOOT = 0.3048; // _FOOT_TO_M = _IN_TO_M * 12
const M_PER_YARD = 0.9144; // _YARD_TO_M = _FOOT_TO_M * 3
const M_PER_MILE = 1609.344; // _MILE_TO_M = _YARD_TO_M * 1760
const M_PER_NAUTICAL_MILE = 1852; // _NAUTICAL_MILE_TO_M
const S_PER_HOUR = 3600; // _HRS_TO_SECS
// _MM_TO_M * 1000 * _STANDARD_GRAVITY * _MERCURY_DENSITY, and the same
// from _IN_TO_M.
const PA_PER_MMHG = 9.80665 * 13.5951;
const PA_PER_INHG = MM_PER_INCH * 9.80665 * 13.5951;

/** Daylight luminous efficacy for W/m² → lx. An approximation: daylight
 *  spans 93–120 lm/W, and 120 maps full sun (~1000 W/m²) to the clear-sky
 *  model's noon value of ~120 klx. The sun pipeline compares against
 *  clear sky, so the constant mostly cancels out. */
export const DAYLIGHT_EFFICACY_LM_PER_W = 120;

/** Upper bounds (exclusive) of Beaufort forces 0–11 in km/h; a speed at
 *  or above the last bound is force 12. These are the km/h bands of the
 *  Beaufort scale (WMO Code 1100), e.g.
 *  https://en.wikipedia.org/wiki/Beaufort_scale */
export const BEAUFORT_KMH_UPPER: readonly number[] = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];

// Read from a sensor it is HA's `SpeedConverter._beaufort_to_ms`; shown,
// it is the WMO band the speed falls in, which is what a forecast reader
// expects and differs from HA's rounded inverse at the band edges.
const BEAUFORT: ScaleUnit = {
  id: 'Beaufort',
  spellings: ['Bft'],
  decimals: 0,
  toCanonical: (force) => (force < 0 ? null : 0.836 * force ** 1.5),
  fromCanonical: (metresPerSecond) => {
    const kmh = metresPerSecond * S_PER_HOUR / 1000;
    const force = BEAUFORT_KMH_UPPER.findIndex((upper) => kmh < upper);
    return force === -1 ? BEAUFORT_KMH_UPPER.length : force;
  },
};

const INCH_SPELLINGS = ['inch', 'inches', '"'];

// Integrations outside HA's unit enum write an hourly rate as `/hr` or
// `/hour`.
const perHour = (bases: readonly string[]): string[] =>
  bases.flatMap((base) => ['/h', '/hr', '/hour'].map((suffix) => base + suffix));

export const UNITS: Readonly<Record<Quantity, readonly UnitDef[]>> = {
  // TemperatureConverter; its 1.8 is written as 9 / 5.
  temperature: [
    { id: '°C', mul: 1, div: 1, decimals: 1, spellings: ['C', '℃'] },
    { id: '°F', mul: 5, div: 9, zero: 32, decimals: 1, spellings: ['F', '℉'] },
    { id: 'K', mul: 1, div: 1, zero: 273.15, decimals: 1 },
  ],
  // PressureConverter. Its base is Pa: a row with `div: 100` has `mul`
  // in Pa.
  pressure: [
    { id: 'hPa', mul: 1, div: 1, decimals: 0, deltaDecimals: 1 },
    { id: 'mbar', mul: 1, div: 1, decimals: 0, deltaDecimals: 1 },
    { id: 'Pa', mul: 1, div: 100, decimals: 0 },
    // `MPa` is a unit of its own, 10⁹ times larger.
    { id: 'mPa', mul: 1, div: 100000, decimals: 0, exactCase: true },
    { id: 'kPa', mul: 10, div: 1, decimals: 1, deltaDecimals: 2 },
    { id: 'cbar', mul: 10, div: 1, decimals: 1 },
    { id: 'bar', mul: 1000, div: 1, decimals: 3 },
    { id: 'inHg', mul: PA_PER_INHG, div: 100, decimals: 2 },
    { id: 'mmHg', mul: PA_PER_MMHG, div: 100, decimals: 0, deltaDecimals: 1 },
    { id: 'inH₂O', mul: 249.0889083333348, div: 100, decimals: 1 },
    { id: 'psi', mul: 6894.757, div: 100, decimals: 2 },
    { id: 'atm', mul: 101325, div: 100, decimals: 3 },
  ],
  // SpeedConverter's UnitOfSpeed units.
  speed: [
    { id: 'm/s', mul: 1, div: 1, decimals: 0, spellings: ['mps'] },
    { id: 'km/h', mul: 1000, div: S_PER_HOUR, decimals: 0, spellings: ['kph', 'kmh', 'km/hr'] },
    { id: 'mph', mul: M_PER_MILE, div: S_PER_HOUR, decimals: 0 },
    { id: 'kn', mul: M_PER_NAUTICAL_MILE, div: S_PER_HOUR, decimals: 0, spellings: ['kt', 'kts', 'knots'] },
    { id: 'ft/s', mul: M_PER_FOOT, div: 1, decimals: 0 },
    { id: 'in/s', mul: M_PER_INCH, div: 1, decimals: 0 },
    { id: 'm/min', mul: 1, div: 60, decimals: 0 },
    { id: 'mm/s', mul: 1, div: 1000, decimals: 0 },
    BEAUFORT,
  ],
  // UnitOfPrecipitationDepth, with DistanceConverter's factors.
  precipitation: [
    { id: 'mm', mul: 1, div: 1, decimals: 1 },
    { id: 'cm', mul: 10, div: 1, decimals: 2 },
    { id: 'in', mul: MM_PER_INCH, div: 1, decimals: 2, spellings: INCH_SPELLINGS },
  ],
  // SpeedConverter's UnitOfVolumetricFlux units.
  precipitation_rate: [
    { id: 'mm/h', mul: 1, div: 1, decimals: 1, spellings: perHour(['mm']) },
    { id: 'mm/d', mul: 1, div: 24, decimals: 1 },
    { id: 'in/h', mul: MM_PER_INCH, div: 1, decimals: 2, spellings: perHour(['in', ...INCH_SPELLINGS]) },
    { id: 'in/d', mul: MM_PER_INCH, div: 24, decimals: 2 },
  ],
  // `lx` is HA's LIGHT_LUX; irradiance is no illuminance and comes in
  // through DAYLIGHT_EFFICACY_LM_PER_W.
  illuminance: [
    { id: 'lx', mul: 1, div: 1, decimals: 0, spellings: ['lux'] },
    {
      id: 'W/m²', mul: DAYLIGHT_EFFICACY_LM_PER_W, div: 1, decimals: 0,
      spellings: ['W/m2', 'W/㎡', 'Wm-2', 'W*m-2'],
    },
  ],
  // DistanceConverter.
  length: [
    { id: 'm', mul: 1, div: 1, decimals: 0, spellings: ['meter', 'metre', 'meters', 'metres'] },
    { id: 'km', mul: 1000, div: 1, decimals: 3 },
    { id: 'cm', mul: 1, div: 100, decimals: 0 },
    { id: 'mm', mul: 1, div: 1000, decimals: 0 },
    { id: 'ft', mul: M_PER_FOOT, div: 1, decimals: 0, spellings: ['feet'] },
    { id: 'yd', mul: M_PER_YARD, div: 1, decimals: 0 },
    { id: 'mi', mul: M_PER_MILE, div: 1, decimals: 3 },
    { id: 'in', mul: M_PER_INCH, div: 1, decimals: 0 },
    { id: 'nmi', mul: M_PER_NAUTICAL_MILE, div: 1, decimals: 3 },
  ],
  // DurationConverter, from seconds up to days.
  duration: [
    { id: 'h', mul: 1, div: 1, decimals: 1 },
    { id: 'min', mul: 1, div: 60, decimals: 0 },
    { id: 's', mul: 1, div: S_PER_HOUR, decimals: 0 },
    { id: 'd', mul: 24, div: 1, decimals: 2 },
  ],
};

interface UnitIndex {
  exact: Map<string, UnitDef>;
  folded: Map<string, UnitDef>;
}

// Templates and integrations write `KM/H`, `mm Hg` or `W / m²`, so a
// second lookup ignores case and spaces.
const fold = (text: string): string => text.toLowerCase().replace(/\s+/g, '');

function buildIndex(defs: readonly UnitDef[]): UnitIndex {
  const index: UnitIndex = { exact: new Map(), folded: new Map() };
  for (const def of defs) {
    for (const spelling of [def.id, ...(def.spellings ?? [])]) {
      index.exact.set(spelling, def);
      if (!def.exactCase) index.folded.set(fold(spelling), def);
    }
  }
  return index;
}

const INDEX = Object.fromEntries(
  Object.entries(UNITS).map(([quantity, defs]) => [quantity, buildIndex(defs)]),
) as Record<Quantity, UnitIndex>;

const isLinear = (def: UnitDef): def is LinearUnit => 'mul' in def;
const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

function resolve(quantity: Quantity, raw: unknown): UnitDef | null {
  if (typeof raw !== 'string') return null;
  const { exact, folded } = INDEX[quantity];
  const text = raw.trim();
  return exact.get(text) ?? folded.get(fold(text)) ?? null;
}

/** The unit's id, or null when it is missing or not a unit of the
 *  quantity. */
export function parseUnit(quantity: Quantity, raw: unknown): string | null {
  return resolve(quantity, raw)?.id ?? null;
}

/** A reading in `unit` as the quantity's canonical unit, unrounded. Null
 *  for an unknown unit or a non-finite value: an unknown unit is never
 *  read as another one. */
export function toCanonical(quantity: Quantity, value: number | null | undefined, unit: unknown): number | null {
  const def = resolve(quantity, unit);
  if (!def || !isFiniteNumber(value)) return null;
  if (!isLinear(def)) return def.toCanonical(value);
  return (value - (def.zero ?? 0)) * def.mul / def.div;
}

/** Inverse of `toCanonical`. For Beaufort the result is the force 0–12. */
export function fromCanonical(quantity: Quantity, value: number | null | undefined, unit: unknown): number | null {
  const def = resolve(quantity, unit);
  if (!def || !isFiniteNumber(value)) return null;
  if (!isLinear(def)) return def.fromCanonical(value);
  const scaled = value * def.div / def.mul;
  // No `+ 0` for a unit without a zero point: it would turn -0 into 0.
  return def.zero === undefined ? scaled : scaled + def.zero;
}

/** A difference in `unit` as the canonical unit: the factor only, no
 *  zero point (a 10 °F spread is 5.56 °C). Null for Beaufort. */
export function deltaToCanonical(quantity: Quantity, delta: number | null | undefined, unit: unknown): number | null {
  const def = resolve(quantity, unit);
  if (!def || !isLinear(def) || !isFiniteNumber(delta)) return null;
  return delta * def.mul / def.div;
}

/** Inverse of `deltaToCanonical`. */
export function deltaFromCanonical(quantity: Quantity, delta: number | null | undefined, unit: unknown): number | null {
  const def = resolve(quantity, unit);
  if (!def || !isLinear(def) || !isFiniteNumber(delta)) return null;
  return delta * def.div / def.mul;
}

/** Decimals the card shows for a reading or a difference in `unit`. */
export function displayDecimals(quantity: Quantity, unit: unknown, kind: ValueKind = 'value'): number | null {
  const def = resolve(quantity, unit);
  if (!def) return null;
  if (kind === 'value') return def.decimals;
  return isLinear(def) ? def.deltaDecimals ?? def.decimals : null;
}

/** A number already in `unit`, rounded to that unit's decimals. */
export function roundForDisplay(
  quantity: Quantity,
  value: number | null | undefined,
  unit: unknown,
  kind: ValueKind = 'value',
): number | null {
  const decimals = displayDecimals(quantity, unit, kind);
  if (decimals === null || !isFiniteNumber(value)) return null;
  const scale = 10 ** decimals;
  const rounded = Math.round(value * scale) / scale;
  // A small negative rounds to -0, which Intl.NumberFormat prints as "-0".
  return rounded === 0 ? 0 : rounded;
}

/** The exit: a canonical reading or difference in the display unit,
 *  rounded. Number formatting and the unit label stay with the caller. */
export function toDisplay(
  quantity: Quantity,
  canonical: number | null | undefined,
  unit: unknown,
  kind: ValueKind = 'value',
): number | null {
  const convert = kind === 'delta' ? deltaFromCanonical : fromCanonical;
  return roundForDisplay(quantity, convert(quantity, canonical, unit), unit, kind);
}
