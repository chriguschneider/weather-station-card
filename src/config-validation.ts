// Advisory config validator. Takes the raw user YAML object and returns
// a list of human-readable problem strings — unknown keys, wrong-typed
// values, and "did you mean X?" suggestions for near-miss typos.
//
// This is ADVISORY ONLY. It never throws and the card always renders
// with defaults (ADR-0008 — DEFAULTS is the merge floor). The hard
// structural throws stay in `assertConfig` / `setConfig`; this module
// only catches the silent-ignore class of mistake (a misspelled key
// merged onto DEFAULTS just sits there doing nothing).
//
// The allowed key set is DERIVED from DEFAULTS / DEFAULTS_FORECAST /
// DEFAULTS_UNITS so it cannot drift from the real config surface
// (ADR-0008). A handful of keys are valid YAML but have no DEFAULTS
// entry (free-text `title`, runtime-merged `units.speed`, the
// classifier-override `condition_mapping`, the `locale` override) —
// those are listed explicitly below.

import { DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS } from './defaults.js';

// Top-level keys that are valid YAML but intentionally have no DEFAULTS
// entry — see the drift-guard test's DELETE_ONLY_PATHS and main.ts.
const EXTRA_TOP_LEVEL_KEYS = [
  'type', // custom:weather-station-card — HA's own card-type discriminator
  'title', // free-text card header, runtime fallback `cfg.title || ''`
  'locale', // language override, read in `set hass`
  'speed', // legacy top-level speed unit, merged into units.speed in setConfig
  'condition_mapping', // classifier threshold overrides — free-form object
  // Standard Home Assistant card-level keys, written by HA itself (the
  // grid/layout editor, conditional visibility) and never read by this
  // card. Flagging them is a false positive — every card in a
  // sections-view dashboard carries `grid_options`.
  'grid_options',
  'view_layout',
  'visibility',
] as const;

// Keys whose VALUES are free-form objects we deliberately do not
// descend into. `sensors` slots are entity ids (open-ended set);
// `condition_mapping` is a documented threshold table; the action
// objects carry HA's standard action selector shape. Validating their
// interiors risks false rejections, so we only type-check the container.
const OPAQUE_OBJECT_KEYS = new Set([
  'sensors',
  'condition_mapping',
  'tap_action',
  'hold_action',
  'double_tap_action',
]);

// Nested units keys that are valid but absent from DEFAULTS_UNITS
// (`speed` is merged in at runtime from the legacy top-level `speed`;
// `precipitation` defaults to the sensor's own unit, so it has no
// static DEFAULTS_UNITS entry either).
const EXTRA_UNITS_KEYS = ['speed', 'precipitation'] as const;

const TOP_LEVEL_KEYS = new Set<string>([
  ...Object.keys(DEFAULTS),
  ...EXTRA_TOP_LEVEL_KEYS,
]);
const FORECAST_KEYS = new Set<string>(Object.keys(DEFAULTS_FORECAST));
const UNITS_KEYS = new Set<string>([
  ...Object.keys(DEFAULTS_UNITS),
  ...EXTRA_UNITS_KEYS,
]);

// Maximum edit distance for a "did you mean" suggestion. 2 catches the
// common single-typo and transposition cases (`forcast_days`,
// `show_humdiity`) without suggesting an unrelated key for a genuinely
// unknown option.
const SUGGESTION_MAX_DISTANCE = 2;

// Levenshtein edit distance — small two-row implementation, no deps.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  let prev = new Array<number>(bLen + 1);
  let curr = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j++) prev[j] = j;
  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bLen];
}

