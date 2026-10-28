// Coordinates for Open-Meteo requests and the sunshine day length: the
// card's `location` option when valid, else Home Assistant's home
// location. Sun and moon times, solar strength and the lux derivation
// read it too (#356), so a card for another place shows that place's sun.

import { validTimeZone } from './utils/time-zone.js';

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

export interface CardTimeZone {
  /** Input for the card's Calendar; `Calendar` itself falls back to the
   *  browser zone when this is unusable. */
  zone: unknown;
  /** Set when the configured zone was unusable and the server zone applies. */
  warning: string | null;
}

/** Display zone of a card (#357): `server` (default, also '' / unset),
 *  `location` (`location.time_zone`) or an IANA name. An unusable value
 *  falls back to the server zone with a warning. */
export function resolveCardTimeZone(
  config: { time_zone?: unknown; location?: unknown } | null | undefined,
  serverZone: unknown,
): CardTimeZone {
  const raw = config?.time_zone;
  if (raw === undefined || raw === null || raw === '' || raw === 'server') {
    return { zone: serverZone, warning: null };
  }
  if (raw === 'location') {
    const loc = config?.location;
    const zone = typeof loc === 'object' && loc !== null
      ? validTimeZone((loc as Record<string, unknown>).time_zone)
      : undefined;
    if (zone) return { zone, warning: null };
    return {
      zone: serverZone,
      warning: '`time_zone: location` needs a valid IANA `location.time_zone`'
        + ' (for example America/Denver); the server time zone is used instead',
    };
  }
  const zone = validTimeZone(raw);
  if (zone) return { zone, warning: null };
  return {
    zone: serverZone,
    warning: `\`time_zone\` "${String(raw)}" is not a known IANA time zone;`
      + ' the server time zone is used instead',
  };
}
