---
name: greenfield-vague
skill: create-app
description: create-app proposes a stack and first steps for a vague todo request before approval
tags: [happy-path]
input: /create-app build me a todo app. For this first turn, propose the stack and initial steps, then stop for approval before writing application code.
state: clean
assert-files-absent:
  - package.json
  - src
assert-contains:
  - todo
  - stack
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
  - Cannot read
---

## What This Tests

A user gives the most common vague request: "build me a todo app." The skill must
not stall or crash. It should pick a tech stack, describe Tier 1 scaffolding steps,
and output a plan even without more detail. The first-turn boundary is explicit:
application files must remain absent until the user approves the plan.

## Expected Behavior

1. Identifies this as a greenfield project (no existing codebase)
2. Proposes or confirms a tech stack
3. Describes Tier 1 (or higher) scaffolding steps
4. Does not ask an infinite chain of clarifying questions before producing output
5. No crash or raw error output
