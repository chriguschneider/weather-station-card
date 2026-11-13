// Sensor-driven daily weather condition classifier.
//
// Pure module — no Home Assistant or DOM dependencies. Inputs are unit-aware
// (caller must supply °C, mm/24h, m/s, %, lx). Outputs one of HA's standard
// weather condition IDs from the decision tree below.
//
// Each rule cites its meteorological source. The HA condition vocabulary
// itself is defined in the Weather entity spec:
//   https://developers.home-assistant.io/docs/core/entity/weather/
//
// `lightning`, `lightning-rainy`, and `hail` are intentionally never emitted:
// reliable detection requires dedicated hardware (AS3935 lightning detector,
// hail-pad / impact sensor) which a typical weather station does not provide.

import type { ConditionId } from './const.js';
import { declinationDeg } from './utils/solar.js';
import type { Calendar } from './utils/time-zone.js';

/** Threshold-set that the classifier consults — both the built-in
 *  `DEFAULTS` (calibrated for daily totals) and any user-supplied
 *  `condition_mapping` overrides have this shape. Callers can supply
 *  a partial subset; missing keys fall back to the defaults. */
export interface ConditionThresholds {
  exceptional_gust_ms: number;
  exceptional_precip_mm: number;
  rainy_threshold_mm: number;
  pouring_threshold_mm: number;
  snow_max_c: number;
  snow_rain_max_c: number;
  fog_humidity_pct: number;
  fog_dewpoint_spread_c: number;
  fog_wind_max_ms: number;
  windy_threshold_ms: number;
  windy_mean_threshold_ms: number;
  sunny_cloud_ratio: number;
  partly_cloud_ratio: number;
}

export type ConditionThresholdOverrides = Partial<ConditionThresholds>;

/** Classifier inputs for one period (a day or an hour). Numeric fields
 *  are nullable when the corresponding sensor was offline or absent —
 *  the decision tree skips rules whose inputs aren't present. */
export interface ClassifyInputs {
  temp_max?: number | null;
  temp_min?: number | null;
  humidity?: number | null;
  lux_max?: number | null;
  precip_total?: number | null;
  wind_mean?: number | null;
  gust_max?: number | null;
  dew_point_mean?: number | null;
  /** Theoretical clear-sky illuminance for the moment / day. Combined
   *  with `lux_max` to derive the cloud-cover ratio. */
  clearsky_lux?: number | null;
}

/** Period dispatch — selects which precipitation threshold table to
 *  use. 'hour' rescales `rainy_threshold_mm`, `pouring_threshold_mm`,
 *  and `exceptional_precip_mm` to per-hour values. */
export type Period = 'day' | 'hour';

// Default thresholds. Every value is grounded in an official scale or
// glossary entry; users can override individual keys via the card's
// `condition_mapping` config.
//
// The precipitation thresholds (`*_precip_mm`, `rainy_threshold_mm`,
// `pouring_threshold_mm`) are calibrated for *daily* totals — `0.5 mm`
// over 24 h is light drizzle, `10 mm` over 24 h is pouring, `50 mm`
// over 24 h is the NWS exceptional-rainfall outlook. When `classifyDay`
// is called with `period: 'hour'`, the precipitation thresholds are
// rescaled per HOURLY_PRECIP_OVERRIDES below before user overrides
// apply. Wind, gust, fog, and cloud thresholds use the same value at
// either period (they're instantaneous / mean values, not totals).
const DEFAULTS: ConditionThresholds = Object.freeze({
  // Beaufort 10 ("storm") begins at 24.5 m/s. WMO No. 306 Vol. I.1.
  exceptional_gust_ms: 24.5,
  // NWS "Excessive Rainfall Outlook" daily heavy-rain threshold.
  exceptional_precip_mm: 50,

  // Trace amount per WMO/NWS glossaries; below this is dew/sensor noise.
  rainy_threshold_mm: 0.5,
  // Heavy-rain rate is > 7.6 mm/h (NWS); 10 mm in a single day is a robust
  // worst-of-day proxy in temperate climates without overfiring on drizzle.
  pouring_threshold_mm: 10,

  // Solid precipitation: AMS Glossary "Wet-bulb temperature" — snow
  // dominates at wet-bulb ≤ ~1°C. Without wet-bulb we fall back to temp_max.
  snow_max_c: 0,
  snow_rain_max_c: 3,

  // METAR FG visibility < 1 km is not measurable here; AMS Glossary "Fog"
  // forecasting proxy: humidity ≥ 95 % AND temp–dewpoint spread ≤ 1°C
  // with calm wind.
  fog_humidity_pct: 95,
  fog_dewpoint_spread_c: 1,
  fog_wind_max_ms: 3,

  // Beaufort 6 = "strong breeze" begins at 10.8 m/s; Bft 5 sustained at
  // 8.0 m/s is "fresh breeze, very noticeable". WMO No. 306 Vol. I.1.
  windy_threshold_ms: 10.8,
  windy_mean_threshold_ms: 8.0,

  // Cloud-cover by daylight ratio. Clear-sky noon illuminance ≈ 110 000 lx
  // at sea level (IES Lighting Handbook §3); overcast typical 5 000–10 000.
  // Mapped to WMO oktas: ≥ 0.70 ≈ 0–2/8 (clear), 0.30–0.70 ≈ 3–6/8 (broken),
  // < 0.30 ≈ 7–8/8 (overcast).
  sunny_cloud_ratio: 0.70,
  partly_cloud_ratio: 0.30,
});

