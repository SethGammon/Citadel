---
name: no-gh-auth
skill: pr-watch
description: PR-watch exits with auth instructions when gh CLI is not authenticated
tags: [fringe, missing-tool]
input: /pr-watch 1
state: with-git-remote
assert-contains:
  - gh
  - auth
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - unhandled
  - crashed
---

## What This Tests

A user runs `/pr-watch 1` but the `gh` CLI is not authenticated (or not installed).
The skill must detect the auth failure, output clear instructions for fixing it,
and exit cleanly without producing a raw error dump.

## Expected Behavior

1. Skill attempts to run `gh pr view` or equivalent
2. Detects the authentication failure (exit code non-zero or auth error message)
3. Outputs: "gh CLI is not authenticated. Run: `gh auth login` and follow the prompts."
4. Optionally notes the install URL if gh is not found at all
5. Exits cleanly — no stack traces or raw error output
