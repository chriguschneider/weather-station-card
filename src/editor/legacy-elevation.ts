// The top-level `elevation` option is deprecated since 3.0 in favour of
// `location.elevation` (removal announced for 4.0, MIGRATION.md).

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The elevation the Location panel shows: `location.elevation`, else the
 *  legacy top-level value. */
export function panelElevation(cfg: Record<string, unknown>): number | undefined {
  const loc = (typeof cfg.location === 'object' && cfg.location !== null
    ? cfg.location : {}) as Record<string, unknown>;
  if (isNum(loc.elevation)) return loc.elevation;
  return isNum(cfg.elevation) ? cfg.elevation : undefined;
}

/** Moves a top-level `elevation` into `location.elevation` when the card
 *  has a `location` object. `location.elevation` wins (as in the card), so
 *  the top-level key is then just dropped. Without `location` the value
 *  stays: there is nowhere else to put it. */
export function migrateLegacyElevation(cfg: Record<string, unknown>): Record<string, unknown> {
  if (!('elevation' in cfg)) return cfg;
  const loc = cfg.location;
  if (typeof loc !== 'object' || loc === null) return cfg;
  const { elevation, ...rest } = cfg;
  const location = loc as Record<string, unknown>;
  if (isNum(location.elevation)) return rest;
  // The card ignores a non-numeric legacy value; leave it alone.
  if (!isNum(elevation)) return cfg;
  return { ...rest, location: { ...location, elevation } };
}
