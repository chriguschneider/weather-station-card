// @vitest-environment jsdom
// Zero-degree popup (#330): the forecast curve behind the 48 h sensor's
// `forecast` attribute, opened from either zero-degree row.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseZeroDegreeCurve,
  findCurveMinimum,
  paddedLevelRange,
  dayStartsBetween,
  formatLowest,
  findWindowMinimum,
  formatCurveRange,
  buildZeroDegreeChart,
  ZeroDegreePopup,
} from '../src/zero-degree-popup.js';
import { setCardTimeZone } from '../src/utils/time-zone.js';
import { _clearIntlCaches } from '../src/utils/intl-cache.js';
import '../src/main.js';

// Shape of the hass-meteoswiss-weather attribute (issue #225 there):
// hourly rows, ISO datetimes with offset, level in the sensor's unit.
const ROWS = [
  { datetime: '2026-10-21T07:00:00+02:00', level: 2722 },
  { datetime: '2026-10-21T08:00:00+02:00', level: 2650 },
  { datetime: '2026-10-22T05:00:00+02:00', level: 1585 },
  { datetime: '2026-10-22T06:00:00+02:00', level: 1610 },
  { datetime: '2026-10-23T12:00:00+02:00', level: 2100 },
];

const ms = (iso) => Date.parse(iso);

beforeEach(() => {
  setCardTimeZone('Europe/Zurich');
  _clearIntlCaches();
});

