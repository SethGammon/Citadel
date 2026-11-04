---
name: vague-status-phrase
skill: dashboard
description: "What's happening?" routes to the dashboard and renders correctly
tags: [fringe, routing]
input: what's happening
state: clean
assert-contains:
  - Citadel Dashboard
  - CAMPAIGNS
assert-not-contains:
  - I don't understand
  - ENOENT
  - TypeError:
  - SyntaxError:
  - at Module._compile
  - node:internal/
  - Cannot read properties of
---

## What This Tests

Users don't always say `/dashboard`. They say "what's going on", "what's happening",
"show me what's happening", etc. The `/do` router is supposed to catch these and
route to `/dashboard`.

This test verifies that a natural-language status question produces a dashboard,
not a confused response or an error.

## Expected Behavior

1. The skill recognizes the status-check intent
2. Routes to /dashboard behavior
3. Produces a complete dashboard output (same as explicit /dashboard call)
