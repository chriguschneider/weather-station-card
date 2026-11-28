import { describe, it, expect } from 'vitest';
import { cardStyles } from '../src/chart/styles';

const opts = {
  iconsSize: 25,
  currentTempSize: 40,
  timeSize: 26,
  dayDateSize: 15,
  chartHeight: 180,
  titlePresent: false,
  labelsSmallSize: 11,
  labelsBaseSize: 14,
};

// Declaration blocks of every rule whose selector is exactly `selector`.
function rulesFor(css, selector) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const out = [];
  let m;
  while ((m = re.exec(css))) {
    if (m[1].trim() === selector) out.push(m[2]);
  }
  return out;
}

describe('cardStyles clock anchoring (#404)', () => {
  const css = cardStyles(opts);

  it('makes .main the containing block of the absolute clock', () => {
    expect(rulesFor(css, '.main').some((b) => b.includes('position: relative'))).toBe(true);
    expect(rulesFor(css, '.current-time').some((b) => b.includes('position: absolute'))).toBe(true);
  });

  it('offsets the clock from .main, not from the card edge', () => {
    const base = rulesFor(css, '.current-time')[0];
    expect(base).toContain('top: 4px');
    expect(base).toContain('inset-inline-end: 0');
    expect(base).not.toMatch(/(^|\s)right:/);
    expect(base).not.toContain('top: 20px');
  });
});

describe('cardStyles icons_size (#553)', () => {
  const COND = '.conditions .wsc-icon,\n    .conditions ha-icon';
  const iconSize = (css, selector) => {
    const b = rulesFor(css, selector).find((x) => x.includes('--mdc-icon-size'));
    return b && b.match(/--mdc-icon-size:\s*([^;]+);/)[1].trim();
  };

  it('sizes forecast-row icons and the main icon from iconsSize', () => {
    const css = cardStyles({ ...opts, iconsSize: 40 });
    expect(iconSize(css, COND)).toBe('40px');
    expect(iconSize(css, '.main ha-icon')).toBe('80px');
    expect(css).not.toMatch(/\bimg\b/);
  });

  it('keeps the default 25 at the previous main size', () => {
    const css = cardStyles(opts);
    expect(iconSize(css, COND)).toBe('25px');
    expect(iconSize(css, '.main ha-icon')).toBe('50px');
  });
});

describe('cardStyles wind speed size (#555)', () => {
  const speedSize = (css, selector) => {
    const b = rulesFor(css, selector).find((x) => x.includes('font-size'));
    return b && b.match(/font-size:\s*([^;]+);/)[1].trim();
  };

  it('follows labels_font_size in the wide and narrow layouts', () => {
    const css = cardStyles({ ...opts, labelsBaseSize: 16 });
    expect(speedSize(css, '.wind-speed')).toBe('16px');
    const narrow = css.slice(css.indexOf('@container wsc-card (max-width: 360px)'));
    expect(rulesFor(narrow, '.wind-speed')[0]).toContain('font-size: 15px');
  });

  it('keeps the default 11px and 10px unchanged', () => {
    const css = cardStyles({ ...opts, labelsBaseSize: 11 });
    expect(speedSize(css, '.wind-speed')).toBe('11px');
    const narrow = css.slice(css.indexOf('@container wsc-card (max-width: 360px)'));
    expect(rulesFor(narrow, '.wind-speed')[0]).toContain('font-size: 10px');
  });
});

describe('cardStyles current temperature size', () => {
  const css = cardStyles(opts);

  it('sets the configured size on .main', () => {
    const blocks = rulesFor(css, '.main');
    expect(blocks.some((b) => b.includes('font-size: 40px'))).toBe(true);
  });

  it('narrow layout scales the size on .main', () => {
    const blocks = rulesFor(css, '.main');
    expect(blocks.some((b) => b.includes(`font-size: ${Math.round(40 * 0.85)}px`))).toBe(true);
  });

  it('no bare `.main span` rule sets a font size (wide or narrow)', () => {
    const blocks = rulesFor(css, '.main span');
    expect(blocks.some((b) => b.includes('font-size'))).toBe(false);
  });

  it('keeps the unit/condition sizes on spans except the entity link', () => {
    const blocks = rulesFor(css, '.main span:not(.wsc-entity-link)');
    expect(blocks.some((b) => b.includes('font-size: 18px'))).toBe(true);
    expect(blocks.some((b) => b.includes('font-size: 15px'))).toBe(true);
  });
});

describe('cardStyles attributes_size / condition_size (#557)', () => {
  const NARROW = (css) => css.slice(css.indexOf('max-width: 360px'));
  const COND = '.main .current-condition span:not(.wsc-entity-link)';
  const size = (css, sel) => {
    const b = rulesFor(css, sel).find((x) => x.includes('font-size'));
    return b && b.match(/font-size:\s*([^;]+);/)[1].trim();
  };

  it('defaults emit no extra attribute or condition rules', () => {
    const css = cardStyles(opts);
    expect(rulesFor(css, '.attributes')[0]).not.toContain('font-size');
    expect(rulesFor(css, COND)).toEqual([]);
    expect(rulesFor(css, '.attributes > div > div')).toEqual([]);
    expect(size(NARROW(css), '.attributes')).toBe('13px');
    expect(cardStyles({ ...opts, attributesSize: 0, conditionSize: 18 })).toBe(css);
  });

  it('sets the sizes in the base rules and scales them in the 360px rule', () => {
    const css = cardStyles({ ...opts, attributesSize: 20, conditionSize: 28 });
    expect(rulesFor(css, '.attributes').some((b) => b.includes('font-size: 20px'))).toBe(true);
    expect(size(css, COND)).toBe('28px');
    expect(size(NARROW(css), '.attributes')).toBe('17px');
    expect(size(NARROW(css), COND)).toBe('24px');
    expect(rulesFor(css, '.attributes > div > div')[0]).toContain('white-space: nowrap');
  });

  it('leaves the temperature unit size alone', () => {
    const css = cardStyles({ ...opts, attributesSize: 20, conditionSize: 28 });
    expect(size(css, '.main span:not(.wsc-entity-link)')).toBe('18px');
    expect(size(NARROW(css), '.main span:not(.wsc-entity-link)')).toBe('15px');
  });
});
