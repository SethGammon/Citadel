---
name: no-planning-dir
skill: do
description: Router skips Tier 1 gracefully when .planning/ does not exist
tags: [fringe, missing-state]
input: /do fix the login bug
state: clean
timeout: 240000
assert-contains:
  - login
  - bug
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
  - undefined
  - .planning
---

## What This Tests

A user runs `/do` on a project that has not been initialized with `.planning/`.
The router must skip the Tier 1 active-state check (which reads `.planning/campaigns/`
and `.planning/fleet/`) and fall through to Tier 2 keyword matching without crashing.

## Expected Behavior

1. Tier 0 pattern check finds no direct match
2. Tier 1 is skipped cleanly because `.planning/` is absent (no error thrown)
3. Tier 2 keyword matching routes "fix the login bug" → Marshal
4. The routing decision is announced: "Routing to /marshal because..."
5. No raw filesystem errors appear anywhere in the output
