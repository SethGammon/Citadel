---
name: teams-pilot
skill: fleet
description: Fleet --teams falls back to classic worktree mode when the experimental flag is absent
tags: [fringe, teams-mode]
behavior: invariant
input: /fleet --teams refactor the API layer and update the frontend in parallel
state: clean
skip-execute: true
skip-reason: requires-agent-spawn
assert-contains:
  - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  - classic
  - worktree
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
---

## What This Tests

A user invokes Teams mode in an environment where `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
is not set. Fleet must detect the missing flag, print an explicit fallback notice naming
the variable, and run the classic worktree protocol instead of attempting native task or
SendMessage coordination.

## Expected Behavior

1. Fleet checks for `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and a Claude Code runtime
2. The flag is absent, so Fleet prints the fallback notice naming the missing variable
3. Execution proceeds in classic worktree mode: waves, briefs, discovery relay
4. No native task spine or SendMessage rebalancing is attempted
5. Session file and merge review behave exactly as in classic mode
