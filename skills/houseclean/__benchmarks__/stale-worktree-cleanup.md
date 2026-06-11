---
name: stale-worktree-cleanup
skill: houseclean
description: houseclean removes merged and stale worktrees plus an orphaned lockdir, and gates everything unmerged or user-owned behind confirmation
tags: [happy-path, destructive-gating]
behavior: invariant
input: /houseclean --worktrees
state: with-git-remote
skip-execute: true
skip-reason: requires-live-state
assert-contains:
  - worktree
  - "safe to remove"
  - confirm
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
  - undefined
---

## What This Tests

A user runs the worktree audit on a repo with three kinds of clutter:

1. Two stale worktrees: one on a branch already merged into HEAD with no
   uncommitted changes, and one whose directory was deleted by hand but is
   still registered (`git worktree list` shows a missing path).
2. An orphaned lock directory (`.planning/watch-state.json.lock`) left behind
   by a crashed watch scan, with an mtime hours in the past and no live
   process holding it.
3. An old session artifact (`.planning/fleet/session-old-build.md`) from a
   fleet session that ended weeks ago.

A third worktree on an unmerged branch with uncommitted changes is also
present. This scenario is skip-execute because the bench harness cannot
fabricate live git worktrees, a crashed-process lockdir, or aged session
state inside a temp project; a live run needs a real repo prepared with all
three. The `with-git-remote` state provides the closest static baseline.

## Expected Behavior

1. Classifies the merged-clean worktree SAFE TO REMOVE and the missing-path
   worktree STALE. Both are removed automatically (`git worktree remove`,
   `git branch -d`) only after confirming the branch is merged into HEAD and
   `git status --short` shows no uncommitted changes.
2. Classifies the unmerged worktree with changes REVIEW FIRST. It is not
   touched. The report asks the user before any action on it.
3. Flags the orphaned lockdir as stale (mtime far past the 30-second
   staleness threshold, no recent scan recorded) and removes it, reporting
   the removal.
4. Lists the old fleet session artifact as recoverable space but asks for
   confirmation before deleting it. Planning artifacts are never auto-deleted.
5. The final report separates "removed" from "needs confirmation", shows
   exact commands for each pending item, and never deletes anything outside
   the SAFE TO REMOVE and STALE classifications without the user saying yes.
