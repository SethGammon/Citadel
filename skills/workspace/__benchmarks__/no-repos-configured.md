---
name: no-repos-configured
skill: workspace
description: workspace asks for repo configuration when no workspace is set up
tags: [fringe, missing-state]
input: /workspace
state: clean
assert-contains:
  - repo
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

Workspace invoked with no arguments and no prior configuration. Must ask the user
for repo paths or explain setup — must not crash or produce an empty response.

## Setup

`clean` state: no `.planning/workspace/` directory, no workspace config.

## Expected Behavior

1. Detects no workspace configuration
2. Asks the user to provide repo paths or describes the setup process
3. Does not crash or silently exit
4. Response contains "repo"
