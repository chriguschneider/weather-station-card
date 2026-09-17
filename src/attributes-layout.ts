// Attribute-row layout (ADR-0025). The live panel's attribute row is a
// set of columns, each holding rows top-to-bottom. `attributes_layout`
// lets the user pick which rows appear and where; without it the card
// falls back to the built-in default filtered by the `show_*` toggles.
//
// Pure — no Lit, no hass. main.ts maps the resolved tokens onto its
// row renderers; the editor uses the add/remove helpers to keep the
// attribute pills in sync with an explicit layout.

import { DEFAULTS } from './defaults.js';

// Every attribute the row can show, named after its `show_*` toggle so
// the YAML vocabulary is one list, not two. Two pairs also exist as a
// combined line — dew point + humidity, UV + illuminance — because the
// card has always drawn those on one line when both are on; the combined
// token makes that line an explicit, movable row, the singles let the
// user split it.
export const ATTRIBUTE_TOKENS = [
  'pressure',
  'dew_point_humidity',
  'dew_point',
  'humidity',
  'precipitation',
  'zero_degree_level',
  'uv_illuminance',
  'uv_index',
  'illuminance',
  'sun',
  'moon',
  'wind_direction',
  'wind_speed',
  'wind_gust_speed',
] as const;

export type AttributeToken = (typeof ATTRIBUTE_TOKENS)[number];
export type AttributesLayout = AttributeToken[][];

// Built-in arrangement — the three columns the card has always drawn.
// Also the anchor for the editor's insert position: a pill switched on
// lands next to its nearest sibling from its default column, ordered as
// here.
export const DEFAULT_ATTRIBUTES_LAYOUT: ReadonlyArray<ReadonlyArray<AttributeToken>> = [
  ['pressure', 'dew_point_humidity', 'dew_point', 'humidity', 'precipitation', 'zero_degree_level'],
  ['uv_illuminance', 'uv_index', 'illuminance', 'sun', 'moon'],
  ['wind_direction', 'wind_speed', 'wind_gust_speed'],
];

// A combined line and the two singles it stands for. In automatic mode
// both singles on → the combined line (the pre-ADR-0025 behaviour); the
// combined show_* key forces it regardless.
export const LINE_FAMILIES: ReadonlyArray<{
  combined: AttributeToken;
  parts: readonly [AttributeToken, AttributeToken];
}> = [
  { combined: 'dew_point_humidity', parts: ['dew_point', 'humidity'] },
  { combined: 'uv_illuminance', parts: ['uv_index', 'illuminance'] },
];

const TOKEN_SET: ReadonlySet<string> = new Set(ATTRIBUTE_TOKENS);

export function isAttributeToken(value: unknown): value is AttributeToken {
  return typeof value === 'string' && TOKEN_SET.has(value);
}

export function showKeyOf(token: AttributeToken): string {
  return `show_${token}`;
}

export function tokenOfShowKey(key: string): AttributeToken | undefined {
  const leaf = key.split('.').pop() ?? '';
  const token = leaf.startsWith('show_') ? leaf.slice('show_'.length) : leaf;
  return isAttributeToken(token) ? token : undefined;
}

/** True when the config carries a non-empty `attributes_layout`. An
 *  empty list is the "automatic" value DEFAULTS ships. */
export function hasExplicitLayout(cfg: Record<string, unknown> | null | undefined): boolean {
  const raw = cfg?.attributes_layout;
  return Array.isArray(raw) && raw.length > 0;
}

/** Normalise raw YAML into columns of known tokens. A bare string entry
 *  is read as a one-row column; unknown tokens, duplicates and empty
 *  columns are dropped. Never throws — the validator reports the
 *  problems, this just renders what it can. */
export function normalizeLayout(raw: unknown): AttributesLayout {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<AttributeToken>();
  const out: AttributesLayout = [];
  for (const entry of raw) {
    const items = Array.isArray(entry) ? entry : [entry];
    const column: AttributeToken[] = [];
    for (const item of items) {
      if (!isAttributeToken(item) || seen.has(item)) continue;
      seen.add(item);
      column.push(item);
    }
    if (column.length > 0) out.push(column);
  }
  return out;
}

