---
name: decompose-angles
skill: research-fleet
description: Research-fleet spawns scouts across multiple angles and produces a unified REPORT
tags: [happy-path]
input: /research-fleet should we use Redis or Postgres for session storage
state: clean
skip-execute: true
assert-contains:
  - scouts
  - REPORT
  - Recommendation
  - Consensus
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - Cannot read
---

## What This Tests

The core research-fleet flow: a question with multiple independent angles (performance,
operational complexity, consistency, community). The skill must decompose into scouts,
run them in parallel, compress findings, and produce a unified REPORT with a recommendation.

## Expected Behavior

1. Decomposes "Redis vs Postgres for session storage" into 3-4 independent angles
2. Deploys one scout per angle using Fleet wave mechanics
3. Each scout produces a findings document in `.planning/research/fleet-{slug}/`
4. Findings are compressed into a unified brief after Wave 1
5. Final REPORT.md is written with Consensus Findings, any Conflicts, and a Recommendation
6. HANDOFF includes the report path and one-line recommendation
