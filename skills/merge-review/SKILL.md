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

## Orientation

**Use when:** reviewing pending fleet worktree merges before accepting them into the main branch.
**Don't use when:** reviewing general code quality (use /review); checking CI status before merging (use /pr-watch).

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

Run `git diff main..{branch} --name-only`, `--stat`, and `git branch --list {branch}`.

If the branch no longer exists: mark `status: "merged"`, note "likely already merged. Skipped.", continue.

### Step 3: Detect Overlapping Files

Compare changed file sets pairwise. For each pair sharing files, read `git diff main..{branch} -- {file}` for both and classify:
- **Additive**: both add to the file (low risk, likely auto-mergeable)
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

Run `git worktree list --porcelain`. For each non-main worktree: check `git branch --merged HEAD`. If merged and clean: run `git worktree remove "{path}" --force` and `git branch -d "{branch}"`. No user confirmation needed. Report count: "Cleaned up {N} merged worktree(s): {branch-names}".

---

## Fringe Cases

**Queue empty:** Output "No pending merge reviews." and stop.

**Branch no longer exists:** Remove from queue, note, continue.

**Branch not in queue:** Note "not in the merge queue" and suggest `/merge-review` to see all.

**All branches conflict (circular):** List all conflicts; do not propose an order; escalate to user.

**One branch pending:** Skip conflict detection; output single-branch review (files, stat, recommendation).

**Large diff (>500 lines):** Summarize changed areas; link to `git diff` command for details.

**Worktree path missing but branch exists:** Proceed with git diff using branch name; worktree existence not required.

---

## Integration Points

- **worktree-remove.js** — queues items to `.planning/telemetry/merge-check-queue.jsonl` when a fleet worktree completes
- **fleet skill** — run `/merge-review` after fleet agents complete, before merging to main
- **session-end.js** — may surface a reminder if the merge queue has items at session end

## Contextual Gates

**Disclosure:** "Reviewing pending fleet worktree merges. Read-only — no changes applied."
**Reversibility:** green — read-only review; no files merged or modified
**Trust gates:**
- Any: view merge review report and recommendations

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
