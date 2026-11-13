// Shared overlay shell of the card's popups (zero-degree, data sources).
//
// Plain DOM in the card's shadow root, outside ha-card: `.card` carries
// `container-type: inline-size`, and that containment would turn
// `position: fixed` card-relative. No `ha-dialog`: it is HA-internal,
// lazy-loaded and changes shape between HA versions. The shell owns
// backdrop, dialog attributes, close button, Escape, the Tab trap and
// focus return; a popup supplies only its heading and body.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface PopupShellOpen {
  /** Where the overlay mounts: the card's shadow root. */
  root: ShadowRoot | HTMLElement;
  /** Heading node; the shell gives it the id `<prefix>-title`. */
  heading: HTMLElement;
  closeLabel: string;
  /** Appended to the panel after the header. */
  body: readonly Node[];
  /** Tab stops after the close button, in order. */
  focusables?: readonly HTMLElement[];
  /** Popup-specific CSS, appended after the shared rules. */
  css?: string;
  /** Focus goes back here on close. */
  returnFocus?: HTMLElement | null;
  /** Runs once when the overlay goes away, before focus is restored. */
  onClose?(): void;
}

export interface PopupShellHandle {
  panel: HTMLElement;
  closeButton: HTMLButtonElement;
}

function baseCss(p: string): string {
  return `
  .${p}-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    font-family: var(--ha-card-font-family, var(--paper-font-body1_-_font-family, inherit));
  }
  .${p}-panel {
    box-sizing: border-box;
    width: 100%;
    max-width: 520px;
    max-height: 100%;
    overflow: auto;
    padding: 16px;
    background: var(--ha-card-background, var(--card-background-color, #fff));
    color: var(--primary-text-color, #212121);
    border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  @media (max-width: 560px) {
    .${p}-panel { max-width: none; border-radius: 0; }
  }
  .${p}-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .${p}-close {
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
  .${p}-close:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
`;
}

/** One instance per popup; `open` while open rebuilds, `close` is
 *  idempotent and the card's teardown calls it. `prefix` names the CSS
 *  classes (`<prefix>-backdrop`, `-panel`, `-header`, `-close`). */
export class PopupShell {
  private _overlay: HTMLElement | null = null;
  private _returnFocus: HTMLElement | null = null;
  private _onClose: (() => void) | null = null;
  private _focusables: HTMLElement[] = [];

  constructor(private readonly _prefix: string) {}

  get isOpen(): boolean {
    return this._overlay !== null;
  }

  open(opts: PopupShellOpen): PopupShellHandle {
    this.close(false);
    const p = this._prefix;
    const overlay = el('div', `${p}-backdrop`);
    const style = document.createElement('style');
    style.textContent = baseCss(p) + (opts.css ?? '');
    const panel = el('div', `${p}-panel`);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', `${p}-title`);

    const header = el('div', `${p}-header`);
    opts.heading.id = `${p}-title`;
    const closeButton = el('button', `${p}-close`, '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', opts.closeLabel);
    closeButton.addEventListener('click', () => this.close());
    header.append(opts.heading, closeButton);
    panel.append(header, ...opts.body);

    overlay.append(style, panel);
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', (ev) => this._onKeydown(ev));
    opts.root.appendChild(overlay);
    this._overlay = overlay;
    this._returnFocus = opts.returnFocus ?? null;
    this._onClose = opts.onClose ?? null;
    this._focusables = [closeButton, ...(opts.focusables ?? [])];
    closeButton.focus();
    return { panel, closeButton };
  }

  /** `restoreFocus` false is the rebuild path of `open` and the hand-off
   *  to HA's more-info dialog. */
  close(restoreFocus = true): void {
    if (!this._overlay) return;
    const onClose = this._onClose;
    this._onClose = null;
    this._overlay.remove();
    this._overlay = null;
    this._focusables = [];
    const target = this._returnFocus;
    this._returnFocus = null;
    onClose?.();
    if (restoreFocus && target?.isConnected) target.focus();
  }

  private _onKeydown(ev: KeyboardEvent): void {
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
    const focusables = this._focusables;
    const n = focusables.length;
    const idx = focusables.indexOf(active as HTMLElement);
    let next = ev.shiftKey ? idx - 1 : idx + 1;
    if (idx === -1) next = 0;
    ev.preventDefault();
    focusables[(next + n) % n].focus();
  }
}
