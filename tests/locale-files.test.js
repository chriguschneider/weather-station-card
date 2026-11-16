// @vitest-environment jsdom
// The loader map in locale.ts is a hand-kept list (ADR-0013); these
// tests fail when it drifts from src/locales, and when a non-English
// card renders an empty label.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { render } from 'lit';
import locale, { ensureLocaleLoaded } from '../src/locale.js';
import '../src/main.js';

const files = fs.readdirSync('src/locales')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((l) => l !== 'en');

const loaderKeys = [...fs.readFileSync('src/locale.ts', 'utf8')
  .matchAll(/^\s+'?([A-Za-z-]+)'?: \(\) => import\(/gm)].map((m) => m[1]);

describe('locale loaders', () => {
  it('loader keys equal the files in src/locales', () => {
    expect([...loaderKeys].sort()).toEqual([...files].sort());
  });

  it.each(files)('%s loads through ensureLocaleLoaded', async (lang) => {
    await ensureLocaleLoaded(lang);
    expect(locale[lang]).toBeTruthy();
  });
});

// The 3-hour pressure change is shown in the row's unit (ADR-0035).
describe('pressure tooltip template', () => {
  it.each(['en', ...files])('%s takes the unit as {unit}', async (lang) => {
    await ensureLocaleLoaded(lang);
    const template = locale[lang].pressure_tooltip_template;
    expect(template).toContain('{unit}');
    expect(template).not.toContain('hPa');
  });
});

// ADR-0035, point 6: a unit reaches a text as {unit} or from the `units`
// table, so a string never names one itself. `in` is not on the list: it
// is a word in English, German, Italian, Dutch and Swedish.
const UNIT_IN_TEXT = /(?<!\p{L})(?:°C|°F|hPa|mbar|kPa|inHg|mmHg|m\/s|km\/h|mph|kn|Bft|mm|cm|mm\/h|in\/h|lx|W\/m²)(?!\p{L})/u;
// The hint quotes the chart's label ("mm %") as an example.
const UNIT_EXEMPT_PATHS = new Set(['editor.show_chart_precip_probability_hint']);
// "0 °C" is the name of the zero-degree level, not a reading.
const ZERO_DEGREE_NAME = /(?<![\d.,])0 °C/g;

describe('no hard-coded unit outside the units table', () => {
  it.each(['en', ...files])('%s', async (lang) => {
    await ensureLocaleLoaded(lang);
    const hits = [];
    const walk = (v, path) => {
      if (typeof v === 'string') {
        if (!UNIT_EXEMPT_PATHS.has(path) && UNIT_IN_TEXT.test(v.replace(ZERO_DEGREE_NAME, ''))) hits.push(`${path}: ${v}`);
      } else if (v && typeof v === 'object') {
        for (const [k, c] of Object.entries(v)) walk(c, path ? `${path}.${k}` : k);
      }
    };
    for (const [k, v] of Object.entries(locale[lang])) if (k !== 'units') walk(v, k);
    expect(hits).toEqual([]);
  });
});

describe('card rendered in French', () => {
  it('the French table has no empty strings', async () => {
    await ensureLocaleLoaded('fr');
    const empty = [];
    const walk = (v, path) => {
      if (typeof v === 'string') { if (v.trim() === '') empty.push(path); }
      else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, `${path}.${k}`);
    };
    walk(locale.fr, 'fr');
    expect(empty).toEqual([]);
  });

  it('has no empty labels in the live panel', async () => {
    await ensureLocaleLoaded('fr');
    const card = document.createElement('weather-station-card');
    card.setConfig({
      show_main: true,
      show_attributes: true,
      show_wind_speed: false,
      show_wind_direction: false,
      sensors: { temperature: 'sensor.t', humidity: 'sensor.h', pressure: 'sensor.p' },
    });
    card.language = 'fr';
    const states = {
      'sensor.t': { state: '20', attributes: { unit_of_measurement: '°C' } },
      'sensor.h': { state: '50', attributes: { unit_of_measurement: '%' } },
      'sensor.p': { state: '1013', attributes: { unit_of_measurement: 'hPa' } },
    };
    card.hass = { states, language: 'fr', config: { time_zone: 'Europe/Zurich', state: 'RUNNING' } };
    const host = document.createElement('div');
    render(card.renderAttributes(), host);
    const text = host.textContent.replace(/\s+/g, ' ').trim();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('hPa');
    expect(text).not.toMatch(/\bundefined\b|\bNaN\b/);
  });
});
