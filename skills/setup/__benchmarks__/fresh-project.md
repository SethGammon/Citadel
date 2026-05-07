---
name: fresh-project
skill: setup
description: setup walks through configuration steps and creates harness.json on a clean project
tags: [happy-path]
behavior: invariant
input: /setup
state: clean
skip-execute: true
skip-reason: interactive-setup
assert-contains:
  - setup
  - Q1
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
  - Cannot read
---

## What This Tests

A user runs `/setup` for the first time on a clean project. The skill must walk
through the configuration steps and produce or describe the harness.json file.

## Expected Behavior

1. Detects no existing configuration
2. Walks through one or more setup steps (project name, hooks, permissions, etc.)
3. References harness.json as the output configuration
4. Produces actionable output (steps taken or next steps)
5. No crash or raw error output
