// @vitest-environment jsdom
// show_sources on the card (#431): live-source recording, the info
// button (absent / muted / accent, placement) and the popup it opens.

import { describe, it, expect, vi, afterEach } from 'vitest';
import '../src/main.js';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };

const metNo = {
  state: 'partlycloudy',
  attributes: {
    temperature: -2.3,
    temperature_unit: '°C',
    humidity: 91,
    pressure: 1029,
    pressure_unit: 'hPa',
    wind_speed: 3.6,
    wind_bearing: 26,
    wind_speed_unit: 'km/h',
  },
};

const sensor = (state, unit, extra = {}) => ({ state, attributes: { unit_of_measurement: unit }, ...extra });

const baseStates = () => ({
  'weather.home': metNo,
  'sensor.temp': sensor('-2.1', '°C'),
  'sensor.hum': sensor('90', '%'),
  'sensor.wind': sensor('5.4', 'km/h'),
});

const makeHass = (states) => ({
  states,
  config: { latitude: 46.9, longitude: 7.4, time_zone: 'Europe/Zurich', unit_system: { temperature: '°C' } },
  language: 'en',
});

async function mountCard(states, extra = {}) {
  const card = document.createElement('weather-station-card');
  card.setConfig({
    show_station: false,
    show_forecast: false,
    show_main: true,
    show_attributes: true,
    show_humidity: true,
    show_pressure: true,
    show_wind_speed: true,
    show_wind_direction: false,
    show_dew_point: false,
    show_sources: true,
    weather_entity: 'weather.home',
    sensors: { temperature: 'sensor.temp', humidity: 'sensor.hum', wind_speed: 'sensor.wind' },
    ...extra,
  });
  card.hass = makeHass(states);
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const button = (card) => card.shadowRoot.querySelector('.wsc-sources-info');
const buttonLink = (card) => button(card)?.querySelector('[role="button"]');
const popupLines = (card) =>
  [...card.shadowRoot.querySelectorAll('.wsc-src-line:not(.wsc-src-legend)')];

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('show_sources: info button', () => {
  it('is absent when the option is off', async () => {
    const card = await mountCard(baseStates(), { show_sources: false });
    expect(button(card)).toBeNull();
    expect(card.shadowRoot.querySelector('[data-wsc-token]')).toBeNull();
  });

  it('is on by default', async () => {
    const card = await mountCard(baseStates());
    const cfg = { ...card.config };
    delete cfg.show_sources;
    card.setConfig(cfg);
    await card.updateComplete;
    expect(card.config.show_sources).toBe(true);
    expect(button(card)).not.toBeNull();
  });

  it('sits in the top-right corner before the clock, muted while every value is from the station', async () => {
    // Pressure has no sensor and would fall back: hide it for this case.
    const card = await mountCard(baseStates(), { show_pressure: false });
    const btn = button(card);
    expect(btn).not.toBeNull();
    expect(btn.closest('.main')).not.toBeNull();
    expect(btn.classList.contains('wsc-sources-corner')).toBe(true);
    const clock = card.shadowRoot.querySelector('.current-time');
    if (clock) {
      expect(btn.parentElement).toBe(clock.parentElement);
      expect(btn.compareDocumentPosition(clock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(btn.classList.contains('wsc-sources-alert')).toBe(false);
    const link = buttonLink(card);
    expect(link.getAttribute('aria-haspopup')).toBe('dialog');
    expect(link.getAttribute('tabindex')).toBe('0');
    expect(link.textContent.trim()).toBe('Data sources');
    expect(link.querySelector('ha-icon').getAttribute('icon')).toBe('mdi:information-outline');
  });

  it('stays grey when a value comes from the weather entity by design', async () => {
    const card = await mountCard(baseStates());
    expect(card._liveSources.pressure).toEqual({ kind: 'weather', entityId: 'weather.home' });
    expect(button(card).classList.contains('wsc-sources-alert')).toBe(false);
    expect(buttonLink(card).querySelector('ha-icon').getAttribute('icon')).toBe('mdi:information-outline');
    buttonLink(card).click();
    const p = popupLines(card).find((l) => l.textContent.includes('Pressure'));
    expect(p.classList.contains('wsc-src-problem')).toBe(false);
  });

  it('warns when a configured sensor is unavailable and the weather entity stands in', async () => {
    // Weather entity carries humidity, sensor has no last good value yet.
    const states = baseStates();
    states['sensor.hum'] = sensor('unavailable', '%', { last_changed: '2026-11-08T08:12:00Z' });
    const card = await mountCard(states, { show_pressure: false });
    expect(card._liveSources.humidity.kind).toBe('weather');
    expect(card._liveSources.humidity.sensorId).toBe('sensor.hum');
    expect(button(card).classList.contains('wsc-sources-alert')).toBe(true);
    const link = buttonLink(card);
    expect(link.querySelector('ha-icon').getAttribute('icon')).toBe('mdi:alert-circle-outline');
    expect(link.textContent.trim()).toBe('Data sources: sensor problem');
    link.click();
    const hum = popupLines(card).find((l) => l.textContent.includes('Humidity'));
    expect(hum.classList.contains('wsc-src-problem')).toBe(true);
    expect(hum.textContent).toContain('Weather service');
    expect(hum.textContent).toContain('sensor.hum unavailable since 09:12');
  });

  it('warns when a station sensor is stale', async () => {
    const card = await mountCard(baseStates(), { show_pressure: false });
    const states = baseStates();
    states['sensor.hum'] = sensor('unavailable', '%', { last_changed: '2026-11-08T08:12:00Z' });
    card.hass = makeHass(states);
    await card.updateComplete;
    expect(card._liveSources.humidity).toEqual({ kind: 'stale', entityId: 'sensor.hum' });
    expect(button(card).classList.contains('wsc-sources-alert')).toBe(true);
  });

  it('moves next to the chart mode toggle when the live block is hidden', async () => {
    const card = await mountCard(baseStates(), { show_main: false });
    expect(card.shadowRoot.querySelector('.main')).toBeNull();
    // The chart block is on screen here although no series is enabled,
    // so render the chart placement directly.
    card.config = { ...card.config, show_station: true };
    const host = document.createElement('div');
    const { render } = await import('lit');
    render(card._renderSourcesButton('chart'), host);
    const btn = host.querySelector('.wsc-sources-info');
    expect(btn.classList.contains('wsc-sources-chart')).toBe(true);
    expect(btn.classList.contains('wsc-sources-corner')).toBe(false);
    expect(btn.classList.contains('wsc-sources-chart-alone')).toBe(false);
    card.config = { ...card.config, forecast: { ...card.config.forecast, show_mode_toggle: false } };
    render(card._renderSourcesButton('chart'), host);
    expect(host.querySelector('.wsc-sources-info').classList.contains('wsc-sources-chart-alone')).toBe(true);
  });

  it('has no button when both the live block and the chart are hidden', async () => {
    const card = await mountCard(baseStates(), { show_main: false });
    expect(button(card)).toBeNull();
  });
});

describe('show_sources: popup', () => {
  it('lists every shown value with its source, in the card order', async () => {
    const card = await mountCard(baseStates());
    buttonLink(card).click();
    expect(card.shadowRoot.querySelector('.wsc-src-panel[role="dialog"]')).not.toBeNull();
    const lines = popupLines(card).map((l) => ({ kind: l.dataset.kind, text: l.textContent.replace(/\s+/g, ' ').trim() }));
    expect(lines[0]).toEqual({ kind: 'station', text: 'Temperature -2.1°C · Station · sensor.temp' });
    const byKind = Object.fromEntries(lines.map((l) => [l.text.split(' ')[0], l]));
    expect(byKind.Pressure).toEqual({ kind: 'weather', text: 'Pressure 1029 hPa · Weather service · weather.home' });
    expect(byKind.Humidity.text).toBe('Humidity 90 % · Station · sensor.hum');
    expect(lines.some((l) => l.text.startsWith('Wind speed') && l.kind === 'station')).toBe(true);
  });

  it('names a stale sensor with the time it went unavailable', async () => {
    const card = await mountCard(baseStates());
    const states = baseStates();
    states['sensor.hum'] = sensor('unavailable', '%', { last_changed: '2026-11-08T08:12:00Z' });
    card.hass = makeHass(states);
    await card.updateComplete;
    buttonLink(card).click();
    const hum = popupLines(card).find((l) => l.textContent.includes('Humidity'));
    expect(hum.dataset.kind).toBe('stale');
    // 08:12 UTC is 09:12 in the card's zone (Europe/Zurich, CET).
    expect(hum.textContent).toContain('last value, unavailable since 09:12');
    expect(hum.textContent).toContain('90 %');
  });

  it('labels sun and moon as calculated from the location', async () => {
    const card = await mountCard(baseStates(), { show_sun: true, show_moon: true });
    buttonLink(card).click();
    const computed = popupLines(card).filter((l) => l.dataset.kind === 'computed');
    expect(computed.length).toBeGreaterThan(0);
    for (const l of computed) {
      expect(l.textContent).toContain('Calculated from the location');
      expect(l.getAttribute('role')).toBeNull();
    }
  });

  it('honours source_labels', async () => {
    const card = await mountCard(baseStates(), { source_labels: { station: 'Netatmo', weather: 'met.no' } });
    buttonLink(card).click();
    const texts = popupLines(card).map((l) => l.textContent);
    expect(texts[0]).toContain('Netatmo');
    expect(texts.some((t) => t.includes('met.no'))).toBe(true);
  });

  it('a popup line opens the entity more-info and closes the popup', async () => {
    const card = await mountCard(baseStates());
    const more = vi.fn();
    card.addEventListener('hass-more-info', more);
    buttonLink(card).click();
    popupLines(card).find((l) => l.dataset.kind === 'weather').click();
    expect(more).toHaveBeenCalledTimes(1);
    expect(more.mock.calls[0][0].detail).toEqual({ entityId: 'weather.home' });
    expect(card._sourcesPopup.isOpen).toBe(false);
  });

  it('opens with Enter, closes with Escape and returns focus to the button', async () => {
    const card = await mountCard(baseStates());
    const link = buttonLink(card);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(card._sourcesPopup.isOpen).toBe(true);
    card.shadowRoot.querySelector('.wsc-src-panel')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card._sourcesPopup.isOpen).toBe(false);
    expect(card.shadowRoot.activeElement).toBe(link);
  });

  it('opens with Space too', async () => {
    const card = await mountCard(baseStates());
    buttonLink(card).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(card._sourcesPopup.isOpen).toBe(true);
  });

  it('disconnecting the card closes the popup', async () => {
    const card = await mountCard(baseStates());
    buttonLink(card).click();
    const root = card.shadowRoot;
    card.remove();
    expect(root.querySelector('.wsc-src-backdrop')).toBeNull();
    expect(card._sourcesPopup.isOpen).toBe(false);
  });

  it('shows the chart section with the encodings when a chart is on', async () => {
    const card = await mountCard(baseStates());
    card.config = { ...card.config, show_station: true, show_forecast: true };
    const legend = card._sourceLegend(card.config).map((i) => i.text);
    expect(legend).toContain('Forecast: Weather service');
    expect(legend.some((t) => t.startsWith('Measured: '))).toBe(true);
    expect(legend.some((t) => /Forecast: Forecast/.test(t))).toBe(false);
  });

  it('has no chart section without a chart', async () => {
    const card = await mountCard(baseStates());
    expect(card._sourceLegend(card.config)).toEqual([]);
  });
});
