---
name: experiment
license: MIT
description: >-
  Automated optimization loop with scalar fitness function. Proposes changes in
  isolated worktrees, measures against a fixed baseline, and retains verified
  candidates locally. Supports convergence detection and diminishing returns.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - experiment
  - optimize
  - try
  - A/B
  - measure
last-updated: 2026-10-15
---

# /experiment — Metric-Driven Optimization Loop

## Identity

Coordinate bounded metric-driven experiments in isolated checkouts, retaining
candidates locally until the declared verification and independent review pass.

## Orientation

### When to Use

- When you want to optimize a measurable metric (bundle size, error count, test coverage, FPS)
- When you have a clear hypothesis but aren't sure which of several approaches wins
- When manual A/B testing would be too slow or error-prone
- NOT when the goal is subjective ("make it feel better") — the metric must be a number

### Inputs

The user provides three things:
1. **scope**: Files to modify (glob pattern, e.g., "src/api/**/*.ts")
2. **metric**: Project command that outputs a single number (e.g., `node tools/bundle-bytes.cjs`)
3. **budget**: Iteration cap (default: 5) or time cap (e.g., "10 minutes")

Ask only for missing inputs that cannot be resolved from the request or project.
The metric MUST exit successfully and output a single finite number to stdout.

## Protocol

### Step 1: BASELINE

1. Read project instructions and inspect the checkout, index, untracked files,
   and active worktrees. Record the source commit and dirty-file hashes/status.
   Leave user work in place: never stash, reset, clean, switch branches, or commit
   unrelated changes to make an experiment possible.
2. Create a dedicated worktree at an explicit commit, or a separate local clone
   at that commit. Verify its path, HEAD, and clean status before running commands.
   If the requested baseline includes authorized working changes, copy only those
   changes into the isolated checkout, preserving deletions and file contents;
   verify their hashes and commit the snapshot there. Leave the original index and
   files untouched. If the intended snapshot is unclear, clarify before copying.
3. Before iterations, write the evaluation plan in the experiment report: source
   and snapshot commits, allowed source scope, metric command and direction,
   timeout, repeat/noise policy, and required typecheck, regression and behavioral
   checks. Record any inapplicable check and its reason now, not after a failure.
   Ask about direction only if ambiguous. A scalar is a proxy, not acceptance.
4. Freeze the evaluator: record hashes for the metric implementation, test
   assertions, fixtures/expected outputs, and relevant command/config files.
   These are outside candidate edit scope, even if a broad glob includes them.
   Keep the original incumbent commit, evaluator and plan fixed for the run.
5. Measure the baseline and run the declared checks in isolation. Record commands,
   exit codes, values and evidence paths. An invalid baseline or required-check
   failure holds optimization until resolved; do not silently waive the check.

Run commands from the intended isolated checkout. Bind `CLAUDE_PROJECT_DIR` for
each child process to that checkout so timeout/telemetry helpers cannot write into
the user's source checkout. Use the installed timeout helper (in Citadel itself,
`node scripts/run-with-timeout.js 300 <command> [args...]`).

### Step 2: ITERATE

For each iteration (up to budget):

1. **Create isolation**: Use a fresh worktree/clone from the original incumbent or
   the last verified retained candidate; record that parent commit. Give the worker
   the fixed plan, scope, evaluator exclusions and previous attempts. Verify actual
   isolation rather than relying on a branch name or a spawn option alone.
2. **Propose change**: Modify only allowed source files. Never change the metric,
   tests, expected outputs, exclusions or thresholds to earn a pass. If the
   evaluator needs repair, stop this run and establish a new baseline and plan.
3. **Inspect and measure**: Check the full diff and evaluator hashes first. Reject
   scope violations or evaluator changes, even if they improve the number. Run the
   unchanged metric and declared checks with bounded timeouts and the same setup
   as the incumbent. Keep raw results, candidate commit and evaluator identity.
4. **Review**: For an improving candidate, obtain independent review of the exact
   diff, scope, behavior/regressions and evidence. The proposer cannot approve its
   own result. A summary-only HANDOFF check is insufficient. Review unavailability,
   stale evidence, timeout or an incomplete required check means HELD, not passed.
5. **Decide**:
   - **KEEP**: Improved under the declared repeat/noise policy, with every required
     check and independent review passed for this exact candidate. Retain its local
     commit; it may seed the next iteration. Do not merge into the user's checkout.
   - **DISCARD**: Same/worse, failed required check, scope violation or evaluator
     tampering. Log why; preserve evidence before removing only experiment-owned
     disposable worktrees. Never clean another agent's or the user's worktree.
   - **HELD**: Missing/unknown evidence or review. Preserve the local candidate and
     reason; it cannot seed a subsequent iteration or authorize promotion.
6. **Log**: Record value, delta against both the original baseline and the previous
   retained best, verdict, change, commit, required-check results and review evidence.

Promotion is separate from KEEP. Only after all gates pass may an already
authorized local integration proceed into a safe, clean destination. Recheck the
resulting integration subject with the declared checks and independent review if
its content differs. Otherwise leave the candidate local and report the held gate.
Never push, publish, or overwrite dirty work as part of the optimization loop.

### Step 3: CONVERGENCE CHECK

