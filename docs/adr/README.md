# Architecture Decision Records

This directory captures the **why** behind non-obvious architectural choices in
this card. Code shows *what* the implementation does; ADRs explain *why* a
particular path was chosen and what alternatives were rejected.

## When to write one

Write an ADR only when **all three** of these are true:

1. **Hard to reverse** — the cost of changing the decision later is meaningful (package upgrades, bundler swaps, public-API shape, data-source contracts).
2. **Surprising without context** — a future reader (or future Claude) would otherwise undo it by accident, wondering "why on earth did they do it this way?".
3. **Result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any one is missing, skip the ADR:

- Easy to reverse → just reverse it later.
- Not surprising → nobody will wonder why.
- No real alternative → "we did the obvious thing" isn't worth recording.

Skip the ADR for routine bug fixes, refactors that don't change a contract, or
decisions whose rationale already lives in the commit message.

This restrictive AND-of-three test is enforced by the `documentation-guardian` skill and aligns with the user-level `grill-with-docs` skill.

## How to add one

1. Copy [`template.md`](./template.md) to a new file.
2. Number it with the next free four-digit prefix and a `kebab-case` slug:
   `0001-some-decision.md`, `0002-another-one.md`, …
3. Fill in **Status**, **Date** (YYYY-MM-DD), **Context**, **Decision**, **Consequences**, **Related**.
4. Land it via the normal PR flow — ADRs are versioned with the code they describe.

## Status lifecycle

- **Proposed** — under discussion; not yet acted on.
- **Accepted** — in force; the codebase reflects this decision.
- **Deprecated** — no longer applies, but kept for historical context.
- **Superseded by NNNN** — replaced by a later ADR; link forward.

ADRs are append-only — once accepted, don't rewrite history. If a decision
changes, write a new ADR that supersedes the old one and update the old one's
status line.

## Index

- [0001 — Commit `dist/weather-station-card.js` alongside source](./0001-dist-committed-for-hacs.md) (Accepted)
- [0002 — Sunshine duration: tiered data-source policy](./0002-sunshine-duration-tier-policy.md) (Accepted)
- [0003 — E2E visual-regression baselines pinned to the GHA Ubuntu runner](./0003-e2e-baselines-pinned-to-gha.md) (Accepted)
- [0004 — TypeScript: strict for leaf modules, `any` allowed at the HA boundary](./0004-typescript-strict-with-boundary-relaxations.md) (Accepted)
- [0005 — Editor partial reorganisation around user intent](./0005-editor-partial-reorg.md) (Accepted)
- [0006 — Build-time `__CARD_VERSION__` injection via Rollup](./0006-build-time-version-injection.md) (Accepted)
- [0007 — `set hass` decomposed into three phase methods](./0007-set-hass-three-phase.md) (Accepted)
- [0008 — DEFAULTS as the single source of truth (`src/defaults.ts`)](./0008-defaults-single-source-of-truth.md) (Accepted)
- [0009 — Lookup-table pattern for unit conversions](./0009-lookup-table-pattern-for-unit-conversions.md) (Accepted)
- [0010 — Group-renderer pattern for conditional template blocks](./0010-group-renderer-pattern.md) (Accepted)
- [0011 — Track `package-lock.json` for reproducible builds](./0011-track-package-lock.md) (Accepted)
- [0012 — Chart library: uPlot](./0012-chart-library-uplot.md) (Accepted)
- [0013 — ESM output with content-hashed chunks for lazy editor](./0013-esm-code-split-for-lazy-editor.md) (Accepted)
