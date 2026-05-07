---
name: briefed-item-build
skill: autopilot
description: Autopilot processes a briefed intake item through to completion
tags: [happy-path]
behavior: invariant
input: /autopilot
state: with-intake
skip-execute: true
skip-reason: requires-agent-spawn
assert-contains:
  - processed
  - logging
  - intake
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - Cannot read
---

## What This Tests

A user has a properly formatted intake item with `status: briefed` waiting in
`.planning/intake/`. Autopilot must pick it up, execute the build step, verify
the output, and mark the item as completed. This is the core happy-path flow.

## Expected Behavior

1. Autopilot scans and finds the briefed item
2. Reads CLAUDE.md for project conventions
3. Executes the approach described in the brief
4. Marks the item as `completed` after verification
5. Outputs a summary showing the item moved from briefed to completed
