# Contributing

Thanks for considering a contribution. The most welcome kinds of PRs are
**translations**, **bug fixes**, and **screenshots / docs polish**. New
features are also welcome — please open an issue first to discuss scope.

If your PR touches code beyond a single locale or a one-line fix, skim
[ARCHITECTURE.md](ARCHITECTURE.md) first — it covers the data flow, the
forecast-array shape that every consumer relies on, and the chart-plugin
contract. About 10 minutes of reading saves an hour of reverse-engineering.

## Adding a new language

The visual editor and the in-card condition labels are translated in
[`src/locales/`](src/locales/), one file per language
(`src/locales/<lang>.ts`). Each file has two relevant blocks:

- **Top-level keys**: condition names (`sunny`, `rainy`, …), unit labels,
  cardinal directions.
- **`editor: { … }` block**: labels shown inside the visual editor
  (sensor picker labels, section headings, units page). All 25 languages
  ship this block; `en` is canonical.

To add or complete a language:

1. Copy `src/locales/en.ts` to `src/locales/<lang>.ts` (or open the
   existing file for your language) and translate the values. Do not touch
   the keys.
2. For a new language, add its entry to the `loaders` map in
   [`src/locale.ts`](src/locale.ts) (one static `import()` per language,
   ADR-0013) and to `tests/locales-editor-parity.test.js`, in the same PR.
3. Run `npm ci` once if you haven't, then `npm run build`. The parity test
   fails when a language misses an editor key. Do not commit `dist/`: it is
   built in the release job (ADR-0032).
4. Open a PR. Mention which language you added or extended.

**Machine translations.** The 3.0 texts (Location panel, time zone, the info
button and its data-sources popup, and the snow line lines of the
zero-degree popup) are machine translated in every
language except English and German. Native speakers are very welcome to
correct them: edit the values in `src/locales/<lang>.ts`, keep `{placeholders}`
exactly, and mention the language in your PR. Tests fail if one of these
keys is missing or still English.

The fallback chain at runtime is: requested language → English → key name.
A missing translation never crashes the card; it just falls through.

## Build & dev workflow

```bash
npm install
npm run lint         # ESLint 10 (typescript-eslint + lit + sonarjs)
npm run typecheck    # tsc --noEmit
npm run test         # vitest run (see TESTING.md)
npm run coverage     # vitest with v8 coverage provider
npm run depcheck     # dependency-cruiser architecture rules
npm run rollup       # one-shot bundle
npm run build        # lint + typecheck + test + rollup
npm start            # rollup --watch + dev server
```

Built artefact: `dist/` (entry `weather-station-card.js` plus hashed
chunks). **It is not committed** (ADR-0032): the release job builds it from
the tagged commit and attaches it to the GitHub Release, which HACS installs.

## CI & branch protection

`master` is protected. Direct pushes are blocked — every change goes
through a pull request. Two CI checks must be green before the merge
button activates:

- **`build`** (`.github/workflows/build.yml`) — lint, audit, typecheck,
  unit tests, coverage gate, depcheck, bundle, e2e + visual regression,
  bundle-budget, and the whole suite in four time zones.
- **`Analyze (javascript-typescript)`** (CodeQL) — security analysis.

SonarCloud and Dependabot run on PRs too but are advisory; CodeQL's
`Analyze` job is required, the standalone CodeQL helper check is not.

`build.yml` also runs weekly on `master`, so dependency or browser drift
shows up without a commit; when it fails, `ci-watch.yml` opens a
"CI is red on master" issue and closes it once the build is green again.

Linear history is enforced (no merge commits) — the maintainer uses
`gh pr merge --rebase` to land PRs.

[`docs/QUALITY-GATES.md`](docs/QUALITY-GATES.md) is the full reference
for what each gate enforces, the lint-warnings backlog policy, the
SonarCloud exclusions, and the Dependabot review conventions (no
auto-merge, watch for wrapper-deprecations on Actions, manual
changelog read on major bumps).

## AI-assisted contributions

