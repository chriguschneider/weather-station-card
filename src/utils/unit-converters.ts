// What is left of the pre-ADR-0035 converters. The live panel converts
// through units.ts; these helpers stay until step C3 of #478 moves the
// past data (data-source.ts: classifier inputs and lux scale), the
// readings' lux scale and the chart's precipitation label onto the units
// table.

import { BEAUFORT_KMH_UPPER, DAYLIGHT_EFFICACY_LM_PER_W, fromCanonical, toCanonical } from './units.js';

export { BEAUFORT_KMH_UPPER, DAYLIGHT_EFFICACY_LM_PER_W };

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
  return (fromUnit === '°F' || fromUnit === 'F') ? toCanonical('temperature', temp, '°F') : temp;
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
    ? toCanonical('precipitation', precip, 'in')
    : precip;
}

/** Convert a precipitation length (total or rate — the factor is the
 *  same, the caller owns the `/h` label) between mm and in. Same base,
 *  any non-mm/in base or a non-finite value passes through unchanged. */
export function convertPrecipLength(value: number, fromBase: string, toBase: string): number {
  if (fromBase === 'in' && toBase === 'mm') return toCanonical('precipitation', value, 'in') ?? value;
  if (fromBase === 'mm' && toBase === 'in') return fromCanonical('precipitation', value, 'in') ?? value;
  return value;
}

// ── Solar irradiance → illuminance (community post 15, point 5) ──────
//
// Many stations (SWS-12500-class, Ecowitt solar sensors) report solar
// irradiance in W/m² instead of illuminance in lux, and the card's sun
// pipeline is lux-based. Fine-tuning stays available through
// `condition_mapping.sunshine_lux_ratio`.

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
