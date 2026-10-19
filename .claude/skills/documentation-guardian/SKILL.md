---
name: documentation-guardian
description: Proactively suggests ADRs when architectural changes happen in this Lovelace card repo, and checks code changes against existing decisions in docs/adr/. Activate on new chart plugin, new data source or upstream host, a changed budget, new render mode, new top-level config option, build/quality gate change, bundler or major-dependency bump, module-boundary break, the same logic landing in a second place, or pattern deviation from an existing ADR.
---

# Documentation Guardian

Keeps `docs/adr/` in sync with the code. Two jobs:

1. **Detect ADR-worthy changes** as they happen and propose drafting an ADR.
2. **Check planned and in-progress changes against existing ADRs** before they land.

The ADR conventions referenced here live in [`docs/adr/README.md`](../../../docs/adr/README.md). When the two disagree, `docs/adr/README.md` wins — update this skill to match.

## Activation triggers (this repo's architecture)

Activate when you observe any of these in a planned or in-progress change:

- A **new chart plugin** under `src/chart/plugins/`, or a new entry registered in `src/chart/plugins.ts`.
- A **new data source** under `src/data-source/`, or a new tier added to the sunshine-source resolution chain (existing tiers are governed by an accepted ADR — re-read `docs/adr/` to find which).
- A **new upstream host or endpoint** the card calls from the browser (today: the HA websocket/recorder and Open-Meteo, ADR-0015/0020/0027/0028), or a new runtime dependency in `package.json` `dependencies` — it ships to every dashboard.
- A change to a **budget**: request cadence or cache TTLs (ADR-0020), the bundle budget in `build.yml`, the perf tolerance in `perf-baseline.json` (ADR-0014), the coverage floor in `vitest.config.js`.
- A **new render mode** or layout (a fourth top-level mode beside Combination / Station / Forecast), or a new `forecast.style` variant beyond style1/style2.
- A **new top-level card-config option** that the user can set in their YAML — these become public API and are notoriously hard to remove.
- A **build / quality gate change**: ESLint rule promoted warn→error, vitest coverage threshold moved, dependency-cruiser rule added or relaxed, new CI workflow under `.github/workflows/`, change to the `Required status checks` set on master.
- A **bundler or major-dependency bump**: Rollup, vitest, lit, chart.js, playwright, eslint majors. The decision to take a major and the migration shape is ADR-worthy; patch/minor bumps are not.
- A **boundary break**: a new uplevel `import` in `src/chart/`, `src/editor/`, or `src/utils/`. Either it needs to be removed, or the boundary itself needs an ADR change.
- A **change to the e2e baseline regeneration flow** (the `update-baselines.yml` workflow, the playwright tolerance, the WSL fallback policy — pinning is governed by an accepted ADR; re-read `docs/adr/` before changing the flow).
- A **release-flow change** — the steps in `CONTRIBUTING.md` → *Release flow* and `AGENTS.md` → *Release procedure* for cutting `vX.Y.Z`, or the tag-push steps in `build.yml`.
- The **same logic in a second language or place** (a parser in the card and in a test helper, a table in code and in docs, a default in `src/defaults.ts` and in the editor): propose one written spec plus a shared golden-fixture test both sides run.
- A **pattern deviation** from an accepted ADR — code that contradicts an existing decision.

## Skip — do not trigger on

