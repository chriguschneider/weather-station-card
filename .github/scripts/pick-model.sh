#!/usr/bin/env bash
# Pick the Claude model for an issue from its labels.
#
# Explicit override wins: agent:opus / agent:sonnet / agent:haiku force it.
# Otherwise P1 -> Opus, P3 / good first issue -> Haiku, else Sonnet.
# Aliases, not pinned IDs: Claude Code resolves them to the latest model of
# the family, so this file does not go stale with every release.
#
# Usage: pick-model.sh <issue-number>. Prints `model=<alias>` on stdout.
set -euo pipefail

issue="${1:?usage: pick-model.sh <issue-number>}"
labels="$(gh issue view "$issue" --json labels --jq '[.labels[].name] | join(",")')"

model="sonnet" # default workhorse
case ",$labels," in
  *,agent:opus,*)                  model="opus" ;;
  *,agent:haiku,*)                 model="haiku" ;;
  *,agent:sonnet,*)                model="sonnet" ;;
  *,P1,*)                          model="opus" ;;
  *,P3,* | *,"good first issue",*) model="haiku" ;;
esac

echo "issue #$issue labels=[$labels] -> $model" >&2
echo "model=$model"