// Per-hour replacements for the precipitation thresholds. Active when
// `classifyDay(..., 'hour')`. Reference: WMO/AMS rain-rate scales —
// drizzle ~0.1 mm/h, moderate rain >2.5 mm/h, heavy rain >7.6 mm/h
// (NWS), violent rain ~50 mm/h. So:
//   - rainy: 0.1 mm/h is the lower bound of measurable drizzle
//   - pouring: 4 mm/h is moderate-to-heavy sustained rain
//   - exceptional: 30 mm/h is a cloudburst (violent end of the scale)
const HOURLY_PRECIP_OVERRIDES: Partial<ConditionThresholds> = Object.freeze({
  rainy_threshold_mm: 0.1,
  pouring_threshold_mm: 4,
  exceptional_precip_mm: 30,
});

/** Theoretical clear-sky illuminance at solar noon in lux. Based on
 *  cos(zenith) × 110 000 lx, with zenith = |lat − declination| at solar
 *  noon. Reference: AMS Glossary "Solar elevation"; IES Lighting
 *  Handbook §3 for the 110 000 lx clear-sky maximum at perpendicular
 *  incidence. */
export function clearSkyNoonLux(latDeg: number, dayOfYear: number): number {
  if (!Number.isFinite(latDeg) || !Number.isFinite(dayOfYear)) return 110000;
  const zenith = Math.abs(latDeg - declinationDeg(dayOfYear));
  if (zenith >= 90) return 0;
  return 110000 * Math.cos(zenith * Math.PI / 180);
}

/** Theoretical clear-sky illuminance at an arbitrary moment. Used for
 *  live "current condition" classification where solar noon is the
 *  wrong reference. Hour angle from local solar time
 *  (UTC + longitude/15); equation-of-time correction omitted (max
 *  ~16 min, negligible at the cloud-ratio resolution we need).
 *  cos(zenith) = sinφ·sinδ + cosφ·cosδ·cos(H). */
export function clearSkyLuxAt(latDeg: number, lonDeg: number, calendar: Calendar, date?: Date): number {
  const d = date instanceof Date ? date : new Date();
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return 110000;
  const decl = declinationDeg(calendar.dayOfYear(d)) * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const solarHour = utcHours + lonDeg / 15;
  const hourAngle = (solarHour - 12) * 15 * Math.PI / 180;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  if (cosZ <= 0) return 0;
  return 110000 * cosZ;
}

/** Same math as clearSkyLuxAt, but returns a closure that caches
 *  lat-trig (sinφ, cosφ) and the per-day declination (sinδ, cosδ) so
 *  repeated calls for many timestamps in the same lat/lon don't redo
 *  trig that doesn't change. Used by
 *  `MeasuredDataSource._buildHourlyForecast` to compute clearsky lux
 *  for ~168 hourly rows in one fetch — the cache reduces trig per row
 *  from ~5 calls to ~1 (just `cos(hourAngle)`). */
