---
name: happy-path-status
skill: evolve
description: evolve --status shows belief model and velocity without attacking
tags: [happy-path]
input: /evolve skill-md --status
state: with-evolve-history
assert-contains:
  - belief
  - velocity
  - spend
assert-files-unchanged:
  - .planning/rubrics/skill-md.md
  - .planning/evolve/skill-md/director-state.json
  - .planning/evolve/skill-md/belief-model.jsonl
  - .planning/evolve/skill-md/experiment-log.jsonl
assert-files-absent:
  - .planning/evolve/skill-md/cycle-3-digest.md
assert-not-contains:
  - TypeError:
  - SyntaxError:
  - node:internal/
---

## What This Tests

`--status` mode must report current belief model state, learning velocity, and
cumulative spend without dispatching any agents or modifying any files.

## Setup

`with-evolve-history` state: `.planning/rubrics/skill-md.md` exists,
`.planning/evolve/skill-md/director-state.json` exists with `cycle: 2`,
`.planning/evolve/skill-md/belief-model.jsonl` has entries.

## Expected Behavior

1. Reads director state and belief model
2. Reports cycle count, velocity history, cumulative spend
3. Shows per-axis scores and hypothesis status
4. Does NOT dispatch scouts or fleet
5. Does NOT modify any files
6. Response contains "belief", "velocity", and "spend"
