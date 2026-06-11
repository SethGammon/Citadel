# Quality Loops: /improve and /evolve

> last-updated: 2026-06-11

Reference companion for the quality-loop skill family. `/improve` runs scored
single-axis improvement loops against a rubric; `/evolve` directs multi-cycle,
hypothesis-driven campaigns on top of the same rubric system. Protocol steps,
gates, and stop conditions live in `skills/improve/SKILL.md` and
`skills/evolve/SKILL.md`; this doc holds the full templates, schemas, and
expanded playbooks those skills point to.

## Campaign File Template

`/improve` campaign mode maintains `.planning/campaigns/improve-{target}.md`.
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

## Structural Check Types

Phase 1b (structural analysis) executes the structural checks from each axis's
verification spec. Common check types:

- File path verification (do referenced files exist?)
- Schema consistency (do all skills have identical frontmatter fields?)
- Coverage ratios (what percentage of skills have benchmark scenarios?)
- Link rot (do all internal doc links resolve?)
- Cross-reference accuracy (do docs match current source?)

## Evaluator Panel

Phase 1c spawns three evaluator agents in parallel. Each receives:

- The rubric with all axis definitions and anchors
- Read access to the target (repo files, demo page screenshots if applicable)
- Their persona (A/B/C as defined in the rubric's Scoring Protocol)
- Instruction: score every axis 0-10 with a one-sentence justification per axis

## Scorecard Format

Phase 1d compiles the scorecard in this layout:

```
Axis        | A   | B   | C   | Prog      | Final | Delta  | Flag
------------|-----|-----|-----|-----------|-------|--------|-----
{axis_name} | {n} | {n} | {n} | PASS/FAIL | {n.n} | +{n.n} | cap
```

## Attack Dispatch Strategies

Phase 3 dispatch playbooks by axis category:

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

## Loop Log Template

Phase 5 writes `.planning/improvement-logs/{target}/loop-{n}.md`:

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

## Cycle Digest Format

`/evolve` writes a per-cycle digest to `.planning/evolve/{target}/cycle-{n}-digest.md`:

```markdown
# Cycle {n} — {target} | {date}

## Scores
| Axis | Prior | This Cycle | Delta |

## Hypotheses
| ID | Axis | Hypothesis | Scout Result | Confidence |

## What Was Attacked
| Axis | Skill | Delta | Mechanism Confirmed |

## Patterns Discovered This Cycle
- {pattern}: {evidence}

## Belief Model Updates
- {hypothesis confirmed / rejected / revised}

## Spend: ${cycle} this cycle | ${cumulative} cumulative | Velocity: {v}
```

## Scout Result Schema

`/evolve` Phase 3 scouts return:

```json
{ "hypothesis_id": "...", "confirmed": true, "evidence": "...", "confidence": 0.85 }
```

## Fleet Agent Result Schema

`/evolve` Phase 5 fleet agents return a structured result:

```json
{
  "axis": "...", "skill": "...",
  "delta": 1.2,
  "mechanism_confirmed": true,
  "files_changed": ["..."],
  "approach": "..."
}
```

## Unlimited Mode Templates

`/evolve` declaration before the first unlimited-mode cycle:

```
/evolve running in unlimited mode.
Target: {target} | Exit: all axes ≥ 9.0 OR velocity < 0.2 for 3 cycles
Estimated cost: $12–18/cycle | Spend so far: $0
To halt after current cycle: type /stop or press Escape.
```

Per-cycle report:

```
Cycle {n} complete. Spend: ${cycle} | Cumulative: ${total} | Velocity: {v}
```
