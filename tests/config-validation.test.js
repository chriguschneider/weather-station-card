import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config-validation.js';
import {
  DEFAULTS,
  DEFAULTS_FORECAST,
  DEFAULTS_UNITS,
} from '../src/defaults.js';

// A minimal but structurally valid combination-mode config.
function validBaseConfig() {
  return {
    type: 'custom:weather-station-card',
    sensors: { temperature: 'sensor.outdoor_temperature' },
    weather_entity: 'weather.home',
  };
}

describe('validateConfig — clean configs pass', () => {
  it('returns no problems for a minimal valid config', () => {
    expect(validateConfig(validBaseConfig())).toEqual([]);
  });

  it('returns no problems for an empty config', () => {
    expect(validateConfig({})).toEqual([]);
  });

  it('accepts the full DEFAULTS object as a config', () => {
    // DEFAULTS is the merge floor — every key in it must be considered
    // valid, or the validator would warn about its own defaults.
    expect(validateConfig({ ...DEFAULTS })).toEqual([]);
  });

  it('accepts every documented top-level key with a correct-typed value', () => {
    const cfg = {
      ...validBaseConfig(),
      title: 'My weather',
      locale: 'de',
      speed: 'km/h',
      condition_mapping: { rainy_threshold_mm: 0.3 },
      tap_action: { action: 'more-info' },
      hold_action: { action: 'navigate', navigation_path: '/x' },
      double_tap_action: { action: 'none' },
      show_station: true,
      show_forecast: true,
      days: 7,
      forecast_days: 7,
      icons_size: 25,
    };
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('accepts every DEFAULTS_FORECAST key under forecast', () => {
    const cfg = { ...validBaseConfig(), forecast: { ...DEFAULTS_FORECAST } };
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('accepts every DEFAULTS_UNITS key plus speed under units', () => {
    const cfg = {
      ...validBaseConfig(),
      units: { ...DEFAULTS_UNITS, speed: 'mph' },
    };
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('accepts station-only mode config', () => {
    const cfg = {
      show_station: true,
      show_forecast: false,
      sensors: { temperature: 'sensor.t', humidity: 'sensor.h' },
    };
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('accepts forecast-only mode config', () => {
    const cfg = {
      show_station: false,
      show_forecast: true,
      weather_entity: 'weather.home',
      forecast: { type: 'hourly', number_of_forecasts: 12 },
    };
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('does not flag a null-valued known key (user clearing a value)', () => {
    expect(validateConfig({ ...validBaseConfig(), title: null })).toEqual([]);
  });
});

describe('validateConfig — unknown keys', () => {
  it('flags an unknown top-level key', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      not_a_real_key: true,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Unknown option');
    expect(problems[0]).toContain('not_a_real_key');
  });

  it('flags an unknown nested forecast key', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      forecast: { bogus_forecast_key: 1 },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Unknown option');
    expect(problems[0]).toContain('forecast.bogus_forecast_key');
  });

  it('flags an unknown nested units key', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      units: { temperatuer: 'C' },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('units.temperatuer');
  });

  it('does not descend into opaque object keys (sensors / condition_mapping)', () => {
    // sensors slots and condition_mapping thresholds are open-ended —
    // an unfamiliar key inside them must NOT be flagged.
    const problems = validateConfig({
      ...validBaseConfig(),
      sensors: { temperature: 'sensor.t', some_custom_slot: 'sensor.x' },
      condition_mapping: { custom_threshold: 9 },
    });
    expect(problems).toEqual([]);
  });
});

describe('validateConfig — typo suggestions', () => {
  it('suggests the correct key for a near-miss top-level typo', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      forcast_days: 5,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('forcast_days');
    expect(problems[0]).toContain('did you mean');
    expect(problems[0]).toContain('forecast_days');
  });

  it('suggests the correct nested key for a forecast typo', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      forecast: { chart_hieght: 200 },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('forecast.chart_hieght');
    expect(problems[0]).toContain('did you mean');
    expect(problems[0]).toContain('forecast.chart_height');
  });

  it('omits a suggestion when no key is close enough', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      completely_unrelated_xyz: true,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain('did you mean');
  });
});

describe('validateConfig — wrong value types', () => {
  it('flags a string where a boolean is expected', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      show_station: 'yes',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Wrong type');
    expect(problems[0]).toContain('show_station');
    expect(problems[0]).toContain('boolean');
  });

  it('flags a string where a number is expected', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      forecast_days: '7',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Wrong type');
    expect(problems[0]).toContain('forecast_days');
    expect(problems[0]).toContain('number');
  });

  it('flags a wrong-typed nested forecast value', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      forecast: { chart_height: 'tall' },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Wrong type');
    expect(problems[0]).toContain('forecast.chart_height');
  });

  it('flags a list passed where an object is expected', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      forecast: ['daily'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Wrong type');
    expect(problems[0]).toContain('forecast');
    expect(problems[0]).toContain('list');
  });

  it('flags a non-object passed for an opaque object key', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      tap_action: 'navigate',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Wrong type');
    expect(problems[0]).toContain('tap_action');
  });
});

describe('validateConfig — non-object input', () => {
  it('returns a descriptive message for null', () => {
    const problems = validateConfig(null);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Config must be an object');
  });

  it('returns a descriptive message for a string', () => {
    const problems = validateConfig('not a config');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Config must be an object');
  });

  it('returns a descriptive message for an array', () => {
    const problems = validateConfig([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('list');
  });

  it('never throws on undefined input', () => {
    expect(() => validateConfig(undefined)).not.toThrow();
    expect(validateConfig(undefined)).toHaveLength(1);
  });
});

describe('validateConfig — multiple problems', () => {
  it('reports every problem in one pass', () => {
    const problems = validateConfig({
      ...validBaseConfig(),
      forcast_days: 5, // typo
      show_station: 'yes', // wrong type
      forecast: { totally_bogus: 1 }, // unknown nested
    });
    expect(problems).toHaveLength(3);
  });
});