afterEach(() => {
  setCardTimeZone(undefined);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('parseZeroDegreeCurve', () => {
  it('returns null for anything but an array', () => {
    expect(parseZeroDegreeCurve(undefined)).toBeNull();
    expect(parseZeroDegreeCurve('2722')).toBeNull();
    expect(parseZeroDegreeCurve({ datetime: 'x', level: 1 })).toBeNull();
  });

  it('sorts unsorted input ascending', () => {
    const curve = parseZeroDegreeCurve([ROWS[2], ROWS[0], ROWS[1]]);
    expect(curve.map((p) => p.level)).toEqual([2722, 2650, 1585]);
    expect(curve[0].t).toBe(ms(ROWS[0].datetime));
  });

  it('drops rows with a bad datetime or a non-finite level', () => {
    const curve = parseZeroDegreeCurve([
      null,
      'row',
      { datetime: 'not a date', level: 1200 },
      { datetime: 1700000000, level: 1200 },
      { datetime: '2026-10-21T09:00:00+02:00', level: NaN },
      { datetime: '2026-10-21T10:00:00+02:00', level: '1500' },
      { datetime: '2026-10-21T11:00:00+02:00', level: null },
      ROWS[0],
      ROWS[1],
    ]);
    expect(curve).toHaveLength(2);
  });

  it('dedupes equal timestamps, first row wins', () => {
    const curve = parseZeroDegreeCurve([
      ROWS[0],
      { datetime: '2026-10-21T05:00:00Z', level: 9999 },
      ROWS[1],
    ]);
    expect(curve).toHaveLength(2);
    expect(curve[0].level).toBe(2722);
  });

  it('needs at least two valid points', () => {
    expect(parseZeroDegreeCurve([])).toBeNull();
    expect(parseZeroDegreeCurve([ROWS[0]])).toBeNull();
    expect(parseZeroDegreeCurve([ROWS[0], { datetime: 'x', level: 1 }])).toBeNull();
  });
});

describe('findCurveMinimum', () => {
  it('finds the lowest point', () => {
    expect(findCurveMinimum(parseZeroDegreeCurve(ROWS)).level).toBe(1585);
  });

  it('takes the earliest hour on a tie', () => {
    const curve = parseZeroDegreeCurve([
      { datetime: '2026-10-21T07:00:00+02:00', level: 1800 },
      { datetime: '2026-10-21T08:00:00+02:00', level: 1500 },
      { datetime: '2026-10-21T09:00:00+02:00', level: 1500 },
    ]);
    expect(findCurveMinimum(curve).t).toBe(ms('2026-10-21T08:00:00+02:00'));
  });

  it('returns null for an empty list', () => {
    expect(findCurveMinimum([])).toBeNull();
  });
});

describe('paddedLevelRange', () => {
  it('snaps to whole hundreds with headroom', () => {
    expect(paddedLevelRange(1585, 2722)).toEqual([1400, 2900]);
    expect(paddedLevelRange(1600, 2700)).toEqual([1500, 2800]);
  });

  it('stays at zero for an all-positive curve near the ground', () => {
    expect(paddedLevelRange(40, 900)).toEqual([0, 1000]);
  });

  it('keeps negative levels (below sea level) as they are', () => {
    expect(paddedLevelRange(-150, 300)).toEqual([-300, 400]);
  });
});

describe('dayStartsBetween', () => {
  it('lists local midnights in the HA zone', () => {
    const days = dayStartsBetween(ms(ROWS[0].datetime), ms(ROWS[4].datetime));
    expect(days).toEqual([
      ms('2026-10-22T00:00:00+02:00'),
      ms('2026-10-23T00:00:00+02:00'),
    ]);
  });

  it('is empty inside one day', () => {
    expect(dayStartsBetween(ms(ROWS[0].datetime), ms(ROWS[1].datetime))).toEqual([]);
  });
});

describe('text', () => {
  const opts = { language: 'en-GB', unit: 'm', hour12: false };

  it('formats the lowest line with weekday and time', () => {
    const min = findCurveMinimum(parseZeroDegreeCurve(ROWS));
    expect(formatLowest(min, 'Lowest', opts)).toBe('Lowest 1,585 m Thu 05:00');
  });

  it('omits the unit when the sensor has none', () => {
    const min = findCurveMinimum(parseZeroDegreeCurve(ROWS));
    expect(formatLowest(min, 'Lowest', { ...opts, unit: undefined })).toBe('Lowest 1,585 Thu 05:00');
  });

  it('appends the 48 h minimum when it is a different hour', () => {
    const curve = parseZeroDegreeCurve([
      ...ROWS,
      { datetime: '2026-10-24T08:00:00+02:00', level: 1447 },
    ]);
    const min = findCurveMinimum(curve);
    const min48 = findWindowMinimum(curve, 48);
    expect(min48.level).toBe(1585);
    expect(formatLowest(min, 'Lowest', opts, min48))
      .toBe('Lowest 1,447 m Sat 08:00 · 48 h: 1,585 m Thu 05:00');
  });

  it('shows the minimum once when the 48 h one is the same hour', () => {
    const curve = parseZeroDegreeCurve(ROWS);
    expect(formatLowest(findCurveMinimum(curve), 'Lowest', opts, findWindowMinimum(curve, 48)))
      .toBe('Lowest 1,585 m Thu 05:00');
  });

  it('uses the card-supplied formatter for values', () => {
    const min = findCurveMinimum(parseZeroDegreeCurve(ROWS));
    const formatValue = (l, withUnit) => `${l}'${withUnit ? 'u' : ''}`;
    expect(formatLowest(min, 'Lowest', { ...opts, formatValue })).toBe("Lowest 1585'u Thu 05:00");
  });

  it('formats the data range', () => {
    const text = formatCurveRange(ms(ROWS[0].datetime), ms(ROWS[4].datetime), opts);
    expect(text).toContain('21 Oct');
    expect(text).toContain('07:00');
    expect(text).toContain(' – ');
    expect(text).toContain('23 Oct');
  });
});

function fakeChartFactory() {
  const charts = [];
  const factory = vi.fn((target, curve, opts) => {
    const chart = { target, curve, opts, destroy: vi.fn(), setSize: vi.fn() };
    charts.push(chart);
    return chart;
  });
  return { factory, charts };
}

function openPopup(extra = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const row = document.createElement('span');
  row.tabIndex = 0;
  root.appendChild(row);
  const { factory, charts } = fakeChartFactory();
  const popup = new ZeroDegreePopup();
  const onHistory = vi.fn();
  popup.open({
    root,
    themeHost: host,
    curve: parseZeroDegreeCurve(ROWS),
    unit: 'm',
    language: 'en-GB',
    hour12: false,
    strings: { title: 'Zero-degree level', lowest: 'Lowest', history: 'History', close: 'Close' },
    returnFocus: row,
    onHistory,
    createChart: factory,
    ...extra,
  });
  return { popup, root, row, charts, factory, onHistory };
}

const key = (target, k, init = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

describe('ZeroDegreePopup', () => {
  it('renders a labelled modal dialog with title, range and lowest line', () => {
    const { popup, root } = openPopup();
    expect(popup.isOpen).toBe(true);
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = root.getElementById(dialog.getAttribute('aria-labelledby'));
    expect(title.textContent).toContain('Zero-degree level');
    expect(root.querySelector('.wsc-zd-range').textContent).toContain('21 Oct');
    expect(root.querySelector('.wsc-zd-lowest').textContent).toBe('Lowest 1,585 m Thu 05:00');
    expect(root.querySelector('.wsc-zd-close').getAttribute('aria-label')).toBe('Close');
  });

  it('moves focus to the close button and back to the row on close', () => {
    const { popup, root, row } = openPopup();
    expect(root.activeElement).toBe(root.querySelector('.wsc-zd-close'));
    popup.close();
    expect(root.activeElement).toBe(row);
  });

  it('closes on X, Esc and a backdrop click, not on a panel click', () => {
    let { popup, root, charts } = openPopup();
    root.querySelector('.wsc-zd-close').click();
    expect(popup.isOpen).toBe(false);
    expect(charts[0].destroy).toHaveBeenCalledTimes(1);

    ({ popup, root } = openPopup());
    key(root.querySelector('.wsc-zd-panel'), 'Escape');
    expect(popup.isOpen).toBe(false);

    ({ popup, root } = openPopup());
    root.querySelector('.wsc-zd-panel').click();
    expect(popup.isOpen).toBe(true);
    root.querySelector('.wsc-zd-backdrop').click();
    expect(popup.isOpen).toBe(false);
    expect(root.querySelector('.wsc-zd-backdrop')).toBeNull();
  });

  it('keeps Tab inside the dialog', () => {
    const { root } = openPopup();
    const close = root.querySelector('.wsc-zd-close');
    const history = root.querySelector('.wsc-zd-history');
    key(close, 'Tab');
    expect(root.activeElement).toBe(history);
    key(history, 'Tab');
    expect(root.activeElement).toBe(close);
    key(close, 'Tab', { shiftKey: true });
    expect(root.activeElement).toBe(history);
    key(history, 'Enter');
    expect(root.activeElement).toBe(history);
  });

  it('History calls back; without a callback there is no button', () => {
    const { root, onHistory } = openPopup();
    root.querySelector('.wsc-zd-history').click();
    expect(onHistory).toHaveBeenCalledTimes(1);

    const second = openPopup({ onHistory: undefined });
    expect(second.root.querySelector('.wsc-zd-history')).toBeNull();
  });

  it('re-opening rebuilds: the old chart is destroyed, one overlay remains', () => {
    const { popup, root, charts, factory } = openPopup();
    popup.open({
      root,
      themeHost: root.host,
      curve: parseZeroDegreeCurve(ROWS.slice(0, 3)),
      unit: 'm',
      language: 'en-GB',
      strings: { title: 'T', lowest: 'L', history: 'H', close: 'C' },
      createChart: factory,
    });
    expect(charts[0].destroy).toHaveBeenCalledTimes(1);
    expect(charts[1].curve).toHaveLength(3);
    expect(root.querySelectorAll('.wsc-zd-backdrop')).toHaveLength(1);
  });

  it('passes theme colours and feeds the cursor readout', () => {
    const { root, charts } = openPopup();
    const { opts } = charts[0];
    expect(opts.colors.line).toBe('#03a9f4');
    expect(opts.height).toBeGreaterThan(0);
    opts.onCursor({ t: ms(ROWS[2].datetime), level: 1585 });
    expect(root.querySelector('.wsc-zd-readout').textContent).toBe('Thu 05:00 · 1,585 m');
    opts.onCursor(null);
    expect(root.querySelector('.wsc-zd-readout').textContent).toBe('');
  });

  it('resizes the chart with the window and stops listening on close', () => {
    const { popup, root, charts } = openPopup();
    Object.defineProperty(root.querySelector('.wsc-zd-chart'), 'clientWidth', { value: 300 });
    window.dispatchEvent(new Event('resize'));
    expect(charts[0].setSize).toHaveBeenCalledWith(300, 220);
    popup.close();
    window.dispatchEvent(new Event('resize'));
    expect(charts[0].setSize).toHaveBeenCalledTimes(1);
  });

  it('a failing chart still leaves a closable dialog', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { popup, root } = openPopup({ createChart: () => { throw new Error('no canvas'); } });
    expect(root.querySelector('.wsc-zd-lowest').textContent).toContain('1,585');
    popup.close();
    expect(popup.isOpen).toBe(false);
  });

  it('close() is idempotent', () => {
    const { popup, charts } = openPopup();
    popup.close();
    popup.close();
    expect(charts[0].destroy).toHaveBeenCalledTimes(1);
  });
});

// jsdom has no 2D canvas; a recording stub lets the real uPlot build run.
function stubCanvas() {
  const calls = [];
  globalThis.Path2D ??= class {
    constructor() {
      return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => {}) });
    }
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const canvas = this;
    const state = { canvas };
    return new Proxy(state, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
        return (...args) => { calls.push([k, ...args]); };
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  });
  return calls;
}

