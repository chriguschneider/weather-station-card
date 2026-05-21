// @vitest-environment jsdom
// Mode-aware completeness check in setConfig — the non-fatal
// `_configError` banner. Each enabled block has a required key:
// show_station -> sensors.temperature, show_forecast -> weather_entity.
// The temperature requirement is waived when the Open-Meteo no-station
// fallback is active (ADR-0015).

import { describe, it, expect } from 'vitest';
import '../src/main.js';

function setup(config) {
  const card = document.createElement('weather-station-card');
  card.setConfig(config);
  return card;
}

describe('setConfig completeness check — _configError', () => {
  it('flags a missing temperature sensor in station mode', () => {
    const card = setup({ show_station: true, show_forecast: false });
    expect(card._configError).toContain('temperature sensor');
  });

  it('clears once a temperature sensor is configured', () => {
    const card = setup({
      show_station: true, show_forecast: false,
      sensors: { temperature: 'sensor.t' },
    });
    expect(card._configError).toBe(null);
  });

  it('flags a missing weather entity in forecast mode', () => {
    const card = setup({ show_station: false, show_forecast: true });
    expect(card._configError).toContain('weather entity');
  });

  it('does NOT flag a missing temperature sensor when the Open-Meteo fallback is active', () => {
    // No sensors + a weather entity + the opt-in → the past block is
    // backfilled from Open-Meteo, so there is nothing to warn about.
    const card = setup({
      show_station: true,
      show_forecast: true,
      weather_entity: 'weather.home',
      forecast: { openmeteo_history: true },
    });
    expect(card._configError).toBe(null);
  });

  it('still flags the missing temperature sensor when the opt-in is off', () => {
    const card = setup({
      show_station: true,
      show_forecast: true,
      weather_entity: 'weather.home',
      forecast: { openmeteo_history: false },
    });
    expect(card._configError).toContain('temperature sensor');
  });
});
