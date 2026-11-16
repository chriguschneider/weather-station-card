// Row of toggle pills: every option always visible (filled = on), one click
// either way. ha-form's multi-select hides unselected options (ADR-0024).
// The editor's only hand-built control; styles live in the editor's global
// <style> block.

import { html, type TemplateResult } from 'lit';

export interface PillOption {
  /** Leaf key `_applyTogglePaths` matches on (`show_pressure`, …). */
  value: string;
  label: string;
}

export interface TogglePillsArgs {
  /** Field label above the row; omit where an `h4.subsection` already names it. */
  label?: string;
  options: ReadonlyArray<PillOption>;
  /** Leaves currently on. */
  selected: ReadonlyArray<string>;
  /** Receives the full next selection, not the toggled item. */
  onChange: (next: string[]) => void;
  /** `data-group` on the row — the handle tests query by. */
  group: string;
}

export function renderTogglePills(args: TogglePillsArgs): TemplateResult {
  const { label, options, selected, onChange, group } = args;
  const on = new Set(selected);

  const toggle = (value: string): void => {
    const next = new Set(on);
    // Delete-or-add rather than a filter+concat: the emitted order then
    // follows `options`, so a config round-trip can't reorder the YAML
    // keys just because the user toggled something off and on again.
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };

  return html`
    <div class="pill-field">
      ${label ? html`<div class="pill-label">${label}</div>` : ''}
      <div class="pills" data-group=${group}>
        ${options.map((option) => {
          const isOn = on.has(option.value);
          return html`
            <button
              type="button"
              class="pill ${isOn ? 'on' : ''}"
              role="switch"
              aria-checked=${isOn ? 'true' : 'false'}
              data-value=${option.value}
              @click=${() => toggle(option.value)}
            >${option.label}</button>
          `;
        })}
      </div>
    </div>
  `;
}
