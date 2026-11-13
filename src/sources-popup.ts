// Data-sources popup (`show_sources`, #431, ADR-0031): one info button
// opens an overlay that names the source of every live value and
// explains the chart's encodings. The card itself stays untagged.
//
// The overlay shell (backdrop, close, Escape, Tab trap, focus return) is
// shared with the zero-degree popup: src/popup-shell.ts.

import { PopupShell, el } from './popup-shell.js';
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
  /** Display name shown instead of the id; the id goes in the tooltip. */
  entityName?: string;
  /** Stale station value: "last value, unavailable since 09:12". */
  note?: string;
  /** Configured sensor is down (stale value or weather fallback). */
  problem?: boolean;
}

/** `Temperature 0.2 °C · Station · sensor.x · last value, …`. */
export function formatSourceLine(line: SourceLine): string {
  const head = line.value ? `${line.label} ${line.value}` : line.label;
  return [head, line.sourceText, line.entityName || line.entityId, line.note].filter(Boolean).join(' · ');
}

// Shell rules (backdrop, panel, header, close) live in popup-shell.ts.
const STYLES = `
  .wsc-src-panel { overflow-x: hidden; }
  .wsc-src-header { margin-bottom: 4px; }
  .wsc-src-heading { font-size: 18px; }
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
  .wsc-src-line:focus-visible {
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
  private readonly _shell = new PopupShell('wsc-src');

  get isOpen(): boolean {
    return this._shell.isOpen;
  }

  open(opts: SourcesPopupOpts): void {
    const { strings } = opts;
    const body: HTMLElement[] = [];
    const focusables: HTMLElement[] = [];
    if (opts.lines.length > 0) {
      body.push(el('div', 'wsc-src-section', strings.liveTitle));
      const list = el('ul', 'wsc-src-list');
      for (const line of opts.lines) list.append(this._lineItem(line, opts, focusables));
      body.push(list);
    }
    if (opts.legend.length > 0) {
      body.push(el('div', 'wsc-src-section', strings.chartTitle));
      const list = el('ul', 'wsc-src-list');
      for (const item of opts.legend) {
        const li = el('li', 'wsc-src-line wsc-src-legend');
        if (item.title) li.title = item.title;
        li.append(swatch(item), el('span', '', item.text));
        list.append(li);
      }
      body.push(list);
    }
    this._shell.open({
      root: opts.root,
      heading: el('span', 'wsc-src-heading', strings.title),
      closeLabel: strings.close,
      body,
      focusables,
      css: STYLES,
      returnFocus: opts.returnFocus,
    });
  }

  /** `restoreFocus` false is the rebuild path of `open` and the hand-off
   *  to HA's more-info dialog. */
  close(restoreFocus = true): void {
    this._shell.close(restoreFocus);
  }

  private _lineItem(line: SourceLine, opts: SourcesPopupOpts, focusables: HTMLElement[]): HTMLElement {
    const li = el('li', line.problem ? 'wsc-src-line wsc-src-problem' : 'wsc-src-line');
    li.dataset.kind = line.kind;
    li.append(el('span', 'wsc-src-label', line.label));
    if (line.value) li.append(document.createTextNode(` ${line.value}`));
    const meta = [line.sourceText, line.entityName || line.entityId, line.note].filter(Boolean).join(' · ');
    if (meta) li.append(el('span', 'wsc-src-meta', ` · ${meta}`));
    const eid = line.entityId;
    if (eid) li.title = eid;
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
}
