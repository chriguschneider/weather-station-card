// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopupShell, el } from '../src/popup-shell.js';

let root;
let shell;

function button(label) {
  const b = document.createElement('button');
  b.textContent = label;
  return b;
}

function open(extra = {}) {
  const extras = extra.focusables ?? [button('a'), button('b')];
  const body = [document.createElement('p'), ...extras];
  return shell.open({
    root,
    heading: el('span', 'h', 'Title'),
    closeLabel: 'Close',
    body,
    focusables: extras,
    ...extra,
  });
}

function key(target, k, init = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  shell = new PopupShell('wsc-t');
});

afterEach(() => {
  shell.close(false);
  root.remove();
});

describe('PopupShell', () => {
  it('renders an accessible modal dialog labelled by its heading', () => {
    const { panel, closeButton } = open();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const id = panel.getAttribute('aria-labelledby');
    expect(id).toBe('wsc-t-title');
    expect(root.querySelector(`#${id}`).textContent).toBe('Title');
    expect(closeButton.getAttribute('aria-label')).toBe('Close');
    expect(document.activeElement).toBe(closeButton);
    expect(shell.isOpen).toBe(true);
  });

  it('wraps Tab forwards and Shift+Tab backwards between the controls', () => {
    const extras = [button('a'), button('b')];
    const { closeButton } = open({ focusables: extras });
    const overlay = root.querySelector('.wsc-t-backdrop');
    const ev1 = key(overlay, 'Tab', { shiftKey: true });
    expect(ev1.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(extras[1]);
    key(overlay, 'Tab');
    expect(document.activeElement).toBe(closeButton);
    key(overlay, 'Tab');
    expect(document.activeElement).toBe(extras[0]);
  });

  it('pulls stray focus back to the first control on Tab', () => {
    const { closeButton } = open();
    const stray = button('stray');
    root.querySelector('p').append(stray);
    stray.focus();
    key(root.querySelector('.wsc-t-backdrop'), 'Tab');
    expect(document.activeElement).toBe(closeButton);
  });

  it('re-opening leaves exactly one overlay', () => {
    open();
    open();
    expect(root.querySelectorAll('.wsc-t-backdrop')).toHaveLength(1);
  });

  it('closes on Escape, the backdrop and the close button, not on the panel', () => {
    const { panel, closeButton } = open();
    panel.click();
    expect(shell.isOpen).toBe(true);
    key(panel, 'Escape');
    expect(shell.isOpen).toBe(false);
    open();
    root.querySelector('.wsc-t-backdrop').click();
    expect(shell.isOpen).toBe(false);
    const again = open();
    again.closeButton.click();
    expect(shell.isOpen).toBe(false);
    expect(closeButton).not.toBe(again.closeButton);
    expect(root.querySelector('.wsc-t-backdrop')).toBeNull();
  });

  it('restores focus to the opener, and tolerates one that is gone', () => {
    const opener = button('opener');
    document.body.append(opener);
    open({ returnFocus: opener });
    shell.close();
    expect(document.activeElement).toBe(opener);

    open({ returnFocus: opener });
    opener.remove();
    expect(() => shell.close()).not.toThrow();
    expect(shell.isOpen).toBe(false);
  });

  it('skips focus restore when asked and runs onClose once', () => {
    const opener = button('opener');
    document.body.append(opener);
    const onClose = vi.fn();
    open({ returnFocus: opener, onClose });
    shell.close(false);
    shell.close(false);
    expect(document.activeElement).not.toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
    opener.remove();
  });

  it('close is a no-op when nothing is open', () => {
    expect(() => shell.close()).not.toThrow();
  });
});
