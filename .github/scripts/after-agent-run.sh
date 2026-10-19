#!/usr/bin/env bash
# Runs after every agent implementation step, success or not, and decides
# what happens next. The action's own exit status is not enough: a run that
# finished its work can still fail for going a few turns over the limit, and
# a run that dies early can look like nothing happened.
#
#   - Work left on a `claude/*` branch (uncommitted files, unpushed
#     commits) is committed and pushed, and a draft PR is made sure to exist.
#   - The PR description's last status line decides:
#       `Agent status: done`    -> hand the PR to the reviewer
#       `Agent status: blocked` -> label needs-verification, a human decides
#       no status line          -> label agent:needs-continuation
#   - Nothing at all to save after a failed run -> comment on the issue
#     ("split it") and label it needs-verification, so the autopilot does not
#     retry the same oversized issue forever.
#
# Pushes with the workflow's GITHUB_TOKEN on purpose: that push triggers
# neither CI nor the reviewer, so unfinished work is never auto-merged. The
# reviewer is started explicitly with `gh workflow run`, which the token may
# do.
#
# Usage: after-agent-run.sh <issue-number> <step-outcome>. Needs GH_TOKEN,
# GITHUB_REPOSITORY and DEFAULT_BRANCH; EXEC_FILE (the action's execution
# file) is optional and only used for the turn count in comments.
set -euo pipefail

issue="${1:?usage: after-agent-run.sh <issue> <outcome>}"
outcome="${2:-unknown}"
default="${DEFAULT_BRANCH:-master}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-0}"

detail="$outcome"
if [ -n "${EXEC_FILE:-}" ] && [ -f "$EXEC_FILE" ]; then
  detail="$(jq -r '[.[] | select(.type == "result")] | last
    | if . == null then "'"$outcome"'" else "\(.subtype // "unknown") after \(.num_turns // "?") turns" end' \
    "$EXEC_FILE" 2>/dev/null || echo "$outcome")"
fi

# What the agent said last, and which tool calls the allowlist refused: the
# first things to look at when a run did not do its job. Printed to the log
# (readable through the API) and, if available, to the job summary.
final_message=""
denials=""
if [ -n "${EXEC_FILE:-}" ] && [ -f "$EXEC_FILE" ]; then
  final_message="$(jq -r '[.[] | select(.type == "result")] | last | .result // "" | .[0:1500]' "$EXEC_FILE" 2>/dev/null || true)"
  denials="$(jq -r '[.[] | select(.type == "result")] | last | .permission_denials // []
    | .[] | "- `\(.tool_name)`: `\(.tool_input.command // .tool_input.file_path // "" | tostring | .[0:160])`"' \
    "$EXEC_FILE" 2>/dev/null || true)"
fi
echo "run: $detail"
[ -n "$denials" ] && printf 'tool calls refused by the allowlist:\n%s\n' "$denials"
[ -n "$final_message" ] && printf 'final message of the agent:\n%s\n' "$final_message"
if [ -n "$denials" ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### Tool calls refused by the allowlist"; echo; echo "$denials"; } >> "$GITHUB_STEP_SUMMARY"
fi

nothing_saved() {
  # Nothing committed. A failed run means the issue is probably too big; a
  # "successful" run that changed nothing (it judged the issue closed,
  # handled, or not doable) is just as much a dead end for the autopilot,
  # which would pick the same issue again on the next tick.
  if [ "$(gh issue view "$issue" --json state --jq .state 2>/dev/null)" = "CLOSED" ]; then
    echo "issue #$issue is closed; nothing to do"
    return 0
  fi
  echo "run ended ($detail) with nothing to save"
  gh issue edit "$issue" --add-label needs-verification || true
  if [ "$outcome" = "success" ]; then
    reason="The agent run finished (**$detail**) without changing anything: $run_url"
  else
    reason="The agent run ended (**$detail**) before it committed anything: $run_url

That usually means the issue is too big for one run. Split it into smaller issues (see \`docs/agent-automation.md\`, *Sizing an issue*)."
  fi
  gh issue comment "$issue" --body "$reason
${denials:+
Tool calls refused by the allowlist:
$denials
}${final_message:+
Last message of the agent:

> ${final_message//$'\n'/$'\n'> }
}
Labelled \`needs-verification\` so the autopilot does not retry it." || true
}

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
case "$branch" in
  claude/*) ;;
  *) nothing_saved; exit 0 ;;
esac

git config user.name "claude[bot]"
git config user.email "209825114+claude[bot]@users.noreply.github.com"

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "wip: unfinished agent run for #$issue" \
    -m "The run ended ($detail) before the agent committed this. Saved by after-agent-run.sh."
  echo "committed leftover changes"
fi

if [ "$(git rev-list --count "origin/$default..HEAD" 2>/dev/null || echo 0)" = "0" ]; then
  nothing_saved
  exit 0
fi

remote="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if ! git push -q "$remote" "HEAD:refs/heads/$branch"; then
  echo "::warning::could not push $branch (remote moved on?); leaving it to a human"
  exit 0
fi

pr="$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')"
if [ -z "$pr" ]; then
  # shellcheck disable=SC2016 # the backticks are Markdown, not a command
  gh pr create --draft --head "$branch" \
    --title "WIP: #$issue (agent run did not finish)" \
    --body "$(printf 'The agent run for #%s ended (%s) before it opened a PR. This draft holds what it had.\n\nContinue with a comment `@claude continue`, or take it over by hand.\n\nRefs #%s' "$issue" "$detail" "$issue")"
  pr="$(gh pr list --head "$branch" --state open --json number --jq '.[0].number')"
fi

status="$(gh pr view "$pr" --json body --jq .body | grep -oE 'Agent status: (done|blocked)' | tail -1 || true)"
case "$status" in
  "Agent status: done")
    echo "agent reports done (run: $detail)"
    if [ -f .github/workflows/claude-review.yml ]; then
      gh workflow run claude-review.yml -f pr="$pr"
      echo "reviewer started for #$pr"
    fi
    ;;
  "Agent status: blocked")
    gh pr edit "$pr" --add-label needs-verification || true
    gh pr comment "$pr" --body "The agent stopped and needs a decision (see *Blocked / needs decision* above). Labelled \`needs-verification\`." || true
    ;;
  *)
    gh pr edit "$pr" --add-label agent:needs-continuation || true
    gh pr comment "$pr" --body "Agent run ended (**$detail**) without reporting \`Agent status: done\`; unfinished work was saved here. Continue with \`@claude continue\`, or by hand. Run: $run_url" || true
    ;;
esac
echo "PR #$pr handled"
