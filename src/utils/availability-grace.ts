// Grace-period bookkeeping for temporarily unavailable sensors (#213): an
// HA restart flips every sensor to `unavailable` for a minute or two, so
// "just went missing" (in grace) differs from "gone for a while" (overdue).
// Pure over an immutable map: a changed situation returns a NEW object, an
// unchanged one the SAME reference.

/** entityId → epoch ms of the first scan that saw it unavailable. */
export type MissingSinceMap = Readonly<Record<string, number>>;

/** Default grace: a typical HA restart (including slow Pi setups)
 *  completes well inside this window. */
export const UNAVAILABLE_GRACE_MS = 5 * 60 * 1000;

/** Fold the current scan into the map: newly missing entities are
 *  stamped with `now`, recovered entities are dropped, persistently
 *  missing ones keep their original stamp. Returns the SAME reference
 *  when nothing changed. */
export function updateMissingSince(
  prev: MissingSinceMap,
  missingNow: ReadonlyArray<string>,
  now: number,
): MissingSinceMap {
  const nowSet = new Set(missingNow);
  let changed = false;
  const next: Record<string, number> = {};
  for (const eid of missingNow) {
    if (prev[eid] !== undefined) {
      next[eid] = prev[eid];
    } else {
      next[eid] = now;
      changed = true;
    }
  }
  for (const eid of Object.keys(prev)) {
    if (!nowSet.has(eid)) changed = true; // recovered — dropped from next
  }
  return changed ? next : prev;
}

/** Entities that have been missing longer than the grace period. */
export function overdueMissing(
  map: MissingSinceMap,
  graceMs: number,
  now: number,
): string[] {
  return Object.entries(map)
    .filter(([, since]) => now - since >= graceMs)
    .map(([eid]) => eid);
}

/** Milliseconds until the earliest in-grace entry becomes overdue;
 *  null when nothing is pending (map empty or everything overdue
 *  already). The controller arms a one-shot re-scan timer with it so
 *  the overdue state surfaces even when HA goes quiet. */
export function nextExpiryDelay(
  map: MissingSinceMap,
  graceMs: number,
  now: number,
): number | null {
  let earliest: number | null = null;
  for (const since of Object.values(map)) {
    const delay = since + graceMs - now;
    if (delay <= 0) continue;
    if (earliest === null || delay < earliest) earliest = delay;
  }
  return earliest;
}