PRs from contributors using Claude Code, Cursor, Codex, or other AI
assistants are welcome — see [`AGENTS.md`](AGENTS.md) for the
conventions specific to AI-assisted work (commit attribution, comment
discipline, parallel-work coordination, draft-PR convention,
branch-update recipe). Everything in this file applies to those PRs
too. The maintainer's own agent automation (`agent:go`, `@claude`, the
reviewer) is described in
[`docs/agent-automation.md`](docs/agent-automation.md).

## Tests

Pure-function unit tests live under `tests/` and run via Vitest. See
[TESTING.md](TESTING.md) for the conventions on what is in scope (data
layer, classifier, formatting helpers, editor partial smoketests) and
what is intentionally not covered (Lit lifecycle, Chart.js drawing,
full editor DOM). New PRs that touch `src/condition-classifier.ts`,
`src/data-source.ts`, or `src/format-utils.ts` should extend the
corresponding test file.

PRs that change an editor render partial (`src/editor/render-*.ts`)
should extend the matching `tests/editor-render-*.test.js` smoketest:
add cases for any new toggle, sub-section heading, or
`hasSensor` / `hasLiveValue` gating. The smoketests render with mock
`EditorLike` + `EditorContext` so they're cheap to extend — see the
existing files for the pattern.

For UI changes that need eyeballing against a real Home Assistant
instance, see [LOCAL-TESTING.md](LOCAL-TESTING.md) for a Docker-based
recipe that doesn't depend on any maintainer-specific setup.

PRs that introduce a new architectural pattern, shift a public-API
contract, or make a hard-to-reverse choice should land an ADR under
`docs/adr/` alongside the code (see `docs/adr/README.md` for the
criteria and template).

## Code style

- Two-space indent, LF line endings.
- ES2022 features are fine (`?.`, `??`, top-level await is not used).
- Inline comments only when the *why* is non-obvious. Don't restate code.

## Release flow

For maintainers cutting a new `vX.Y.Z` release. The build workflow on
`master` enforces some of these (tag-vs-package.json, CHANGELOG entry
present, tag on master); the rest are convention.

1. **Bump version** in `package.json`.
2. **CHANGELOG entry** — prepend a `## [X.Y.Z] — YYYY-MM-DD` block
   (format: see [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md#changelog-format)).
   The build workflow extracts this verbatim into the GitHub release
   body when you push the tag, and HACS shows that body in its in-app
   update dialog. **Write for that reader, not for engineers**: plain
   user-perspective English, lead with the user impact, keep
   build/tooling detail in a short "Under the hood" section. If a
   release has no user-facing changes, say so plainly in one sentence
   and stop — don't pad with internal jargon.
3. **Verify these docs reflect what changed** — a release is a good
   time to catch doc drift. None of these are mandatory per release,
   but ask yourself for each:
   - `README.md` — new user-facing config keys, behaviour, screenshots
   - `ARCHITECTURE.md` — module boundaries, build pipeline, data flow
   - `TESTING.md` — test layers, coverage scope
   - `CONTRIBUTING.md` — dev workflow changes
   - `MIGRATION.md` — breaking change for users
4. **`npm run build`** — local check only; `dist/` is not committed
   (ADR-0032).
5. **Open a PR**, wait for CI green, rebase-merge to `master`.
   `master` is branch-protected — direct push will fail.
6. **Tag and push**:
   ```bash
   git tag vX.Y.Z master
   git push origin refs/tags/vX.Y.Z
   ```
   The `build` workflow then verifies tag matches `package.json.version`,
   extracts the `[X.Y.Z]` block from `CHANGELOG.md` as release notes,
   builds the bundle and uploads every `dist/*.js` to the GitHub release —
   HACS picks it up automatically. A tag whose commit is not on master is
   refused.

## Issues

Bugs, feature requests, and questions:
<https://github.com/chriguschneider/weather-station-card/issues>

When reporting a bug, please include:

- Card YAML config (redact entity IDs if sensitive)
- Home Assistant version
- HACS version (if installed via HACS)
- Browser console output if the card fails to render
