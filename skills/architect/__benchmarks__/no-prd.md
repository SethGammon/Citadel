---
name: no-prd
skill: architect
description: Architect gracefully asks for direction when no PRD exists in .planning/
tags: [fringe, missing-state]
input: /architect
state: clean
assert-contains:
  - PRD
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
  - Cannot read
---

## What This Tests

A user who runs `/architect` with a clean project — no `.planning/` directory, no PRD,
no prior campaign context. The skill must not crash. It should ask the user to provide
a PRD or architectural direction before proceeding.

## Expected Behavior

1. Architect detects that no PRD or direction is present
2. Outputs a human-readable prompt asking for a PRD or direction
3. Does not crash with a filesystem error
4. Does not produce raw JSON or Node.js stack traces
