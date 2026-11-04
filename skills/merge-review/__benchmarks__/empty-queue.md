---
name: empty-queue
skill: merge-review
description: /merge-review gives a clear message when no branches are pending
tags: [fringe, missing-state]
input: /merge-review
state: clean
assert-contains:
  - merge
assert-matches:
  - (?:no|nothing|none|empty)[^\n]{0,80}(?:pending|merge|review|queue)|(?:merge|review|queue)[^\n]{0,80}(?:empty|none|nothing|no.pending)
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - Cannot read
---

## What This Tests

A user runs `/merge-review` when no fleet agents have completed any worktrees.
The merge-check-queue.jsonl either doesn't exist or is empty.

The skill must give a helpful "nothing to do" message — not crash on the
missing file or show a confusing empty output.

## Expected Behavior

1. Detects that the queue is empty (or doesn't exist)
2. Outputs the "No pending merge reviews" message from the SKILL.md spec
3. Does not produce any error output
4. Does not attempt git commands that would fail on empty input
