#!/usr/bin/env python3
"""PreToolUse guard for unattended agent runs on GitHub Actions.

Blocks writes to `.github/` and `.claude/`: the CI and the agent's own
guardrails are changed by a human, never by the agent. Deny rules and
PreToolUse hooks hold even when the permission mode would allow the call,
and the action restores `.claude/` from the base branch on pull requests,
so a PR cannot switch this off.

Loaded only through `.claude/ci-settings.json` (the workflows pass it via
the action's `settings` input), so local interactive sessions are not
affected. Exit code 2 blocks the call and shows stderr to the agent.
Stdlib only.
"""

from __future__ import annotations

import json
import os
import re
import sys

PROTECTED = (".github/", ".claude/")
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# Git/gh calls that only read are fine even when they name a protected path.
READ_ONLY = re.compile(r"^\s*(git (status|diff|log|show|blame)|gh pr (diff|view)|cat|ls|grep|rg)\b")
# A read-only prefix proves nothing once the command chains, pipes or redirects.
CHAINING = re.compile(r"[;&|`>]|\$\(")
# `.github` / `.claude` as a path segment, not `foo.github.io`.
MENTIONS = re.compile(r"(?<![\w.-])\.(github|claude)(?![\w-])")


def block(reason: str) -> None:
    print(
        f"Blocked by .claude/hooks/protect-paths.py: {reason}. Changes under "
        "`.github/` and `.claude/` are made by a maintainer. Describe the exact "
        "change in the PR and stop.",
        file=sys.stderr,
    )
    sys.exit(2)


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return
    tool = event.get("tool_name", "")
    data = event.get("tool_input") or {}
    root = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())

    if tool in WRITE_TOOLS:
        path = data.get("file_path") or data.get("notebook_path") or ""
        full = os.path.realpath(os.path.join(root, path))
        rel = os.path.relpath(full, root).replace(os.sep, "/") + ("/" if os.path.isdir(full) else "")
        if any(rel.startswith(p) for p in PROTECTED):
            block(f"{tool} on {rel}")
    elif tool == "Bash":
        command = data.get("command", "")
        read_only = READ_ONLY.match(command) and not CHAINING.search(command)
        if MENTIONS.search(command) and not read_only:
            block(f"shell command touching a protected path: {command[:120]!r}")


if __name__ == "__main__":
    main()
