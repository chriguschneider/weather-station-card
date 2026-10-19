#!/usr/bin/env python3
"""PreToolUse hook: before `git commit`, remind Claude to run commit-guardian.

Cross-platform replacement for a PowerShell one-liner. Adds context only;
it never blocks. Stdlib only.
"""

import json
import re
import sys

try:
    event = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)
command = (event.get("tool_input") or {}).get("command", "")
if re.match(r"^\s*git\s+commit\b", command):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": (
                "Run the commit-guardian skill (.claude/skills/commit-guardian/SKILL.md) "
                "before this commit: check the staged changes against docs/adr/ and AGENTS.md."
            ),
        }
    }))
