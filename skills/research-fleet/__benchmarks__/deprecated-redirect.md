---
name: deprecated-redirect
skill: research-fleet
description: Deprecated stub redirects /research-fleet invocations to /research parallel mode
tags: [fringe, deprecated]
behavior: invariant
input: /research-fleet should we use Redis or Postgres for session storage
state: clean
skip-execute: true
skip-reason: requires-agent-spawn
assert-contains:
  - research
  - parallel
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
  - undefined
---

## What This Tests

/research-fleet is deprecated; its SKILL.md is a stub. A direct invocation must
still land somewhere useful: the agent follows `skills/research/SKILL.md` with
parallel mode on, exactly as if the user had invoked `/research --parallel`
with the same arguments.

## Expected Behavior

1. The stub does no research of its own
2. The agent reads `skills/research/SKILL.md` and runs its parallel-mode protocol
3. Scouts are decomposed and deployed per that protocol
4. Output reflects /research parallel mode (unified report, recommendation), not an error
