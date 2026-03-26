---
name: no-metric
skill: experiment
description: experiment asks for a measurable metric before starting when none is provided
tags: [fringe, missing-state]
input: /experiment make the dashboard faster
state: clean
timeout: 240000
assert-contains:
  - metric
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
  - Cannot read
---

## What This Tests

A user provides a vague optimization goal ("make the dashboard faster") without a
measurable baseline metric. The skill must not start blindly iterating. It should
ask for a concrete metric (e.g., FPS, load time, bundle size) before proceeding.

## Expected Behavior

1. Recognizes the goal is vague — no baseline or metric specified
2. Asks for a measurable metric before starting iterations
3. Does not begin generating experiment iterations without a metric
4. No crash or raw error output
