---
name: no-playwright
skill: qa
description: qa gracefully handles missing Playwright with an install message rather than crashing
tags: [fringe, missing-state]
input: /qa
state: clean
assert-contains:
  - Playwright
assert-matches:
  - install|setup|set.up|URL|server
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
  - Cannot read
---

## What This Tests

A user runs `/qa` on a clean project where Playwright is not installed. The skill
must detect the missing dependency and output a helpful install message or gracefully
skip, rather than crashing with a module-not-found error.

## Expected Behavior

1. Detects that Playwright is not installed (or not configured)
2. Outputs a message referencing Playwright
3. Suggests an install command or next step
4. Does not crash with a raw module error
5. No raw error output
