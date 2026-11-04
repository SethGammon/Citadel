---
name: no-planning-dir
skill: dashboard
description: Dashboard renders an initialized empty project and offers a valid next action
tags: [fringe, missing-state]
input: /dashboard
state: clean
assert-contains:
  - Citadel Dashboard
  - CAMPAIGNS
  - FLEET
  - PENDING
  - HEALTH
  - NEXT ACTION
assert-matches:
  - /(?:citadel:)?(?:do|verify|archon)\b
assert-not-contains:
  - ENOENT
  - SyntaxError
  - TypeError
  - undefined
  - Cannot read
  - ACTIVATION_OWNERSHIP_UNKNOWN
---

## What This Tests

The project starts without authored planning state. Native startup and hook
verification may initialize Citadel before the skill runs; that is expected.
The workload remains empty. The dashboard must show all sections and a useful
next action, which may be setup, hook verification, or starting the first task.
It must not report unknown ownership for the Citadel dashboard skill.
