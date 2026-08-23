# Agent automation (opt-in)

Unlike a backlog that gets ground through automatically, this repo is
idea-driven: **only issues you explicitly hand over are worked by Claude.**
Both flows open **draft PRs only** and never push to `master`
(branch protection enforces it).

## Opt-in by label (`claude-labeled.yml`)

Add the **`agent:go`** label to an issue → Claude implements it on a
`claude/<n>-<slug>` branch and opens a draft PR. Issues without the label
(ideas, discussions, `enhancement` you haven't triaged) are never touched.

- Start it: `gh issue edit <n> --add-label agent:go` (or add the label in the UI).
- Manually: Actions → "Claude (opt-in via label)" → Run workflow → issue number.
- If the run fails, the `agent:go` label is removed so it doesn't look claimed.

## On @claude mention (`claude-mention.yml`)

Write `@claude ...` in an issue or PR comment to have Claude work that item.

## Model per issue

`.github/scripts/pick-model.sh` chooses the model from labels. This repo has
no P1/P2/P3, so add an explicit override when it matters:

| Label | Model |
|---|---|
| `agent:opus` | `claude-opus-4-8` |
| `agent:sonnet` | `claude-sonnet-4-6` |
| `agent:haiku` | `claude-haiku-4-5` |
| (none) | `claude-sonnet-4-6` (default) |

## Setup (maintainer, one-time)

Install the Claude GitHub App and add the repo secret
`CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`). The agent reads AGENTS.md
and the ADRs, and does not regenerate the GHA-pinned E2E baselines
(ADR-0003).

## Known limitations

**The agent cannot push changes to `.github/workflows/` files.**
GitHub enforces a separate `workflows` permission that is distinct from
`contents: write`. The Claude GitHub App token only has `contents: write`,
so any fix that requires modifying a workflow file will be blocked at
`git push` / `gh api PUT`. The PR will be opened as "Blocked / needs
maintainer action" with the exact patch to apply manually.
