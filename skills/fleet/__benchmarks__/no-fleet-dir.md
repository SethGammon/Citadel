---
name: no-fleet-dir
skill: fleet
description: Fleet creates session directory when .planning/fleet/ does not exist
tags: [fringe, missing-state]
input: /fleet build the auth module in parallel
state: clean
skip-execute: true
timeout: 300000
assert-contains:
  - auth
  - project
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
  - undefined
  - directory not found
---

## What This Tests

A user invokes Fleet on a fresh project where `.planning/fleet/` does not yet exist.
Fleet must create the session directory itself rather than crashing on a missing path.
This is the first-run experience for Fleet on any new project.

## Expected Behavior

1. Fleet reads CLAUDE.md and checks for active campaigns
2. Decomposes "build the auth module in parallel" into independent streams
3. Creates `.planning/fleet/` if it does not exist before writing the session file
4. Writes the session file and logs session start
5. No raw filesystem errors appear — the missing directory is created, not reported as an error
