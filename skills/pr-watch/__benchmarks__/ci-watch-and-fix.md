---
name: ci-watch-and-fix
skill: pr-watch
description: PR-watch detects a failing CI check, reads logs, applies a targeted fix, and re-polls
tags: [happy-path]
input: /pr-watch 42
state: with-git-remote
skip-execute: true
assert-contains:
  - PR
  - repository
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - force-push
---

## What This Tests

The core happy-path flow: a PR with a failing TypeScript CI check. PR-watch must
read the failure log, identify the specific error, apply a targeted fix, push the
fix commit, and continue polling until checks pass or the circuit breaker triggers.

## Expected Behavior

1. Outputs "Watching PR #42: {title}" with branch and URL
2. Fetches CI status and finds a failing check
3. Reads the failure log and identifies the failure class (e.g., TypeScript errors)
4. Applies the minimum change to fix the failing check
5. Commits with message "fix: resolve CI failure — {check-name}" and pushes
6. Waits for CI to re-run and reports updated status
