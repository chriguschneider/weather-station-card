// Advisory config validator (ADR-0008): returns problem strings (unknown
// keys with "did you mean", wrong types). It never throws and the card
// renders with defaults regardless; the hard throws stay in
// `assertConfig` / `setConfig`. The allowed keys derive from the DEFAULTS
// objects; valid keys without a DEFAULTS entry are listed explicitly below.

import { DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS } from './defaults.js';
import {
  ATTRIBUTE_TOKENS,
  hasExplicitLayout,
  isAttributeToken,
  showKeyOf,
} from './attributes-layout.js';
import { parseLocation, resolveCardTimeZone } from './location.js';

// Valid top-level keys without a DEFAULTS entry (see the drift-guard
// test's DELETE_ONLY_PATHS).
const EXTRA_TOP_LEVEL_KEYS = [
  'type', // custom:weather-station-card — HA's own card-type discriminator
  'title', // free-text card header, runtime fallback `cfg.title || ''`
  'locale', // language override, read in `set hass`
  'speed', // legacy top-level speed unit, merged into units.speed by normalizeConfig
  'condition_mapping', // classifier threshold overrides — free-form object
  'location', // {latitude, longitude, elevation, time_zone} of the card's place, checked by parseLocation / resolveCardTimeZone
  'elevation', // site metres for the zero-degree rows; unset falls back to the sensor / HA (#333)
  'source_labels', // {station, weather, computed} text overrides for the show_sources popup; unset uses the localized defaults
  // HA writes these itself (grid/layout editor, conditional visibility);
  // flagging them is a false positive.
  'grid_options',
  'view_layout',
  'visibility',
  'card_mod', // read by the card-mod plugin from the card's config; the value is not inspected
] as const;

// Retired options: not read, still accepted silently so existing
// dashboards don't start warning.
const RETIRED_TOP_LEVEL_KEYS = [
  'show_sunshine_duration',
] as const;

// Free-form objects (entity ids, threshold table, HA action shapes): only
// the container is type-checked, since descending risks false rejections.
const OPAQUE_OBJECT_KEYS = new Set([
  'sensors',
  'condition_mapping',
  'source_labels',
  'tap_action',
  'hold_action',
  'double_tap_action',
]);

// Valid units keys absent from DEFAULTS_UNITS: `speed` comes from the legacy
// top-level `speed`, `precipitation` defaults to the sensor's own unit.
const EXTRA_UNITS_KEYS = ['speed', 'precipitation'] as const;

// Forecast colour overrides read by the chart but deliberately absent
// from DEFAULTS_FORECAST: unset means "follow the theme", so a default
// value would override it.
const EXTRA_FORECAST_KEYS = [
  'chart_text_color',
  'chart_datetime_color',
] as const;

const TOP_LEVEL_KEYS = new Set<string>([
  ...Object.keys(DEFAULTS),
  ...EXTRA_TOP_LEVEL_KEYS,
  ...RETIRED_TOP_LEVEL_KEYS,
]);
const FORECAST_KEYS = new Set<string>([
  ...Object.keys(DEFAULTS_FORECAST),
  ...EXTRA_FORECAST_KEYS,
]);
const UNITS_KEYS = new Set<string>([
  ...Object.keys(DEFAULTS_UNITS),
  ...EXTRA_UNITS_KEYS,
]);

// 2 catches single typos and transpositions (`forcast_days`) without
// suggesting an unrelated key for a genuinely unknown option.
const SUGGESTION_MAX_DISTANCE = 2;

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

// Arrays are named apart from objects: lists vs. maps is a common YAML mix-up.
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

