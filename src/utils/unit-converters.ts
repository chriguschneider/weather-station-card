// Pure unit-conversion helpers used by the live-attributes block.
//
// Wind / pressure tables are keyed by `targetUnit->sourceUnit`. Beaufort
// and same-unit cases are short-circuited inside the converters and
// never index into the tables.

/** Wind-speed conversion factors. multiply source-unit value by the
 *  factor for `target->source` to get the value in the target unit. */
export const WIND_CONVERSION: Record<string, number> = {
  'm/s->km/h': 1000 / 3600,
  'm/s->mph': 0.44704,
  'km/h->m/s': 3.6,
  'km/h->mph': 1.60934,
  'mph->m/s': 1 / 0.44704,
  'mph->km/h': 1 / 1.60934,
};

/** Pressure conversion factors, same scheme as WIND_CONVERSION. */
export const PRESSURE_CONVERSION: Record<string, number> = {
  'mmHg->hPa': 0.75006,
  'mmHg->inHg': 25.4,
  'hPa->mmHg': 1 / 0.75006,
  'hPa->inHg': 33.8639,
  'inHg->mmHg': 1 / 25.4,
  'inHg->hPa': 1 / 33.8639,
};

/** Normalise a wind speed to metres per second for the condition
 *  classifier, whose thresholds (`exceptional_gust_ms`,
 *  `windy_threshold_ms`, …) are defined in m/s. The classifier itself is
 *  unit-blind, so a source value in km/h or mph MUST be converted here
 *  before it reaches `classifyDay` — otherwise a moderate breeze read in
 *  km/h (e.g. 31 km/h ≈ 8.6 m/s) trips the 24.5 m/s exceptional-gust
 *  threshold and the period misclassifies as `exceptional`.
 *
 *  Null / non-finite input returns null. An unknown or already-m/s unit
 *  (including undefined, as when no source unit was resolved) passes the
 *  value through unchanged — the m/s identity case. */
export function toMetersPerSecond(
  windSpeed: number | null | undefined,
  fromUnit: string | undefined,
): number | null {
  if (windSpeed == null || !Number.isFinite(windSpeed)) return null;
  if (!fromUnit || fromUnit === 'm/s') return windSpeed;
  const factor = WIND_CONVERSION[`m/s->${fromUnit}`];
  return factor !== undefined ? windSpeed * factor : windSpeed;
}

/** Normalise a temperature to °C for the condition classifier, whose
 *  snow (`snow_max_c`, `snow_rain_max_c`) and fog-spread thresholds are
 *  in °C. A °F reading left unconverted is always a larger number than
 *  its °C value, so e.g. a freezing 30 °F (−1 °C) reads as 30 → above
 *  the 3 °C snow ceiling → snow misclassifies as rain.
 *
 *  Only °F is converted; °C / undefined / unknown units pass through
 *  unchanged. Null / non-finite input returns null. */
export function toCelsius(
  temp: number | null | undefined,
  fromUnit: string | undefined,
): number | null {
  if (temp == null || !Number.isFinite(temp)) return null;
  return (fromUnit === '°F' || fromUnit === 'F') ? (temp - 32) * 5 / 9 : temp;
}

/** Normalise a precipitation length — a total in mm or a mm/h rate — to
 *  millimetres for the condition classifier, whose rain thresholds
 *  (`rainy_threshold_mm`, `pouring_threshold_mm`, …) are in mm. Inches
 *  left unconverted under-read by 25.4×, so heavy rain reads as drizzle
 *  and `pouring` / `exceptional` never fire. The trailing rate suffix
 *  (`/h`, `/hr`) is stripped before the unit check, so `in/h` converts
 *  the same as `in`.
 *
 *  Only inch units (`in`, `inch`, `inches`, `"`) are converted; mm /
 *  undefined / unknown units pass through. Null / non-finite returns
 *  null. */
export function toMillimeters(
  precip: number | null | undefined,
  fromUnit: string | undefined,
): number | null {
  if (precip == null || !Number.isFinite(precip)) return null;
  if (!fromUnit) return precip;
  const base = fromUnit.toLowerCase().split('/')[0].trim();
  return (base === 'in' || base === 'inch' || base === 'inches' || base === '"')
    ? precip * 25.4
    : precip;
}

/** True when the unit denotes a precipitation RATE (ends in `/h`,
 *  `/hr`, `/hour`) rather than an accumulated total. */
export function isPrecipRateUnit(unit: string | undefined): boolean {
  return !!unit && /\/(h|hr|hour)$/i.test(unit);
}

/** Reduce a precipitation unit to its canonical length base. Strips a
 *  trailing rate suffix and normalises every inch spelling to `in`;
 *  `mm/h` → `mm`, `IN/H` → `in`, `inch` → `in`, `"` → `in`. Unknown
 *  units (e.g. `%`) pass through lower-cased so the caller can detect
 *  the non-mm/in case and skip conversion. Undefined → `mm`. */
export function precipBaseUnit(unit: string | undefined): string {
  if (!unit) return 'mm';
  const base = unit.toLowerCase().split('/')[0].trim();
  return (base === 'in' || base === 'inch' || base === 'inches' || base === '"')
    ? 'in'
    : base;
}

/** Convert a precipitation length (total or rate — the factor is the
 *  same, the caller owns the `/h` label) between mm and in. Same base
 *  or any non-mm/in base passes through unchanged. */
