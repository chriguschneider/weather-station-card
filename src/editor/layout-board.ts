// Editor control — the attribute-row layout board (ADR-0025).
//
// A row of drop zones, one per layout column plus a trailing "new
// column" zone, each holding the rows currently on as draggable pills.
// Dragging a pill within a column reorders it, dragging across columns
// moves it, dropping on the trailing zone opens a column. Every drop
// writes an explicit `attributes_layout`; the toggle-pill row above the
// board keeps deciding WHICH rows are on, the board decides WHERE.
//
// Pointer events, not HTML5 drag-and-drop: the native API does not
// fire on touch, and the editor is used on tablets. The board is
// re-rendered from a preview layout while a drag is in flight, so the
// dragged pill itself is the placeholder (dimmed, dashed) and the
// columns never jump; a fixed-position ghost follows the pointer. The
// preview is always derived from the layout at drag start, so a column
// emptied by the drag stays open for a drop-back until the pointer is
// released (normalizeLayout drops it on commit).
//
// Keyboard: arrow keys on a focused pill move it one step; the same
// move helper backs both paths. Styles live in the editor's global
// <style> block next to the toggle pills (`.layout-board`, …).

import { html, nothing, type TemplateResult } from 'lit';
import {
  normalizeLayout,
  type AttributeToken,
  type AttributesLayout,
} from '../attributes-layout.js';

export interface DropTarget {
  /** Column index; `columns.length` opens a new column. */
  column: number;
  /** Row index inside that column, counted without the dragged pill. */
  index: number;
}

interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ColumnGeometry {
  rect: RectLike;
  pills: Array<{ token: AttributeToken; rect: RectLike }>;
}

/** The layout with `token` lifted out and reinserted at `target`.
 *  Emptied columns are kept (drop-back must stay possible while the
 *  pointer is down); a target of `base.length` appends a column. */
export function previewLayout(
  base: AttributesLayout,
  token: AttributeToken,
  target: DropTarget,
): AttributesLayout {
  const next = base.map((column) => column.filter((t) => t !== token));
  while (next.length <= target.column) next.push([]);
  const column = next[target.column];
  column.splice(Math.max(0, Math.min(target.index, column.length)), 0, token);
  return next;
}

// Distance from a point to a rect (0 when inside), used to pick the
// nearest column when the pointer is in a gap or off the board.
function axisGap(v: number, lo: number, hi: number): number {
  if (v < lo) return lo - v;
  if (v > hi) return v - hi;
  return 0;
}
function rectDistance(x: number, y: number, r: RectLike): number {
  const dx = axisGap(x, r.left, r.right);
  const dy = axisGap(y, r.top, r.bottom);
  return dx * dx + dy * dy;
}

/** Pure geometry → drop target. `columns` includes the trailing
 *  new-column zone as its last entry (with no pills). */
export function dropTargetFor(
  point: { x: number; y: number },
  columns: ReadonlyArray<ColumnGeometry>,
  dragged: AttributeToken,
): DropTarget | null {
  if (columns.length === 0) return null;
  let column = 0;
  let best = Infinity;
  columns.forEach((c, i) => {
    const d = rectDistance(point.x, point.y, c.rect);
    if (d < best) { best = d; column = i; }
  });
  const others = columns[column].pills.filter((p) => p.token !== dragged);
  const index = others.filter((p) => (p.rect.top + p.rect.bottom) / 2 < point.y).length;
  return { column, index };
}

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

/** Keyboard move: one step in the given direction. Returns the input
 *  (same reference) when the move is a no-op, so callers can skip the
 *  config write. Emptied columns are dropped. */
export function moveToken(
  layout: AttributesLayout,
  token: AttributeToken,
  direction: MoveDirection,
): AttributesLayout {
  const col = layout.findIndex((column) => column.includes(token));
  if (col < 0) return layout;
  const row = layout[col].indexOf(token);
  let target: DropTarget;
  switch (direction) {
    case 'up':
      if (row === 0) return layout;
      target = { column: col, index: row - 1 };
      break;
    case 'down':
      if (row >= layout[col].length - 1) return layout;
      target = { column: col, index: row + 1 };
      break;
    case 'left':
      if (col === 0) return layout;
      target = { column: col - 1, index: Math.min(row, layout[col - 1].length) };
      break;
    case 'right':
      // From the last column a right move opens a new one — unless the
      // pill is alone there, which would only shuffle an empty column.
      if (col === layout.length - 1 && layout[col].length === 1) return layout;
      target = { column: col + 1, index: Math.min(row, layout[col + 1]?.length ?? 0) };
      break;
  }
  return normalizeLayout(previewLayout(layout, token, target));
}

