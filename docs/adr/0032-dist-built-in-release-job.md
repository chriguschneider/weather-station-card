# 0032: Build `dist/` only in the release job

**Status:** Accepted

**Date:** 2026-11-08

## Context

ADR-0001 committed the built bundle so HACS could install it and so a branch could be tried from a `raw.githubusercontent.com` URL. Since ADR-0013 the bundle is an entry file plus content-hashed chunks, and every `src/` change renames `main-<hash>.js`. With several agent PRs open at once (the normal case since the agent automation, ADR-0029), every merge put every other open PR into a `dist/` conflict that only a rebuild could resolve; on 2026-11-08 this happened on most merges of the day.

The reasons for ADR-0001 no longer hold:

- HACS installs a tagged version from the release assets, not from the repo tree; the release job already uploads every `dist/*.js` (`build.yml`, *Upload bundle to release*).
- Trying an unreleased change on a real Home Assistant is done with a local build (maintainer's Pi pre-test), not from a branch URL.

## Decision

- `dist/` is gitignored and removed from the repository.
- CI builds the bundle on every run; the bundle budget, E2E and perf gates use that build. The *Verify committed bundle matches source* step is removed.
- The release job (tag `v*`) runs the full pipeline on the tagged commit, refuses a tag whose commit is not on master, and attaches every `dist/*.js` to the GitHub Release. That upload is the only copy users get.
- Agents and contributors never commit `dist/`; a branch is brought up to date with `git merge origin/master`.

## Consequences

**Pros**

- No more bundle conflicts between open PRs; agent PRs can be merged in any order.
- Smaller diffs; reviews see only source changes.
- The shipped bundle is always built by CI from the tagged commit with `npm ci` (lockfile), not on someone's machine.

**Cons**

- Installing from a branch (HACS "redownload" of a non-release ref, or a `raw.githubusercontent.com` URL) no longer finds a bundle. Testers use a release, a pre-release, or a local build.
- The bundle that ships is no longer visible in the PR diff; trust moves to the tagged CI build (mitigated by `npm ci`, the tag-on-master check and the full pipeline in the release job).

**Tradeoffs**

- Stable (non-hashed) chunk names: rejected. The content of `main.js` still changes, so conflicts remain, and browsers would serve stale chunks after an update because only the entry carries the HACS cache-busting query (ADR-0013).
- A custom git merge driver for `dist/`: rejected. GitHub's server-side merge ignores it.

## Related

- Supersedes [ADR-0001](./0001-dist-committed-for-hacs.md)
- [ADR-0013](./0013-esm-code-split-for-lazy-editor.md) (hashed chunks), [ADR-0029](./0029-repo-standard-agent-guardrails.md) (agent automation)
