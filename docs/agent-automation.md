# Agent automation (opt-in)

This repo is idea-driven, not a backlog that gets ground through
automatically: Claude works an issue **only when you hand it over**. All
flows open **draft PRs only** and never push to `master` (branch protection
enforces it). Every workflow skips itself with a notice while the
`CLAUDE_CODE_OAUTH_TOKEN` secret is missing, so a fresh setup is never red.
The set-up comes from [`repo-standard`](https://github.com/chriguschneider/repo-standard);
the deviations are recorded in [ADR-0029](adr/0029-repo-standard-agent-guardrails.md).

This repo runs in mode **`opt-in`**:

| Mode | Label + mention | Reviewer + auto-merge | Autopilot |
|---|:-:|:-:|:-:|
| `minimal` | ✓ | – | – |
| `opt-in` | ✓ | ✓ | – |
| `autopilot` | ✓ | ✓ | ✓ |

## Opt-in by label (`claude-labeled.yml`)

Add the **`agent:go`** label to an issue → Claude implements it on a
`claude/<n>-<slug>` branch and opens a draft PR. Issues without the label
(ideas, discussions, `enhancement` you haven't triaged) are never touched.

The agent runs `npm ci`, `npm run build` (lint + typecheck + vitest +
rollup), `npm run depcheck` and `npm run coverage`, and commits the rebuilt
`dist/` with any `src/` change (ADR-0001). It cannot run the Playwright
E2E / visual-regression suite or the perf gate; CI does. It never
regenerates `tests-e2e/snapshots/` or `perf-baseline.json`: those are
pinned to the GHA runner and only `update-baselines.yml` writes them
(ADR-0003, ADR-0014).

- `gh issue edit <n> --add-label agent:go` (or add it in the UI).
- Manually: Actions → "Claude (opt-in via label)" → Run workflow → issue number.
- On failure the `agent:go` label is removed so it isn't left looking claimed.
- **Only trusted issue text is worked.** The issue becomes the agent's
  instructions, so an issue written by someone without write access is
  refused with a comment (and the label removed). Restate the task in your
  own issue, or add `agent:untrusted-ok` after reading the text yourself.

## On @claude mention (`claude-mention.yml`)

Write `@claude ...` in an issue or PR comment. Gated to the owner /
collaborators: comment events carry secrets even from strangers. Only the
owner's and the agent's own comments reach the prompt
(`include_comments_by_actor`).

## Model per issue

`.github/scripts/pick-model.sh` chooses the model from labels. It passes
aliases, so the latest model of each family is used without edits here.

| Label | Model |
|---|---|
| `agent:opus` | `opus` |
| `agent:haiku` | `haiku` |
| `agent:sonnet` / (none) | `sonnet` |
| `P1` | `opus` |
| `P3` / `good first issue` | `haiku` |

## Guardrails

The agent reads text written by others (issues, comments, PR titles, code)
and runs with write access. Every public attack on agent workflows in
2025/26 combined exactly that with an unrestricted shell. So the shell is
restricted, and several layers hold even if the model is talked into
something:

| Layer | What it does | Where |
|---|---|---|
| Tool allowlist | `--permission-mode dontAsk` plus `--allowedTools`: git, a few `gh` subcommands and the repo's own check commands. Anything else is refused without a prompt. No `--dangerously-skip-permissions`. | `claude_args` in each workflow |
| Deny rules | `gh api`, `gh secret`, `gh workflow`, `gh repo`, `curl`, `wget`, force pushes. Deny always wins. | `.claude/ci-settings.json` |
| Path guard hook | Blocks every write to `.github/` and `.claude/`, through file tools or the shell. Runs only on GitHub Actions; local sessions are unaffected. | `.claude/hooks/protect-paths.py` |
| Trusted text only | Untrusted issues are refused, foreign comments are filtered out. | job `if:`, `include_comments_by_actor` |
| Egress | harden-runner logs (mode `audit`) or blocks (mode `block`) outbound connections. | first step of each agent job |
| Pinned actions | Every `uses:` is a full commit SHA; Dependabot bumps it after a 7-day cooldown (not for claude-code-action, whose updates are security fixes). | all workflows, `dependabot.yml` |
| Reviewer reads CI | The reviewer never runs the PR's tests or scripts (the PR could change them, and the job holds secrets); CI runs them without secrets. | `claude-review.yml` |
| Sensitive paths | A PR touching `.github/`, `.claude/`, `scripts/`, `docs/adr/`, `AGENTS.md`, `CLAUDE.md`, `package*.json`, `hacs.json`, `dist/`, `tests-e2e/snapshots/`, `perf-baseline.json` or a gate config (`vitest`, `eslint`, `dependency-cruiser`, `playwright`, `rollup`, `tsconfig`) is never auto-merged, whatever the model decided. | `SENSITIVE` and last steps of `claude-review.yml` |

The action restores `.claude/` from the base branch on pull requests, so a
PR cannot switch off the settings or the hook.

**About the `workflows` permission:** the official Claude GitHub App is
installed with Workflows read/write, and a token obtained in a January 2026
attack (CVE-2025-66032) carried that permission. In earlier runs of this
setup a push to `.github/workflows/` was rejected with 403, but that is not
a guarantee. The hook above is the boundary that does not depend on how
the token is scoped.

**Switching egress to `block`:** after a few agent runs, open a run's
harden-runner insights (link in the job summary), compare the endpoints
with `allowed-endpoints`, add what is missing, then set
`egress-policy: block` in the three agent workflows.

Other rules:

- The prompts tell the agent to follow `AGENTS.md`, `ARCHITECTURE.md` and
  `docs/adr/`, to treat issue text as a description of a change rather
  than instructions, to stop if the issue is closed or already has an open
  PR, and never to invent domain data (every lookup table, threshold or
  upstream field cites a source: an ADR, a URL, a real fixture).
- **Changes only a human may make** (`.github/`, `.claude/`): the agent
  writes `Refs #N` instead of `Closes #N` and a `## Human-only change`
  section with the exact diff. The reviewer then holds the PR and opens a
  follow-up issue, so that half does not get lost when the rest merges.
- **The agent reports how it ended.** The last line of the PR description
  is `Agent status: done` or `Agent status: blocked`. The action's exit
  status is not used for this: a finished run can still fail for going a
  few turns over the limit.
- **Runs are capped** at 100 turns (mention: 60) and 60 minutes (mention: 45). The agent
  pushes early and opens the draft PR after its first commit. After every
  run, `after-agent-run.sh` commits and pushes what is left and reads the
  status line:

  | Ends with | Then |
  |---|---|
  | `Agent status: done` | the reviewer is started (`gh workflow run claude-review.yml`) |
  | `Agent status: blocked` | the PR gets `needs-verification`, a human decides |
  | no status line | the PR gets **`agent:needs-continuation`**; continue with `@claude continue` or by hand |
  | nothing committed, run failed | the *issue* gets `needs-verification` and a comment to split it |

  Its pushes use the workflow token, so they trigger neither CI nor the
  reviewer: unfinished work is never auto-merged.

## Sizing an issue

Most failed runs in the repos this standard comes from were issues that
were too big, not too hard. A run that hits the limit before its first
commit leaves nothing; the same issue then fails again. Use the *Agent
task* issue template and keep to:

- **One layer per issue** (a data source, a chart plugin, an editor
  partial, a locale ...), at most about four modules.
- **Measuring and deciding happen first, by hand.** Upstream facts (HA
  entity attributes, Open-Meteo fields), the ADR, real fixtures and any new
  E2E baselines (`update-baselines.yml`) land in a maintainer PR; the agent
  issues only implement.
- **Name the files and the exact tests** that prove it, and what is out of
  scope (no network in tests, no new ADR, no new dependency).
- **Slices of one feature** are titled "Feature (N/M)" and handed over in
  order, only when the previous slice is merged.
- **A repo needs a test suite before `agent:go` makes sense.** Without
  tests the agent cannot verify anything, and the reviewer cannot either.
  This one has vitest (unit) and Playwright (E2E, CI only).
- Research logs and wish lists get the label **`tracking`**: no agent ever
  works them.

## Automated review + auto-merge (`claude-review.yml`)

An **independent Opus reviewer** runs on agent PRs (`claude/*` branches of
this repository; a contributor's fork PR with the same prefix is ignored).
It starts when the author agent reports `Agent status: done`, or when a
human marks an agent PR ready. Not when the draft opens: the agent opens
it early and keeps working. Its own `gh pr ready` does not start a second
review. It first waits for the required checks, then reviews the diff adversarially
against `AGENTS.md` and the ADRs, reads the CI result (it does not run the
checks itself). It may fix docs, tests and comments on the branch (**at
most 3 rounds**; CI re-runs on its pushes) but **never `src/`**: `dist/`
must be rebuilt in the same commit and the reviewer cannot run the build,
so for a code problem it comments the exact fix and holds. Then either:

- **auto-merges** (`gh pr merge --auto --squash`) when green and solid, or
- **holds for you** when the change needs a human decision or a live
  check, when the PR or its issue carries **`needs-verification`**, or when
  it could not make the change solid — it labels the PR
  `needs-verification` and comments exactly what to check.

Whatever the model decided, a PR that touches sensitive paths or carries a
`## Human-only change` is then held with `needs-verification`. Since a
`src/` change always comes with a rebuilt `dist/`, every agent PR that
changes the card itself is held for the maintainer; docs and test PRs can
auto-merge. A review run
that dies (turn limit, error) labels the PR too, instead of leaving it
open without a label. After that the job waits for the required checks; if
one fails after auto-merge was armed, the PR gets `needs-verification` and
a comment naming the check, instead of sitting silently.

## A red default branch (`ci-watch.yml`)

`build.yml` ("Build & Lint") also runs weekly, so tool or dependency drift
(a new advisory, a browser update shifting the visual baselines) shows up
without commits. When it fails on `master`, `ci-watch.yml` opens one issue
"CI is red on master" (no `agent:go`, so no agent picks it up) and closes
it when the build is green again. Releases need no extra check: they run in
the same `build` job, after every gate has passed on the tagged commit.

Auto-merge needs branch protection with the required checks `build` and
`Analyze (javascript-typescript)` on `master`.

## No autopilot

This repo deliberately has no autopilot: there is no ordered backlog to
clear, and every issue is handed over by hand with `agent:go`.

## Setup (one-time, by the owner)

1. Install the Claude GitHub App on this repository
   (https://github.com/apps/claude), or extend the existing installation
   under https://github.com/settings/installations.
2. `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R chriguschneider/weather-station-card`
   (token from `claude setup-token`; never paste it into a chat).
3. SonarCloud project + `SONAR_TOKEN` (already configured; advisory, not
   a required check).
4. Labels from repo-standard's `labels.json` (`agent:untrusted-ok`,
   `agent:needs-continuation`, `tracking`, ...) must exist, or the label
   steps in the workflows fail.
