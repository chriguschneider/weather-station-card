# AGENTS.md

Conventions for AI-assisted contributions to this repo (Claude Code,
Cursor, Codex, Aider, or any other assistant). Read this first if you are
an AI assistant working on a fork or a branch, or a human driving one.

Everything in [`CONTRIBUTING.md`](CONTRIBUTING.md) still applies. This
file covers the conventions that matter most for AI-assisted work.

---

## Shared Skeleton

These conventions apply across all of chriguschneider's repos and come from
[`repo-standard`](https://github.com/chriguschneider/repo-standard). Repo-specific sections follow below.

### Commit attribution

Commits made with AI assistance carry a `Co-Authored-By:` trailer that
names the tool and model honestly, e.g.:

```
Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Cursor <noreply@cursor.sh>
Co-Authored-By: Codex <noreply@openai.com>
```

The exact string is not load-bearing; what matters is that git history
reflects what did the typing. The maintainer's own local trailer lives in
their machine-local `CLAUDE.local.md` and is not the canonical form for
contributors.

### Language

English only in code, comments, commit messages, and these repo docs.
Non-English is fine in chat, but never gets persisted to a file or a
commit.

### Comment discipline

Inline comments earn their place by explaining the *why* (a hidden
constraint, a subtle invariant, a workaround), not by restating the
code.

```ts
// Bad — restates what the next line obviously does.
// Increment the counter
counter += 1;

// Good — encodes a non-obvious reason.
// HA emits an extra forecast tick at midnight UTC; drop it so the
// chart doesn't grow a phantom column.
counter += 1;
```

Multi-paragraph docstrings on small functions and "why we removed X"
breadcrumbs both add noise. The PR description is the place for context
that does not survive the diff.

### Model selection

Route the model to the difficulty, not the other way round:

- **Haiku** — trivial mechanical: typos, docs, a config default, a bumped
  constant, value validation.
- **Sonnet** — the default: normal bug fixes, tests, CI, well-scoped
  features.
- **Opus** — architectural surface: lifecycle/teardown, concurrency,
  hardening, ambiguous root-cause hunting, anything ADR-worthy.

### Parallel work

- **Branch naming**: `<tool-or-initials>/<issue>-<slug>`, e.g.
  `claude/127-parallel-workflow-research`, `cursor/45-fix-scroll`.
- **Issue claiming**: `gh issue edit <N> --add-assignee @me` before
  starting, so parallel contributors see it is taken.
- **Worktrees**: parallelize along module boundaries, one worktree each:
  `git worktree add ../weather-station-card-<issue> <branch>`. Each gets its
  own `dist/` and `node_modules`, so parallel builds don't clobber each
  other. One file, one lane.

### Draft PRs

CI runs on every push. If you iterate with several pushes, open the PR as
a **draft** until you expect CI to pass, then mark ready. Direct push to
`master` is not the flow; open a PR.

### Changelog entries

Every PR that changes user-visible behavior adds an entry to
`CHANGELOG.md` under `## [Unreleased]` in the right subsection
(Added/Changed/Deprecated/Removed/Fixed/Security, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).

**Exemption:** a fix for a feature that never appeared in a released
version needs no entry — it has no user-visible before-state.

Write entries for users: would they click *Update* because of this line?
HACS and release pages show the section as is. Internal work (refactors,
CI, tests) goes in a short *Under the hood* list at the end of the section,
or nowhere.

The release commit renames `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD`
(no `v` in this repo's headings; format in
[`docs/STYLE-GUIDE.md`](docs/STYLE-GUIDE.md#changelog-format)); the release
steps in `build.yml` extract that section verbatim as the GitHub release
notes.

### Generated files and data

- A committed build output (bundle, generated table, PDF) has a CI check
  that it matches its sources, and is regenerated in the same commit as
  the source change. On a rebase conflict, regenerate; never hand-merge it.
  Here: `dist/` (ADR-0001), see *Resolving `dist/` conflicts* below.
- Test fixtures are trimmed real files (keep the real header, encoding and
  a handful of rows), never hand-written.
- Domain data (lookup tables, codes, thresholds, unit conversions,
  upstream field names) cites its source: an ADR, a URL in a comment, or a
  fixture cut from a real payload. Nothing is invented.

### Architectural decisions

If a change introduces a new architectural pattern, breaks a module
boundary, adds an upstream host or runtime dependency, adds a public
config option, swaps a build/quality gate, or deviates from an existing
ADR, it likely needs an ADR of its own. Triggers and the template are in
[`docs/adr/README.md`](docs/adr/README.md). Land the ADR with the code.
An accepted ADR is amended, never rewritten.

Claude Code users get automatic prompts via the repo-local skills in
`.claude/skills/`:

- **`commit-guardian`** — before any `git commit`, checks the staged diff
  against accepted ADRs and the conventions in this file,
  `ARCHITECTURE.md` and `docs/STYLE-GUIDE.md`. Non-blocking: findings are
  a numbered list, the user decides.
- **`documentation-guardian`** — proposes an ADR when an architectural
  change happens and flags changes that contradict an existing decision.

Other AI tools (Cursor, Codex, Aider) don't load them — read the
`SKILL.md` files directly to pick up the conventions they enforce.

### Automation

Opt-in, draft-PR-only (see [`docs/agent-automation.md`](docs/agent-automation.md)):
add the **`agent:go`** label to hand an issue to Claude, or write
**@claude** in a comment (owner/collaborators only). The model comes from
the issue's labels via `.github/scripts/pick-model.sh`. Unattended runs
use a tool allowlist, cannot write to `.github/` or `.claude/` (path guard
hook), and only act on issue text from people with write access.

---

## Repo-Specific: Weather Station Card

### What this is

A Home Assistant Lovelace card (TypeScript + Lit, uPlot, Rollup,
distributed via HACS as a plugin) that charts your own weather station's
history alongside any forecast, driven by sensor data, not only a
`weather.*` entity. It started as a fork of Marc Lamberts'
weather-chart-card.

It is a frontend card only: no Home Assistant integration, no backend.
Everything runs in the browser and reads from HA (states, recorder
statistics, weather forecasts) and, opt-in or as a fallback, Open-Meteo.
[`hass-meteoswiss-weather`](https://github.com/chriguschneider/hass-meteoswiss-weather)
is a sibling integration whose forecast (incl. `sunshine_duration`) the
card can show.

### Repo structure

```
src/
├── main.ts                       # the <weather-station-card> element (HA boundary, ADR-0004)
├── defaults.ts                   # DEFAULTS, single source of truth (ADR-0008)
├── chart/                        # uPlot orchestration + plugins (ADR-0012, ADR-0019)
├── editor/                       # visual editor partials (lazy chunk, ADR-0013)
├── utils/                        # time zone, caches, request dedup (ADR-0020, ADR-0026)
├── locales/                      # one file per language, one chunk each
└── *-source.ts, data-source.ts   # recorder / forecast / Open-Meteo sources
tests/                            # vitest unit + jsdom tests
tests-e2e/                        # Playwright E2E + visual baselines (GHA-pinned)
dist/                             # committed build output, HACS serves it (ADR-0001)
docs/adr/                         # decisions
```

[`ARCHITECTURE.md`](ARCHITECTURE.md) has the module map, lifecycle and
data flow.

### Non-negotiables from the ADRs

The agent workflows tell the agent to stop rather than break one of these.
Re-read `docs/adr/` for the full set; new ADRs land regularly.

- **`dist/` is committed and in sync** with `src/` (ADR-0001); the entry
  filename `weather-station-card.js` never changes, chunks are
  content-hashed (ADR-0013).
- **E2E visual baselines and `perf-baseline.json` come only from the GHA
  runner** via `update-baselines.yml`, never from a local or WSL run
  (ADR-0003, ADR-0014).
- **TypeScript strict** everywhere except the `main.ts` boundary; no new
  `@ts-nocheck` (ADR-0004).
- **One source of defaults**: `src/defaults.ts` (ADR-0008).
- **Module boundaries**: `src/chart/`, `src/editor/`, `src/utils/` never
  import upwards (`.dependency-cruiser.cjs`, `npm run depcheck`).
- **Version only in `package.json`**, injected at build time via
  `'__CARD_VERSION__'` (ADR-0006); `package-lock.json` is tracked
  (ADR-0011).
- **Upstreams**: the weather entity first, Open-Meteo only as fallback or
  opt-in (ADR-0015, ADR-0027, ADR-0028); requests are deduplicated and
  cached across cards (ADR-0020). Times follow the HA server's time zone
  (ADR-0026).
- **Quality gates** (`docs/QUALITY-GATES.md`): bundle budget, coverage
  floor, perf gate, runtime-only `npm audit` block. Changing one needs an
  ADR or an amendment (ADR-0029).

### Release procedure

Releases run in `build.yml` on a tag push (job `build`, after every gate);
see [`CONTRIBUTING.md`](CONTRIBUTING.md#release-flow) for the full list.

1. **Bump** the version in `package.json` (`npm version X.Y.Z
   --no-git-tag-version` also updates `package-lock.json`).
2. **Changelog**: rename `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD`
   and add a fresh empty `## [Unreleased]`. Write for dashboard owners.
3. **`npm run build`** and commit `dist/` with the rest as the release
   commit; open a PR, wait for green, merge.
4. **Tag and push** — only with the maintainer's explicit go, a tag push
   ships to every HACS user: `git tag vX.Y.Z master`,
   `git push origin refs/tags/vX.Y.Z`. The workflow checks the tag against
   `package.json`, extracts the `## [X.Y.Z]` section as release notes and
   attaches every `dist/*.js` (lazy chunks included) to the release.

### Testing

- `npm ci` once (Node 22 in CI).
- `npm run build` = lint + typecheck + vitest + rollup. Also
  `npm run depcheck` (module boundaries) and `npm run coverage` (coverage
  floor in `vitest.config.js`).
- `npm run test:e2e` — Playwright E2E + visual regression; needs
  `npx playwright install chromium` and the bundle on disk. CI always runs
  it, plus the bundle budget, the perf gate and the dist-in-sync check.
- [`TESTING.md`](TESTING.md) covers the layers and what is out of scope.

CI runs the full pipeline (audit + lint + depcheck + typecheck + tests +
coverage + bundle + E2E + visual regression + perf) on every push, about
6 minutes per run, so open iterating PRs as drafts.

### Resolving `dist/` conflicts on rebase

When master advances during your branch's life, you may hit a merge
conflict in `dist/`. **Don't hand-merge the minified bundle.** Take either
side, then:

```bash
npm run build
git add dist/
git rebase --continue
```

The `Verify committed bundle matches source` step in CI would catch a
hand-merged bundle anyway, so re-running the bundler is the only path that
holds. This is a documented consequence of [ADR-0001 (dist committed for
HACS)](docs/adr/0001-dist-committed-for-hacs.md).

### Testing UI changes

For changes that need eyeballing against a real Home Assistant
instance, use the Docker recipe in [`LOCAL-TESTING.md`](LOCAL-TESTING.md).
Visual baselines under `tests-e2e/snapshots/` are regenerated only by
the [`update-baselines.yml`](.github/workflows/update-baselines.yml)
workflow on the GHA runner — never commit baselines from a local
Playwright run, the rendering tolerance won't match (see
[ADR-0003](docs/adr/0003-e2e-baselines-pinned-to-gha.md)).

### Lovelace card pitfalls

- **HACS shows the README as it was at the release tag**, not as it is on
  `master`, and its sanitiser strips `<picture>`/`<source>` and breaks
  relative image paths. In `README.md` use plain `<img>` with absolute
  `https://raw.githubusercontent.com/...` URLs, and never rename or move
  an image or badge URL between releases: older installs still point at
  the old one.
- **Editor defaults equal runtime defaults.** `src/defaults.ts` is the one
  source (ADR-0008); `setConfig`, `getStubConfig` and the editor read it,
  and `tests/editor-defaults-drift.test.js` / `tests/editor-schema.test.js`
  fail when they disagree. A new option goes into the defaults, the
  editor, `docs/CONFIGURATION.md` and the tests in the same PR.
- **Locales are a hand-kept list.** Rollup needs one static `import()` per
  language (ADR-0013), so a new file in `src/locales/` also needs its entry
  in the `loaders` map in `src/locale.ts` and in
  `tests/locales-editor-parity.test.js`, in the same PR.
- **The changelog is for dashboard owners.** HACS shows the release
  section in its update dialog: say what changes for them and whether
  they must do anything (YAML change, cache refresh), no file paths or
  tool names.
- **HA serves `dist/` precompressed.** After a local deploy to a test HA,
  regenerate the `.gz` or HA keeps serving the stale bundle; `dist/*.gz`
  is gitignored and never committed.