const KEY_TO_DIRECTION: Record<string, MoveDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

// Pointer travel before a press becomes a drag — below this a touch is
// a tap and a mouse press is a click, and nothing moves.
const DRAG_THRESHOLD_PX = 6;

interface DragState {
  token: AttributeToken;
  board: HTMLElement;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  pillWidth: number;
  pillHeight: number;
  label: string;
  active: boolean;
  base: AttributesLayout;
  preview: AttributesLayout;
  ghost: HTMLElement | null;
  onChange: (next: AttributesLayout) => void;
  rerender: () => void;
  onMove: (ev: PointerEvent) => void;
  onUp: (ev: PointerEvent) => void;
  onCancel: (ev: PointerEvent) => void;
}

// One drag at a time per document; the board is re-rendered from
// `drag.preview` while this is set.
let drag: DragState | null = null;

/** Test/debug seam: the layout the board currently previews. */
export function currentDragPreview(): AttributesLayout | null {
  return drag?.active ? drag.preview : null;
}

function measureColumns(board: HTMLElement): ColumnGeometry[] {
  return Array.from(board.querySelectorAll<HTMLElement>('[data-col]')).map((colEl) => ({
    rect: colEl.getBoundingClientRect(),
    pills: Array.from(colEl.querySelectorAll<HTMLElement>('[data-token]')).map((pillEl) => ({
      token: pillEl.dataset.token as AttributeToken,
      rect: pillEl.getBoundingClientRect(),
    })),
  }));
}

