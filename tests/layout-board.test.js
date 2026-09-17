// @vitest-environment jsdom
// Layout board (ADR-0025): the pure move / drop helpers, the rendered
// zones, keyboard moves, and a pointer drag simulated with mocked
// geometry (jsdom has no layout, so every rect is stubbed).

import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import {
  previewLayout,
  dropTargetFor,
  moveToken,
  renderLayoutBoard,
  currentDragPreview,
} from '../src/editor/layout-board.js';

describe('previewLayout', () => {
  const base = [['pressure', 'dew_point'], ['sun'], ['wind_direction', 'wind_speed']];

  it('reorders within a column', () => {
    expect(previewLayout(base, 'dew_point', { column: 0, index: 0 })).toEqual([
      ['dew_point', 'pressure'], ['sun'], ['wind_direction', 'wind_speed'],
    ]);
  });

  it('moves across columns and keeps the emptied column open', () => {
    expect(previewLayout(base, 'sun', { column: 2, index: 1 })).toEqual([
      ['pressure', 'dew_point'], [], ['wind_direction', 'sun', 'wind_speed'],
    ]);
  });

  it('opens a new column when the target is past the last one', () => {
    expect(previewLayout(base, 'wind_speed', { column: 3, index: 0 })).toEqual([
      ['pressure', 'dew_point'], ['sun'], ['wind_direction'], ['wind_speed'],
    ]);
  });

  it('clamps the index', () => {
    expect(previewLayout(base, 'pressure', { column: 1, index: 99 })[1]).toEqual(['sun', 'pressure']);
  });
});

describe('dropTargetFor', () => {
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
  const columns = [
    { rect: rect(0, 0, 90, 200), pills: [
      { token: 'pressure', rect: rect(0, 0, 90, 30) },
      { token: 'dew_point', rect: rect(0, 40, 90, 70) },
    ] },
    { rect: rect(100, 0, 190, 200), pills: [{ token: 'sun', rect: rect(100, 0, 190, 30) }] },
    { rect: rect(200, 0, 230, 200), pills: [] }, // the new-column zone
  ];

  it('picks the column under the pointer and the slot below the pills above it', () => {
    expect(dropTargetFor({ x: 50, y: 60 }, columns, 'sun')).toEqual({ column: 0, index: 2 });
    expect(dropTargetFor({ x: 50, y: 10 }, columns, 'sun')).toEqual({ column: 0, index: 0 });
  });

  it('does not count the dragged pill itself', () => {
    expect(dropTargetFor({ x: 50, y: 60 }, columns, 'pressure')).toEqual({ column: 0, index: 1 });
  });

  it('snaps to the nearest column from a gap or outside the board', () => {
    expect(dropTargetFor({ x: 96, y: 50 }, columns, 'pressure').column).toBe(1);
    expect(dropTargetFor({ x: 400, y: 50 }, columns, 'pressure').column).toBe(2);
    expect(dropTargetFor({ x: 10, y: -50 }, columns, 'sun').column).toBe(0);
  });

  it('returns null without columns', () => {
    expect(dropTargetFor({ x: 0, y: 0 }, [], 'sun')).toBeNull();
  });
});

describe('moveToken (keyboard)', () => {
  const base = [['pressure', 'dew_point'], ['sun'], ['wind_direction', 'wind_speed']];

  it('moves up and down within a column, clamped', () => {
    expect(moveToken(base, 'dew_point', 'up')[0]).toEqual(['dew_point', 'pressure']);
    expect(moveToken(base, 'pressure', 'down')[0]).toEqual(['dew_point', 'pressure']);
    expect(moveToken(base, 'pressure', 'up')).toBe(base);
    expect(moveToken(base, 'dew_point', 'down')).toBe(base);
  });

  it('moves left and right keeping the row index where possible', () => {
    expect(moveToken(base, 'wind_speed', 'left')).toEqual([
      ['pressure', 'dew_point'], ['sun', 'wind_speed'], ['wind_direction'],
    ]);
    expect(moveToken(base, 'dew_point', 'right')).toEqual([
      ['pressure'], ['sun', 'dew_point'], ['wind_direction', 'wind_speed'],
    ]);
    expect(moveToken(base, 'pressure', 'left')).toBe(base);
  });

  it('right from the last column opens a new one, unless the pill is alone there', () => {
    expect(moveToken(base, 'wind_speed', 'right')).toEqual([
      ['pressure', 'dew_point'], ['sun'], ['wind_direction'], ['wind_speed'],
    ]);
    const alone = [['pressure'], ['sun']];
    expect(moveToken(alone, 'sun', 'right')).toBe(alone);
  });

  it('drops a column emptied by the move', () => {
    expect(moveToken(base, 'sun', 'left')).toEqual([
      ['sun', 'pressure', 'dew_point'], ['wind_direction', 'wind_speed'],
    ]);
  });
});

// ── rendering ────────────────────────────────────────────────────────

const t = (k) => k;
const labelFor = (token) => `L:${token}`;

function mount(overrides = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const args = {
    layout: [['pressure', 'dew_point'], ['wind_speed']],
    explicit: false,
    labelFor,
    t,
    onChange: vi.fn(),
    onReset: vi.fn(),
    rerender: vi.fn(),
    ...overrides,
  };
  // The board reads the drag preview at render time, so re-rendering
  // must go through the same template — mirror the editor's requestUpdate.
  const draw = () => render(renderLayoutBoard(args), container);
  args.rerender.mockImplementation(draw);
  draw();
  return { container, args, draw };
}

const columnsOf = (container) =>
  Array.from(container.querySelectorAll('[data-col]:not(.new)')).map((col) =>
    Array.from(col.querySelectorAll('[data-token]')).map((p) => p.dataset.token));

