// Editor-only Open-Meteo lookups for the Location panel (#372). Both run
// on a button click and nowhere else; the card itself never calls them
// (ADR-0030). Response fields: https://open-meteo.com/en/docs/geocoding-api
// (name, admin1, country, latitude, longitude, elevation, timezone) and
// https://open-meteo.com/en/docs (`elevation`, `timezone` with
// `timezone=auto`).

export interface PlaceHit {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
}

export interface ElevationZone {
  elevation?: number;
  timezone?: string;
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** "name, admin1, country" as shown in the result list. */
export function placeLabel(hit: PlaceHit): string {
  return [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
}

export async function searchPlaces(query: string, language: string): Promise<PlaceHit[]> {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=10`
    + `&language=${encodeURIComponent(language)}&format=json`;
  const body = await getJson(url);
  const results = Array.isArray(body.results) ? body.results : [];
  const hits: PlaceHit[] = [];
  for (const r of results as Record<string, unknown>[]) {
    if (!r || !isNum(r.latitude) || !isNum(r.longitude) || !str(r.name)) continue;
    hits.push({
      name: r.name as string,
      admin1: str(r.admin1),
      country: str(r.country),
      latitude: r.latitude,
      longitude: r.longitude,
      elevation: isNum(r.elevation) ? r.elevation : undefined,
      timezone: str(r.timezone),
    });
  }
  return hits;
}

export async function lookupElevationZone(latitude: number, longitude: number): Promise<ElevationZone> {
  const body = await getJson(
    `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&timezone=auto`,
  );
  const out: ElevationZone = {};
  if (isNum(body.elevation)) out.elevation = body.elevation;
  const zone = str(body.timezone);
  if (zone) out.timezone = zone;
  if (out.elevation === undefined && out.timezone === undefined) {
    throw new Error('no elevation or time zone in response');
  }
  return out;
}
