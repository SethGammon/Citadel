---
name: external-library-research
skill: research
description: Research produces structured findings with confidence levels for an external library question
tags: [happy-path]
behavior: invariant
input: /research what is the best way to handle JWT refresh tokens in 2025
state: clean
timeout: 300000
assert-contains:
  - findings
  - Confidence
  - Source
  - Recommendation
  - HANDOFF
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

A user asks a well-scoped external research question. Research must formulate
targeted queries, read credible sources, extract findings with confidence levels,
write a findings document, and return a clear recommendation.

## Expected Behavior

1. Research formulates 2-4 specific search queries (docs, community, comparison)
2. Reads 3-6 credible sources without exhaustive searching
3. Extracts findings with What/Source/Confidence/Action for each
4. Writes findings to `.planning/research/{slug}.md`
5. Returns a summary with a clear recommendation and HANDOFF block
