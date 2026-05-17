// Vitest setup. Runs before every test file. Polyfills jsdom gaps that
// modules under test depend on at import time.

// uPlot calls window.matchMedia at module-load (devicePixelRatio change
// listener for retina-aware redraws). jsdom doesn't ship matchMedia by
// default, and the @vitest-environment node tests don't have window at
// all — so guard on globalThis.window, attach a no-op stub when absent.
if (typeof globalThis.window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: String(query ?? ''),
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
