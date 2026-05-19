# 0013: ESM output with content-hashed chunks for lazy editor

**Status:** Accepted

**Date:** 2026-05-19

## Context

Until this change the rollup config emitted a single CJS file
(`dist/weather-station-card.js`) containing the card, the visual
editor, and every locale. Every user who viewed the card paid the
parse cost of the editor and of language strings they never saw —
the editor in particular is ~22 KB minified for a code path most
users hit a handful of times in the card's lifetime.

The "single-file" convention is empirically dominant in the HACS
ecosystem — a survey of seven popular cards (mini-graph-card,
button-card, mushroom, bubble-card, apexcharts-card, decluttering-
card, card-mod) found all of them shipping a single bundle. But the
convention is not a HACS requirement: `advanced-camera-card`
(58k weekly downloads) ships a 50-chunk ESM build with a separated
editor and per-language chunks, and HACS handles it cleanly —
`gather_files_to_download` in HACS' integration source downloads
all release assets (or all `dist/` files when there is no release),
not just the file named in `hacs.json`. The `filename` field there
only names the entry that gets registered as a Lovelace resource.

Our Lovelace resource registration was checked on the maintainer's
running HA via `.storage/lovelace_resources`: type was already
`module`, so an ESM entry needs no client-side change.

Alternatives considered:

- **Stay CJS, single file.** Simplest. Fixes nothing — editor still
  in the hot path; locales still in the hot path. The architectural
  shape blocks Slice 5 (per-language locales) too, not just the
  editor.
- **CJS entry that injects an ESM `<script>` tag at runtime to
  side-load the editor.** Works without a format change. Hides the
  dependency from rollup's chunker so we can't get content-hashed
  cache-busting; we'd hand-manage filenames. The Service-Worker
  cache trap (`?hacstag` only applies to the registered file) would
  also bite. Mechanically possible but worse engineering hygiene than
  the format switch.
- **ESM output with single entry + lazy chunks, no facade.** First
  attempt — failed in production. The editor chunk's static
  imports of shared code resolved to `./weather-station-card.js`,
  the same URL HACS appends `?hacstag=` to. The browser ended up
  with two copies of the entry under different URLs (with and
  without query string), the second copy re-executed
  `customElements.define('weather-station-card', …)`, threw
  "already defined", and HA disabled the visual editor. Confirmed
  on the maintainer's HA after deploying both files to
  `/hacsfiles/weather-station-card/`.
- **ESM output with `preserveEntrySignatures: 'strict'`** — what we
  did. Rollup extracts shared code into a content-hashed chunk
  (`main-<hash>.js`), the registered entry shrinks to a 28-byte
  facade (`import "./main-<hash>.js";`), and the editor chunk
  imports from the hashed chunk, not the entry — so the hacstag
  query never collides with module identity. This is the exact
  `advanced-camera-card` recipe; the comment in their rollup
  config calls it out as load-bearing.

## Decision

`dist/weather-station-card.js` is the ESM entry. With
`preserveEntrySignatures: 'strict'` rollup turns it into a 28-byte
facade (`import "./main-<hash>.js";`) and emits the actual card
code into `main-<hash>.js`. The visual editor lives in a third
content-hashed chunk (`weather-station-card-editor-<hash>.js`)
loaded via dynamic `import()` from inside the card's static
`getConfigElement()`.

The rollup config switches from `format: 'cjs'` / `file:` to
`format: 'es'` / `dir: 'dist'` with `entryFileNames:
'weather-station-card.js'` and `chunkFileNames: '[name]-[hash].js'`.
The entry filename is pinned so HACS' registered resource URL stays
unchanged across releases; chunk filenames are content-hashed so
the browser caches them long-term and HACS' `?hacstag=` query
parameter — which only applies to the registered entry — is not
load-bearing for chunk freshness.

`preserveEntrySignatures: 'strict'` is what makes the facade
appear. Without it, rollup is free to merge shared code back into
the entry — and when the editor chunk then imports that shared
code, the import path resolves to `./weather-station-card.js`,
which is the same URL HACS bumps with `?hacstag=`. The browser
treats `weather-station-card.js?hacstag=v1` and
`weather-station-card.js` as two distinct module identities,
re-runs the entry's `customElements.define`, throws, and HA
disables the visual editor. Forcing the facade keeps the entry
trivial and inert; chunks only ever import from the hashed
`main-<hash>.js`, which HACS never touches.

`getConfigElement` is async and returns
`await import(...); document.createElement(...)`. HA awaits the
returned value (this is supported in the editor lookup path), so
the lazy import is transparent to the editor UI.

`.github/workflows/build.yml` is updated:

- **Bundle budget** sums `dist/*.js` instead of checking one file.
- **Verify committed bundle matches source** checks all of `dist/`.
- **Upload bundle to release** uses `files: dist/*.js` so HACS
  release-asset downloads pick up every chunk, not just the entry.

The E2E harness's editor-mount helpers (`tests-e2e/editor.spec.ts`,
`tests-e2e/editor-visual.spec.ts`) call the card's
`getConfigElement()` once before constructing the editor element
directly. The previous shape relied on a side-effect import in
`main.ts` registering the editor's custom element at module load —
now lazy, so the harness has to trigger the load explicitly.

ADR-0001 is not superseded. That ADR's contract is "the file HACS
points at exists in the tree." That contract is preserved — what
changes is that `dist/` now contains additional content-hashed
files alongside the entry. The "Verify committed bundle matches
source" gate now covers the whole directory.

## Consequences

**Pros**

- Editor (~22 KB) drops out of the cold-mount path; users who never
  open the editor never pay its parse cost.
- The pattern generalises: locales and any future heavy modules
  (alternate chart engines, calendar widgets, …) can use the same
  dynamic-import shape. Slice B (per-language locale chunks) is
  unblocked.
- Content-hashed chunk filenames give us correct browser caching
  across releases automatically — no manual cache-bust dance needed
  for code that does not change between versions.
- Aligns with the modern Lovelace plugin model: HA already loads us
  as `type: module`, so we are now using the platform as designed.

**Cons**

- `dist/` is no longer one file. PR diffs grow slightly. Local-iter
  scripts (e.g. the SSH push in `CLAUDE.md`) need to push the full
  directory, not just the entry.
- A first-time editor open now incurs a small chunk fetch (~22 KB).
  In poor-network or fully-offline situations this can fail where
  the eager-loaded editor would have succeeded — accepted trade-off
  because (a) the editor is not on the critical-path UI, and (b)
  the browser caches the chunk after first fetch.

**Tradeoffs**

- A multi-file release breaks the "drop one .js file into
  www/community/" install path some users use manually outside
  HACS. Acceptable — the manual install path is undocumented and
  HACS itself handles the full directory correctly.
- The facade adds one extra round-trip on cold mount (entry then
  main chunk). On a normal HA install both files come from the
  same host on a kept-alive connection, so the cost is sub-50 ms —
  small compared to the editor parse cost we now defer.

## Related

- [`./0001-dist-committed-for-hacs.md`](./0001-dist-committed-for-hacs.md)
  — `dist/` commit contract still holds; verify-gate now covers
  the whole directory.
- [HACS plugin download logic](https://github.com/hacs/integration/blob/main/custom_components/hacs/repositories/base.py)
  — `gather_files_to_download` downloads every release asset for
  plugin repos.
- [advanced-camera-card rollup config](https://github.com/dermotduffy/advanced-camera-card/blob/master/rollup.config.js)
  — reference implementation for the multi-chunk + facade pattern,
  including the load-bearing `preserveEntrySignatures: 'strict'`
  comment.
