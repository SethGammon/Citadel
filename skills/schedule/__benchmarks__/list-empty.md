---
name: list-empty
skill: schedule
description: Schedule lists empty saved project records without contacting cloud scheduling
tags: [fringe, missing-state]
input: /schedule list saved schedule records for this project only. Read local state; do not query the operating system scheduler or any cloud service.
state: clean
assert-contains:
  - schedule
assert-matches:
  - (?:no|zero|none|empty)[^\n]{0,100}(?:schedule|record)|(?:schedule|record)[^\n]{0,100}(?:no|zero|none|empty)
assert-files-absent:
  - .citadel/schedules
  - .planning/codex-automations
assert-not-contains:
  - TypeError
  - ENOENT
---

## What This Tests

An empty project has no saved schedules. Listing local records must be read-only
and must not bootstrap a cloud environment or create an operating-system task.
The case does not claim that the user has no schedules elsewhere.
