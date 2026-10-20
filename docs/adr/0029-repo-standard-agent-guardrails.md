# 0029 — Agent guardrails and CI conventions from repo-standard

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

This repo was one of the sources of [`repo-standard`](https://github.com/chriguschneider/repo-standard), the set-up shared by the maintainer's repos for letting Claude agents work issues. Since then the standard gained guardrails from incidents elsewhere and from public attacks on agent workflows (CVE-2025-66032, the tj-actions tag rewrite, Clinejection): the agents here still ran with `--dangerously-skip-permissions`, actions were pinned by tag, the reviewer ran the PR's own build in a job holding secrets, and a dev-only `npm audit` finding could block unrelated PRs.

The standard expects a CI workflow named "CI" plus a separate tag-triggered release workflow. Here `build.yml` ("Build & Lint") is both: its `build` job is a required status check on `master` (with CodeQL's `Analyze (javascript-typescript)`), and the same job cuts the release on a tag push after every gate has passed on the tagged commit. Renaming the job or moving the release would change the required checks and the release path of a card with live users.

## Decision

Adopt the standard (type `lovelace-card`, mode `opt-in`: label, `@claude`, independent reviewer with auto-merge, no autopilot), with these repo-specific deviations:

- **`build.yml` stays the CI and the release.** Job names and the tag-push release steps are unchanged. `ci-watch.yml` watches the workflow named "Build & Lint". The standard's "green CI on the tagged commit" check is covered by the release steps running in the same job, after all gates.
- **Agent runs** use a tool allowlist (`--permission-mode dontAsk`, this repo's npm scripts), deny rules and a path guard for `.github/` and `.claude/` (`.claude/ci-settings.json`, `.claude/hooks/protect-paths.py`), harden-runner (egress `audit` for now), only trusted issue text, and `after-agent-run.sh` to keep unfinished work. Models are picked by alias.
- **The reviewer reads CI instead of running the build**, and never edits `src/` (it cannot rebuild `dist/`, ADR-0001). A deterministic step holds every PR that touches CI, agent config, the ADRs, `AGENTS.md`, package files, the GHA-pinned baselines (ADR-0003, ADR-0014) or the gate configs. `dist/` is not on that list: CI already proves it matches `src/`, and holding it would hold every code PR.
- **Only runtime advisories block**: `npm audit --omit=dev --audit-level=high`; the full audit runs informationally.
- **Every action is pinned by commit SHA**; Dependabot bumps them after a 7-day cooldown (not `anthropics/claude-code-action`). `build.yml` also runs weekly, so drift turns `master` red without commits.

## Consequences

**Pros**

- A crafted issue or comment can no longer reach an unrestricted shell holding the agent token.
- A red `master` opens an issue instead of going unnoticed.

**Cons**

- `check.py` from repo-standard keeps reporting the separate CI/release workflow as missing; that is this deviation, not drift.
- Card code PRs from the agent always wait for the maintainer.

**Tradeoffs**

- Splitting `build.yml` into the standard's two workflows was rejected: it would rename the required check and touch a working release.
- A future change to a gate here is mirrored back into repo-standard or recorded as an amendment to this ADR.

## Related

- ADR-0001 (dist committed), ADR-0003 (E2E baselines on GHA), ADR-0014 (perf gate)
- [`docs/agent-automation.md`](../agent-automation.md)
