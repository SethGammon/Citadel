---
name: audit-and-report
skill: marshal
description: Marshal runs a full audit loop and produces a structured findings report
tags: [happy-path]
behavior: invariant
input: /marshal assess the authentication module
state: clean
assert-contains:
  - Marshal Report
  - Findings
  - Scope
  - HANDOFF
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

A user asks Marshal to assess a specific area of the codebase. Marshal must read
relevant files, produce structured findings with file and line references, and
output a clean Marshal Report — all without modifying any code.

## Expected Behavior

1. Marshal reads CLAUDE.md and identifies the auth module's location
2. Announces the chain: "I'll investigate the auth module, then synthesize findings."
3. Reads relevant files and identifies patterns, gaps, or issues
4. Produces a Marshal Report with Findings section citing specific file:line references
5. Outputs a HANDOFF block summarizing the investigation