// Return the closest allowed key within SUGGESTION_MAX_DISTANCE, or
// undefined when nothing is close enough to be worth suggesting.
function suggest(key: string, allowed: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDist = SUGGESTION_MAX_DISTANCE + 1;
  for (const candidate of allowed) {
    const dist = editDistance(key, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return bestDist <= SUGGESTION_MAX_DISTANCE ? best : undefined;
}

function unknownKeyMessage(
  key: string,
  scope: string,
  allowed: Iterable<string>,
): string {
  const qualify = (k: string): string => (scope ? `${scope}.${k}` : k);
  const label = qualify(key);
  const hint = suggest(key, allowed);
  const suffix = hint ? ` — did you mean \`${qualify(hint)}\`?` : '';
  return `Unknown option: \`${label}\`${suffix}`;
}

// Human-readable name for a JS runtime type, treating arrays distinctly
// from plain objects (YAML lists vs. maps are a common mix-up).
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

// Type-check one leaf value against the type implied by its default.
// Only flags a genuine mismatch; `null`/`undefined` are left alone
// (an empty YAML value is the user's way of clearing a key). A numeric
// string ("8") where a number is expected is accepted — this card
// coerces every numeric field (parseInt / CSS interpolation) and HA's
// visual editor commonly stores number inputs as strings.
function checkValueType(
  label: string,
  value: unknown,
  expected: unknown,
  problems: string[],
): void {
  if (value === null || value === undefined) return;
  const expectedType = typeof expected;
  // Only the three scalar types carry a meaningful type contract here.
  if (
    expectedType !== 'boolean' &&
    expectedType !== 'number' &&
    expectedType !== 'string'
  ) {
    return;
  }
  const actualType = typeof value;
  if (actualType === expectedType) return;
  // A numeric string passed where a number is expected is valid input:
  // the renderer coerces it, and HA's visual editor stores number
  // fields as strings. An empty string clears the field (default
  // applies). Only a non-numeric string is a genuine mismatch.
  if (expectedType === 'number' && actualType === 'string') {
    const trimmed = (value as string).trim();
    if (trimmed === '' || Number.isFinite(Number(trimmed))) return;
  }
  problems.push(
    `Wrong type for \`${label}\`: expected ${expectedType}, got ${typeName(value)}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

// Validate one nested config section (`forecast` / `units`) against its
// allowed-key set and the default-implied value types.
function validateNestedSection(
  scope: string,
  section: unknown,
  allowedKeys: Set<string>,
  defaults: Record<string, unknown>,
  problems: string[],
): void {
  if (section === undefined) return;
  if (!isPlainObject(section)) {
    problems.push(
      `Wrong type for \`${scope}\`: expected an object, got ${typeName(section)}`,
    );
    return;
  }
  for (const [key, value] of Object.entries(section)) {
    if (!allowedKeys.has(key)) {
      problems.push(unknownKeyMessage(key, scope, allowedKeys));
      continue;
    }
    if (key in defaults) {
      checkValueType(`${scope}.${key}`, value, defaults[key], problems);
    }
  }
}

/**
 * Pure validator. Returns an array of human-readable problem strings
 * for the given raw config object — empty when the config is clean.
 *
 * Never throws. A non-object input yields a single descriptive message
 * rather than an exception, so the caller can surface it like any other
 * advisory warning.
 */
export function validateConfig(rawConfig: unknown): string[] {
  const problems: string[] = [];

  if (!isPlainObject(rawConfig)) {
    return [`Config must be an object, got ${typeName(rawConfig)}`];
  }

  for (const [key, value] of Object.entries(rawConfig)) {
    validateTopLevelEntry(key, value, problems);
  }

  return problems;
}

// Validate a single top-level config entry. Split out of validateConfig
// to keep the per-key branching out of the iteration loop.
function validateTopLevelEntry(
  key: string,
  value: unknown,
  problems: string[],
): void {
  if (!TOP_LEVEL_KEYS.has(key)) {
    problems.push(unknownKeyMessage(key, '', TOP_LEVEL_KEYS));
    return;
  }
  if (key === 'forecast') {
    validateNestedSection('forecast', value, FORECAST_KEYS, DEFAULTS_FORECAST, problems);
    return;
  }
  if (key === 'units') {
    validateNestedSection('units', value, UNITS_KEYS, DEFAULTS_UNITS, problems);
    return;
  }
  // Opaque object containers: type-check the container only, never
  // descend (entity-id slots / threshold tables / action shapes are
  // open-ended — descending risks false rejections).
  if (OPAQUE_OBJECT_KEYS.has(key)) {
    if (value !== undefined && value !== null && !isPlainObject(value)) {
      problems.push(
        `Wrong type for \`${key}\`: expected an object, got ${typeName(value)}`,
      );
    }
    return;
  }
  // Plain scalar leaf with a DEFAULTS-implied type.
  if (key in DEFAULTS) {
    checkValueType(
      key,
      value,
      (DEFAULTS as Record<string, unknown>)[key],
      problems,
    );
  }
}
