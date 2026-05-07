---
name: visual-verify-pass
skill: live-preview
description: Live-preview captures screenshots and reports PASS for a correctly rendering component
tags: [happy-path]
behavior: invariant
input: /live-preview
state: with-campaign
skip-execute: true
skip-reason: requires-playwright
assert-contains:
  - screenshot
  - PASS
  - route
  - verified
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - BLANK
---

## What This Tests

A mid-campaign invocation where view-layer files were modified and the dev server
is running. Live-preview must identify the affected routes, take screenshots, verify
they render correctly, and save artifacts to `.planning/screenshots/`.

## Expected Behavior

1. Detects which view-layer files were modified in the current phase
2. Maps modified files to routes
3. Takes screenshots using Playwright
4. Reads each screenshot and verifies it is not blank
5. Outputs a verification summary table with PASS results
6. Screenshots are saved as artifacts to `.planning/screenshots/`
