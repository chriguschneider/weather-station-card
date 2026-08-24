// Shared multi-select control: a row of toggle pills.
//
// Replaces `ha-form`'s `selector.select` with `multiple: true`, which
// renders only the SELECTED options as removable chips and hides the
// rest behind an add-dropdown. That costs discoverability — you cannot
// see what a panel offers without opening the dropdown — and makes the
// interaction asymmetric (one click to remove, two to add).
//
// Pills show every option at all times: filled = on, outlined = off,
// one click either way. The row never reflows as you toggle, so nothing
// jumps under the pointer.
//
// This is the editor's only hand-built control; everything else is
// schema-driven `ha-form` (ADR-0023). The deviation buys the always-
// visible option set, which no HA selector provides. Config semantics
// are unchanged: callers hand the selected leaves to
// `editor._applyTogglePaths`, exactly as the multi-select did.
//
// Styles live in the editor's global <style> block (`.pill-field`,
// `.pills`, `.pill`) next to the other cross-partial rules.

import { html, type TemplateResult } from 'lit';

export interface PillOption {
  /** Leaf key `_applyTogglePaths` matches on (`show_pressure`, …). */
  value: string;
  label: string;
}

export interface TogglePillsArgs {
  /** Field label, rendered above the row like `ha-form` labels. Omit
   *  where an `h4.subsection` heading already names the row — a label
   *  there would just repeat the heading one line below it. */
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
