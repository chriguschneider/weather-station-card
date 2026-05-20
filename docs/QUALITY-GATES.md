# Quality gates

Build-time and CI gates that every PR has to clear. Most are
mechanical (lint passes, tests pass, coverage stays above the floor);
a few have load-bearing rationale that's worth knowing before you
touch them.

→ Back to [README](../README.md)

## What runs in CI

Two GitHub Actions checks are required before the merge button
activates on `master`:

- **`build`** (`.github/workflows/build.yml`) — chains lint, audit,
  typecheck, vitest unit tests + coverage, dependency-cruiser,
  rollup, e2e + visual regression, and the dist-in-sync verification.
- **`Analyze (javascript-typescript)`** (CodeQL) — security analysis
  on `security-extended` queries.

SonarCloud and Dependabot also run on PRs but are advisory; the
standalone `CodeQL` helper status is also non-required (the
`Analyze` job is the gate).

## Lint — ESLint 10 (flat config)

Configured in `eslint.config.mjs` with `typescript-eslint`,
`eslint-plugin-lit`, and `eslint-plugin-sonarjs`. **0 errors** is
required to ship; warnings are an accepted refactoring backlog
(currently ~60, mostly cognitive-complexity in the integration
boundary `main.ts` plus `scroll-ux.ts` and `sunshine-source.ts`).

The convention for promoting `warn → error` per rule is "do it once
the hot-spot is refactored" — flipping a warning to error before the
refactor would block PRs that didn't introduce the warning.

**Don't blanket-run `eslint --fix`.** It once removed an
`as HTMLCanvasElement` cast in `chart/orchestrator.ts` that the
typecheck depended on; the build broke. Fix targeted lints by hand
or `--fix --rule <id>` for one rule at a time, and re-run typecheck
after.

## npm audit

`npm audit --audit-level=high` runs in CI and blocks the build on
high or critical advisories. Lower severities are reported by
Dependabot but don't fail the build.

## Coverage gate

CI fails if statements / branches / functions / lines drop below
**80 %** for the modules in `vitest.config.js`. Editor + `main.ts`
are out of scope (covered by Playwright instead).

> **History note.** Pre-v1.4.2 the `include` array in
> `vitest.config.js` listed `.js` paths after the v1.2 TypeScript
> migration. The v8 coverage provider matched zero files and the
> gate was silently inert (`Statements 0/0 (Unknown%)`) for several
> releases. If you ever touch the coverage config and the report
> looks suspiciously easy to pass, check whether the include
> patterns are actually matching files before celebrating.

## Architecture rules — dependency-cruiser

`.dependency-cruiser.cjs` enforces:

- **No circular imports** project-wide.
- **No orphans** under `src/` (a file nothing imports is a finding).
  `teardown-registry.ts` is allow-listed as the documented exception —
  test-covered, slated for re-integration in a future cycle.
- **Module boundaries**: `src/chart/`, `src/editor/`, and `src/utils/`
  may not uplevel-import. A new `import "../../something"` in those
  subtrees is a finding.

## SonarCloud

Active since 2026-05-07. Project key
`chriguschneider_weather-station-card`, organisation `chriguschneider`,
secret `SONAR_TOKEN`. Automatic Analysis is **off** — the CI-driven
scan is the source of truth (the two collide otherwise). LCOV from
`npm run coverage` feeds the dashboard. Quality-gate status is shown
in PRs but not required for merge.

A few file-scoped exclusions live in `sonar-project.properties`:

- `src/main.ts` excluded from analysis (HA integration boundary,
  uses `@ts-nocheck` per ADR-0004).
- Several modules excluded from coverage scope where Playwright is
  the test harness (mirror `vitest.config.js` `coverage.include`).
- `src/locale.ts` excluded from CPD (per-language string tables
  intentionally repeat units / cardinal-direction / condition-id
  blocks — see issue #123).
- `typescript:S3735` (void operator) suppressed project-wide because
  the void-floating-promise pattern is what `typescript-eslint`'s
  `no-floating-promises` actively requires (see issue #57).

## CodeQL

Runs `security-extended` queries weekly and on every PR via
`.github/workflows/codeql.yml`. The `Analyze (javascript-typescript)`
job is the required check; the standalone `CodeQL` helper is
advisory.

## Dependabot

`.github/dependabot.yml` opens weekly PRs for npm and GitHub Actions
updates. **No auto-merge** — every PR gets a manual review.

Two patterns to watch for:

- **Major version bumps.** Always read the changelog before merging;
  even with a green CI a major release can introduce silent
  behavioural changes that the test suite doesn't yet exercise.
- **Wrapper-deprecation on Actions.** Some GHA actions become thin
  wrappers around their successor (e.g.
  `sonarsource/sonarcloud-github-action` v5 was a wrapper around
  `SonarSource/sonarqube-scan-action`). When Dependabot proposes a
  major bump, also check whether the action itself is deprecated —
  if so, switch to the successor directly and close the Dependabot
  PR.

## Branch protection

`master` is protected since 2026-05-07. Required status checks:
`build` and `Analyze (javascript-typescript)`. PR required, linear
history required, no force-push, no delete. `enforce_admins: false`
means the maintainer can bypass via the GitHub UI in a true
emergency, but contributors should always use the PR flow.

The protection means even bot-generated commits (e.g. baseline
regen via `update-baselines.yml`) need to land via PR if they
target master directly. The current workflow dispatches on a
feature branch and the bot pushes to that branch; a follow-up PR
moves the baselines onto master.

## Perf regression gate

The `Render-time perf gate` step in `build` runs `scripts/perf-gate.cjs`,
which compares the per-scenario median mount → chart-rendered timing from
`tests-e2e/perf-render-time.spec.ts` against the committed
`perf-baseline.json` plus a generous **+25 %** tolerance. A PR that
measurably slows cold mount fails the build.

The tolerance is deliberately wide — GHA-runner CPU variability is high
(the same reason ADR-0003 pins visual baselines to the runner) and the
spec already averages 5 iterations. The goal is to catch real
regressions, not runner noise.

Baseline numbers must be measured on the GHA runner, never locally.
While `perf-baseline.json` carries `"placeholder": true` the gate is
**warn-only**: it prints the measured medians to the step summary so the
first `master` run can be used to pin real numbers. The full rationale
is in [ADR-0014](adr/0014-perf-regression-gate.md).

## dist/ in sync

The `verify dist matches HEAD` step in `build` re-runs the bundler in
CI and compares the output against the committed
`dist/weather-station-card.js`. If `src/**/*.ts` is staged without a
matching `dist/` rebuild, this step fails with a clear error.

The architectural reason for committing the bundle lives in
[ADR-0001 (dist committed for HACS)](adr/0001-dist-committed-for-hacs.md).
Resolving rebase conflicts in the minified bundle is documented in
[`AGENTS.md`](../AGENTS.md#resolving-dist-conflicts-on-rebase).

## E2E baseline regeneration

Visual-regression baselines under `tests-e2e/snapshots/` are
regenerated only via the `update-baselines.yml` GHA workflow (see
[ADR-0003](adr/0003-e2e-baselines-pinned-to-gha.md)). Local
Playwright runs use a different rendering environment and produce
diffs of 1–4 % against the GHA-pinned baselines, well past the
0.2 % tolerance — never commit locally regenerated PNGs.

[`TESTING.md`](../TESTING.md#updating-visual-baselines) has the dispatch
recipe.
