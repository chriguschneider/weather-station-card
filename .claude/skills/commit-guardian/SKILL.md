---
name: commit-guardian
description: Before any `git commit` in this repo, verify that staged changes do not contradict an accepted ADR in docs/adr/ or break conventions in CLAUDE.md, ARCHITECTURE.md, and docs/STYLE-GUIDE.md. Activates when the user says "commit", "commit this", "let's commit", or before running `git commit ...` via Bash. Reports findings as a numbered list referencing ADR number plus file:line, then waits for user confirmation. Non-blocking — the user always decides whether to proceed.
---

# Commit Guardian

Pre-commit ADR & convention compliance check. Read by Claude before any `git commit` it is about to run, to catch violations of accepted decisions in `docs/adr/` and conventions in [`CLAUDE.md`](../../../CLAUDE.md), [`ARCHITECTURE.md`](../../../ARCHITECTURE.md), and [`docs/STYLE-GUIDE.md`](../../../docs/STYLE-GUIDE.md).

Complementary to [`documentation-guardian`](../documentation/SKILL.md): that skill triggers when an architectural change *happens* and proposes new ADRs. This one triggers when a commit is *imminent* and checks against existing ADRs.

A `PreToolUse` hook in [`.claude/settings.json`](../../settings.json) injects a reminder into context whenever a `git commit` Bash call is detected, so this skill should always be pulled in — but the skill itself stays in charge of the actual checks.

## Activation triggers

Activate immediately before any of these:

- I am about to run `git commit ...` via the Bash tool.
- The user says "commit", "commit this", "let's commit", "ready to commit", or similar.
- The standard "create commit" flow from the system prompt is invoked.

## Skip — do not trigger on

- The user explicitly opts out: "skip the check", "just commit", "no need to check ADRs".
- Trivial diffs with no architectural surface: typo fixes in prose, whitespace, comment rewording, badge / link tweaks in `README.md`, single-value config tweaks (a threshold, a default).
- `dist/weather-station-card.js` updated together with matching `src/` changes — that is the *required* dist-sync flow, not a violation.
- Pure version bumps in `package.json` + `CHANGELOG.md` append for a release commit.
- E2E baseline updates under `tests-e2e/snapshots/` made by the `update-baselines.yml` GHA bot (commit author `github-actions[bot]`, subject starts with `chore: update e2e baselines`).
- Dependabot PR commits.
- Commits where `documentation-guardian` already ran the same checks earlier in the session — note the reuse, do not repeat the full walkthrough.

## Workflow

