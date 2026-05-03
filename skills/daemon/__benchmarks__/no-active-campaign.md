---
name: no-active-campaign
skill: daemon
description: /daemon start exits with a clear message when no active campaign exists
tags: [fringe, missing-state]
input: /daemon start
state: clean
assert-contains:
  - campaign
assert-not-contains:
  - daemon.json
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

Step 1 of /daemon start requires an active campaign. When none exists, the skill
must stop before writing any state file and give the user an actionable message.

## Setup

`clean` state: no `.planning/campaigns/` entries with `status: active`.

## Expected Behavior

1. Scans `.planning/campaigns/` (or finds it absent)
2. Finds no active campaign
3. Outputs a clear message explaining the requirement (e.g., "No active campaign. Start one with /archon first.")
4. Does NOT write daemon.json
5. Does NOT attempt to create triggers