describe('buildZeroDegreeChart (uPlot)', () => {
  it('builds, draws the overlay and tears down', async () => {
    const calls = stubCanvas();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onCursor = vi.fn();
    const chart = buildZeroDegreeChart(target, parseZeroDegreeCurve(ROWS), {
      language: 'en-GB',
      unit: 'm',
      width: 480,
      height: 220,
      colors: { line: '#f00', text: '#000', muted: '#888' },
      onCursor,
    });
    expect(target.querySelector('.uplot')).not.toBeNull();
    chart.setSize(400, 220);
    // uPlot commits its first draw in a microtask.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    // Minimum label of the overlay plugin.
    expect(calls.some(([k, text]) => k === 'fillText' && text === '1,585 m')).toBe(true);
    chart.destroy();
    expect(target.querySelector('.uplot')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Card integration.

const SENSOR = 'sensor.zero_degree_level_48h';

function makeHass(attrs = {}) {
  return {
    states: {
      'sensor.t': { state: '12.0', attributes: { unit_of_measurement: '°C' } },
      'sensor.zero_degree_level': { state: '2722', attributes: { unit_of_measurement: 'm' } },
      [SENSOR]: { state: '1585', attributes: { unit_of_measurement: 'm', change: -1137, ...attrs } },
    },
    config: { latitude: 46.9, longitude: 7.4, time_zone: 'Europe/Zurich' },
    language: 'en',
  };
}

// The card attaches its observer from a timer that can outlive a test.
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };

async function mountCard(hass, extraConfig = {}) {
  stubCanvas();
  const card = document.createElement('weather-station-card');
  card.setConfig({
    ...extraConfig,
    show_station: false,
    show_forecast: false,
    show_attributes: true,
    show_zero_degree_level: true,
    show_zero_degree_level_48h: true,
    sensors: {
      temperature: 'sensor.t',
      zero_degree_level: 'sensor.zero_degree_level',
      zero_degree_level_48h: SENSOR,
    },
  });
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

// Current row: a snowflake icon (site state); trend row: an arrow (#333)
// or, without a curve, the v2.12 snowflake + trending arrow.
const rowLinks = (card) =>
  [...card.shadowRoot.querySelectorAll('.wsc-entity-link')]
    .filter((el) => /^mdi:(snowflake|arrow-)/.test(el.querySelector('ha-icon')?.getAttribute('icon') || ''));

describe('card: zero-degree rows', () => {
  it('with a curve both rows open the popup instead of more-info', async () => {
    const card = await mountCard(makeHass({ forecast: ROWS }));
    const more = vi.fn();
    card.addEventListener('hass-more-info', more);
    const links = rowLinks(card);
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('aria-haspopup')).toBe('dialog');
      link.click();
      expect(card.shadowRoot.querySelector('[role="dialog"]')).not.toBeNull();
      expect(card.shadowRoot.querySelector('.uplot')).not.toBeNull();
      key(card.shadowRoot.querySelector('.wsc-zd-panel'), 'Escape');
      expect(card.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
    }
    links[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(card.shadowRoot.querySelector('[role="dialog"]')).not.toBeNull();
    expect(more).not.toHaveBeenCalled();
  });

  it('History opens more-info of the 48 h sensor and closes the popup', async () => {
    const card = await mountCard(makeHass({ forecast: ROWS }));
    const more = vi.fn();
    card.addEventListener('hass-more-info', more);
    rowLinks(card)[0].click();
    card.shadowRoot.querySelector('.wsc-zd-history').click();
    expect(more).toHaveBeenCalledTimes(1);
    expect(more.mock.calls[0][0].detail).toEqual({ entityId: SENSOR });
    expect(card.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
  });

  it('without the attribute (or < 2 valid points) tap stays more-info', async () => {
    for (const attrs of [{}, { forecast: [ROWS[0]] }, { forecast: 'n/a' }]) {
      const err = vi.spyOn(console, 'error');
      const card = await mountCard(makeHass(attrs));
      const more = vi.fn();
      card.addEventListener('hass-more-info', more);
      const links = rowLinks(card);
      expect(links).toHaveLength(2);
      links[1].click();
      expect(more).toHaveBeenCalledTimes(1);
      expect(more.mock.calls[0][0].detail).toEqual({ entityId: SENSOR });
      expect(links[1].hasAttribute('aria-haspopup')).toBe(false);
      expect(card.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
      expect(err).not.toHaveBeenCalled();
      card.remove();
      vi.restoreAllMocks();
    }
  });

  it('re-parses only when the attribute array changes', async () => {
    const hass = makeHass({ forecast: ROWS });
    const card = await mountCard(hass);
    const first = card.zero_degree_curve;
    card.hass = { ...hass, states: { ...hass.states } };
    expect(card.zero_degree_curve).toBe(first);
    card.hass = makeHass({ forecast: ROWS.slice(0, 2) });
    expect(card.zero_degree_curve).toHaveLength(2);
  });

  it('disconnecting the card tears the popup and its chart down', async () => {
    const card = await mountCard(makeHass({ forecast: ROWS }));
    rowLinks(card)[0].click();
    const root = card.shadowRoot;
    expect(root.querySelector('.uplot')).not.toBeNull();
    card.remove();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector('.uplot')).toBeNull();
    expect(card._zeroDegreePopup.isOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trend row and site state (#333).

// Hourly curve through the issue's figures: 2'506 m Wed 07:00, 1'586 m
// Thu 05:00, 2'556 m Fri 06:00, 2'300 m Sat 12:00; linear in between.
const TREND_ANCHORS = [
  ['2026-10-21T07:00:00+02:00', 2506],
  ['2026-10-22T05:00:00+02:00', 1586],
  ['2026-10-23T06:00:00+02:00', 2556],
  ['2026-10-24T12:00:00+02:00', 2300],
].map(([iso, level]) => [ms(iso), level]);
const TREND_ROWS = (() => {
  const out = [];
  for (let i = 0; i < TREND_ANCHORS.length - 1; i++) {
    const [t0, l0] = TREND_ANCHORS[i];
    const [t1, l1] = TREND_ANCHORS[i + 1];
    for (let t = t0; t < t1; t += 3_600_000) {
      out.push({ datetime: new Date(t).toISOString(), level: Math.round(l0 + ((l1 - l0) * (t - t0)) / (t1 - t0)) });
    }
  }
  const [tl, ll] = TREND_ANCHORS[TREND_ANCHORS.length - 1];
  out.push({ datetime: new Date(tl).toISOString(), level: ll });
  return out;
})();
const levelAt = (t) => TREND_ROWS.find((r) => Date.parse(r.datetime) === t).level;

function trendHass(now, { haElevation, attrs = {} } = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const hass = makeHass({ forecast: TREND_ROWS, ...attrs });
  hass.states['sensor.zero_degree_level'].state = String(levelAt(now));
  hass.states[SENSOR].state = '1586';
  if (haElevation !== undefined) hass.config.elevation = haElevation;
  return hass;
}

const rows = (card) => {
  const [current, trend] = rowLinks(card);
  return { current, trend, currentIcon: current.querySelector('ha-icon').getAttribute('icon'),
    trendIcon: trend.querySelector('ha-icon').getAttribute('icon') };
};
const titleOf = (link) => link.closest('[title]')?.getAttribute('title') ?? null;

describe('card: zero-degree trend and site state (#333)', () => {
  const T0 = TREND_ANCHORS[0][0];

  it('today: falls fast to 1586 m Thu 05:00, then up to 2556 m Fri 06:00', async () => {
    const card = await mountCard(trendHass(T0));
    const { current, trend, currentIcon, trendIcon } = rows(card);
    expect(trendIcon).toBe('mdi:arrow-down');
    expect(trend.querySelector('small').textContent).toBe('48 h');
    expect(trend.querySelector('.wsc-zd-target').textContent.replace(/\s+/g, ' ').trim())
      .toBe('1,586 m Thu 05:00');
    expect(trend.querySelector('.wsc-zd-day').textContent).toBe('Thu');
    expect(trend.querySelector('.wsc-zd-target').getAttribute('style')).toBeNull();
    expect(titleOf(trend)).toBe('Falls fast to 1,586 m Thu 05:00 · now 2,506 m · then up to 2,556 m Fri 06:00');
    // No elevation anywhere: plain icon, no site tooltip.
    expect(currentIcon).toBe('mdi:snowflake-thermometer');
    expect(titleOf(current)).toBeNull();
    // The popup still opens from both rows (#330).
    expect(trend.getAttribute('aria-haspopup')).toBe('dialog');
    expect(current.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('20 h later: rises to 2556 m Fri 06:00', async () => {
    const card = await mountCard(trendHass(T0 + 20 * 3_600_000));
    const { trend, trendIcon } = rows(card);
    expect(trendIcon).toBe('mdi:arrow-top-right');
    expect(trend.querySelector('.wsc-zd-target').textContent.replace(/\s+/g, ' ').trim())
      .toBe('2,556 m Fri 06:00');
    expect(titleOf(trend)).toBe('Rises to 2,556 m Fri 06:00 · now 1,670 m');
  });

  it('a flat curve reads "Stays between"', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const flat = [0, 6, 12].map((h, i) => ({
      datetime: new Date(T0 + h * 3_600_000).toISOString(), level: [2500, 2450, 2600][i],
    }));
    const hass = makeHass({ forecast: flat });
    hass.states['sensor.zero_degree_level'].state = '2500';
    const card = await mountCard(hass);
    const { trend, trendIcon } = rows(card);
    expect(trendIcon).toBe('mdi:arrow-right');
    expect(titleOf(trend)).toBe('Stays between 2,450 and 2,600 m');
  });

  it('target reaching the site: precipitation colour, ❄ marker, snow sentence', async () => {
    const card = await mountCard(trendHass(T0), { title: 'Köniz', elevation: 1300 });
    const { current, trend, currentIcon } = rows(card);
    expect(trend.querySelector('small').textContent).toBe('❄ 48 h');
    expect(trend.querySelector('.wsc-zd-target').getAttribute('style'))
      .toBe('color: rgba(132, 209, 253, 1.0)');
    expect(titleOf(trend)).toContain(' · Snow down to Köniz 1,300 m from Thu 05:00');
    expect(currentIcon).toBe('mdi:snowflake-thermometer');
    expect(titleOf(current)).toBe('Snow line about 2,206 m (estimated), Köniz 1,300 m · far above you');
  });

  it('site tooltip numbers go through the HA number format, in metres', async () => {
    const hass = trendHass(T0, { haElevation: 619 });
    hass.formatEntityState = (s) =>
      `${String(Math.round(Number(s.state))).replace(/\B(?=(\d{3})+$)/g, "'")} ${s.attributes.unit_of_measurement}`;
    const card = await mountCard(hass);
    expect(titleOf(rows(card).current))
      .toBe("Snow line about 2'206 m (estimated), 619 m · far above you");
  });

  it('site state follows the elevation (sensor attribute, then HA)', async () => {
    let card = await mountCard(trendHass(T0, { attrs: { elevation: 2000 } }));
    expect(rows(card).currentIcon).toBe('mdi:snowflake-alert');
    expect(titleOf(rows(card).current)).toBe('Snow line about 2,206 m (estimated), 2,000 m · just above you');
    card.remove();
    vi.restoreAllMocks();
    card = await mountCard(trendHass(T0, { haElevation: 2300 }));
    expect(rows(card).currentIcon).toBe('mdi:snowflake');
    expect(titleOf(rows(card).current)).toContain('at your level or below');
  });

  it('without a curve the trend row stays as in v2.12', async () => {
    const err = vi.spyOn(console, 'error');
    const card = await mountCard(makeHass({}));
    const { trend, trendIcon } = rows(card);
    expect(trendIcon).toBe('mdi:snowflake-thermometer');
    expect(trend.querySelector('small').textContent).toBe('48 h');
    expect(trend.querySelector('ha-icon[icon="mdi:trending-down"]')).not.toBeNull();
    expect(err).not.toHaveBeenCalled();
  });
});
