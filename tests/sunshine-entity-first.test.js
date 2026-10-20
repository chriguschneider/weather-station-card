// @vitest-environment jsdom
// Sunshine bar, entity first (ADR-0028): a forecast entry's own
// `sunshine_duration` (minutes) wins, Open-Meteo and the cloud-cover
// estimate fill only the gaps, and the Open-Meteo request is skipped
// when the entity covers every visible column.

import { describe, it, expect } from 'vitest';
import '../src/main.js';
import {
  attachEntitySunshine,
  attachSunshine,
  entitySunshineHours,
  forecastCoversSunshine,
} from '../src/sunshine-source.js';

describe('entitySunshineHours', () => {
  it('converts minutes to hours', () => {
    expect(entitySunshineHours({ sunshine_duration: 45 })).toBe(0.75);
    expect(entitySunshineHours({ sunshine_duration: 600 })).toBe(10);
    expect(entitySunshineHours({ sunshine_duration: 0 })).toBe(0);
  });

  it('accepts numeric strings and clamps negatives to 0', () => {
    expect(entitySunshineHours({ sunshine_duration: '30' })).toBe(0.5);
    expect(entitySunshineHours({ sunshine_duration: -5 })).toBe(0);
  });

  it('returns null when the entry has no usable value', () => {
    expect(entitySunshineHours({})).toBe(null);
    expect(entitySunshineHours({ sunshine_duration: null })).toBe(null);
    expect(entitySunshineHours({ sunshine_duration: '' })).toBe(null);
    expect(entitySunshineHours({ sunshine_duration: 'unknown' })).toBe(null);
    expect(entitySunshineHours(null)).toBe(null);
  });
});

describe('attachEntitySunshine', () => {
  it('sets sunshine in hours and leaves entries without a value alone', () => {
    const input = [
      { datetime: '2026-10-20T00:00:00Z', sunshine_duration: 120 },
      { datetime: '2026-10-21T00:00:00Z' },
    ];
    const out = attachEntitySunshine(input);
    expect(out[0].sunshine).toBe(2);
    expect('sunshine' in out[1]).toBe(false);
    expect(input[0].sunshine).toBeUndefined();
  });

  it('survives attachSunshine, which fills only the entries without one', () => {
    const entries = attachEntitySunshine([
      { datetime: '2026-10-20T12:00:00', sunshine_duration: 120 },
      { datetime: '2026-10-21T12:00:00' },
    ]);
    const out = attachSunshine(entries, {
      dailyValues: [
        { date: '2026-10-20', value: 9 },
        { date: '2026-10-21', value: 5 },
      ],
      latitude: 46.9,
    });
    expect(out[0].sunshine).toBe(2);
    expect(out[1].sunshine).toBe(5);
  });
});

describe('forecastCoversSunshine', () => {
  it('is true only when every entry carries the value', () => {
    expect(forecastCoversSunshine([{ sunshine_duration: 10 }, { sunshine_duration: 0 }])).toBe(true);
    expect(forecastCoversSunshine([{ sunshine_duration: 10 }, {}])).toBe(false);
  });

  it('counts an empty or missing slice as covered', () => {
    expect(forecastCoversSunshine([])).toBe(true);
    expect(forecastCoversSunshine(null)).toBe(true);
  });
});

describe('card: _sunshineNeedsOpenMeteo', () => {
  const DAY = 24 * 3600 * 1000;
  const days = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
    datetime: new Date(Date.now() + (i + 1) * DAY).toISOString(),
    ...extra,
  }));

  function setup(config, forecastData) {
    const card = document.createElement('weather-station-card');
    card.setConfig({ weather_entity: 'weather.home', show_forecast: true, ...config });
    card._forecastData = forecastData;
    return card;
  }

  it('is false while the sunshine bar is off', () => {
    const card = setup({ show_station: false, forecast: { show_sunshine: false } }, days(5));
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(false);
  });

  it('is false when the entity covers every forecast column', () => {
    const card = setup(
      { show_station: false, forecast: { show_sunshine: true } },
      days(5, { sunshine_duration: 300 }),
    );
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(false);
  });

  it('is true when one forecast column has no sunshine', () => {
    const data = days(5, { sunshine_duration: 300 });
    delete data[3].sunshine_duration;
    const card = setup({ show_station: false, forecast: { show_sunshine: true } }, data);
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(true);
  });

  it('treats a forecast that has not arrived yet as covered', () => {
    const card = setup({ show_station: false, forecast: { show_sunshine: true } }, null);
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(false);
  });

  it('is false for a daily station block with a sunshine sensor and a covering entity', () => {
    const card = setup({
      sensors: { temperature: 'sensor.t', sunshine_duration: 'sensor.sun' },
      forecast: { show_sunshine: true, type: 'daily' },
    }, days(5, { sunshine_duration: 300 }));
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(false);
  });

  it('is true for a station block with no sunshine or illuminance sensor', () => {
    const card = setup({
      sensors: { temperature: 'sensor.t' },
      forecast: { show_sunshine: true, type: 'daily' },
    }, days(5, { sunshine_duration: 300 }));
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(true);
  });

  it('is true for an hourly station block even with a sunshine sensor', () => {
    const card = setup({
      sensors: { temperature: 'sensor.t', sunshine_duration: 'sensor.sun' },
      forecast: { show_sunshine: true, type: 'hourly' },
    }, null);
    expect(card._sunshineNeedsOpenMeteo(card.config)).toBe(true);
  });
});
