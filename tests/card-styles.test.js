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
