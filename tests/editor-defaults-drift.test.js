// Drift guard: every editor toggle default must equal the runtime default.
//
// The editor's toggle lists each carry a `def` — the value the editor
// treats as "unset". `_applyTogglePaths` DELETES a key that lands back
// on its `def` instead of writing it, so the card then falls through to
// DEFAULTS. When the two disagree, the result is a silent, delayed
// break:
//
//   `show_pressure` was `true` in the editor and `false` in DEFAULTS.
//   A card added through the UI carried an explicit `show_pressure:
//   true`, so pressure rendered. The first time the user toggled ANY
//   other attribute, `_applyTogglePaths` saw pressure sitting on its
//   editor default, deleted the key — and pressure vanished from the
//   card. Nothing about the pressure row had been touched.
//
// Same mechanism in the other direction turns an explicit "off" back
// on. Neither is visible in a render test: the editor and the card are
// each self-consistent, they just disagree with one another.

import { describe, it, expect } from 'vitest';
import { DEFAULTS, DEFAULTS_FORECAST } from '../src/defaults.js';
import { MAIN_ELEMENT_PATHS, ATTRIBUTE_PATHS } from '../src/editor/render-live-panel.js';
import { CHART_ROW_PATHS } from '../src/editor/render-chart.js';

const LISTS = [
  { name: 'MAIN_ELEMENT_PATHS', items: MAIN_ELEMENT_PATHS, defaults: DEFAULTS },
  { name: 'ATTRIBUTE_PATHS', items: ATTRIBUTE_PATHS, defaults: DEFAULTS },
  { name: 'CHART_ROW_PATHS', items: CHART_ROW_PATHS, defaults: DEFAULTS_FORECAST },
];

const leafOf = (path) => path.split('.').pop();

describe('editor toggle defaults match DEFAULTS', () => {
  for (const { name, items, defaults } of LISTS) {
    describe(name, () => {
      it('declares every key in the matching DEFAULTS bag', () => {
        const missing = items
          .map(({ path }) => leafOf(path))
          .filter((leaf) => !(leaf in defaults));
        expect(missing).toEqual([]);
      });

      for (const { path, def } of items) {
        const leaf = leafOf(path);
        it(`${leaf}: editor def ${def} === DEFAULTS ${defaults[leaf]}`, () => {
          expect(defaults[leaf]).toBe(def);
        });
      }
    });
  }
});

// The clock projection in weather-station-card-editor.ts hand-writes the
// same three paths; keep them honest too.
describe('clock projection defaults match DEFAULTS', () => {
  for (const key of ['show_time', 'show_time_seconds', 'use_12hour_format']) {
    it(`${key} defaults to false`, () => {
      expect(DEFAULTS[key]).toBe(false);
    });
  }
});
