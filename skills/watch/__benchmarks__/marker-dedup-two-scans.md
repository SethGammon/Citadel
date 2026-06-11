---
name: marker-dedup-two-scans
skill: watch
description: watch scan creates exactly one intake item per unique marker and re-scanning produces no duplicates (the dedup quality gate)
tags: [happy-path, dedup]
behavior: invariant
input: Run /watch scan, then run /watch scan again with no file changes in between, and report how many intake items exist for each marker.
state: with-git-remote
skip-execute: true
skip-reason: requires-live-state
assert-contains:
  - marker
  - intake
  - scan
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
  - undefined
---

## What This Tests

The watch dedup quality gate: one intake item per unique marker, across
scans. The repo contains two source files with `@citadel:` marker comments
committed after the watch baseline:

- `src/auth.ts` with `// @citadel: todo tighten token expiry checks`
- `src/api.py` with `# @citadel: todo add request logging`

The user runs `/watch scan` twice in a row with no file changes between the
scans. This scenario is skip-execute because it needs live state the bench
harness cannot set up in a single --print invocation: a git repo with a
baseline commit, marker files committed on top of it, and two sequential
scan runs sharing `.planning/watch-state.json`. The `with-git-remote` state
provides the closest static baseline.

## Expected Behavior

1. Scan 1 detects both changed files via `git diff --name-only
   {lastScanCommit} HEAD` and finds both markers.
2. Each marker gets a stable identity hash (file path + action + normalized
   text, line numbers excluded) and exactly one intake item is written to
   `.planning/intake/`, with the `marker_hash` recorded in its frontmatter
   and in `processedMarkers`.
3. Scan 2 finds zero new markers: both hashes are already in
   `processedMarkers`, so no skill dispatch and no intake write occurs.
4. After both scans, `.planning/intake/` contains exactly two watch-sourced
   items, one per unique marker. No duplicates, even though the marker lines
   are still present in the files.
5. State is updated on both scans (`lastScanTime`, `stats.scansRun`), and
   the scan reports show 2 markers found on scan 1 and 0 new on scan 2.