// The ghost lives on document.body with inline styles: the editor sits
// inside HA's dialog, whose transforms would re-anchor a fixed element
// rendered from within the shadow tree.
function createGhost(state: DragState): HTMLElement {
  const ghost = document.createElement('div');
  ghost.textContent = state.label;
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${state.pillWidth}px`,
    boxSizing: 'border-box',
    padding: '7px 14px',
    borderRadius: '16px',
    fontSize: '13px',
    lineHeight: '1.2',
    fontFamily: 'inherit',
    background: 'var(--primary-color, #03a9f4)',
    color: 'var(--text-primary-color, #fff)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    pointerEvents: 'none',
    zIndex: '10000',
    opacity: '0.9',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(ghost);
  return ghost;
}

function positionGhost(state: DragState, x: number, y: number): void {
  if (!state.ghost) return;
  state.ghost.style.transform = `translate(${x - state.grabOffsetX}px, ${y - state.grabOffsetY}px)`;
}

function sameLayout(a: AttributesLayout, b: AttributesLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function endDrag(commit: boolean): void {
  const state = drag;
  if (!state) return;
  window.removeEventListener('pointermove', state.onMove);
  window.removeEventListener('pointerup', state.onUp);
  window.removeEventListener('pointercancel', state.onCancel);
  state.ghost?.remove();
  drag = null;
  const changed = state.active && !sameLayout(normalizeLayout(state.preview), normalizeLayout(state.base));
  if (commit && changed) {
    state.onChange(normalizeLayout(state.preview));
  } else {
    state.rerender();
  }
}

function startDrag(
  ev: PointerEvent,
  args: { token: AttributeToken; label: string; layout: AttributesLayout;
    onChange: (next: AttributesLayout) => void; rerender: () => void },
): void {
  // Primary button only; a right-click is not a drag.
  if (ev.button !== 0) return;
  if (drag) endDrag(false);
  const pill = ev.currentTarget as HTMLElement;
  const board = pill.closest<HTMLElement>('.layout-board');
  if (!board) return;
  const rect = pill.getBoundingClientRect();
  const state: DragState = {
    token: args.token,
    board,
    startX: ev.clientX,
    startY: ev.clientY,
    grabOffsetX: ev.clientX - rect.left,
    grabOffsetY: ev.clientY - rect.top,
    pillWidth: rect.width,
    pillHeight: rect.height,
    label: args.label,
    active: false,
    base: args.layout,
    preview: args.layout,
    ghost: null,
    onChange: args.onChange,
    rerender: args.rerender,
    onMove: (move: PointerEvent) => {
      const s = drag;
      if (!s) return;
      if (!s.active) {
        const dx = move.clientX - s.startX;
        const dy = move.clientY - s.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        s.active = true;
        s.ghost = createGhost(s);
        s.rerender();
      }
      move.preventDefault();
      positionGhost(s, move.clientX, move.clientY);
      const target = dropTargetFor({ x: move.clientX, y: move.clientY }, measureColumns(s.board), s.token);
      if (!target) return;
      const next = previewLayout(s.base, s.token, target);
      if (!sameLayout(next, s.preview)) {
        s.preview = next;
        s.rerender();
      }
    },
    onUp: () => endDrag(true),
    // The browser took the pointer away (a scroll gesture won, the
    // dialog closed): put everything back, write nothing.
    onCancel: () => endDrag(false),
  };
  drag = state;
  window.addEventListener('pointermove', state.onMove);
  window.addEventListener('pointerup', state.onUp);
  window.addEventListener('pointercancel', state.onCancel);
}

export interface LayoutBoardArgs {
  /** Rows currently on, in their resolved columns. */
  layout: AttributesLayout;
  /** True when the config carries an explicit `attributes_layout` —
   *  shows the "back to automatic" action. */
  explicit: boolean;
  labelFor: (token: AttributeToken) => string;
  t: (key: string) => string;
  onChange: (next: AttributesLayout) => void;
  onReset: () => void;
  /** Re-render hook (the editor's requestUpdate) for drag previews. */
  rerender: () => void;
}

export function renderLayoutBoard(args: LayoutBoardArgs): TemplateResult {
  const { layout, explicit, labelFor, t, onChange, onReset, rerender } = args;
  const shown = drag?.active ? drag.preview : layout;
  const dragging = drag?.active ? drag.token : null;

  const onKeydown = (ev: KeyboardEvent, token: AttributeToken): void => {
    const direction = KEY_TO_DIRECTION[ev.key];
    if (!direction) return;
    ev.preventDefault();
    const next = moveToken(layout, token, direction);
    if (next === layout) return;
    onChange(next);
    // The pill is re-created in its new column on the next render;
    // put the focus back on it so a second arrow press keeps working.
    const board = (ev.currentTarget as HTMLElement).closest<HTMLElement>('.layout-board');
    requestAnimationFrame(() => {
      board?.querySelector<HTMLElement>(`[data-token="${token}"]`)?.focus();
    });
  };

  const pill = (token: AttributeToken): TemplateResult => html`
    <div
      class="pill on layout-pill ${token === dragging ? 'dragging' : ''}"
      data-token=${token}
      tabindex="0"
      role="option"
      aria-label=${labelFor(token)}
      @pointerdown=${(ev: PointerEvent) =>
        startDrag(ev, { token, label: labelFor(token), layout, onChange, rerender })}
      @keydown=${(ev: KeyboardEvent) => onKeydown(ev, token)}
    ><ha-icon icon="mdi:drag-vertical"></ha-icon><span>${labelFor(token)}</span></div>
  `;

  return html`
    <div class="pill-field">
      <div class="pill-label">${t('layout_board_label')}</div>
      <div class="layout-board" role="listbox" aria-label=${t('layout_board_label')}>
        ${shown.map((column, ci) => html`
          <div class="layout-col ${column.length === 0 ? 'empty' : ''}" data-col=${ci}>
            ${column.map(pill)}
          </div>
        `)}
        <div class="layout-col new" data-col=${shown.length}>
          <span>${t('layout_board_new_column')}</span>
        </div>
      </div>
      <div class="hint">${t('layout_board_hint')}</div>
      ${explicit ? html`
        <button type="button" class="link-button" @click=${onReset}>${t('layout_board_reset')}</button>
      ` : nothing}
    </div>
  `;
}
