---
name: no-rubric
skill: evolve
description: evolve errors with actionable message when no rubric exists
tags: [fringe, missing-state]
input: /evolve my-new-feature
state: clean
assert-contains:
  - rubric
  - /improve
assert-not-contains:
  - TypeError
  - undefined
  - ENOENT
---

## What This Tests

When `/evolve` is invoked for a target with no rubric file, it must error
with a clear message pointing to the fix — not crash or silently do nothing.

## Setup

`clean` state: no `.planning/rubrics/my-new-feature.md` exists.

## Expected Behavior

1. Detects no rubric at `.planning/rubrics/my-new-feature.md`
2. Lists available rubric targets from `.planning/rubrics/`
3. Instructs user to run `/improve my-new-feature` Phase 0 first
4. Does NOT attempt to auto-generate a rubric
5. Response contains "rubric" and "/improve"
