#!/usr/bin/env bash
# Pick the Claude model for an issue from its labels.
#
# Explicit override wins: an `agent:opus` / `agent:sonnet` / `agent:haiku`
# label forces that model. Otherwise fall back to priority labels, else the
# default. (This repo has no P1/P2/P3 labels, so most issues resolve to the
# default Sonnet unless you add an explicit agent:* label.)
#
#   agent:opus   -> claude-opus-4-8
#   agent:sonnet -> claude-sonnet-4-6
#   agent:haiku  -> claude-haiku-4-5
#   P1           -> claude-opus-4-8
#   P3 / good first issue -> claude-haiku-4-5
#   (default)    -> claude-sonnet-4-6
#
# Usage: pick-model.sh <issue-number>. Prints `model=<id>` on stdout.
set -euo pipefail

issue="${1:?usage: pick-model.sh <issue-number>}"
labels="$(gh issue view "$issue" --json labels --jq '[.labels[].name] | join(",")')"

model="claude-sonnet-4-6" # default workhorse
case ",$labels," in
  *,agent:opus,*)                  model="claude-opus-4-8" ;;
  *,agent:haiku,*)                 model="claude-haiku-4-5" ;;
  *,agent:sonnet,*)                model="claude-sonnet-4-6" ;;
  *,P1,*)                          model="claude-opus-4-8" ;;
  *,P3,* | *,"good first issue",*) model="claude-haiku-4-5" ;;
esac

echo "issue #$issue labels=[$labels] -> $model" >&2
echo "model=$model"
