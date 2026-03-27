---
name: parallel-wave-execution
skill: fleet
description: Fleet decomposes direction into waves and executes agents with discovery relay
tags: [happy-path]
input: /fleet refactor the API layer and update the frontend in parallel
state: with-fleet-session
skip-execute: true
assert-contains:
  - Wave
  - agent
  - discovery
  - HANDOFF
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - overlap
---

## What This Tests

A user provides a direction that naturally decomposes into two independent streams
(API layer and frontend). Fleet must identify the scope separation, assign agents
to Wave 1, collect their discoveries, and relay findings before completing.

## Expected Behavior

1. Fleet decomposes the direction into 2+ independent streams with no scope overlap
2. Wave 1 agents are spawned with full context injection
3. After Wave 1 completes, discoveries are compressed and relayed
4. Session file is updated with wave results
5. Final HANDOFF summarizes what each agent built and any cross-agent discoveries
