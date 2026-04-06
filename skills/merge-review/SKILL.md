---
name: merge-review
description: >-
  Reviews pending fleet worktree merges before they're accepted. Reads the
  merge-check queue, detects file-level conflicts between branches, proposes a
  safe merge order, and surfaces reconciliation plans for overlapping changes.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-26
---

# /merge-review — Fleet Merge Arbitration

## Identity

You are the merge arbitrator. You review pending worktree branches created by
fleet agents, detect conflicts between them, and propose a safe merge order.

You surface analysis — you never merge branches yourself. Final merge decisions
belong to the user or the orchestrating agent.

## When to Route Here

- "check merges"
- "any conflicts"
- "what do the fleet agents want to merge"
- "review the pending branches"
- "is it safe to merge fleet output"
- "arbitrate the worktrees"
- worktree-remove.js has queued items and the user wants to process them

## Invocation Forms

```
/merge-review              # Process the full queue
/merge-review {branch}     # Review a specific branch only
```

## Protocol

### Step 1: Read the Queue

Read `.planning/telemetry/merge-check-queue.jsonl`. Each line is a JSON object:
```json
{"branch": "fleet/task-abc", "worktree": "/path/to/worktree", "queuedAt": "ISO"}
```

If the file doesn't exist or is empty:
> "No pending merge reviews. Fleet agents haven't completed any worktrees recently."
Stop here.

If invoked with a specific branch (`/merge-review {branch}`): filter to that branch only.

### Step 2: For Each Branch — Gather Diff Data

For each pending branch:

```bash
# List changed files
git diff main..{branch} --name-only

# Change summary (additions, deletions, file count)
git diff main..{branch} --stat

# Verify the branch still exists
git branch --list {branch}
```

If the branch no longer exists (already merged or deleted):
- Remove it from the queue (mark as `status: "merged"`)
- Note it in output: "Branch `{name}` no longer exists — likely already merged. Skipped."
- Continue to next branch

### Step 3: Detect Overlapping Files

After gathering diffs for all branches, compare changed file sets pairwise.

For each pair of branches that share one or more changed files:
- This is an **overlap** — requires reconciliation
- Read the diff sections for the overlapping files from both branches:
  ```bash
  git diff main..{branch-A} -- {file}
  git diff main..{branch-B} -- {file}
  ```
- Assess the nature of the conflict:
  - **Additive**: both branches add to the file (low risk, likely auto-mergeable)
  - **Overlapping edits**: both modify the same function/section (medium risk)
  - **Contradictory**: one adds, the other removes the same code (high risk)

### Step 4: Assess Risk Per Branch

For each branch:
- **low** — no overlapping files with other branches
- **medium** — overlaps exist but changes appear additive or in different sections
- **high** — overlaps in the same function, class, or closely coupled section

### Step 5: Propose Merge Order

Order branches: fewest conflicts first, most conflicts last.

If circular dependencies exist (A conflicts with B, B conflicts with C, C conflicts
with A): escalate to the user — do not propose an impossible order.

### Step 6: Output the Report

```
## Merge Review: {N} branch(es) pending

### Branch: {name}
Files changed: {N}
Overlap with other branches: {branch-X} ({file-list}) | none
Risk: low | medium | high
Recommendation: merge | review-first | resolve-conflict

---
[repeat for each branch]
---

### Conflicts Detected

{branch-A} and {branch-B} both modified:
  - {file}: {brief description — e.g., "A adds export, B removes same export"}
Recommended resolution: {which change to keep, or how to combine them}

[repeat for each conflict pair]

### Proposed Merge Order

1. {branch} — no conflicts, safe to merge first
2. {branch} — depends on #1; review {file} after merging #1
3. {branch} — manual conflict resolution needed in {file} before merging

### Summary
Branches ready to merge: {N}
Branches needing review: {N}
Branches with hard conflicts: {N}
```

If all branches are conflict-free:
```
## Merge Review: {N} branch(es) pending — No conflicts detected

All branches can be merged in any order. Recommended order (by change size, smallest first):
1. {branch} — {N} files
2. {branch} — {N} files
```

### Step 7: Update the Queue

After producing the report, mark reviewed items in the queue:
- Branches still needing work: `status: "reviewed"`, add `reviewedAt` timestamp
- Branches no longer existing: `status: "merged"` (already handled in Step 2)

Write the updated queue back to `.planning/telemetry/merge-check-queue.jsonl`.

### Step 8: Cleanup Merged Worktrees

After updating the queue, look for any registered worktrees whose branches are
now merged into HEAD (not just branches in the queue — check all worktrees):

```bash
git worktree list --porcelain
```

For each worktree (excluding the main one):
1. Check if its branch is merged: `git branch --merged HEAD | grep "{branch}"`
2. If merged AND the worktree is clean (no uncommitted changes):
   - Run: `git worktree remove "{path}" --force`
   - Run: `git branch -d "{branch}"`
   - Report: "Cleaned up merged worktree: {branch}"

Do this automatically — merged worktrees with no uncommitted changes are
always safe to remove. No user confirmation needed.

If any worktrees are removed, note the count in the output:
```
Cleaned up {N} merged worktree(s): {branch-names}
```

This keeps the desktop and repo clean without requiring a separate /houseclean run.

---

## Fringe Cases

**Queue is empty:**
> "No pending merge reviews. Fleet agents haven't completed any worktrees recently."

**Branch no longer exists (already merged):**
Remove from queue, note in output, continue. Don't fail.

**Specific branch not in queue:**
> "Branch `{name}` is not in the merge queue. Use `/merge-review` to see all pending branches, or check if it was already merged."

**All branches conflict with each other (circular/total conflict):**
> "All {N} branches share conflicting changes. An automatic merge order cannot be determined.
> Please review each branch manually and decide which changes to keep before merging."
List all conflicts clearly. Do not propose an order.

**Only one branch pending:**
Skip the conflict detection step (nothing to compare against). Output a simplified
single-branch review: changed files, stat summary, recommendation.

**Diff is very large (>500 lines):**
Summarize rather than quoting: "Large diff ({N} lines). Key changed areas: {list of
directories or modules}. Run `git diff main..{branch} -- {file}` for details."

**Worktree path no longer exists but branch does:**
Note the missing worktree but proceed with git diff analysis using the branch name.
Worktree existence is not required for diff analysis.

---

## Integration Points

- **worktree-remove.js** — queues items to `.planning/telemetry/merge-check-queue.jsonl`
  when a fleet worktree completes. This skill processes that queue.
- **fleet skill** — `/fleet` orchestrates the worktrees. After fleet agents complete,
  run `/merge-review` before merging any output back to main.
- **session-end.js** — may surface a reminder if the merge queue has items at session end.

---

## Quality Gates

- Never merge branches — only analyze and recommend
- Always update the queue after processing (mark reviewed/merged)
- Always provide a concrete recommendation for each branch (merge / review-first / resolve-conflict)
- If a branch was already merged, clean it from the queue without error
- If all conflicts are circular/unresolvable, escalate clearly rather than proposing an impossible order

## Exit Protocol

/merge-review does not produce a HANDOFF block. It outputs the merge report (Step 6) and then
waits for the next user command.

After the report, suggest next actions based on what was found:
- If all branches are safe: "All clear. Merge in the order above."
- If conflicts exist: "Resolve the flagged conflicts before merging. Run `/merge-review` again after resolving."
- If queue is empty: "Queue is empty. Nothing to review."
