// Attribute-row layout (ADR-0025): the pure resolver + editor helpers.
//
// Two modes. Without `attributes_layout` the default three-column
// arrangement is filtered by the show_* toggles exactly as before the
// key existed. With a non-empty layout the list decides everything —
// which rows render and where — and the show_* row keys are ignored.

import { describe, it, expect } from 'vitest';
import { DEFAULTS } from '../src/defaults.js';
import {
  ATTRIBUTE_TOKENS,
  DEFAULT_ATTRIBUTES_LAYOUT,
  LINE_OF,
  addTokenToLayout,
  columnLines,
  hasExplicitLayout,
  normalizeLayout,
  removeTokenFromLayout,
  resolveAttributesLayout,
  tokenOfShowKey,
} from '../src/attributes-layout.js';

describe('token vocabulary', () => {
  it('every token has a show_* default in DEFAULTS', () => {
    for (const token of ATTRIBUTE_TOKENS) {
      expect(typeof DEFAULTS[`show_${token}`]).toBe('boolean');
    }
  });

  it('the default layout lists every token exactly once', () => {
    const flat = DEFAULT_ATTRIBUTES_LAYOUT.flat();
    expect([...flat].sort()).toEqual([...ATTRIBUTE_TOKENS].sort());
  });

  it('every token maps to a line', () => {
    for (const token of ATTRIBUTE_TOKENS) expect(typeof LINE_OF[token]).toBe('string');
  });

  it('tokenOfShowKey strips the prefix and rejects strangers', () => {
    expect(tokenOfShowKey('show_wind_speed')).toBe('wind_speed');
    expect(tokenOfShowKey('wind_speed')).toBe('wind_speed');
    expect(tokenOfShowKey('show_main')).toBeUndefined();
    expect(tokenOfShowKey('forecast.show_sunshine')).toBeUndefined();
  });
});

describe('resolveAttributesLayout — automatic mode', () => {
  it('reproduces the pre-layout defaults: headline rows on, detail rows off', () => {
    expect(resolveAttributesLayout({})).toEqual([
      ['pressure', 'precipitation'],
      ['uv_index'],
      ['wind_direction', 'wind_speed'],
    ]);
  });

  it('honours opt-in and opt-out toggles', () => {
    const layout = resolveAttributesLayout({
      show_pressure: false,
      show_dew_point: true,
      show_humidity: true,
      show_wind_gust_speed: true,
      show_zero_degree_level: true,
    });
    expect(layout).toEqual([
      ['dew_point', 'humidity', 'precipitation', 'zero_degree_level'],
      ['uv_index'],
      ['wind_direction', 'wind_speed', 'wind_gust_speed'],
    ]);
  });

  it('only shows the moon together with the sun (it renders inside the sun cell)', () => {
    expect(resolveAttributesLayout({}).flat()).not.toContain('moon');
    expect(resolveAttributesLayout({ show_sun: true }).flat()).toEqual(
      expect.arrayContaining(['sun', 'moon']),
    );
    expect(resolveAttributesLayout({ show_sun: true, show_moon: false }).flat()).not.toContain('moon');
  });

  it('drops a column whose rows are all off', () => {
    const layout = resolveAttributesLayout({ show_wind_direction: false, show_wind_speed: false });
    expect(layout).toHaveLength(2);
  });

  it('treats an empty list as automatic', () => {
    expect(hasExplicitLayout({ attributes_layout: [] })).toBe(false);
    expect(resolveAttributesLayout({ attributes_layout: [] })).toEqual(resolveAttributesLayout({}));
  });
});

describe('resolveAttributesLayout — explicit layout wins', () => {
  it('returns the configured columns in order and ignores show_* keys', () => {
    const layout = resolveAttributesLayout({
      show_wind_direction: true,
      show_zero_degree_level: false,
      attributes_layout: [
        ['pressure', 'dew_point'],
        ['zero_degree_level', 'wind_speed'],
      ],
    });
    expect(layout).toEqual([['pressure', 'dew_point'], ['zero_degree_level', 'wind_speed']]);
  });

  it('allows the moon without the sun', () => {
    expect(resolveAttributesLayout({ attributes_layout: [['moon']] })).toEqual([['moon']]);
  });

  it('drops unknown tokens, duplicates and empty columns without throwing', () => {
    expect(normalizeLayout([['pressure', 'bogus'], [], ['pressure', 'sun'], 42, null])).toEqual([
      ['pressure'], ['sun'],
    ]);
  });

  it('reads a bare token as a one-row column', () => {
    expect(normalizeLayout(['pressure', ['wind_speed', 'wind_gust_speed']])).toEqual([
      ['pressure'], ['wind_speed', 'wind_gust_speed'],
    ]);
  });

  it('returns nothing for garbage', () => {
    expect(normalizeLayout('pressure')).toEqual([]);
    expect(normalizeLayout({ a: 1 })).toEqual([]);
  });
});

describe('columnLines', () => {
  it('collapses shared-line tokens at the position of their first member', () => {
    expect(columnLines(['humidity', 'pressure', 'dew_point'])).toEqual(['dew_point', 'pressure']);
    expect(columnLines(['illuminance', 'sun', 'uv_index', 'moon'])).toEqual(['sun_strength', 'sun']);
  });
});

describe('editor helpers', () => {
  it('adds a token into its default column at its default rank', () => {
    const layout = [['pressure', 'precipitation'], ['uv_index'], ['wind_direction', 'wind_speed']];
    expect(addTokenToLayout(layout, 'dew_point')).toEqual([
      ['pressure', 'dew_point', 'precipitation'], ['uv_index'], ['wind_direction', 'wind_speed'],
    ]);
    expect(addTokenToLayout(layout, 'wind_gust_speed')[2]).toEqual([
      'wind_direction', 'wind_speed', 'wind_gust_speed',
    ]);
  });

  it('follows a displaced sibling instead of a column index', () => {
    // The user moved the zero-degree level into the wind column;
    // humidity (a climate row) joins its nearest climate sibling there.
    expect(addTokenToLayout([['zero_degree_level', 'wind_speed']], 'humidity')).toEqual([
      ['humidity', 'zero_degree_level', 'wind_speed'],
    ]);
    expect(addTokenToLayout([['wind_speed', 'pressure']], 'dew_point')).toEqual([
      ['wind_speed', 'pressure', 'dew_point'],
    ]);
  });

  it('opens a new column in default order when no sibling is placed', () => {
    expect(addTokenToLayout([['pressure']], 'wind_speed')).toEqual([['pressure'], ['wind_speed']]);
    expect(addTokenToLayout([['wind_speed']], 'pressure')).toEqual([['pressure'], ['wind_speed']]);
    expect(addTokenToLayout([['pressure'], ['wind_speed']], 'sun')).toEqual([
      ['pressure'], ['sun'], ['wind_speed'],
    ]);
  });

  it('is a no-op for a token already placed anywhere', () => {
    const layout = [['wind_speed', 'pressure']];
    expect(addTokenToLayout(layout, 'pressure')).toEqual(layout);
  });

  it('does not mutate its input', () => {
    const layout = [['pressure']];
    addTokenToLayout(layout, 'sun');
    removeTokenFromLayout(layout, 'pressure');
    expect(layout).toEqual([['pressure']]);
  });

  it('removes a token and drops the column when it empties', () => {
    expect(removeTokenFromLayout([['pressure'], ['sun', 'moon']], 'pressure')).toEqual([['sun', 'moon']]);
    expect(removeTokenFromLayout([['pressure'], ['sun', 'moon']], 'moon')).toEqual([['pressure'], ['sun']]);
  });
});
