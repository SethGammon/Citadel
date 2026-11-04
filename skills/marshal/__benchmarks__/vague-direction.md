---
name: vague-direction
skill: marshal
description: Marshal asks one clarifying question when direction is too vague to act on
tags: [fringe, wrong-input]
input: /marshal do the thing
state: clean
assert-contains:
  - ?
assert-not-contains:
  - ENOENT
  - TypeError
  - TypeError:
  - SyntaxError:
  - at Module._compile
  - node:internal/
  - Cannot read
  - crashed
assert-files-absent:
  - src
  - package.json
---

## What This Tests

A user provides a direction so vague ("do the thing") that Marshal cannot form a
reasonable interpretation. Marshal must ask exactly one clarifying question rather
than guessing wildly, crashing, or producing a nonsensical plan.

## Expected Behavior

1. Marshal attempts to parse the direction into structured intent
2. Cannot identify scope, mode, or target from "do the thing"
3. Asks exactly one focused clarifying question (e.g., "What area of the codebase or what problem should I focus on?")
4. Does not begin executing or generating a plan until the scope is clarified
5. No errors or stack traces appear
