---
name: happy-path-status
skill: evolve
description: evolve --status shows belief model and velocity without attacking
tags: [happy-path]
input: /evolve skill-md --status
state: with-campaign
assert-contains:
  - belief
  - velocity
  - spend
assert-not-contains:
  - attacking
  - fleet
  - worktree
---

## What This Tests

`--status` mode must report current belief model state, learning velocity, and
cumulative spend without dispatching any agents or modifying any files.

## Setup

`has-rubric-and-prior-cycles` state: `.planning/rubrics/skill-md.md` exists,
`.planning/evolve/skill-md/director-state.json` exists with `cycle: 2`,
`.planning/evolve/skill-md/belief-model.jsonl` has entries.

## Expected Behavior

1. Reads director state and belief model
2. Reports cycle count, velocity history, cumulative spend
3. Shows per-axis scores and hypothesis status
4. Does NOT dispatch scouts or fleet
5. Does NOT modify any files
6. Response contains "belief", "velocity", and "spend"
