// Provenance of each live-panel value (`show_sources`, ADR-0031).
//
// A live reading has exactly one origin, decided in
// sensor-readings.ts: the configured station sensor, the sensor's
// last good value while it is unavailable (#213), or the weather
// entity's current attributes when no usable sensor value exists.
// The card used to know this only implicitly; recording it lets the
// panel label each value so a mixed setup (local station + forecast
// provider) is readable at a glance.

// `computed`: derived in-card from the location (sun, moon), no entity.
export type LiveSourceKind = 'station' | 'stale' | 'weather' | 'computed';

export interface LiveSource {
  kind: LiveSourceKind;
  entityId?: string;
  /** Weather fallback caused by a configured sensor that has no usable
   *  value. Absent when no sensor is configured (fallback by design). */
  sensorId?: string;
}

/** The configured sensor a value is missing from: the stale sensor, or
 *  the sensor the weather entity stands in for. */
export function sensorDownId(src: LiveSource | undefined): string | undefined {
  if (src?.kind === 'stale') return src.entityId;
  if (src?.kind === 'weather') return src.sensorId;
  return undefined;
}

/** A configured station sensor has been down past the card's grace
 *  period (`overdueIds`, from the availability scan). Inside the grace
 *  window or while HA starts it is not yet a problem. A weather value
 *  with no sensor configured is normal. */
export function isSensorProblem(src: LiveSource | undefined, overdueIds: ReadonlySet<string>): boolean {
  const id = sensorDownId(src);
  return !!id && overdueIds.has(id);
}

export interface SourceLabels {
  station?: string;
  weather?: string;
  computed?: string;
}

// The fallback rule itself: sensor-readings.ts calls this first and
// takes the value from the side it picks, so the recorded source is
// the value's source by construction (#451).
// `sensorValue` is the sensor's usable value (its live
// state, or its last good state while unavailable); `weatherHasValue`
// whether the weather entity carries the matching attribute.
export function resolveLiveSource(opts: {
  sensorId: string | undefined;
  sensorState: string | undefined;
  sensorValue: string | undefined;
  weatherEntity: string | undefined;
  weatherHasValue: boolean;
}): LiveSource | undefined {
  const { sensorId, sensorState, sensorValue, weatherEntity, weatherHasValue } = opts;
  if (sensorId && sensorValue !== undefined && sensorValue !== '') {
    const live = sensorState !== undefined && sensorState !== 'unavailable' && sensorState !== 'unknown';
    return { kind: live ? 'station' : 'stale', entityId: sensorId };
  }
  if (weatherEntity && weatherHasValue) {
    return { kind: 'weather', entityId: weatherEntity, ...(sensorId ? { sensorId } : {}) };
  }
  return undefined;
}

// Short text shown next to a value. A user label wins; otherwise the
// localized default ("Station" / "Forecast"). Stale station values
// reuse the station label — the tooltip carries the "last known" hint.
export function sourceLabel(
  kind: LiveSourceKind,
  labels: SourceLabels | undefined,
  defaults: { station: string; weather: string; computed: string },
): string {
  if (kind === 'weather') return labelText(labels?.weather, defaults.weather);
  if (kind === 'computed') return labelText(labels?.computed, defaults.computed);
  return labelText(labels?.station, defaults.station);
}

// YAML can hand us a number or object; only non-blank strings override.
export function labelText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback.trim();
}