// `null`/`undefined` are left alone (an empty YAML value clears a key).
function checkValueType(
  label: string,
  value: unknown,
  expected: unknown,
  problems: string[],
): void {
  if (value === null || value === undefined) return;
  const expectedType = typeof expected;
  if (
    expectedType !== 'boolean' &&
    expectedType !== 'number' &&
    expectedType !== 'string'
  ) {
    return;
  }
  const actualType = typeof value;
  if (actualType === expectedType) return;
  // Numeric strings are valid: the card coerces every numeric field and
  // HA's visual editor may store number inputs as strings. An empty
  // string clears the field.
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

/** Problem strings for a raw config, empty when clean. Never throws; a
 *  non-object input yields one message. */
export function validateConfig(rawConfig: unknown): string[] {
  const problems: string[] = [];

  if (!isPlainObject(rawConfig)) {
    return [`Config must be an object, got ${typeName(rawConfig)}`];
  }

  for (const [key, value] of Object.entries(rawConfig)) {
    validateTopLevelEntry(key, value, problems);
  }
  validateLayoutOverridesToggles(rawConfig, problems);
  const zoneWarning = resolveCardTimeZone(rawConfig, undefined).warning;
  if (zoneWarning) problems.push(zoneWarning);
  if (parseLocation(rawConfig.location)
    && [undefined, null, ''].includes((rawConfig.location as { elevation?: unknown }).elevation as undefined)) {
    problems.push(
      'location set without elevation: snow line site comparison off; set location.elevation or click Determine',
    );
  }

  return problems;
}

// Still honoured, so not problems: kept out of `validateConfig` and shown
// by the editor as one hint line.
const DEPRECATED_TOP_LEVEL_KEYS: Readonly<Record<string, string>> = {
  elevation: 'location.elevation', // removal announced for 4.0
};

export interface DeprecatedOption {
  key: string;
  replacement: string;
}

export function deprecatedOptions(rawConfig: unknown): DeprecatedOption[] {
  if (!isPlainObject(rawConfig)) return [];
  return Object.entries(DEPRECATED_TOP_LEVEL_KEYS)
    .filter(([key]) => rawConfig[key] !== undefined && rawConfig[key] !== null)
    .map(([key, replacement]) => ({ key, replacement }));
}

// `attributes_layout` (ADR-0025): a list of columns of row tokens. A bare
// token in place of a column is accepted by the renderer, so not flagged.
function validateAttributesLayout(value: unknown, problems: string[]): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    problems.push(
      `Wrong type for \`attributes_layout\`: expected a list of columns, got ${typeName(value)}`,
    );
    return;
  }
  const checkToken = (token: unknown, where: string): void => {
    if (isAttributeToken(token)) return;
    if (typeof token !== 'string') {
      problems.push(
        `Wrong type for \`${where}\`: expected a row name, got ${typeName(token)}`,
      );
      return;
    }
    const hint = suggest(token, ATTRIBUTE_TOKENS);
    const suffix = hint ? ` — did you mean \`${hint}\`?` : '';
    problems.push(`Unknown row in \`${where}\`: \`${token}\`${suffix}`);
  };
  value.forEach((column, ci) => {
    if (Array.isArray(column)) {
      column.forEach((token, ri) => checkToken(token, `attributes_layout[${ci}][${ri}]`));
    } else {
      checkToken(column, `attributes_layout[${ci}]`);
    }
  });
}

// An explicit layout decides row visibility, so `show_*` toggles beside it do
// nothing. One combined hint, since a UI-created card writes every toggle.
function validateLayoutOverridesToggles(
  rawConfig: Record<string, unknown>,
  problems: string[],
): void {
  if (!hasExplicitLayout(rawConfig)) return;
  const ignored = ATTRIBUTE_TOKENS
    .map(showKeyOf)
    .filter((key) => rawConfig[key] !== undefined);
  if (ignored.length === 0) return;
  const list = ignored.map((k) => '`' + k + '`').join(', ');
  problems.push(
    '`attributes_layout` is set, so ' + list
    + ' will be ignored — the layout decides which attribute rows are shown',
  );
}

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
  if (key === 'attributes_layout') {
    validateAttributesLayout(value, problems);
    return;
  }
  if (key === 'location') {
    if (value !== undefined && value !== null && parseLocation(value) === null) {
      problems.push(
        '`location` is ignored (Home Assistant\'s location is used): expected'
        + ' `latitude` (-90..90) and `longitude` (-180..180) as numbers',
      );
    } else if (isPlainObject(value)) {
      checkValueType('location.elevation', (value as Record<string, unknown>).elevation, 0, problems);
    }
    return;
  }
  if (key === 'elevation') {
    checkValueType(key, value, 0, problems);
    return;
  }
  if (OPAQUE_OBJECT_KEYS.has(key)) {
    if (value !== undefined && value !== null && !isPlainObject(value)) {
      problems.push(
        `Wrong type for \`${key}\`: expected an object, got ${typeName(value)}`,
      );
    } else if (key === 'source_labels' && isPlainObject(value)) {
      // The three label slots are shown as text, so they must be strings.
      for (const [slot, text] of Object.entries(value as Record<string, unknown>)) {
        if (text !== undefined && text !== null && typeof text !== 'string') {
          problems.push(
            `Wrong type for \`source_labels.${slot}\`: expected a string, got ${typeName(text)}`,
          );
        }
      }
    }
    return;
  }
  if (key in DEFAULTS) {
    checkValueType(
      key,
      value,
      (DEFAULTS as Record<string, unknown>)[key],
      problems,
    );
  }
}
