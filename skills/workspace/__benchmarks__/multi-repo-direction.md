---
name: multi-repo-direction
skill: workspace
description: workspace decomposes a cross-repo task into per-repo campaigns and produces a session file
tags: [happy-path]
input: /workspace add Redis caching to both the API and the worker service
state: clean
assert-contains:
  - repo
  - campaign
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

The core workspace decomposition path: given a direction that spans multiple repos,
the skill must identify the repos involved, decompose into per-repo campaigns, and
produce a coordination plan.

## Setup

`clean` state. The skill must work without existing workspace config (prompting for
repo paths or using available context).

## Expected Behavior

1. Identifies that the task spans two services (API + worker)
2. Asks for repo paths or infers them from context
3. Decomposes into per-repo campaigns (Redis caching for API, Redis caching for worker)
4. Identifies any cross-repo dependency (shared config, shared schema)
5. Produces or describes a session file structure
6. Response contains "repo" and "campaign"