// `show_*` semantics without a layout: opt-out rows render unless
// explicitly false, opt-in rows only on explicit true — the DEFAULTS
// value says which is which (ADR-0008).
function toggledOn(cfg: Record<string, unknown>, token: AttributeToken): boolean {
  const key = showKeyOf(token);
  const def = (DEFAULTS as Record<string, unknown>)[key] === true;
  return def ? cfg[key] !== false : cfg[key] === true;
}

// Automatic-mode visibility of one token, with the two rules that keep
// old configs rendering as before: a family's singles fold into the
// combined line when both are on, and the moon (default on) only shows
// together with the sun — it used to live inside the sun cell, and
// every card with the attribute row would otherwise grow a moon line it
// never asked for. An explicit layout is free of both rules.
function automaticOn(c: Record<string, unknown>, token: AttributeToken): boolean {
  for (const family of LINE_FAMILIES) {
    if (token === family.combined) {
      return toggledOn(c, family.combined)
        || (toggledOn(c, family.parts[0]) && toggledOn(c, family.parts[1]));
    }
    if (family.parts.includes(token)) {
      return toggledOn(c, token) && !automaticOn(c, family.combined);
    }
  }
  if (token === 'moon') return toggledOn(c, 'moon') && toggledOn(c, 'sun');
  return toggledOn(c, token);
}

/** The layout the card renders: the explicit one when set (it wins
 *  outright — `show_*` row toggles are ignored then), else the default
 *  arrangement filtered by the `show_*` toggles. */
export function resolveAttributesLayout(
  cfg: Record<string, unknown> | null | undefined,
): AttributesLayout {
  const c = cfg ?? {};
  if (hasExplicitLayout(c)) return normalizeLayout(c.attributes_layout);
  const out: AttributesLayout = [];
  for (const column of DEFAULT_ATTRIBUTES_LAYOUT) {
    const rows = column.filter((token) => automaticOn(c, token));
    if (rows.length > 0) out.push(rows);
  }
  return out;
}

function defaultPosition(token: AttributeToken): { column: number; rank: number } {
  let rank = 0;
  for (let column = 0; column < DEFAULT_ATTRIBUTES_LAYOUT.length; column++) {
    for (const t of DEFAULT_ATTRIBUTES_LAYOUT[column]) {
      if (t === token) return { column, rank };
      rank++;
    }
  }
  return { column: DEFAULT_ATTRIBUTES_LAYOUT.length - 1, rank };
}

/** Editor helper: insert a token into an explicit layout next to its
 *  nearest default sibling — right after the closest earlier row of its
 *  default column that is placed somewhere, else right before the
 *  closest later one. A user who moved the zero-degree level into the
 *  wind column therefore gets humidity next to it, not into a column
 *  index that stopped meaning "climate" the moment a column was
 *  removed. With no sibling placed at all the token opens a new column,
 *  slotted so the columns keep the default left-to-right order.
 *  Returns a new layout. */
export function addTokenToLayout(layout: AttributesLayout, token: AttributeToken): AttributesLayout {
  const next = layout.map((column) => [...column]);
  if (next.some((column) => column.includes(token))) return next;
  const { column: dc, rank } = defaultPosition(token);

  let prev: { col: number; row: number; rank: number } | undefined;
  let after: { col: number; row: number; rank: number } | undefined;
  next.forEach((column, col) => {
    column.forEach((t, row) => {
      const pos = defaultPosition(t);
      if (pos.column !== dc) return;
      if (pos.rank < rank && (!prev || pos.rank > prev.rank)) prev = { col, row, rank: pos.rank };
      if (pos.rank > rank && (!after || pos.rank < after.rank)) after = { col, row, rank: pos.rank };
    });
  });
  if (prev) {
    next[prev.col].splice(prev.row + 1, 0, token);
    return next;
  }
  if (after) {
    next[after.col].splice(after.row, 0, token);
    return next;
  }
  let at = next.length;
  for (let col = 0; col < next.length; col++) {
    if (next[col].length > 0 && defaultPosition(next[col][0]).column > dc) { at = col; break; }
  }
  next.splice(at, 0, [token]);
  return next;
}

/** Editor helper: remove a token; empty columns are dropped. */
export function removeTokenFromLayout(layout: AttributesLayout, token: AttributeToken): AttributesLayout {
  return layout
    .map((column) => column.filter((t) => t !== token))
    .filter((column) => column.length > 0);
}
