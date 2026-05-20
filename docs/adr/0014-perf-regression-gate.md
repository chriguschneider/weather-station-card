# 0014: Cold-mount perf regression gate in CI

**Status:** Accepted

**Date:** 2026-05-20

## Context

`tests-e2e/perf-render-time.spec.ts` measures end-to-end mount →
chart-rendered timing for three representative configs (`daily-`,
`today-`, `hourly-combination`), averaging 5 iterations each, and
writes `test-results/perf-render-time.json`. Until now the `build`
workflow only **printed** those numbers into the run summary
("Render-time advisory") — it never failed a build. A PR that
measurably slowed cold mount produced a green check; the regression
was only visible as a trend if someone happened to read the summary
across several PRs.

Cold mount is the recurring real-world case for this card (HA
Companion app, fresh sessions re-pay the full mount), so a silent
slowdown is a genuine user-facing regression. v2.0 pillar C wants
this advisory promoted into a gate that fails the `build` job.

The hard part is **noise**. Shared GHA `ubuntu-latest` runners vary
in CPU allocation run-to-run. ADR-0003 already documents that the
runner environment is variable enough that visual baselines must be
pinned to it. A perf gate with a tight tolerance would produce
false-red builds; too loose and it never fires. Two further problems:

- **The baseline cannot be measured locally.** A dev laptop or WSL
  renders at a different speed than the GHA runner — the same
  argument ADR-0003 makes for visual baselines. A baseline committed
  from a local run would be meaningless against a GHA assertion.
- **Bootstrapping.** The very first commit that adds the gate has no
  GHA-measured baseline to compare against.

Alternatives considered:

- **Keep it advisory-only.** Zero flakiness risk, but the plan
  explicitly asks for a gate; a number nobody is forced to look at
  does not guard slices 2–9.
- **Tight tolerance (~+5–10%).** Would catch small regressions but
  flake on runner noise — false-red builds erode trust in CI faster
  than a missed 10% regression costs.
- **Compare against the previous run instead of a committed
  baseline.** Needs cross-run artifact storage and still drifts; a
  committed baseline is reviewable in the diff and version-controlled.

## Decision

Promote the advisory step in `.github/workflows/build.yml` into a
**hard gate** with a generous tolerance and a GHA-pinned baseline.

- **`perf-baseline.json`** (repo root) holds the per-scenario baseline
  medians, a `tolerance_pct` (set to **25**), and a `placeholder`
  flag. Baseline numbers MUST be measured on the GHA `ubuntu-latest`
  runner — never a local or WSL machine (same rationale as ADR-0003).

- **`scripts/perf-gate.cjs`** is the gate. It reads
  `test-results/perf-render-time.json` and `perf-baseline.json`,
  compares each scenario's `median_ms` (p50) to
  `baseline × (1 + tolerance_pct/100)`, emits `::error::` annotations,
  and exits non-zero on a regression. Plain Node core, no
  dependencies; its pure `evaluate()` core is unit-tested in
  `tests/perf-gate.test.js`.

- **Tolerance is +25%.** The spec already averages 5 iterations per
  config; +25% over a GHA-measured baseline is wide enough to absorb
  runner-noise variance yet still catches the kind of regression that
  matters (a chart pipeline change that doubles mount time). This is
  the deliberate "catch real regressions, not noise" trade.

- **Placeholder bootstrap.** `perf-baseline.json` ships with
  `"placeholder": true` and zeroed baselines. While that flag is set
  the gate is **warn-only**: it prints the measured medians to the
  step summary and a `::warning::`, and exits 0. The first `build`
  run on `master` after this lands surfaces real GHA numbers; the
  maintainer copies them into `perf-baseline.json`, sets
  `"placeholder": false`, and opens a follow-up PR. From that PR on
  the gate is armed and fails the build on a regression.

- The gate step is **not** guarded by `if: always()`. When an earlier
  step fails, the perf JSON is unreliable; and a missing JSON file is
  itself treated as a gate failure (exit 2) so the gate can never go
  green on absent data.

## Consequences

**Pros**

- A PR that measurably slows cold mount → chart-rendered now fails
  the required `build` check instead of printing a number nobody
  reads. Slices 2–9 of v2.0 are guarded against silent perf drift.
- The gate logic is a pure, unit-tested function — a regression in
  the gate itself is caught by `tests/perf-gate.test.js`, not
  discovered in production CI.
- The baseline is a reviewable, version-controlled artifact: a PR
  that re-pins it makes the new expectation explicit in the diff.
- The placeholder mechanism means this PR can land without a
  chicken-and-egg measurement problem and without any flakiness.

**Cons**

- The gate is inert (warn-only) until the follow-up PR pins real
  numbers. There is a one-PR window where a regression would only
  warn. Acceptable: the alternative is guessing baseline numbers.
- A future GHA runner-image upgrade can shift all three baselines at
  once (same failure mode ADR-0003 calls out). Recovery: re-pin
  `perf-baseline.json` from a fresh `master` run.
- +25% will not catch a small (~10–20%) regression. This is a
  conscious trade against false-red builds — a tighter gate on a
  noisy runner costs more trust than it saves.

**Tradeoffs**

- Advisory-only was rejected: the plan asks for an enforced gate.
- A tight tolerance was rejected: runner noise would flake it.
- Previous-run comparison was rejected: needs cross-run artifact
  plumbing and is not reviewable; a committed baseline is both.
- Per the feasibility escape in the slice brief, a warn-only
  fallback was the documented safety net if a non-flaky hard gate
  proved infeasible. It did not — the +25% tolerance plus 5-iteration
  averaging makes a hard gate viable — so the gate ships armed
  (after the placeholder is pinned), with the placeholder phase
  acting as a built-in soft-launch rather than a permanent fallback.

## Related

- ADR-0003 (e2e baselines pinned to GHA) — same "the GHA runner is
  the only valid measurement environment" rationale, applied here to
  timing instead of pixels.
- `tests-e2e/perf-render-time.spec.ts` — produces the JSON the gate
  reads; its `samples[].median_ms` is the p50 metric compared.
- `scripts/perf-gate.cjs` / `tests/perf-gate.test.js` — the gate and
  its unit tests.
- `.workflow/v2-direction/plan.md` — Slice 1 of the v2.0 plan.