1. Run `git diff --staged` and `git status` to see what is actually staged.
2. Run `git rev-parse --abbrev-ref HEAD` — if the answer is `master`, **stop** and remind the user that direct push to master is blocked since 2026-05-07; offer to create a feature branch first.
3. Read every ADR under `docs/adr/` (skip `template.md` and `README.md`) plus `CLAUDE.md`, `ARCHITECTURE.md`, and `docs/STYLE-GUIDE.md`, unless they are already in session context. Extract checkable rules per the [extraction guide](#how-to-read-an-adr-for-checkable-rules) below — never assume an ADR list is complete; new ones can land at any time.
4. Walk through the extracted ADR rules and the convention checks. Match each finding to a `path:line` in the diff.
5. Output:
   - **All clear:** one line — "All checks pass — proceeding with commit."
   - **Findings:** numbered list, each entry naming `ADR NNNN` (or convention source), the rule, and the offending `path:line`.
6. If anything was flagged, wait for the user to confirm or course-correct. Never block the commit.

## How to read an ADR for checkable rules

Don't rely on a hardcoded ADR list — new ones land regularly and a stale table will silently miss them. For each ADR file under `docs/adr/` (skip `template.md` and `README.md`):

- **Decision section is the source of hard rules.** Look for imperative language: *no / never / always / must / stays / only*, paired with a path or pattern (`src/chart/`, `src/editor/`, `dist/`, branch name, dependency choice). Each such pair is a check candidate against the staged diff.
- **Consequences and Tradeoffs sections are softer.** Treat them as hints worth flagging if the diff clearly contradicts them, not as blockers.
- **Cross-ADR consistency.** When two ADRs scope the same path or topic, apply both rule sets together; a diff can violate the combined rule even if no single ADR is breached.
- **Skip silently if irrelevant.** If an ADR has no overlap with the staged paths, do not list it in the output. Only mention ADRs that produced a finding or a clear pass on a non-trivial check.
- **Status: Accepted is in scope.** Drafts and Superseded ADRs are reference material — note them only if the diff revives a superseded pattern.

## Convention checks

From [`CLAUDE.md`](../../../CLAUDE.md):

- **Commit-trailer is mandatory.** The trailer line `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` must be present in any commit Claude authors. v0.5.0 onwards every release commit carries it. *(Inversion vs. chrigu's homeassistant repo — don't conflate.)*
- **English only in code, comments, and commit messages.** TS identifiers, code comments, and the commit subject/body must be English. German is fine in conversation but never gets persisted to a file or a commit message.
- **Direct push to `master` is blocked.** Branch protection enforces PR-only since 2026-05-07. If the current branch is `master`, stop and propose a feature branch.
- **Never `git push --no-verify` or skip hooks.** Investigate the failure instead.
- **Never push a tag without explicit user confirmation.** Tag pushes trigger the public HACS release.

From [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) and [`.dependency-cruiser.cjs`](../../../.dependency-cruiser.cjs):

- **Module-boundary rules.** `src/chart/`, `src/editor/`, and `src/utils/` may not uplevel-import. A new `import "../../something"` in those subtrees is a finding even if `npm run depcheck` would catch it later.
- **No new orphans.** Adding a new file under `src/` that nothing imports (and is not test-covered) is a finding. `teardown-registry.ts` is the documented exception.

From [`docs/STYLE-GUIDE.md`](../../../docs/STYLE-GUIDE.md):

- **Doc file naming.** New top-level meta-docs use `ALL-CAPS.md`. New user-reference docs in `docs/` likewise. Lowercase is reserved for `README.md` (HACS renders it in the store via `render_readme`).
- **"Back to README" anchor.** Every new `.md` file under `docs/` must include the navigation anchor at the top.

Build / quality gates (silent failures to prevent):

- **`dist/weather-station-card.js` must be in sync.** If `src/**/*.ts` is staged, `dist/weather-station-card.js` must be staged too. CI's `verify dist matches HEAD` step would otherwise fail. The governing decision lives in `docs/adr/` — surfaced by the workflow walk in step 3.
- **No `@ts-nocheck` regressions.** A new `@ts-nocheck` on a previously-strict file is a finding. The strict-mode policy lives in `docs/adr/`; the workflow walk in step 3 will surface it.
- **No WSL-generated E2E baselines.** `tests-e2e/snapshots/**.png` may only be regenerated by the GHA `update-baselines.yml` workflow. If the diff touches PNGs and the commit isn't from `github-actions[bot]`, flag it. The governing decision lives in `docs/adr/` (also restated in `CLAUDE.md`).
- **README image syntax.** New images in `README.md` must use plain `<img>` with absolute `https://raw.githubusercontent.com/...` URLs — never `<picture>`/`<source>`. The HACS info-panel sanitizer drops the latter.
- **No high/critical npm advisories introduced.** If `package.json` / `package-lock.json` is in the diff, mention that `npm audit --audit-level=high` is the gate.

Secrets / hygiene:

- **`.env`, credential JSON, token-shaped strings never staged.** Stop and flag if anything credential-shaped shows up.
- **`scratch/` and `dist/*.gz` stay gitignored.** A staged file under those paths means the ignore rule was bypassed — flag it.

## Behaviour

- **Non-blocking.** Report findings and wait. The user makes the call.
- **No bureaucracy.** A typo fix or single-value tweak does not need a full ADR walk-through. Match the depth of the check to the size of the diff.
- **Be specific.** Cite ADR number, the rule, and `path:line` for each finding.
- **Don't double-check.** If `documentation-guardian` already covered the architectural side in this session, only verify the parts it didn't (typically the convention checks above).
- **English in any artefact written to files.** Conversation can stay German.