describe('renderLayoutBoard', () => {
  it('renders one zone per column, pills in order, plus the new-column zone', () => {
    const { container } = mount();
    expect(columnsOf(container)).toEqual([['pressure', 'dew_point'], ['wind_speed']]);
    const zones = container.querySelectorAll('[data-col]');
    expect(zones.length).toBe(3);
    expect(zones[2].classList.contains('new')).toBe(true);
    expect(zones[2].dataset.col).toBe('2');
    expect(container.querySelector('[data-token="pressure"]').textContent).toContain('L:pressure');
  });

  it('offers the reset action only for an explicit layout', () => {
    expect(mount().container.querySelector('.link-button')).toBeNull();
    const { container, args } = mount({ explicit: true });
    container.querySelector('.link-button').click();
    expect(args.onReset).toHaveBeenCalledTimes(1);
  });

  it('moves a pill with the arrow keys', () => {
    const { container, args } = mount();
    const pill = container.querySelector('[data-token="dew_point"]');
    pill.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(args.onChange).toHaveBeenCalledWith([['pressure'], ['wind_speed', 'dew_point']]);
    // A no-op move writes nothing.
    args.onChange.mockClear();
    container.querySelector('[data-token="pressure"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(args.onChange).not.toHaveBeenCalled();
  });

  // jsdom has no layout: stub every rect so the geometry helpers see a
  // board of 90px-wide columns with 30px pills stacked 40px apart.
  function stubGeometry(container) {
    container.querySelectorAll('[data-col]').forEach((col) => {
      const ci = Number(col.dataset.col);
      col.getBoundingClientRect = () => ({ left: ci * 100, right: ci * 100 + 90, top: 0, bottom: 200, width: 90, height: 200 });
      col.querySelectorAll('[data-token]').forEach((pill, ri) => {
        pill.getBoundingClientRect = () => ({ left: ci * 100, right: ci * 100 + 90, top: ri * 40, bottom: ri * 40 + 30, width: 90, height: 30 });
      });
    });
  }

  const pointer = (type, x, y) => {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    return ev;
  };

  it('drags a pill into another column and commits on release', () => {
    const { container, args, draw } = mount();
    stubGeometry(container);
    const pill = container.querySelector('[data-token="pressure"]');
    pill.dispatchEvent(pointer('pointerdown', 10, 10));

    // Below the threshold nothing happens yet.
    window.dispatchEvent(pointer('pointermove', 12, 12));
    expect(currentDragPreview()).toBeNull();

    // Into the wind column, below its only pill.
    window.dispatchEvent(pointer('pointermove', 150, 60));
    expect(currentDragPreview()).toEqual([['dew_point'], ['wind_speed', 'pressure']]);
    // The board re-rendered from the preview; the dragged pill is the placeholder.
    expect(columnsOf(container)).toEqual([['dew_point'], ['wind_speed', 'pressure']]);
    expect(container.querySelector('[data-token="pressure"]').classList.contains('dragging')).toBe(true);
    expect(document.body.lastElementChild.textContent).toBe('L:pressure'); // the ghost

    window.dispatchEvent(pointer('pointerup', 150, 60));
    expect(args.onChange).toHaveBeenCalledWith([['dew_point'], ['wind_speed', 'pressure']]);
    expect(currentDragPreview()).toBeNull();
    expect(document.body.lastElementChild).toBe(container); // ghost removed
    draw();
  });

  it('drops onto the new-column zone to open a column', () => {
    const { container, args } = mount();
    stubGeometry(container);
    container.querySelector('[data-token="dew_point"]').dispatchEvent(pointer('pointerdown', 10, 50));
    window.dispatchEvent(pointer('pointermove', 215, 50));
    expect(currentDragPreview()).toEqual([['pressure'], ['wind_speed'], ['dew_point']]);
    window.dispatchEvent(pointer('pointerup', 215, 50));
    expect(args.onChange).toHaveBeenCalledWith([['pressure'], ['wind_speed'], ['dew_point']]);
  });

  it('keeps a column emptied by the drag open until release, then drops it', () => {
    const { container, args } = mount();
    stubGeometry(container);
    // The only wind pill goes into the climate column: the wind column
    // stays as an empty zone while the pointer is down …
    container.querySelector('[data-token="wind_speed"]').dispatchEvent(pointer('pointerdown', 110, 10));
    window.dispatchEvent(pointer('pointermove', 50, 100));
    expect(currentDragPreview()).toEqual([['pressure', 'dew_point', 'wind_speed'], []]);
    expect(container.querySelectorAll('[data-col].empty').length).toBe(1);
    window.dispatchEvent(pointer('pointerup', 50, 100));
    // … and is gone from what gets written.
    expect(args.onChange).toHaveBeenCalledWith([['pressure', 'dew_point', 'wind_speed']]);
  });

  it('writes nothing when the pill lands where it started or the drag is cancelled', () => {
    const { container, args } = mount();
    stubGeometry(container);
    const pill = container.querySelector('[data-token="dew_point"]');
    pill.dispatchEvent(pointer('pointerdown', 10, 50));
    window.dispatchEvent(pointer('pointermove', 20, 60));
    window.dispatchEvent(pointer('pointerup', 20, 60));
    expect(args.onChange).not.toHaveBeenCalled();

    pill.dispatchEvent(pointer('pointerdown', 10, 50));
    window.dispatchEvent(pointer('pointermove', 150, 10));
    expect(currentDragPreview()).not.toBeNull();
    window.dispatchEvent(pointer('pointercancel', 150, 10));
    expect(currentDragPreview()).toBeNull();
    expect(args.onChange).not.toHaveBeenCalled();
  });
});
