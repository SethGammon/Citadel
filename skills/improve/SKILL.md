---
name: improve
description: >-
  Autonomous quality improvement loop. Scores a target against a rubric, selects
  the highest-leverage axis, attacks it, verifies, documents, and loops. No
  pre-planning between iterations — each loop re-scores from scratch.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-28
---

# /improve — Autonomous Quality Engine

## Orientation

**Use when:** Scoring a target against a rubric and iteratively improving it. The target must have (or need) a rubric at `.planning/rubrics/{target}.md`.

**Don't use when:** Refactoring code without a quality rubric (use `/refactor`), doing a one-time code review (use `/review`), or debugging a specific bug (use `/systematic-debugging`).

## Invocation

```
/improve {target}            # Loop until plateau or all axes >= 8.0
/improve {target} --n=3      # Run exactly N loops then stop
/improve {target} --axis={name}  # Force-attack a specific axis (skips scoring)
/improve {target} --score-only   # Score and report, no attack
/improve {target} --continue     # Resume from campaign state (used by daemon)
/improve citadel             # Targets the entire Citadel product
```

`target` is a slug that maps to `.planning/rubrics/{target}.md`.
If no rubric exists, run Phase 0 first.

---

## Campaign Mode

When invoked with `--n` or `--continue`, improve operates in **campaign mode** and
maintains a campaign file that daemon can attach to.

### Campaign file: `.planning/campaigns/improve-{target}.md`

Created automatically on the first invocation with `--n`. Format:

```markdown
---
version: 1
id: "improve-{target}-{ISO-date-slug}"
status: active
type: improve
target: {target}
total_loops: {n or "unlimited"}
completed_loops: 0
current_level: {rubric level from frontmatter}
estimated_cost_per_loop: 12
started: "{ISO timestamp}"
---

# Campaign: Improve {target}

Status: active
Direction: Improve {target} for {n} loops at Level {level}

## Loop History

| Loop | Axis Attacked | Outcome | Score Movement |
|------|---------------|---------|----------------|
(populated after each loop)

## Continuation State

next_loop: 1
last_scorecard_log: (none)
last_outcome: (none)
phase_within_loop: not-started
level_up_triggered: false
```

### Campaign lifecycle

Update `phase_within_loop` at each phase: `scoring` → `selected-{axis}` → `attacking-{axis}` → `verifying` → `not-started`.

On loop complete: increment `completed_loops`, update `next_loop`/`last_scorecard_log`/`last_outcome`, append Loop History row.

Status transitions: all loops done → `completed` (move to `completed/`) | level-up → `level-up-pending` | abort → `parked` | user stopped → `paused`.

### The `--continue` flag

1. Read `.planning/campaigns/improve-{target}.md` — error if missing or `status` not `active`
2. If `completed_loops >= total_loops`: mark completed, exit
3. If `phase_within_loop` is not `not-started`: restart current loop from Phase 1 (interrupted mid-loop)
4. Load `last_scorecard_log` for delta comparison, then run Phase 1 onwards

## Protocol

### Phase 0: Rubric Bootstrap (one-time, requires human approval)

Run only when `.planning/rubrics/{target}.md` does not exist.

1. Read competitive research from `.planning/research/` if available
2. Spawn `/research-fleet` to survey comparable products if no research exists
3. Draft 8-14 axes organized into 3-5 categories, each with:
   - Weight (0.0–1.0), Category, three anchors (0/5/10), verification specs (programmatic/structural/perceptual), research inputs
4. Present draft rubric to the user with rationale for each axis
5. **STOP. Do not proceed until the user approves the rubric.**
6. Write approved rubric to `.planning/rubrics/{target}.md`

For Citadel: rubric exists at `.planning/rubrics/citadel.md`. Skip Phase 0.

---

### Phase 1: Score

Score every axis in the rubric. No shortcuts. No cached scores from the previous loop.

#### 1a. Programmatic checks (run first, in parallel)

Execute the programmatic verification steps from the rubric. A programmatic failure caps that axis at 5 regardless of evaluator scores. Record raw results: which checks passed, which failed, what the failure was.

#### 1b. Structural analysis

Execute structural checks from each axis's verification spec:
- File path verification (do referenced files exist?)
- Schema consistency (do all skills have identical frontmatter fields?)
- Coverage ratios (what percentage of skills have benchmark scenarios?)
- Link rot (do all internal doc links resolve?)
- Cross-reference accuracy (do docs match current source?)

