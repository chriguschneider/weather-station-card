/**
 * Apparent temperature, Australian Bureau of Meteorology version without
 * the radiation term (Steadman 1994): http://www.bom.gov.au/info/thermal_stress/
 *
 * `ta` in °C, `rh` in %, `ws` in m/s; returns °C, or null for a
 * non-finite input.
 */
export function apparentTemperature(ta: number, rh: number, ws: number): number | null {
  if (![ta, rh, ws].every(Number.isFinite)) return null;
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * ta) / (237.7 + ta));
  return ta + 0.33 * e - 0.7 * ws - 4;
}
