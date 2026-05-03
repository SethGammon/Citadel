---
name: experiment
description: >-
  Automated optimization loop with scalar fitness function. Proposes changes in
  isolated worktrees, measures with a metric command, keeps improvements, discards
  failures. Supports convergence detection and diminishing returns.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-21
---

# /experiment — Metric-Driven Optimization Loop

## Identity

/experiment is an automated optimization loop with a scalar fitness function.
It takes a hypothesis, runs isolated experiments in git worktrees, measures results
with a metric command, and keeps improvements or discards failures. Think of it as
automated A/B testing for code changes.

## Inputs

The user provides three things:
1. **scope**: Files to modify (glob pattern, e.g., "src/api/**/*.ts")
2. **metric**: Shell command that outputs a single number (e.g., `npm run build 2>&1 | tail -1 | grep -oP '\d+'`)
3. **budget**: Iteration cap (default: 5) or time cap (e.g., "10 minutes")

If any input is missing, ask for it. The metric MUST output a single number to stdout.

## Protocol

### Step 1: BASELINE

1. Stash any uncommitted changes (restore on exit)
2. Run the metric command. Record the baseline value.
3. Determine direction: does lower = better (bundle size, error count) or higher = better (FPS, test count)?
   Ask the user if ambiguous.
4. Log: `Baseline: {value} ({metric command})`

### Step 2: ITERATE

For each iteration (up to budget):

1. **Create isolation**: Spawn a sub-agent in a worktree (`isolation: "worktree"`)
2. **Propose change**: The agent modifies files within scope to improve the metric.
   Provide context: baseline value, metric direction, scope, what previous iterations tried.
3. **Measure**: Run the metric command in the worktree (via `node scripts/run-with-timeout.js 300`)
4. **Gate**: Run typecheck (also via timeout wrapper). If it fails, discard immediately.
5. **Evaluate**:
   - Improved? → KEEP. Merge the worktree branch. New baseline = new value.
   - Same or worse? → DISCARD. Delete the worktree.
6. **Log iteration**:
   ```
   Iteration {N}: {value} ({delta from baseline}) → {KEEP|DISCARD}
   Change: {one-line description of what was tried}
   ```

### Step 3: CONVERGENCE CHECK

After each iteration, check:
- **Local optimum**: Last 3 iterations all discarded → stop ("no more improvements found")
- **Diminishing returns**: Last kept improvement was < 0.5% → stop ("diminishing returns")
- **Budget exhausted**: Iteration count or time exceeded → stop

### Step 4: REPORT

Write results to `.planning/research/experiment-{slug}.md`:

```
# Experiment: {Description}

> Metric: `{command}`
> Direction: {lower|higher} is better
> Scope: {glob pattern}
> Budget: {N iterations}
> Date: {ISO date}

## Results

| Iteration | Value | Delta | Verdict | Change |
|-----------|-------|-------|---------|--------|
| baseline  | {N}   | —     | —       | —      |
| 1         | {N}   | {+/-} | KEEP    | {desc} |
| 2         | {N}   | {+/-} | DISCARD | {desc} |

## Outcome
- **Start**: {baseline}
- **End**: {final value}
- **Improvement**: {percentage}
- **Iterations**: {kept}/{total}
- **Stop reason**: {convergence|diminishing|budget}

## Kept Changes
{List of changes that were kept, with commit hashes}
```

Also log to `.planning/telemetry/agent-runs.jsonl`:
```json
{"event":"experiment-complete","slug":"{slug}","baseline":0,"final":0,"improvement":"0%","kept":0,"total":0,"timestamp":"ISO"}
```

## Common Metrics

| Goal | Metric Command |
|------|---------------|
| Reduce bundle size | `npm run build 2>&1 \| grep -oP 'Total size: \K\d+'` |
| Reduce type errors | `npx tsc --noEmit 2>&1 \| grep -c 'error TS'` |
| Increase test pass rate | `npm test 2>&1 \| grep -oP '\d+ passing'` |
| Reduce file count | `find src -name '*.ts' \| wc -l` |
| Reduce line count | `wc -l src/**/*.ts \| tail -1 \| awk '{print $1}'` |

## When to Use

- When you want to optimize a measurable metric (bundle size, error count, test coverage, FPS)
- When you have a clear hypothesis but aren't sure which of several approaches wins
- When manual A/B testing would be too slow or error-prone
- NOT when the goal is subjective ("make it feel better") — the metric must be a number

## Safety Rules

- NEVER modify files outside scope
- ALWAYS use worktree isolation for changes
- ALWAYS run typecheck before keeping a change
- Restore stashed changes on exit (even on error)
- If the metric command fails, treat as DISCARD (not crash)

## Contextual Gates

**Disclosure:** "Running experiment loop on [target] with fitness: [function]. Each iteration commits. Budget: [N iterations]."
**Reversibility:** amber — modifies source files across iterations; each iteration is committed; undo with `git revert` on kept commits.
**Trust gates:**
- Familiar (5+ sessions): iterates and commits autonomously; novices should use /improve with manual review between steps.

## Quality Gates

- Baseline was measured before any iterations ran
- Every kept iteration improved the metric AND passed typecheck
- Every discarded iteration has a logged reason
- The stop reason is one of: convergence, diminishing returns, or budget exhausted
- The experiment report exists at `.planning/research/experiment-{slug}.md` with all iteration rows filled

## Fringe Cases

**Metric command outputs nothing or non-numeric text**: Treat as a metric failure. Ask the user to provide a command that outputs a single number to stdout before starting iterations.

**No worktree support** (e.g., shallow clone): Fall back to branch isolation. Create a branch, run changes there, measure, then delete or merge the branch. Never modify the working tree directly.

**If .planning/research/ does not exist**: Create it before writing the experiment report. If `.planning/` itself doesn't exist, create the full path or output the report inline.

**Budget exhausted with zero kept iterations**: Report outcome as "no improvement found". This is a valid result — do not continue past the budget.

## Exit Protocol

```
---HANDOFF---
- Experiment: {description}
- Result: {baseline} → {final} ({improvement}%)
- Kept: {N}/{total} iterations
- Stop reason: {reason}
- Report: .planning/research/experiment-{slug}.md
- Reversibility: amber — undo kept iterations with `git revert` on each kept commit
---
```