- Bug fixes that don't change a contract (no new public option, no new module-boundary, no new dependency).
- Refactors within an existing module that keep the public surface identical.
- Adding test coverage to existing code (including v1.5 #10 work on `teardown-registry.ts`).
- Style fixes, lint-warning cleanup, type-narrowing inside an already-strict file.
- E2E baseline regenerations done by the `update-baselines.yml` GHA bot.
- Single-file documentation edits (typo, link, prose tweak) that do not change a convention.
- Patch/minor dependency bumps via Dependabot.
- Lovelace dashboard / Bubble Card / user-side YAML examples in docs (those describe usage, not internal architecture).

## Out of scope (deliberately)

The skill stays narrow. It does **not**:

- Fire on conversational mentions of "bug" or "idea". Filing a GitHub issue is a deliberate user act, not a documentation event.
- Run `gh issue create` or manage labels.
- Police uncommitted working-tree state outside `docs/` and the ADR check.
- Verify cross-links in issue bodies on GitHub.

## Documentation locations

When suggesting where information should live, use these targets:

| Target | Purpose |
|---|---|
| `docs/adr/NNNN-*.md` | Architecture decisions: tech choice, build-gate change, public-API surface, module-boundary, release-flow change |
| `ARCHITECTURE.md` | Module map, lifecycle, data flow — descriptive, derived from code |
| `docs/CONFIGURATION.md` | User-facing card config reference (every new option must land here too) |
| `docs/CONDITIONS.md`, `docs/SENSORS.md`, `docs/TROUBLESHOOTING.md` | User reference docs by domain |
| `docs/STYLE-GUIDE.md` | Documentation conventions themselves |
| `CHANGELOG.md` | Release-by-release log (every user-visible change is mentioned here) |
| `AGENTS.md` | Conventions for AI assistants and humans (Shared Skeleton from repo-standard + repo-specific rules) |
| `CLAUDE.md` / `CLAUDE.local.md` | `CLAUDE.md` only imports `AGENTS.md`; `CLAUDE.local.md` is the maintainer's machine-local notes (gitignored). Do not propose ADR rationale to live in either. |

## Gating test — apply before proposing

The activation triggers above are **detection signals**, not auto-suggestions. After a trigger fires, gate the proposal by the restrictive AND-of-three filter:

1. **Hard to reverse** — the cost of changing the decision later is meaningful.
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **Result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

**All three must be true.** If any one is missing, skip the ADR — the rationale belongs in a commit message, a code comment, the `CHANGELOG.md`, or simply in the diff itself.

- Easy to reverse → just reverse it later.
- Not surprising → nobody will wonder why.
- No real alternative → "we did the obvious thing" isn't worth recording.

This filter mirrors the one in the user-level `grill-with-docs` skill, so both stay aligned on what counts as ADR-worthy.

## Proactive prompting

When a trigger fires **and** the AND-of-three gate passes, surface it before implementation, not after:

> This change introduces / modifies / adds X. That's a deliberate architectural choice with genuine alternatives and meaningful reversal cost — should I draft an ADR for it before continuing?
>
> Suggested: `docs/adr/NNNN-descriptive-title.md`.

If the user agrees, draft the ADR using [`docs/adr/template.md`](../../../docs/adr/template.md) in the same PR as the code change. If the user defers ("not now, later"), respect that — do not nag in the same session.

For architecture suggestions in general: list pros/cons, then a recommendation, then act only after OK.

## Compliance check

### Before implementation

1. **List `docs/adr/` fresh** — never assume a snapshot of the in-force set; new ADRs land regularly and a hardcoded list in this skill would silently drift.
2. Read each accepted ADR whose title or `Decision` section overlaps the staged paths or the planned change's surface area. Skip `template.md` and `README.md`.
3. Verify the planned change does not contradict any of them.
4. If the planned change contradicts an accepted ADR, raise it explicitly:
   > This approach differs from ADR 000N (`<title>`) which decided X. Two options: (a) adjust the implementation to match the ADR, (b) write a superseding ADR. Which one?

### After implementation

1. Note any significant undocumented decisions made during the change.
2. Suggest an ADR for each, naming the file path.

## ADR mechanics

### Required structure

Mirrors [`docs/adr/template.md`](../../../docs/adr/template.md):

```markdown
# NNNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by NNNN

**Date:** YYYY-MM-DD

## Context
## Decision
## Consequences
  - Pros / Cons / Tradeoffs
## Related
```

### Numbering

- Sequential four-digit numbers: 0001, 0002, …
- Find the current highest number with `ls docs/adr/`.
- **Never reuse** a number, even for deprecated or superseded ADRs.

### Amending

An accepted ADR is never rewritten. A refinement that keeps the decision (a new exception, a moved threshold, a renamed path) is appended to the old ADR, keeping the original text:

```markdown
## Amendment YYYY-MM-DD (#issue)

What changed and why. Decided by: <owner | ADR-NNNN>.
```

### Superseding

When a new decision overrides an old one:

- The old ADR's status becomes `Superseded by NNNN`.
- The old ADR file is **not deleted** — history is preserved.
- The new ADR's status is `Accepted` and its `Related` section links back to the superseded one.

## Behavioural guidelines

- **Lightweight, not bureaucratic.** Suggest ADRs only when the change is genuinely a decision, not when the answer is obvious from the code or already documented.
- **"Should I draft an ADR?" pattern**, not auto-generation. Wait for a yes.
- **Respect deferrals.** If the user says "later" or "no", drop it.
- **Pro/contra first.** When recommending an architecture or tool choice, list alternatives, then a recommendation, then wait for OK before implementing.
- **Connect the dots.** Link new ADRs to related ones; reference the ADR from the relevant code section in `ARCHITECTURE.md` or the corresponding user doc.
- **English only in any file written to disk.** Conversation can stay German.
