---
name: gh-not-available
skill: pr-watch
description: /pr-watch gives a clear message when gh CLI is not installed
tags: [fringe, missing-tool]
input: /pr-watch 42
state: with-git-remote
assert-contains:
  - gh
assert-not-contains:
  - TypeError
  - spawn
  - undefined
---

## What This Tests

A user who hasn't installed the GitHub CLI (`gh`) tries to use `/pr-watch`.
The skill checks for gh in Phase 0 (Setup) and should give a helpful
installation message — not produce an opaque "spawn gh ENOENT" error.

In the benchmark test environment, gh is likely not configured with a
real token, so this scenario can be used to verify graceful degradation
even in environments where gh exists but isn't authenticated.

## Expected Behavior

1. Detects gh is unavailable or unauthenticated (Phase 0 check)
2. Outputs a clear message: "gh CLI not found" or "gh not authenticated"
3. Provides installation / auth instructions
4. Does not proceed to watch mode and fail confusingly
