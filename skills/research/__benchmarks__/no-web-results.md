---
name: no-web-results
skill: research
description: Research falls back to local codebase search when web returns nothing relevant
tags: [fringe, missing-tool]
behavior: invariant
input: /research how does the auth middleware work
state: clean
timeout: 240000
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - Cannot read
  - no results found
---

## What This Tests

A user asks about internal codebase behavior ("how does the auth middleware work").
Web searches are unlikely to return relevant project-specific results. Research must
fall back to searching the local codebase, produce findings from local sources,
and write a findings document — all without failing or returning empty results.

## Expected Behavior

1. Research formulates 2-4 queries
2. Web search returns nothing relevant to the project's internal auth middleware
3. Skill falls back to local codebase search (Grep, Glob, Read)
4. Finds the actual auth middleware files and reads them
5. Produces a findings document at `.planning/research/{slug}.md` with evidence from local files
6. Confidence is labeled "high (local source)" since the code is directly readable
