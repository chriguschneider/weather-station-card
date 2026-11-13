// Where the past (station) block's data comes from: the one rule the
// card and the visual editor share (ADR-0015). Pure.

export type PastSource = 'sensors' | 'openmeteo';

interface PastSourceConfig {
  sensors?: unknown;
  weather_entity?: unknown;
  show_station?: unknown;
  forecast?: { openmeteo?: unknown; openmeteo_history?: unknown } | null;
}

/** True when at least one station sensor has a non-empty entity id. */
export function hasStationSensor(sensors: unknown): boolean {
  if (!sensors || typeof sensors !== 'object') return false;
  return Object.values(sensors).some((v) => typeof v === 'string' && v.trim() !== '');
}

/** The configured past-data source, regardless of whether the station
 *  block is shown: any station sensor wins (the recorder, all or
 *  nothing, no per-channel top-up); otherwise the Open-Meteo history
 *  opt-in, unless the Open-Meteo master switch is off; otherwise none. */
export function pastSource(cfg: PastSourceConfig | null | undefined): PastSource | null {
  if (!cfg) return null;
  if (hasStationSensor(cfg.sensors)) return 'sensors';
  if (cfg.forecast?.openmeteo === false) return null;
  return cfg.forecast?.openmeteo_history === true ? 'openmeteo' : null;
}

/** True when the card fills its past block from Open-Meteo instead of
 *  the recorder: the station block is on, the configured source is
 *  Open-Meteo, and a weather entity supplies the forecast half. */
export function pastFromOpenMeteo(cfg: PastSourceConfig | null | undefined): boolean {
  if (!cfg || cfg.show_station === false) return false;
  if (!cfg.weather_entity) return false;
  return pastSource(cfg) === 'openmeteo';
}
