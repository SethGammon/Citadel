---
name: vague-pattern
skill: create-skill
description: create-skill asks for a pattern description when invoked with no arguments
tags: [fringe, missing-state]
input: /create-skill
state: clean
assert-contains:
  - repeating
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
  - Cannot read
---

## What This Tests

A user runs `/create-skill` with no arguments. The skill must not crash or produce
empty output. It should ask the user to describe the repeated pattern or workflow
they want to automate.

## Expected Behavior

1. Detects missing input (no pattern or workflow described)
2. Asks the user to describe the repeated action or workflow
3. Does not attempt to generate a SKILL.md with no information
4. No crash or raw error output
