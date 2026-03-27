---
name: no-planning-research-dir
skill: research-fleet
description: Research-fleet creates output directory when .planning/research/ does not exist
tags: [fringe, missing-state]
input: /research-fleet what testing framework should we adopt
state: clean
skip-execute: true
timeout: 240000
assert-contains:
  - scouts
  - angle
  - findings
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
  - directory not found
  - undefined
---

## What This Tests

Research-fleet is invoked on a project where `.planning/research/` does not yet exist.
The skill must create the directory (and the `fleet-{slug}/` subdirectory) before any
scout writes its findings. Missing output directories should never cause a crash.

## Expected Behavior

1. Research-fleet decomposes the question into scout angles
2. Before deploying scouts, ensures `.planning/research/fleet-{slug}/` exists (creates it if not)
3. Scouts write their findings to the newly created directory without error
4. REPORT.md is written successfully
5. No ENOENT or "directory not found" errors appear at any point
