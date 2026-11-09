# 0001: Commit `dist/weather-station-card.js` alongside source

**Status:** Superseded by [0032](./0032-dist-built-in-release-job.md)

**Date:** 2026-05-08

## Context

This card is distributed via [HACS](https://hacs.xyz/), the Home Assistant Community Store. HACS installs custom cards by downloading a single `.js` file referenced as a release asset on a tagged GitHub Release. There is no npm registry step, no CDN bundler, no per-user build.

The card is also testable on a live HA instance during development by serving the bundle directly from a `raw.githubusercontent.com` URL pointing at a branch — the user pastes the URL into Lovelace's resources list and reloads. That path also requires `dist/weather-station-card.js` to be present at the referenced commit.

The reflexive answer for a JavaScript project is "gitignore `dist/` and let CI build artifacts from source." That works for npm packages and web apps deployed via CI. It does **not** work for HACS, because HACS does not run a build — it downloads the file you point it at.

Alternatives considered:

- **Gitignore `dist/`, build only on tag-push, attach asset to Release.** Breaks branch-based dev installs (no `dist/` on the branch → 404 from `raw.githubusercontent.com`). Also makes "verify the bundle matches the source" harder to enforce during PR review.
- **Use a separate `release` branch that only contains the built bundle.** Adds a release-time step that's easy to forget; doubles the number of branches that need to track.
- **Commit `dist/` alongside source and verify in CI.** What we do.

## Decision

`dist/weather-station-card.js` is committed to the repository alongside the TypeScript source. The release flow rebuilds and re-commits it as part of the release commit (see `CONTRIBUTING.md`).

CI enforces sync: `.github/workflows/build.yml` runs `npm run build` and then aborts the job if `git diff --quiet -- dist/weather-station-card.js` reports a difference, with an explicit error pointing at the fix:

```
::error::dist/weather-station-card.js is out of sync with source.
Run 'npm run build' and commit the result.
```

`.gitignore` excludes only `dist/*.gz` (build-time gzip artefacts that aren't part of the shipped card) — the `.js` itself is tracked.

## Consequences

**Pros**

- HACS installs work the moment a tag is pushed — the bundle is already in the tree.
- Branch-based dev installs (`raw.githubusercontent.com/.../<branch>/dist/...`) work without a CI round-trip.
- PR review can see the bundle diff alongside the source diff, catching accidental dist/source drift.
- The CI sync gate guarantees that what's released matches what was reviewed.

**Cons**

- Larger PR diffs — the minified bundle changes on almost every PR.
- Every release commit has to include the rebuilt `dist/`, which is a manual step easy to forget. CI catches it but the round-trip costs ~3 minutes.
- Merge conflicts in `dist/weather-station-card.js` are unreadable; the resolution is always "rebuild after rebase."

**Tradeoffs**

- The "gitignore dist/, build in CI" pattern is the modern default for npm libraries and web apps. We forgo it because HACS cannot run a build and we don't want a separate distribution channel.
- A `release` branch holding only the bundle was rejected because it doubles the number of refs to maintain and the dev-install workflow would need to differentiate between `master` (source) and `release` (bundle).

## Related

- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — release flow
- [`../../.github/workflows/build.yml`](../../.github/workflows/build.yml) — `Verify committed bundle matches source` step
- [HACS docs — Custom card requirements](https://hacs.xyz/docs/publish/start)
