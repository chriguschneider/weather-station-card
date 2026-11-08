// Data-sources popup (`show_sources`, #431, ADR-0031): one info button
// opens an overlay that names the source of every live value and
// explains the chart's encodings. The card itself stays untagged.
//
// Same overlay pattern as the zero-degree popup (src/zero-degree-popup.ts):
// plain DOM in the card's shadow root outside ha-card (container
// containment would turn `position: fixed` card-relative), no
// `ha-dialog`, Escape / backdrop / × close, focus returns to the opener.
// Kept as its own module so the zero-degree popup stays untouched.

import type { LiveSourceKind } from './live-source.js';
import type { LegendItem } from './chart-legend.js';

// `info`: a row whose source text comes from the row itself (next rain).
export type SourceLineKind = LiveSourceKind | 'info';

export interface SourceLine {
  label: string;
  value: string;
  kind: SourceLineKind;
  /** "Station", "Weather service", "Calculated from the location", … */
  sourceText: string;
  entityId?: string;
  /** Stale station value: "last value, unavailable since 09:12". */
  note?: string;
  /** Configured sensor is down (stale value or weather fallback). */
  problem?: boolean;
}

/** `Temperature 0.2 °C · Station · sensor.x · last value, …`. */
export function formatSourceLine(line: SourceLine): string {
  const head = line.value ? `${line.label} ${line.value}` : line.label;
  return [head, line.sourceText, line.entityId, line.note].filter(Boolean).join(' · ');
}

const STYLES = `
  .wsc-src-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    font-family: var(--ha-card-font-family, var(--paper-font-body1_-_font-family, inherit));
  }
  .wsc-src-panel {
    box-sizing: border-box;
    width: 100%;
    max-width: 520px;
    max-height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    background: var(--ha-card-background, var(--card-background-color, #fff));
    color: var(--primary-text-color, #212121);
    border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  @media (max-width: 560px) {
    .wsc-src-panel { max-width: none; border-radius: 0; }
  }
  .wsc-src-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .wsc-src-heading { font-size: 18px; }
  .wsc-src-close {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 4px;
    font-size: 22px;
    line-height: 1;
    padding: 2px 8px;
  }
  .wsc-src-section {
    margin: 12px 0 4px;
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--secondary-text-color, #727272);
  }
  .wsc-src-list { list-style: none; margin: 0; padding: 0; }
  .wsc-src-line {
    padding: 4px 0;
    font-size: 14px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .wsc-src-line[role="button"] { cursor: pointer; border-radius: 4px; }
  .wsc-src-line[role="button"]:hover .wsc-src-label { color: var(--primary-color, #03a9f4); }
  .wsc-src-label { font-weight: 500; }
  .wsc-src-meta { color: var(--secondary-text-color, #727272); }
  .wsc-src-problem .wsc-src-meta { color: var(--warning-color, #ff9800); }
  .wsc-src-close:focus-visible, .wsc-src-line:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
  .wsc-src-legend { display: flex; align-items: center; gap: 8px; }
  .wsc-src-swatch {
    flex: none;
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    width: 22px;
    height: 14px;
  }
  .wsc-src-swatch-line { display: block; width: 100%; border-top: 2px solid currentColor; }
  .wsc-src-swatch-line.dashed { border-top-style: dashed; }
  .wsc-src-swatch-bar { display: block; width: 10px; height: 12px; margin: 0 auto; border-radius: 2px; }
`;

export interface SourcesPopupStrings {
  title: string;
  close: string;
  liveTitle: string;
  chartTitle: string;
}

