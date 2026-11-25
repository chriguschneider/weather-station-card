// @vitest-environment jsdom
// show_apparent_temperature (#562): the optional "Feels like" line under
// the current temperature. Sensor first, weather attribute second, never
// computed; display units apply (ADR-0035).

import { describe, it, expect, afterEach } from 'vitest';
import '../src/main.js';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };

const wx = (extra = {}) => ({
  state: 'cloudy',
  attributes: { temperature: -2.3, temperature_unit: '°C', ...extra },
});
const sensor = (state, unit) => ({ state, attributes: { unit_of_measurement: unit } });

async function mountCard(states, extra = {}, hassConfig = {}) {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_station: false,
    show_forecast: false,
    show_main: true,
    weather_entity: 'weather.home',
    sensors: { temperature: 'sensor.temp' },
    ...extra,
  });
  card.hass = {
    states,
    config: { latitude: 46.9, longitude: 7.4, time_zone: 'Europe/Zurich', unit_system: { temperature: '°C' }, ...hassConfig },
    language: 'en',
  };
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const line = (card) => card.shadowRoot.querySelector('.feels-like');
const baseStates = (wxExtra = {}) => ({
  'weather.home': wx(wxExtra),
  'sensor.temp': sensor('-2.1', '°C'),
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('feels-like line', () => {
  it('shows the sensor value and unit, linked to the sensor', async () => {
    const states = { ...baseStates(), 'sensor.feels': sensor('-4.4', '°C') };
    const card = await mountCard(states, {
      show_apparent_temperature: true,
      sensors: { temperature: 'sensor.temp', apparent_temperature: 'sensor.feels' },
    });
    expect(line(card).textContent.replace(/\s+/g, ' ').trim()).toBe('Feels like -4.4 °C');
    let opened;
    card.addEventListener('hass-more-info', (e) => { opened = e.detail.entityId; });
    line(card).querySelector('[role="button"]').click();
    expect(opened).toBe('sensor.feels');
  });

  it('falls back to the weather entity attribute, linked to the entity', async () => {
    const card = await mountCard(baseStates({ apparent_temperature: -5 }), { show_apparent_temperature: true });
    expect(line(card).textContent.replace(/\s+/g, ' ').trim()).toBe('Feels like -5 °C');
    let opened;
    card.addEventListener('hass-more-info', (e) => { opened = e.detail.entityId; });
    line(card).querySelector('[role="button"]').click();
    expect(opened).toBe('weather.home');
  });

  it('prefers the sensor over the attribute', async () => {
    const states = { ...baseStates({ apparent_temperature: -5 }), 'sensor.feels': sensor('-4.4', '°C') };
    const card = await mountCard(states, {
      show_apparent_temperature: true,
      sensors: { temperature: 'sensor.temp', apparent_temperature: 'sensor.feels' },
    });
    expect(line(card).textContent).toContain('-4.4');
    expect(line(card).textContent).not.toContain('-5');
  });

  it('renders no line without a sensor and without an attribute', async () => {
    const card = await mountCard(baseStates(), { show_apparent_temperature: true });
    expect(line(card)).toBeNull();
  });

  it('is off by default, and a legacy show_feels_like adds nothing', async () => {
    const states = { ...baseStates({ apparent_temperature: -5 }), 'sensor.feels': sensor('-4.4', '°C') };
    const sensors = { temperature: 'sensor.temp', apparent_temperature: 'sensor.feels' };
    const off = await mountCard(states, { sensors });
    expect(line(off)).toBeNull();
    document.body.innerHTML = '';
    const legacy = await mountCard(states, { sensors, show_feels_like: true });
    expect(line(legacy)).toBeNull();
  });

  it('converts a °F sensor on a °C card like the current temperature', async () => {
    const states = { ...baseStates(), 'sensor.feels': sensor('23', '°F') };
    const card = await mountCard(states, {
      show_apparent_temperature: true,
      sensors: { temperature: 'sensor.temp', apparent_temperature: 'sensor.feels' },
    });
    expect(line(card).textContent.replace(/\s+/g, ' ').trim()).toBe('Feels like -5 °C');
  });
});