export function convertPrecipLength(value: number, fromBase: string, toBase: string): number {
  if (!Number.isFinite(value) || fromBase === toBase) return value;
  if (fromBase === 'in' && toBase === 'mm') return value * 25.4;
  if (fromBase === 'mm' && toBase === 'in') return value / 25.4;
  return value;
}

/** Format a precipitation value for the live attributes row in the
 *  configured display unit. `sourceUnit` is the sensor's native unit
 *  (or the derived-rate's source unit, e.g. `mm/h` / `in/h`);
 *  `targetBase` is the user's chosen display base (`mm` | `in`) and
 *  falls back to the source base when unset or not mm/in.
 *
 *  Inch values are ~25× smaller than their mm equivalent, so they get
 *  two decimals; mm keeps the legacy precision (drop the decimal above
 *  10, so a `339 mm/h` cell reads cleaner than `339.0`). The `/h`
 *  suffix is preserved for rates. */
export function formatPrecipDisplay(
  rawValue: number,
  sourceUnit: string | undefined,
  targetBase: string | undefined,
): { value: string; unit: string } {
  const isRate = isPrecipRateUnit(sourceUnit);
  const sourceBase = precipBaseUnit(sourceUnit);
  const target = (targetBase === 'mm' || targetBase === 'in') ? targetBase : sourceBase;
  const converted = convertPrecipLength(rawValue, sourceBase, target);
  let decimals: number;
  if (target === 'in') decimals = 2;
  else decimals = converted >= 10 ? 0 : 1;
  return {
    value: converted.toFixed(decimals),
    unit: isRate ? `${target}/h` : target,
  };
}

/** Beaufort scale converter — passed in by the caller because the
 *  classifier lives on the card class. Decoupling here keeps the
 *  utils module pure and dependency-free. */
export type BeaufortFn = (windSpeed: number) => number;

/** Convert windSpeed from `fromUnit` to `toUnit`. Same-unit returns
 *  rounded value. Beaufort delegates to `beaufortFn`. Unknown unit
 *  pair returns the input value unchanged (defensive at HA boundary).
 *  `fromUnit` / `toUnit` may be undefined when the HA entity hasn't
 *  populated `wind_speed_unit` yet — falls through to the unchanged
 *  return path. */
export function convertWindSpeed(
  windSpeed: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
  beaufortFn: BeaufortFn,
): number {
  if (toUnit === fromUnit) return Math.round(windSpeed);
  if (toUnit === 'Bft') return beaufortFn(windSpeed);
  const factor = WIND_CONVERSION[`${toUnit}->${fromUnit}`];
  return factor !== undefined ? Math.round(windSpeed * factor) : windSpeed;
}

/** Convert pressure from `fromUnit` to `toUnit`. Same-unit rounds to
 *  integer for hPa / mmHg, leaves inHg as-is. Cross-unit converts and
 *  rounds; for inHg target two decimals are preserved
 *  (`Math.round(x * 100) / 100`) since the integer rounding makes
 *  inHg readings useless. `fromUnit` / `toUnit` may be undefined when
 *  the HA entity hasn't populated `pressure_unit` yet. */
export function convertPressure(
  pressure: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
): number {
  if (toUnit === fromUnit) {
    return (toUnit === 'hPa' || toUnit === 'mmHg')
      ? Math.round(pressure) : pressure;
  }
  const factor = PRESSURE_CONVERSION[`${toUnit}->${fromUnit}`];
  if (factor === undefined) return pressure;
  const converted = pressure * factor;
  return toUnit === 'inHg'
    ? Math.round(converted * 100) / 100
    : Math.round(converted);
}

// ── Solar irradiance → illuminance (community post 15, point 5) ──────
//
// Many stations (SWS-12500-class, Ecowitt solar sensors) report solar
// irradiance in W/m² instead of illuminance in lux. The card's whole
// sun pipeline — clear-sky ratios in the condition classifier, the B2
// sunshine derivation, the live sun-strength row — is lux-based, and
// crucially RATIO-based (measured / theoretical clear-sky), so a
// constant conversion factor mostly cancels out. 120 lm/W is the
// upper-middle of the daylight luminous-efficacy range (93–120 lm/W);
// it maps full sun (~1000 W/m²) to ~120 klx, right at the clear-sky
// model's noon value. Fine-tuning stays available through
// `condition_mapping.sunshine_lux_ratio`.

/** Daylight luminous efficacy used for W/m² → lx conversion. */
export const DAYLIGHT_EFFICACY_LM_PER_W = 120;

/** True when a unit string denotes solar irradiance (W/m² in its
 *  common spellings). */
export function isIrradianceUnit(unit: unknown): boolean {
  if (typeof unit !== 'string') return false;
  const u = unit.toLowerCase().replace(/\s+/g, '');
  return u === 'w/m²' || u === 'w/m2' || u === 'w/㎡' || u === 'wm-2' || u === 'w*m-2';
}

/** Multiplier that converts a sensor reading into lux: 120 for an
 *  irradiance sensor (by unit or `device_class: irradiance`), 1 for a
 *  plain illuminance sensor. */
export function luxScaleFor(unit: unknown, deviceClass?: unknown): number {
  if (deviceClass === 'irradiance' || isIrradianceUnit(unit)) {
    return DAYLIGHT_EFFICACY_LM_PER_W;
  }
  return 1;
}
