// Sun-strength classifier for the live-panel sun row.
//
// Merges UV-index + illuminance into a single visual: a cloud-aware
// sun icon (or moon at night) plus the raw values. The day/night flip
// is lux-driven so the row works without an HA `sun.sun` entity; cloud
// shape is the lux/clearSky ratio bucketed against the same thresholds
// the daily condition classifier already uses
// (`condition-classifier.ts:106-107`).
//
// Pure module — no Home Assistant or DOM dependencies. UV-band cutoffs
// follow the WHO 5-tier scheme (Low 0–2 · Moderate 3–5 · High 6–7 ·
// Very high 8–10 · Extreme 11+). Boundary belongs to the higher band
// (`uv >= 3` → moderate; `uv = 2.999` stays low).

import { clearSkyLuxAt } from './condition-classifier.js';
import { isSunUp } from './moon.js';
import type { Calendar } from './utils/time-zone.js';

export type SunMode = 'day' | 'night';

export type UvBand = 'low' | 'moderate' | 'high' | 'very_high' | 'extreme';

export type SunIconShape =
  | 'weather-sunny'
  | 'weather-partly-cloudy'
  | 'weather-cloudy'
  | 'weather-night';

export type NightReason = 'lux_zero' | 'clearsky_zero' | null;

export interface SunStrengthInputs {
  /** UV index reading, or null when the sensor isn't wired. */
  uv: number | null;
  /** Illuminance reading in lux, or null when the sensor isn't wired. */
  lux: number | null;
  /** Site latitude in degrees, used for clear-sky reference. Null →
   *  factory falls back to the 110 000 lx constant. */
  lat: number | null;
  /** Site longitude in degrees. Null → fallback as above. */
  lon: number | null;
  /** Card calendar, for the day-of-year of the clear-sky model. */
  calendar: Calendar;
  /** Wall-clock moment used for the solar geometry. Defaults to now. */
  now?: Date;
}

export interface SunStrengthResult {
  mode: SunMode;
  uv: number | null;
  lux: number | null;
  iconShape: SunIconShape;
  band: UvBand | null;
  bandLocaleKey: string | null;
  cloudPct: number | null;
  protectionAdvised: boolean;
  nightReason: NightReason;
}

const SUNNY_CLOUD_RATIO = 0.70;
const PARTLY_CLOUD_RATIO = 0.30;
const PROTECTION_UV_THRESHOLD = 3;

function classifyUvBand(uv: number): UvBand {
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very_high';
  return 'extreme';
}

const UV_BAND_LOCALE_KEYS: Record<UvBand, string> = {
  low: 'sun_strength_band_low',
  moderate: 'sun_strength_band_moderate',
  high: 'sun_strength_band_high',
  very_high: 'sun_strength_band_very_high',
  extreme: 'sun_strength_band_extreme',
};

function asFinite(v: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function detectMode(luxFinite: number | null, sunUp: boolean): {
  mode: SunMode;
  nightReason: NightReason;
} {
  if (luxFinite === 0) return { mode: 'night', nightReason: 'lux_zero' };
  if (!sunUp) return { mode: 'night', nightReason: 'clearsky_zero' };
  return { mode: 'day', nightReason: null };
}

function pickIconAndCloud(
  mode: SunMode,
  luxFinite: number | null,
  clearSky: number,
): { iconShape: SunIconShape; cloudPct: number | null } {
  if (mode === 'night') return { iconShape: 'weather-night', cloudPct: null };
  if (luxFinite == null || clearSky <= 0) {
    return { iconShape: 'weather-sunny', cloudPct: null };
  }
  const ratio = luxFinite / clearSky;
  const cloudPct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  if (ratio >= SUNNY_CLOUD_RATIO) return { iconShape: 'weather-sunny', cloudPct };
  if (ratio >= PARTLY_CLOUD_RATIO) return { iconShape: 'weather-partly-cloudy', cloudPct };
  return { iconShape: 'weather-cloudy', cloudPct };
}

/** Classify a UV + lux reading into a day/night mode, an MDI icon
 *  shape that mirrors cloud cover, a WHO UV band, and a sunscreen
 *  hint. Inputs may be individually null when a sensor isn't wired —
 *  the caller is expected to render only the segments it has data
 *  for. */
export function classifySunStrength(input: SunStrengthInputs): SunStrengthResult {
  const { uv, lux, lat, lon, calendar } = input;
  const now = input.now instanceof Date ? input.now : new Date();

  const uvFinite = asFinite(uv);
  const luxFinite = asFinite(lux);
  const clearSky = clearSkyLuxAt(lat ?? NaN, lon ?? NaN, calendar, now);
  // Same NOAA model as the night icon (moon.ts) decides day/night; the
  // simple clear-sky model only supplies the lux reference.
  const sunUp = lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)
    ? true
    : isSunUp(now, lat, lon);

  const { mode, nightReason } = detectMode(luxFinite, sunUp);
  const { iconShape, cloudPct } = pickIconAndCloud(mode, luxFinite, clearSky);

  const band: UvBand | null =
    mode === 'day' && uvFinite != null ? classifyUvBand(uvFinite) : null;
  const bandLocaleKey = band ? UV_BAND_LOCALE_KEYS[band] : null;
  const protectionAdvised =
    mode === 'day' && uvFinite != null && uvFinite >= PROTECTION_UV_THRESHOLD;

  return {
    mode,
    uv: mode === 'night' ? null : uvFinite,
    lux: luxFinite,
    iconShape,
    band,
    bandLocaleKey,
    cloudPct,
    protectionAdvised,
    nightReason,
  };
}

// Truncation, not rounding, so each value stays in its display band:
// 999.9 → "Lux 999" (raw band) and 9999 → "Lux 9.9k" (1-decimal band)
// per .workflow/live-sun-strength/alignment.md.
export function formatLux(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Lux -';
  const v = Math.max(0, value);
  if (v < 1000) return `Lux ${Math.floor(v)}`;
  if (v < 10000) return `Lux ${(Math.floor(v / 100) / 10).toFixed(1)}k`;
  return `Lux ${Math.floor(v / 1000)}k`;
}