#### 1c. Perceptual scoring panel (three independent evaluators)

Spawn three evaluator agents in parallel. Each receives:
- The rubric with all axis definitions and anchors
- Read access to the target (repo files, demo page screenshots if applicable)
- Their persona (A/B/C as defined in the rubric's Scoring Protocol)
- Instruction: score every axis 0-10 with a one-sentence justification per axis

Each evaluator scores independently. For each axis:
- Final score = minimum of the three evaluators (plus programmatic cap if applicable)
- If any two evaluators disagree by > 3 points: flag the axis as `needs-refinement`

`needs-refinement` axes are logged but still scored. Do not halt on evaluator disagreement.

#### 1d. Compile scorecard

```
Axis        | A   | B   | C   | Prog      | Final | Delta  | Flag
------------|-----|-----|-----|-----------|-------|--------|-----
{axis_name} | {n} | {n} | {n} | PASS/FAIL | {n.n} | +{n.n} | cap
```

Final = min(A, B, C), then apply programmatic cap (sets Flag=cap). Delta = current − prior loop score (empty on loop 1).

---

### Phase 2: Select

Choose the single axis to attack this loop.

**Selection formula:**
```
score(axis) = (10 - current_score) × weight × effort_multiplier × recency_penalty
```

- `effort_multiplier`: low = 1.0, medium = 0.7, high = 0.4
- `recency_penalty`: 0.5 if attacked in previous 2 loops, otherwise 1.0
- Effort tiers: **low** < 1hr, **medium** 1-3hrs, **high** 3+hrs

If `--axis` flag was set, skip selection and attack the specified axis.

Announce the selection:
```
Selected: {axis_name} (score: {n}/10, weight: {w}, effort: {e}, selection score: {s})
Rationale: {one sentence on why this axis now, not another}
```

---

### Phase 3: Attack

Execute the improvement. Dispatch strategy depends on the axis category.

**ISOLATION MANDATE:** When dispatching to `/experiment`, `/fleet`, or `/research-fleet`, always use the Agent tool with `isolation: "worktree"`. Sub-agents in worktrees get their own context windows; the orchestrator only receives their HANDOFF results.

**technical axes** (test_coverage, hook_reliability, api_surface_consistency):
- Spawn `/experiment` for measurable improvements with before/after comparison
- Use speculative worktrees for approaches that might conflict (Agent + isolation: "worktree")
- Run `node scripts/run-with-timeout.js 300 node scripts/test-all.js` as the verification oracle

**documentation axes** (documentation_coverage, documentation_accuracy):
- Direct: read current docs, identify specific gaps or inaccuracies, rewrite them
- For coverage gaps: draft new sections, get structural verification before committing
- For accuracy gaps: cross-reference every claim against source, fix discrepancies

**experience axes** (onboarding_friction, error_recovery, command_discoverability):
- Combination: structural fixes (code, config) + documentation updates + /qa verification
- For onboarding: run the actual install flow in a clean temp dir, fix what breaks
- For error paths: inject synthetic failures per the programmatic spec, improve messages

**positioning axes** (differentiation_clarity, competitive_feature_coverage):
- Start with `/research` to verify current competitive landscape is accurate
- Then update README, FAQ, or demo page copy; /qa to verify the updated page renders

**presentation axes** (demo_page_effectiveness, readme_quality, visual_coherence):
- Read current state, identify specific structural gaps per the rubric anchors
- Make targeted changes (not rewrites unless the score is below 3)
- `/live-preview` or `/qa` to verify visual changes render correctly

**security axes** (security_posture):
- Read the specific hooks/scripts involved
- Make targeted code changes
- Run the programmatic verification steps from the rubric directly to confirm fix

#### Artifact archiving

When the attack involves trying multiple approaches:
- Write a decision record to the loop log: why the winner won
- Format: `APPROACH COMPARISON: [approach A] vs [approach B] — winner: [A] because [reason]`

---

### Phase 4: Verify

After the attack, re-score only the targeted axis (not full re-score).

Run the four verification tiers from the rubric for the targeted axis:
1. **Programmatic**: execute the specific checks, confirm they now pass
2. **Structural**: verify the structural requirements are met
3. **Perceptual**: spawn a single evaluator agent (Evaluator B — Newcomer) and score just the targeted axis
4. **Behavioral simulation**: clone the repo into a temp directory and follow QUICKSTART.md exactly as written — no prior knowledge, no shortcuts. Measure whether each step completes without error and record wall time to first successful `/do` command.
   - Required when targeted axis is: `onboarding_friction`, `error_recovery`, `documentation_accuracy`, `command_discoverability`
   - Optional for all other axes
   - Result: `PASS {wall_time}` or `FAIL at step {n}: {what broke}`
   - **A behavioral FAIL overrides a passing perceptual score.** Do not commit on behavioral FAIL.
   - Skip only if the targeted axis could not plausibly affect the user path (e.g., `visual_coherence`, `api_surface_consistency`)

**Regression check** (run on all axes, not just targeted):
- Re-run programmatic checks on every axis that shares files with the changes
- If any previously passing axis now fails programmatic: **abort, do not commit**
- If perceptual estimate suggests any axis dropped > 0.5 from baseline: **abort, do not commit**

On abort: revert the changes, log the failure, treat as "no improvement this loop".

On pass: commit the changes with a descriptive message.

---

### Phase 5: Document

Write the loop log. Always. Even on abort.

**Log path:** `.planning/improvement-logs/{target}/loop-{n}.md`

```markdown
# Improvement Loop {n}: {target}

> Date: {ISO date} | Loop: {n} | Selected axis: {axis_name} | Outcome: improved | no-change | aborted

## Scorecard
| Axis | Loop {n-1} | Loop {n} | Delta |

## Attack summary
**What was changed:** ...  **Approach:** experiment / direct / research+update  **Files:** ...
**APPROACH COMPARISON:** (if multiple tried) {A} vs {B} — winner: {A} because {reason}

## Verification results
**Programmatic:** PASS/FAIL  **Structural:** PASS/FAIL
**Perceptual:** {score}/10 — {one-line rationale}
**Behavioral:** PASS {wall_time} | FAIL at step {n}: {reason} | SKIPPED

## Proposed axis additions
PROPOSED AXIS: {name} | Rationale | Category | Weight | Anchors: 0=... 5=... 10=...
(or: None proposed this loop.)

## What was learned
{2-3 sentences}
```

All proposals go to `.planning/rubrics/{target}-proposals.md`. Never to the live rubric.

---

### Phase 6: Loop or Exit

**Exit conditions (check in order):**

1. `--n` flag was set and N loops have completed: exit, report scorecard
2. All axes >= 8.0: exit with "target has reached quality ceiling"
3. No axis improved > 0.5 in either of the last 2 loops AND no programmatic cap is active AND at least 3 loops have completed: **trigger Level-Up Protocol**
4. The user said stop: exit immediately

**On Level-Up**: do not exit. Escalate. See Level-Up Protocol section.

**On ceiling (all >= 8.0)**: report the final scorecard and recommend a Level-Up run.

**On normal loop**: return to Phase 1. Re-score everything from scratch.

**Campaign mode exit handling:**

- **n-complete** (all loops done): set `status: completed`, move to `completed/`
- **ceiling** (all axes >= 8.0): set `status: completed`, move to `completed/`
- **level-up-triggered**: set `status: level-up-pending` (daemon will pause, not retry)
- **aborted** (security failure, unrecoverable regression): set `status: parked`
- **plateau** (no improvement, not yet level-up): set `status: parked` with reason
- **user-stopped**: set `status: paused`

---

### Level-Up Protocol

Triggers when no axis improved > 0.5 in the last 2 consecutive loops, no programmatic cap is active, and at least 3 loops have completed.

**Step 1: Freeze the snapshot**

Write `.planning/rubrics/{target}-level-{n}-final.md` with: date, loops completed, final scorecard, axes at ceiling (≥9.0 — their 10 anchors become Level {n+1}'s 5 anchors), and axes that plateaued below 9.0 with why.

**Step 2: Write proposals**

For each axis: propose Level {n+1} re-anchoring (current 10 → new 5, propose new 10). For plateaued axes: re-anchor, replace with measurable proxy, or retire.

Auto-include these three process axes if not already in the rubric: `decomposition_quality`, `scope_appropriateness`, `verification_depth`.

Write to `.planning/rubrics/{target}-proposals.md`: re-anchored axes (current 10 anchor, proposed 0/5/10), proposed new axes, axes proposed for retirement.

**Step 3: Halt -- human approval required**

Do not self-approve. Do not continue looping.

**In campaign mode:**
- Set `status: level-up-pending`
- Set `level_up_triggered: true`
- Write to Continuation State: `awaiting: human approval of level-up proposals`

Report:
- What was achieved at this level (scorecard summary)
- The proposals file location
- What the expected new gains look like at the next level

The loop resumes only when the human edits the live rubric with approved proposals
and sets the campaign status back to `active`. Level {n+1} loops continue incrementing
the loop number (they do not reset to 1).

**Step 4: Historical context for future evaluators**

When the loop resumes after a level-up, every evaluator in Phase 1c receives:
- The level-{n}-final.md snapshot as a reference baseline
- The instruction: "Scores from the previous level are the floor. A score of 5 at Level 2 means you have reached what was the ceiling at Level 1."

---

## Fringe Cases

- **No rubric**: run Phase 0, halt for human approval. Never improvise.
- **Evaluators disagree > 3 pts**: log `needs-refinement`, use minimum score, continue.
- **Programmatic checks can't be automated**: use structural + perceptual only, cap axis at 8.
- **No improvement this loop**: document as "no-change", apply recency penalty.
- **Loop 1 (no prior logs)**: delta fields empty — expected.
- **Security axis fails programmatic**: halt and report. Blocking.
- **`--continue` + no campaign file**: error, suggest `--n`.
- **`--continue` + `level-up-pending`**: halt, point to proposals file, require human approval then `status: active`.
- **`--continue` + `completed`**: do not resume, report final scorecard.
- **`--n` + existing active campaign**: treat as `--continue`. If completed/parked: new campaign, incremented slug.

---

## Quality Gates

- Phase 0 requires human approval. No exceptions.
- Phase 4 regression check must run. No committing without it.
- Phase 4 behavioral simulation result must appear in the loop log for applicable axes. Behavioral FAIL blocks commit regardless of perceptual score.
- Phase 5 loop log must be written. Even on abort, even on no-change.
- Perceptual scoring: all three evaluators required for Phase 1. Single evaluator acceptable for Phase 4 spot-check only.
- Selection formula must be shown in output.
- Any axis with a programmatic failure is capped at 5. Cannot be overridden.
- **The loop never writes to the live rubric.** Proposals go to `.planning/rubrics/{target}-proposals.md` only. Human approval required.
- Level-Up Protocol requires human approval before resuming
- **Campaign mode:** campaign file must be updated after every phase transition and every loop completion.
- **Campaign mode:** level-up must set `status: level-up-pending`, not `parked` or `active`.

---

## Contextual Gates

**Disclosure:** State loop count, target, per-loop cost (~$12), total estimate. For `--continue`: loops remaining and spend so far. For unlimited: state exit conditions (plateau or all axes >= 8.0).

**Reversibility:** Green = `--score-only` | Amber = standard loops (each commits separately) | Red = level-up (rewrites rubric anchors permanently). Red requires explicit confirmation.

**Proportionality:** No rubric + no explicit request → suggest `/review`. All axes > 8.0 + `--n=1` → suggest `--axis`. Cost > $50 → confirm.

**Trust gating:** Novice (0-4): `--score-only` / `--n=1` only. Familiar (5-19): up to `--n=5`. Trusted (20+): no cap; confirm unlimited or cost > $50.

## Exit Protocol

```
---HANDOFF---
- Target: {target} — Loop {n} of {n_total or "∞"} — Level {current_level}
- Outcome: {improved | plateau | ceiling | aborted | n-complete | level-up-triggered}
- Score movement: {axis} {before} → {after} (+{delta})
- Behavioral simulation: {PASS {wall_time} | FAIL | SKIPPED}
- Proposed rubric additions: {count} — written to .planning/rubrics/{target}-proposals.md
- Loop log: .planning/improvement-logs/{target}/loop-{n}.md
- Reversibility: amber -- each loop commits separately, revert individual loops with git revert
- Next recommended axis: {axis_name} (if not exiting)
- Level-up snapshot: .planning/rubrics/{target}-level-{n}-final.md (if level-up triggered)
---
```