export interface SourcesPopupOpts {
  /** Where the overlay mounts — the card's shadow root. */
  root: ShadowRoot | HTMLElement;
  lines: readonly SourceLine[];
  /** Chart encodings; empty hides the chart section. */
  legend: readonly LegendItem[];
  strings: SourcesPopupStrings;
  /** Focus goes back here on close. */
  returnFocus?: HTMLElement | null;
  /** A line with an entity was activated; the popup is already closed. */
  onMoreInfo?(entityId: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function swatch(item: LegendItem): HTMLElement {
  const box = el('span', 'wsc-src-swatch');
  box.setAttribute('aria-hidden', 'true');
  if (item.swatch === 'bar') {
    const bar = el('span', 'wsc-src-swatch-bar');
    bar.style.background = item.colors[0] ?? 'currentColor';
    box.append(bar);
    return box;
  }
  const colors = item.colors.length > 0 ? item.colors : ['currentColor'];
  for (const c of colors) {
    const line = el('span', item.swatch === 'dash' ? 'wsc-src-swatch-line dashed' : 'wsc-src-swatch-line');
    line.style.borderTopColor = c;
    box.append(line);
  }
  return box;
}

/** One instance per card. `open` while open rebuilds; `close` is
 *  idempotent and the card's teardown calls it. */
export class SourcesPopup {
  private _overlay: HTMLElement | null = null;
  private _returnFocus: HTMLElement | null = null;

  get isOpen(): boolean {
    return this._overlay !== null;
  }

  open(opts: SourcesPopupOpts): void {
    this.close(false);
    const { strings } = opts;
    const overlay = el('div', 'wsc-src-backdrop');
    const style = document.createElement('style');
    style.textContent = STYLES;
    const panel = el('div', 'wsc-src-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'wsc-src-title');

    const header = el('div', 'wsc-src-header');
    const title = el('span', 'wsc-src-heading', strings.title);
    title.id = 'wsc-src-title';
    const closeBtn = el('button', 'wsc-src-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', strings.close);
    closeBtn.addEventListener('click', () => this.close());
    header.append(title, closeBtn);
    panel.append(header);

    const focusables: HTMLElement[] = [closeBtn];
    if (opts.lines.length > 0) {
      panel.append(el('div', 'wsc-src-section', strings.liveTitle));
      const list = el('ul', 'wsc-src-list');
      for (const line of opts.lines) list.append(this._lineItem(line, opts, focusables));
      panel.append(list);
    }
    if (opts.legend.length > 0) {
      panel.append(el('div', 'wsc-src-section', strings.chartTitle));
      const list = el('ul', 'wsc-src-list');
      for (const item of opts.legend) {
        const li = el('li', 'wsc-src-line wsc-src-legend');
        if (item.title) li.title = item.title;
        li.append(swatch(item), el('span', '', item.text));
        list.append(li);
      }
      panel.append(list);
    }

    overlay.append(style, panel);
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', (ev) => this._onKeydown(ev, focusables));
    opts.root.appendChild(overlay);
    this._overlay = overlay;
    this._returnFocus = opts.returnFocus ?? null;
    closeBtn.focus();
  }

  /** `restoreFocus` false is the rebuild path of `open` and the hand-off
   *  to HA's more-info dialog. */
  close(restoreFocus = true): void {
    if (!this._overlay) return;
    this._overlay.remove();
    this._overlay = null;
    const target = this._returnFocus;
    this._returnFocus = null;
    if (restoreFocus && target?.isConnected) target.focus();
  }

  private _lineItem(line: SourceLine, opts: SourcesPopupOpts, focusables: HTMLElement[]): HTMLElement {
    const li = el('li', line.problem ? 'wsc-src-line wsc-src-problem' : 'wsc-src-line');
    li.dataset.kind = line.kind;
    li.append(el('span', 'wsc-src-label', line.label));
    if (line.value) li.append(document.createTextNode(` ${line.value}`));
    const meta = [line.sourceText, line.entityId, line.note].filter(Boolean).join(' · ');
    if (meta) li.append(el('span', 'wsc-src-meta', ` · ${meta}`));
    const eid = line.entityId;
    const onMoreInfo = opts.onMoreInfo;
    if (eid && onMoreInfo) {
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.setAttribute('aria-label', formatSourceLine(line));
      const activate = () => {
        this.close(false);
        onMoreInfo(eid);
      };
      li.addEventListener('click', activate);
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        }
      });
      focusables.push(li);
    }
    return li;
  }

  private _onKeydown(ev: KeyboardEvent, focusables: HTMLElement[]): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.close();
      return;
    }
    if (ev.key !== 'Tab') return;
    // aria-modal promises focus stays inside: wrap between the controls.
    const root = this._overlay?.getRootNode() as Document | ShadowRoot | undefined;
    const active = root?.activeElement ?? null;
    const n = focusables.length;
    const idx = focusables.indexOf(active as HTMLElement);
    let next = ev.shiftKey ? idx - 1 : idx + 1;
    if (idx === -1) next = 0;
    ev.preventDefault();
    focusables[(next + n) % n].focus();
  }
}
