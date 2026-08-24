// @vitest-environment jsdom
// The editor's toggle-pill control (src/editor/toggle-pills.ts).
//
// This is the one hand-built control in an otherwise schema-driven
// editor, so the behaviour ha-form used to provide has to be pinned
// here: what a click emits, that the row shows every option regardless
// of selection, and that it stays operable by keyboard and readable by
// assistive tech.

import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import { renderTogglePills } from '../src/editor/toggle-pills.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
];

function mount({ selected = [], onChange = vi.fn(), options = OPTIONS } = {}) {
  const container = document.createElement('div');
  render(
    renderTogglePills({ label: 'Rows', group: 'rows', options, selected, onChange }),
    container,
  );
  const pills = Array.from(container.querySelectorAll('.pill'));
  const byValue = (v) => pills.find((p) => p.dataset.value === v);
  return { container, pills, byValue, onChange };
}

describe('renderTogglePills — rendering', () => {
  it('renders every option, not just the selected ones', () => {
    const { pills } = mount({ selected: ['b'] });
    expect(pills.map((p) => p.dataset.value)).toEqual(['a', 'b', 'c']);
    expect(pills.map((p) => p.textContent.trim())).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('marks selected options on and leaves the rest off', () => {
    const { byValue } = mount({ selected: ['a', 'c'] });
    expect(byValue('a').classList.contains('on')).toBe(true);
    expect(byValue('b').classList.contains('on')).toBe(false);
    expect(byValue('c').classList.contains('on')).toBe(true);
  });

  it('renders the field label and the data-group handle', () => {
    const { container } = mount();
    expect(container.querySelector('.pill-label').textContent.trim()).toBe('Rows');
    expect(container.querySelector('.pills').dataset.group).toBe('rows');
  });
});

describe('renderTogglePills — toggling', () => {
  it('adds an option that was off', () => {
    const { byValue, onChange } = mount({ selected: ['a'] });
    byValue('c').click();
    expect(onChange).toHaveBeenCalledWith(['a', 'c']);
  });

  it('removes an option that was on', () => {
    const { byValue, onChange } = mount({ selected: ['a', 'b'] });
    byValue('a').click();
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('emits the full next selection, not the toggled item', () => {
    const { byValue, onChange } = mount({ selected: ['a', 'b', 'c'] });
    byValue('b').click();
    expect(onChange).toHaveBeenCalledWith(['a', 'c']);
  });

  it('emits in option order regardless of the order things were switched on', () => {
    // Selection arrives out of order (a config round-trip, or the user
    // toggling c on before a). The emitted array must still follow the
    // option list, or the written YAML keys would shuffle.
    const { byValue, onChange } = mount({ selected: ['c', 'a'] });
    byValue('b').click();
    expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('can empty the selection completely', () => {
    const { byValue, onChange } = mount({ selected: ['a'] });
    byValue('a').click();
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('ignores a selected value that is not among the options', () => {
    // Stale config keys (a row removed in a later version) must not
    // leak back into the emitted selection.
    const { byValue, onChange } = mount({ selected: ['a', 'ghost'] });
    byValue('b').click();
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });
});

describe('renderTogglePills — accessibility', () => {
  it('uses real buttons, so Tab reaches them and Enter/Space activate', () => {
    const { pills } = mount();
    for (const pill of pills) {
      expect(pill.tagName).toBe('BUTTON');
      // type=button keeps a pill from submitting a surrounding form.
      expect(pill.getAttribute('type')).toBe('button');
    }
  });

  it('exposes on/off state as role=switch + aria-checked', () => {
    const { byValue } = mount({ selected: ['b'] });
    expect(byValue('b').getAttribute('role')).toBe('switch');
    expect(byValue('b').getAttribute('aria-checked')).toBe('true');
    expect(byValue('a').getAttribute('aria-checked')).toBe('false');
  });
});