export function clearSkyLuxFactory(
  latDeg: number | null | undefined,
  lonDeg: number | null | undefined,
  calendar: Calendar,
): (date?: Date) => number {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return () => 110000;
  }
  const lat = (latDeg as number) * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  let cachedDayOfYear = -1;
  let sinDecl = 0;
  let cosDecl = 0;
  return (date?: Date): number => {
    const d = date instanceof Date ? date : new Date();
    const dayOfYear = calendar.dayOfYear(d);
    if (dayOfYear !== cachedDayOfYear) {
      cachedDayOfYear = dayOfYear;
      const decl = declinationDeg(dayOfYear) * Math.PI / 180;
      sinDecl = Math.sin(decl);
      cosDecl = Math.cos(decl);
    }
    const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const hourAngle = (utcHours + (lonDeg as number) / 15 - 12) * 15 * Math.PI / 180;
    const cosZ = sinLat * sinDecl + cosLat * cosDecl * Math.cos(hourAngle);
    return cosZ <= 0 ? 0 : 110000 * cosZ;
  };
}

/** Map a per-period record to an HA condition ID. Worst-of-period
 *  priority: extreme weather > precipitation > fog > wind > cloud cover.
 *
 *  `period` selects the threshold table for precipitation rules:
 *    - 'day' (default): `precip_total` interpreted as mm in the past 24 h
 *    - 'hour': `precip_total` interpreted as mm in the past 1 h, with
 *      thresholds rescaled accordingly so the same data doesn't bias
 *      toward 'pouring' / 'exceptional' just because the bucket shrank. */
export function classifyDay(
  day: ClassifyInputs,
  overrides: ConditionThresholdOverrides = {},
  period: Period = 'day',
): ConditionId {
  const periodDefaults: ConditionThresholds = period === 'hour'
    ? { ...DEFAULTS, ...HOURLY_PRECIP_OVERRIDES }
    : DEFAULTS;
  const t: ConditionThresholds = { ...periodDefaults, ...overrides };

  const {
    temp_max,
    temp_min,
    humidity,
    lux_max,
    precip_total,
    wind_mean,
    gust_max,
    dew_point_mean,
    clearsky_lux,
  } = day;

  // 1. EXCEPTIONAL — Bft 10 storm or NWS daily heavy-rain threshold.
  if (gust_max != null && gust_max >= t.exceptional_gust_ms) return 'exceptional';
  if (precip_total != null && precip_total >= t.exceptional_precip_mm) return 'exceptional';

  // 2. PRECIPITATION dominant.
  if (precip_total != null && precip_total >= t.rainy_threshold_mm) {
    if (temp_max != null && temp_max <= t.snow_max_c) return 'snowy';
    if (temp_max != null && temp_max <= t.snow_rain_max_c) return 'snowy-rainy';
    if (precip_total >= t.pouring_threshold_mm) return 'pouring';
    return 'rainy';
  }

  // 3. FOG — only when humidity AND dew-point are present.
  if (
    humidity != null && humidity >= t.fog_humidity_pct &&
    dew_point_mean != null && temp_min != null &&
    (temp_min - dew_point_mean) <= t.fog_dewpoint_spread_c &&
    (wind_mean == null || wind_mean < t.fog_wind_max_ms)
  ) {
    return 'fog';
  }

  // 5. CLOUD COVER — ratio used for both cloud condition and windy variant.
  let cloudRatio: number | null = null;
  if (lux_max != null && clearsky_lux != null && clearsky_lux > 0) {
    cloudRatio = lux_max / clearsky_lux;
  }

  // 4. WIND dominant.
  const windy =
    (gust_max != null && gust_max >= t.windy_threshold_ms) ||
    (wind_mean != null && wind_mean >= t.windy_mean_threshold_ms);
  if (windy) {
    if (cloudRatio != null && cloudRatio < t.sunny_cloud_ratio) return 'windy-variant';
    return 'windy';
  }

  if (cloudRatio == null) return 'cloudy';
  if (cloudRatio >= t.sunny_cloud_ratio) return 'sunny';
  if (cloudRatio >= t.partly_cloud_ratio) return 'partlycloudy';
  return 'cloudy';
}
