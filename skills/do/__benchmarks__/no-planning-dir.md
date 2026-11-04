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
  - ACTIVATION_OWNERSHIP_UNKNOWN
assert-matches:
  - /(?:citadel:)?(?:marshal|systematic-debugging)
assert-files-absent:
  - package.json
  - src
---

## What This Tests

A user runs `/do` on a project that has not been initialized with `.planning/`.
Startup may create Citadel scaffolding before the prompt. With no application
source or active work, the router must choose a debugging route or ask for the
missing login context, without inventing code or leaking raw filesystem errors.
Mentioning an initialized planning path is not itself a filesystem error.

## Expected Behavior

1. Tier 0 pattern check finds no direct match
2. Tier 1 is skipped cleanly because `.planning/` is absent (no error thrown)
3. Tier 2 keyword matching routes "fix the login bug" → Marshal
4. The routing decision is announced: "Routing to /marshal because..."
5. No raw filesystem errors appear anywhere in the output
