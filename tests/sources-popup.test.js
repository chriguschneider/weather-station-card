// @vitest-environment jsdom
// Data-sources popup DOM (#431): lines, legend, more-info, keyboard,
// focus return.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcesPopup, formatSourceLine, isExceptionKind } from '../src/sources-popup.js';

const STRINGS = { title: 'Data sources', close: 'Close', liveTitle: 'Live values', chartTitle: 'Chart' };

const LINES = [
  { label: 'Temperature', value: '0.2°C', kind: 'station', sourceText: 'Station', entityId: 'sensor.russisprung_temperature' },
  { label: 'Wind speed', value: '17 km/h', kind: 'weather', sourceText: 'Weather service', entityId: 'weather.kleine_scheidegg' },
  { label: 'Humidity', value: '40.5 %', kind: 'stale', sourceText: 'Station', entityId: 'sensor.hum', note: 'last value, unavailable since 09:12' },
  { label: 'Sun', value: '07:18 17:02', kind: 'computed', sourceText: 'Calculated from the location' },
];

const LEGEND = [
  { swatch: 'line', colors: ['#f00', '#00f'], text: 'High / Low' },
  { swatch: 'dash', colors: [], text: 'Forecast: Weather service' },
  { swatch: 'bar', colors: ['#0af'], text: 'Precipitation' },
];

let root;
beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
});

function open(extra = {}) {
  const popup = new SourcesPopup();
  popup.open({ root, lines: LINES, legend: LEGEND, strings: STRINGS, ...extra });
  return popup;
}

describe('formatSourceLine', () => {
  it('joins label, value, source, entity and note', () => {
    expect(formatSourceLine(LINES[0])).toBe('Temperature 0.2°C · Station · sensor.russisprung_temperature');
    expect(formatSourceLine(LINES[2])).toBe('Humidity 40.5 % · Station · sensor.hum · last value, unavailable since 09:12');
    expect(formatSourceLine(LINES[3])).toBe('Sun 07:18 17:02 · Calculated from the location');
  });

  it('flags weather and stale as exceptions only', () => {
    expect(['station', 'stale', 'weather', 'computed', 'info'].map(isExceptionKind))
      .toEqual([false, true, true, false, false]);
  });
});

describe('SourcesPopup', () => {
  it('renders both sections with one line per value and the legend', () => {
    open();
    const sections = [...root.querySelectorAll('.wsc-src-section')].map((n) => n.textContent);
    expect(sections).toEqual(['Live values', 'Chart']);
    const lines = [...root.querySelectorAll('.wsc-src-line:not(.wsc-src-legend)')];
    expect(lines.map((l) => l.dataset.kind)).toEqual(['station', 'weather', 'stale', 'computed']);
    expect(lines[1].classList.contains('wsc-src-exception')).toBe(true);
    expect(lines[2].classList.contains('wsc-src-exception')).toBe(true);
    expect(lines[0].classList.contains('wsc-src-exception')).toBe(false);
    expect(lines[0].textContent.replace(/\s+/g, ' ')).toBe('Temperature 0.2°C · Station · sensor.russisprung_temperature');
    // Computed values have no entity, so no button role.
    expect(lines[3].getAttribute('role')).toBeNull();
    expect(root.querySelectorAll('.wsc-src-legend')).toHaveLength(3);
    expect(root.querySelectorAll('.wsc-src-swatch-line.dashed')).toHaveLength(1);
  });

  it('omits the chart section when the legend is empty', () => {
    open({ legend: [] });
    expect([...root.querySelectorAll('.wsc-src-section')].map((n) => n.textContent)).toEqual(['Live values']);
  });

  it('opens more-info from a line by click and by Enter, closing first', () => {
    const onMoreInfo = vi.fn();
    const popup = open({ onMoreInfo });
    root.querySelector('[data-kind="weather"]').click();
    expect(onMoreInfo).toHaveBeenCalledWith('weather.kleine_scheidegg');
    expect(popup.isOpen).toBe(false);

    open({ onMoreInfo });
    root.querySelector('[data-kind="station"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onMoreInfo).toHaveBeenLastCalledWith('sensor.russisprung_temperature');
  });

  it('closes on Escape and returns focus to the opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const popup = open({ returnFocus: opener });
    expect(document.activeElement?.className).toBe('wsc-src-close');
    root.querySelector('.wsc-src-backdrop')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popup.isOpen).toBe(false);
    expect(root.querySelector('.wsc-src-backdrop')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a backdrop click and on ×, not on a panel click', () => {
    const popup = open();
    root.querySelector('.wsc-src-panel').click();
    expect(popup.isOpen).toBe(true);
    root.querySelector('.wsc-src-backdrop').click();
    expect(popup.isOpen).toBe(false);
    open().close();
    const p2 = open();
    root.querySelector('.wsc-src-close').click();
    expect(p2.isOpen).toBe(false);
  });

  it('wraps Tab focus inside the panel', () => {
    open({ onMoreInfo: () => {} });
    const close = root.querySelector('.wsc-src-close');
    const last = root.querySelector('[data-kind="stale"]');
    last.focus();
    root.querySelector('.wsc-src-backdrop')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(close);
  });

  it('close is idempotent', () => {
    const popup = open();
    popup.close();
    expect(() => popup.close()).not.toThrow();
  });
});
