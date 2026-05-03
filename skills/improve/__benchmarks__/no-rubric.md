---
name: no-rubric
skill: improve
description: /improve on a target with no rubric runs Phase 0 and halts for human approval
tags: [fringe, missing-state]
input: /improve myapp
state: clean
assert-contains:
  - rubric
  - approval
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

When no rubric exists for the target, improve must run Phase 0 (rubric bootstrap)
and halt — it must NOT proceed to scoring or attacking without human approval.

## Setup

`clean` state: no `.planning/rubrics/myapp.md` exists.

## Expected Behavior

1. Checks for `.planning/rubrics/myapp.md` — not found
2. Enters Phase 0: drafts rubric axes, presents them
3. Outputs that it needs human approval before continuing
4. Does NOT score, attack, or loop
5. Response contains "rubric" and "approval" (or equivalent)
