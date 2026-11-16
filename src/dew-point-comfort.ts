// Dew-point comfort classifier for the live-panel dew-point row.
//
// Five bands, priority order first-match-wins:
//
//   Raureif > Nebel > Schwül > Tau > Komfort
//
// Frozen-surface conditions (Td < 0 °C, spread ≤ 3 °C) dominate so the
// frost hint never gets swallowed by the fog / dew bands when both fire
// on a cold morning. The Nebel ≤ 1 °C spread mirrors
// `condition-classifier.ts` `fog_dewpoint_spread_c = 1`.
//
// The thresholds are fixed constants, not config options. Inputs are °C only;
// callers convert °F.

export type DewPointComfortBand =
  | 'raureif'
  | 'nebel'
  | 'schwuel'
  | 'tau'
  | 'komfort';

const FROST_TD_C = 0;          // Td < 0  →  Raureif tier
const FOG_SPREAD_C = 1;        // spread ≤ 1  →  Nebel (matches condition-classifier)
const MUGGY_TD_C = 16;         // Td > 16  →  Schwül
const DEW_SPREAD_C = 3;        // spread ≤ 3  →  Tau (or Raureif when also frost)

/** Classify a dew-point + air-temperature pair (°C); null when either is null or non-finite. */
export function getDewPointComfort(
  td_c: number | null,
  tair_c: number | null,
): DewPointComfortBand | null {
  if (td_c == null || !Number.isFinite(td_c)) return null;
  if (tair_c == null || !Number.isFinite(tair_c)) return null;

  // Physically impossible spreads (Td > T, sensor mismatch) get clamped
  // to 0 so the classifier never escapes the band table.
  const spread = Math.max(0, tair_c - td_c);

  if (td_c < FROST_TD_C && spread <= DEW_SPREAD_C) return 'raureif';
  if (spread <= FOG_SPREAD_C) return 'nebel';
  if (td_c > MUGGY_TD_C) return 'schwuel';
  if (spread <= DEW_SPREAD_C) return 'tau';
  return 'komfort';
}

const DEW_POINT_COMFORT_ICONS: Record<DewPointComfortBand, string> = {
  raureif: 'snowflake-variant',
  nebel: 'weather-fog',
  schwuel: 'water-percent-alert',
  tau: 'water',
  komfort: 'thermometer-water',
};

/** MDI icon name (without prefix) for a comfort band; null without a band. */
export function getDewPointComfortIcon(
  band: DewPointComfortBand | null,
): string | null {
  return band ? DEW_POINT_COMFORT_ICONS[band] : null;
}
