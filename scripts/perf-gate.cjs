#!/usr/bin/env node
/*
 * Cold-mount perf regression gate.
 *
 * Compares the per-scenario median mount -> chart-rendered timings
 * produced by tests-e2e/perf-render-time.spec.ts against the committed
 * baseline in perf-baseline.json, plus a generous tolerance.
 *
 * Invoked from the "Render-time perf gate" step in
 * .github/workflows/build.yml. See docs/adr/0014-perf-regression-gate.md
 * for the tolerance policy and the GHA-pinned-baseline rationale.
 *
 * Exit codes:
 *   0  pass  -- every scenario is within baseline * (1 + tolerance);
 *              also the warn-only path when the baseline is a placeholder.
 *   1  fail  -- at least one scenario regressed past the tolerance.
 *   2  error -- inputs missing or malformed (treated as a real failure:
 *              a perf gate that cannot see its data must not go green).
 *
 * GHA annotations: `::error::` / `::warning::` / `::notice::` lines are
 * emitted on stdout so they surface inline on the PR. A markdown block
 * is appended to $GITHUB_STEP_SUMMARY when that env var is set.
 *
 * No external dependencies -- plain Node core so it runs before any
 * `npm install` step too, and stays trivially unit-testable.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'perf-baseline.json');
const RESULTS_PATH = path.join(REPO_ROOT, 'test-results', 'perf-render-time.json');

/** Append a markdown block to the GHA step summary, if running in CI. */
function appendSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, markdown + '\n');
  } catch {
    // Step summary is best-effort; never let it break the gate.
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Core comparison. Pure -- takes parsed objects, returns a structured
 * verdict. Kept side-effect-free so tests/perf-gate.test.js can drive it
 * directly without touching the filesystem or process.exit.
 *
 * @param {object} baseline parsed perf-baseline.json
 * @param {object} results  parsed test-results/perf-render-time.json
 * @returns {{ status:'pass'|'fail'|'placeholder', rows:Array, messages:string[] }}
 */
function evaluate(baseline, results) {
  const messages = [];
  const tolerancePct =
    typeof baseline.tolerance_pct === 'number' ? baseline.tolerance_pct : 25;
  const factor = 1 + tolerancePct / 100;

  const samples = Array.isArray(results.samples) ? results.samples : [];
  if (samples.length === 0) {
    return {
      status: 'fail',
      rows: [],
      messages: ['perf-render-time.json contained no samples.'],
    };
  }

  const baselines = baseline.baselines || {};
  const placeholder = baseline.placeholder === true;

  const rows = samples.map((s) => {
    const measured = Number(s.median_ms);
    const base = Number(baselines[s.scenario]);
    const hasBaseline = Number.isFinite(base) && base > 0;
    const limit = hasBaseline ? Math.round(base * factor * 100) / 100 : null;
    const regressed = hasBaseline && Number.isFinite(measured) && measured > limit;
    const deltaPct =
      hasBaseline && Number.isFinite(measured)
        ? Math.round(((measured - base) / base) * 1000) / 10
        : null;
    return {
      scenario: s.scenario,
      measured,
      baseline: hasBaseline ? base : null,
      limit,
      deltaPct,
      regressed,
      hasBaseline,
    };
  });

  // Placeholder mode: the committed baseline has not yet been pinned to
  // real GHA numbers. Warn, print the measured medians so the maintainer
  // can copy them into perf-baseline.json, but never fail the build.
  if (placeholder) {
    messages.push(
      'perf-baseline.json is a placeholder -- perf gate is warn-only.',
    );
    return { status: 'placeholder', rows, messages };
  }

  const missing = rows.filter((r) => !r.hasBaseline).map((r) => r.scenario);
  if (missing.length > 0) {
    messages.push(
      `No baseline entry for scenario(s): ${missing.join(', ')}. ` +
        'Add them to perf-baseline.json.',
    );
  }

  const regressions = rows.filter((r) => r.regressed);
  const status = regressions.length > 0 ? 'fail' : 'pass';
  return { status, rows, messages };
}

function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(2) : 'n/a';
}