After each iteration, check:
- **Local optimum**: Last 3 iterations all discarded → stop ("no more improvements found")
- **Diminishing returns**: Last kept improvement was < 0.5% → stop ("diminishing returns")
- **Budget exhausted**: Iteration count or time exceeded → stop
- **Held gate**: Required evidence or isolation unavailable → stop and report it;
  do not count a held candidate as an accepted improvement

Calculate diminishing returns against the previous retained best. Keep reporting
overall improvement against the original baseline; never replace that baseline.
For a zero baseline, report absolute delta instead of dividing by zero.

### Step 4: REPORT

Create and update `.planning/research/experiment-{unique-slug}.md` in the isolated
run checkout; do not overwrite another run's report. Include the frozen plan and
identities from Step 1, followed by:

```
# Experiment: {Description}

> Metric: `{command}`
> Direction: {lower|higher} is better
> Scope: {glob pattern}
> Budget: {N iterations}
> Date: {ISO date}
> Original incumbent: {commit and evaluator hashes}
> Checks: {commands, acceptance conditions, repeat/noise policy}

## Results

| Iteration / Commit | Value | Delta from original / best | Verdict | Checks / Review / Evidence |
|--------------------|-------|----------------------------|---------|----------------------------|
| baseline / {sha}   | {N}   | —                          | —       | {paths}                    |
| 1 / {sha}          | {N}   | {+/-} / {+/-}              | KEEP    | {paths}                    |
| 2 / {sha}          | {N}   | {+/-} / {+/-}              | HELD    | {reason and paths}         |

## Outcome
- **Start**: {baseline}
- **Best verified local candidate**: {value and commit, or none}
- **Improvement**: {percentage}
- **Iterations**: {kept}/{total}; held: {N}
- **Stop reason**: {convergence|diminishing|budget|held gate}
- **Integration**: {not attempted|held with reason|verified target commit}
- **Source checkout preservation**: {before/after dirty-file hashes and index/status comparison}

## Retained Local Changes
{Changes, commit hashes, checkout paths, and any unresolved gates}
```

Log the run through the existing integrity-aware telemetry writer, with the
isolated run checkout as `CLAUDE_PROJECT_DIR`:
```text
node .citadel/scripts/telemetry-log.cjs --event agent-complete --agent experiment --session {slug} --status {success|partial|failed}
```
In Citadel itself use `scripts/telemetry-log.cjs`. Put detailed results in the
report; use `partial` for held gates. The writer supplies `_hash` and `_hash_v: 1`.
If unavailable, report that limitation; never append raw JSONL or fabricate hashes.

## Common Metrics

| Goal | Numeric output from the project metric command |
|------|-----------------------------------------------|
| Reduce bundle size | Built bundle bytes; a failed build is a failed measurement |
| Increase throughput | Operations per second under the fixed workload |
| Reduce latency | A predeclared percentile in milliseconds |
| Reduce file/line count | Count within a fixed scope, with behavioral checks retained |

## Safety Rules

- Source edits stay within scope; reports and telemetry use only owned run paths.
- Preserve user files, index and active work; verify preservation again on exit.
- Use actual isolated checkouts, a fixed evaluator and predeclared required checks.
- Failed or unknown checks never authorize KEEP, integration or terminal success.
- If a candidate metric fails, record DISCARD; never infer a value from failed output.

## Contextual Gates

**Disclosure:** "Running isolated experiment on [target] from [commit], with metric [command] and checks [plan]. Budget: [N]. Verified candidates remain local until integration gates pass."
**Reversibility:** amber — experiment-owned local commits/checkouts are retained with evidence; the source checkout stays intact.
**Trust gates:**
- Proceed within existing authorization for local work; do not request it again.
  Trust level never waives isolation, frozen evaluation, review or required checks.

## Quality Gates

- Original incumbent, evaluator identities and acceptance plan were fixed before iterations.
- Every KEEP has an improved metric, full required passed checks and independent review on the exact candidate.
- Every DISCARD/HELD has a reason; missing, stale or malformed evidence is never a pass.
- Any integration has current passed evidence for the resulting subject (Constitution P-008).
- Report includes all iteration evidence, retained paths, stop reason and source preservation check.

## Fringe Cases

**Metric outputs nothing, non-numeric text, NaN/infinity, or exits nonzero**:
Invalid measurement. Resolve the baseline command before starting; discard a
candidate measurement failure. Pipelines must preserve the measured command's
failure status rather than hiding it behind a successful text filter.

**No worktree support**: Use a separate clean local clone at the recorded commit.
A branch in the same checkout is not isolation. If neither is possible, stop as
held and provide the plan; do not edit the source checkout.

**If .planning/research/ does not exist**: Create it before writing the experiment report. If `.planning/` itself doesn't exist, create the full path or output the report inline.

**Budget exhausted with zero kept iterations**: Report outcome as "no improvement found". This is a valid result — do not continue past the budget.

## Exit Protocol

```
---HANDOFF---
- Experiment: {description}
- Result: {original baseline} → {best verified local value}; retained {N}/{total}
- Gates / integration: {passed, held or failed; target commit if integrated}
- Stop reason / report: {reason}; {isolated report path}
- Preservation / recovery: {source hashes unchanged or observed discrepancy}; {retained local commits and paths}
---
```
