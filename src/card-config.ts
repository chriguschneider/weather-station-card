// The card's resolved configuration: user YAML merged over DEFAULTS and
// normalised once, in `setConfig` (ADR-0008). Everything downstream
// reads the normalised values instead of re-parsing raw YAML.

import { DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS } from './defaults.js';

// DEFAULTS is `as const`; widen its literals so a user value of the
// same kind fits (`days: 14`, `forecast.type: 'hourly'`).
type Widen<T> =
  T extends string ? string
    : T extends number ? number
      : T extends boolean ? boolean
        : T extends ReadonlyArray<infer U> ? ReadonlyArray<Widen<U>>
          : T extends object ? { -readonly [K in keyof T]: Widen<T[K]> }
            : T;

export type CardForecastConfig = Widen<typeof DEFAULTS_FORECAST> & Record<string, unknown>;

export type CardConfig = Omit<Widen<typeof DEFAULTS>, 'forecast' | 'sensors' | 'units'> & {
  forecast: CardForecastConfig;
  units: Widen<typeof DEFAULTS_UNITS> & { speed?: string } & Record<string, unknown>;
  sensors: Record<string, string | undefined>;
  condition_mapping?: { sunshine_cloud_exponent?: number | null } & Record<string, unknown>;
  location?: unknown;
  [key: string]: unknown;
};

interface RawConfig {
  forecast?: Record<string, unknown> | null;
  units?: Record<string, unknown> | null;
  sensors?: Record<string, unknown> | null;
  speed?: string;
  [key: string]: unknown;
}

/** `value` as a positive integer, `fallback` for anything else. */
export function positiveInt(value: unknown, fallback: number): number {
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Merge user YAML over DEFAULTS and normalise the values several
 *  modules read: `days` (past window) and `forecast_days` (forecast
 *  window, `days` when unset or invalid) become positive integers. */
export function normalizeConfig(config: unknown): CardConfig {
  const raw: RawConfig = config && typeof config === 'object' ? (config as RawConfig) : {};
  const cardConfig = {
    ...DEFAULTS,
    ...raw,
    forecast: {
      ...DEFAULTS_FORECAST,
      ...(raw.forecast || {}),
    },
    units: {
      ...DEFAULTS_UNITS,
      ...(raw.units || {}),
    },
    sensors: {
      ...(raw.sensors || {}),
    },
  } as CardConfig;
  cardConfig.units.speed = raw.speed ? raw.speed : cardConfig.units.speed;
  cardConfig.days = positiveInt(cardConfig.days, DEFAULTS.days);
  cardConfig.forecast_days = positiveInt(cardConfig.forecast_days, cardConfig.days);
  return cardConfig;
}
