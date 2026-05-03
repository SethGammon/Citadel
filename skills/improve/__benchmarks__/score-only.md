---
name: score-only
skill: improve
description: /improve citadel --score-only with existing rubric outputs a scorecard and makes no changes
tags: [happy-path]
input: /improve citadel --score-only
state: with-completed-campaign
assert-contains:
  - score
  - axis
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

`--score-only` mode. The skill must score every axis in the rubric and output a
scorecard without making any file changes or spawning attack agents.

## Setup

`with-completed-campaign` provides a `.planning/rubrics/citadel.md` rubric file.
The rubric already exists — Phase 0 should be skipped.

## Expected Behavior

1. Detects existing rubric at `.planning/rubrics/citadel.md` — skips Phase 0
2. Runs Phase 1 scoring (or describes what it would do)
3. Outputs a scorecard with at least two axes scored
4. Makes no file modifications
5. Outputs something containing "score" and "axis"
