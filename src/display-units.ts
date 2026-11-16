// The card's display units (ADR-0035, point 4): one unit per displayed
// quantity, resolved once from an ordered candidate list, and the one
// step that turns a value into the number shown in that unit.

import {
  CANONICAL_UNIT,
  parseUnit,
  roundForDisplay,
  toCanonical,
  toDisplay,
  type Quantity,
} from './utils/units.js';

export type DisplayQuantity = 'temperature' | 'pressure' | 'speed' | 'precipitation';
/** Units-table ids. */
export type DisplayUnits = Readonly<Record<DisplayQuantity, string>>;
export type DisplayUnitCandidates = Readonly<Record<DisplayQuantity, readonly unknown[]>>;

const DISPLAY_QUANTITIES: readonly DisplayQuantity[] = ['temperature', 'pressure', 'speed', 'precipitation'];

function candidateId(quantity: DisplayQuantity, raw: unknown): string | null {
  const id = parseUnit(quantity, raw);
  if (id !== null || quantity !== 'precipitation') return id;
  // A rate sensor names the depth unit the card shows: in/h → in.
  const rate = parseUnit('precipitation_rate', raw);
  return rate === null ? null : rate.split('/')[0];
}

/** Per quantity the first candidate the units table knows, else the
 *  canonical unit. */
export function resolveDisplayUnits(candidates: DisplayUnitCandidates): DisplayUnits {
  const out = {} as Record<DisplayQuantity, string>;
  for (const quantity of DISPLAY_QUANTITIES) {
    let id: string | null = null;
    for (const raw of candidates[quantity]) {
      id = candidateId(quantity, raw);
      if (id !== null) break;
    }
    out[quantity] = id ?? CANONICAL_UNIT[quantity];
  }
  return out;
}

/** The rounded number shown for `value` (in `unit`) in `displayUnit`;
 *  null for an unknown `unit`. */
export function displayNumber(quantity: Quantity, value: number, unit: unknown, displayUnit: string): number | null {
  const from = parseUnit(quantity, unit);
  if (from === null) return null;
  // No round trip through canonical for the same unit: it turns 30.5 km/h
  // into 30.499… and would show 30 instead of 31.
  if (from === parseUnit(quantity, displayUnit)) return roundForDisplay(quantity, value, displayUnit);
  return toDisplay(quantity, toCanonical(quantity, value, unit), displayUnit);
}