function renderRows(rows) {
  const lines = [
    '| Scenario | Measured median (ms) | Baseline (ms) | Limit (+tol) | Delta |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const r of rows) {
    const delta = r.deltaPct === null ? 'n/a' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`;
    const mark = r.regressed ? ' ⚠️' : '';
    lines.push(
      `| ${r.scenario} | ${fmt(r.measured)} | ` +
        `${r.baseline === null ? 'n/a' : fmt(r.baseline)} | ` +
        `${r.limit === null ? 'n/a' : fmt(r.limit)} | ${delta}${mark} |`,
    );
  }
  return lines.join('\n');
}

function main() {
  // --- load inputs ---------------------------------------------------
  if (!fs.existsSync(BASELINE_PATH)) {
    console.log('::error::perf-baseline.json is missing at repo root.');
    appendSummary('## Render-time perf gate\n\nperf-baseline.json missing.');
    process.exit(2);
  }
  if (!fs.existsSync(RESULTS_PATH)) {
    // The E2E spec writes this file in its afterAll hook. If it is
    // absent the perf spec did not run -- a real failure for the gate
    // (the surrounding E2E step would normally have failed first, but
    // do not let the gate silently pass on missing data).
    console.log(
      '::error::test-results/perf-render-time.json missing -- ' +
        'the perf-render-time E2E spec did not produce output.',
    );
    appendSummary(
      '## Render-time perf gate\n\n' +
        'perf-render-time.json missing -- E2E perf spec did not run.',
    );
    process.exit(2);
  }

  let baseline;
  let results;
  try {
    baseline = readJson(BASELINE_PATH);
    results = readJson(RESULTS_PATH);
  } catch (err) {
    console.log(`::error::Could not parse perf JSON inputs: ${err.message}`);
    process.exit(2);
  }

  // --- evaluate ------------------------------------------------------
  const verdict = evaluate(baseline, results);
  const tolerancePct =
    typeof baseline.tolerance_pct === 'number' ? baseline.tolerance_pct : 25;

  // --- report --------------------------------------------------------
  const summaryParts = ['## Render-time perf gate', ''];
  summaryParts.push(
    `Cold-mount mount → chart-rendered timing vs. committed baseline ` +
      `(tolerance +${tolerancePct}%).`,
    '',
    renderRows(verdict.rows),
    '',
  );

  if (verdict.status === 'placeholder') {
    for (const m of verdict.messages) console.log(`::warning::${m}`);
    console.log(
      '::notice::Copy the measured medians above into perf-baseline.json, ' +
        'set "placeholder": false, and open a follow-up PR to arm the gate.',
    );
    summaryParts.push(
      '_Baseline is a **placeholder** — gate is warn-only. Copy the ' +
        'measured medians into `perf-baseline.json`, set `"placeholder": ' +
        'false`, and open a follow-up PR to arm the gate._',
    );
    appendSummary(summaryParts.join('\n'));
    process.exit(0);
  }

  for (const m of verdict.messages) console.log(`::warning::${m}`);

  if (verdict.status === 'fail') {
    for (const r of verdict.rows.filter((x) => x.regressed)) {
      console.log(
        `::error::Perf regression in "${r.scenario}": median ` +
          `${fmt(r.measured)} ms exceeds limit ${fmt(r.limit)} ms ` +
          `(baseline ${fmt(r.baseline)} ms +${tolerancePct}% tolerance, ` +
          `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%).`,
      );
    }
    summaryParts.push(
      '',
      '❌ **Perf gate failed** — at least one scenario regressed past ' +
        'the tolerance. If this is an intentional, justified change, ' +
        're-pin `perf-baseline.json` from a GHA run on `master`.',
    );
    appendSummary(summaryParts.join('\n'));
    process.exit(1);
  }

  console.log('::notice::Perf gate passed — all scenarios within tolerance.');
  summaryParts.push('', '✅ **Perf gate passed** — all scenarios within tolerance.');
  appendSummary(summaryParts.join('\n'));
  process.exit(0);
}

// Export the pure core for unit tests; only run when invoked directly.
module.exports = { evaluate };

if (require.main === module) {
  main();
}
