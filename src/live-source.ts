// Provenance of each live-panel value (`show_sources`, ADR-0031).
//
// A live reading has exactly one origin, decided in
// _extractSensorReadings: the configured station sensor, the sensor's
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

/** A configured station sensor is down: its last good value is shown
 *  (stale) or the weather entity stands in for it. A weather value with
 *  no sensor configured is normal and not a problem. */
export function isSensorProblem(src: LiveSource | undefined): boolean {
  return src?.kind === 'stale' || (src?.kind === 'weather' && !!src.sensorId);
}

export interface SourceLabels {
  station?: string;
  weather?: string;
  computed?: string;
}

// Mirrors the fallback rule of `fromWxIfMissing` in main.ts so the
// recorded source always matches the value that is actually shown.
// `sensorValue` is what valueOf() returned for the sensor (its live
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
  if (kind === 'weather') return (labels?.weather || defaults.weather).trim();
  if (kind === 'computed') return (labels?.computed || defaults.computed).trim();
  return (labels?.station || defaults.station).trim();
}

// Sources of a combined row (dew point + humidity, …) grouped by
// kind in display order: two station sensors get one "Station" tag
// whose tooltip names both entities.
export interface SourceGroup {
  kind: LiveSourceKind;
  entityIds: string[];
}

export function groupSources(sources: ReadonlyArray<LiveSource | undefined>): SourceGroup[] {
  const out: SourceGroup[] = [];
  for (const s of sources) {
    if (!s) continue;
    let group = out.find((g) => g.kind === s.kind);
    if (!group) {
      group = { kind: s.kind, entityIds: [] };
      out.push(group);
    }
    if (s.entityId && !group.entityIds.includes(s.entityId)) group.entityIds.push(s.entityId);
  }
  return out;
}
