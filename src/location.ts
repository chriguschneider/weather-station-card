// Coordinates for Open-Meteo requests and the sunshine day length: the
// card's `location` option when valid, else Home Assistant's home
// location. Sun/moon rise times deliberately keep using HA's location.

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Strict parse of the `location` option. Null for anything but two
 *  finite numbers inside the valid latitude / longitude ranges. */
export function parseLocation(raw: unknown): LatLon | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { latitude, longitude } = raw as Record<string, unknown>;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

interface HassWithLocation {
  config?: { latitude?: number | null; longitude?: number | null } | null;
}

/** Configured location first, then HA's; null when neither is usable. */
export function resolveLocation(
  config: { location?: unknown } | null | undefined,
  hass: HassWithLocation | null | undefined,
): LatLon | null {
  const own = parseLocation(config?.location);
  if (own) return own;
  const lat = hass?.config?.latitude;
  const lon = hass?.config?.longitude;
  if (typeof lat === 'number' && typeof lon === 'number'
    && Number.isFinite(lat) && Number.isFinite(lon)) {
    return { latitude: lat, longitude: lon };
  }
  return null;
}
