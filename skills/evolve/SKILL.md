---
name: evolve
description: >-
  Research-driven multi-cycle improvement director. Forms causal hypotheses
  about why scores are low, validates them with scout agents before attacking,
  dispatches axis-parallel fleet attacks, extracts transferable patterns, and
  runs indefinitely within a budget envelope. Accumulates a persistent belief
  model and pattern library across sessions.
user-invocable: true
auto-trigger: false
last-updated: 2026-05-03
---

# /evolve — Improvement Director

## Orientation

**Use when:** You want sustained autonomous quality advancement — the director
forms hypotheses, scouts before attacking, and builds a belief model that
compounds across cycles. Runs until a natural ceiling, budget exhaustion, or you
say stop.

**Don't use when:** You want a single scored loop (`/improve`), a known axis
attacked directly (`/improve --axis`), or a one-time audit (`/improve --score-only`).

**Key difference from `/improve`:** `/improve` follows the rubric mechanically.
`/evolve` asks *why* scores are where they are, validates those theories before
spending fleet budget, and extracts cross-skill patterns that propagate to skills
never directly attacked.

## Invocation

```
/evolve {target}                  # run until ceiling, velocity drop, or budget
/evolve {target} --n={N}          # exactly N director cycles then stop
/evolve {target} --budget=${X}    # run until cumulative spend reaches $X
/evolve {target} --continue       # resume from saved director state
/evolve {target} --status         # show belief model, velocity, spend — no attack
/evolve {target} --axis={name}    # focus director on one axis (scout + attack only)
```

`target` maps to `.planning/rubrics/{target}.md`.
If no rubric exists, run `/improve {target}` Phase 0 first — `/evolve` requires
an approved rubric and will not auto-generate one.

---

## Campaign Artifacts

All findings are externalized incrementally — written after every phase, not
only at cycle end. A crashed or compacted session resumes with full context.

| Artifact | Path | Contents |
|---|---|---|
| Director state | `.planning/evolve/{target}/director-state.json` | cycle count, spend, velocity history, current phase, halt status |
| Belief model | `.planning/evolve/{target}/belief-model.jsonl` | one record per (axis, skill) per cycle: score, hypothesis, evidence, confidence |
| Experiment log | `.planning/evolve/{target}/experiment-log.jsonl` | every experiment: hypothesis → prediction → actual delta → mechanism confirmed |
| Pattern library | `.planning/evolve/{target}/pattern-library.md` | transferable patterns: what change to what axis class caused what delta in which skills |
| Cycle digest | `.planning/evolve/{target}/cycle-{n}-digest.md` | human-readable per-cycle summary for review |
| Global patterns | `.planning/research/patterns.md` | cross-target patterns written outside campaign scope; available to future sessions and other targets |

Create `.planning/evolve/{target}/` on first invocation. Create `.planning/research/` if absent.

---

## Cycle Digest Format

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

---

## Director Cycle Protocol

### Phase 1: Survey

Run `/improve {target} --score-only`. Record scores to belief model with delta
from prior cycle (empty on cycle 1). Flag any axis that dropped since last cycle
as `regression-watch` — these are checked first in Phase 2.

### Phase 2: Hypothesize

For every axis below 8.0, generate one primary hypothesis in this form:

```
HYPOTHESIS: {axis} scores {n}/10 because {specific mechanism},
            not because {common misread}.
PREDICTION: Fixing {mechanism} will raise score ≥ {delta} across {N} skills.
FALSIFICATION: If we apply {change} and score does not rise > 0.5, hypothesis rejected.
```

Draw hypotheses from: evaluator justifications in Phase 1, prior evidence in
the belief model, and programmatic check failures. Do not hypothesize from score
alone — the number is the symptom.

Write each hypothesis to the experiment log as `{ id, status: "pending", ... }`.

Skip hypothesis generation for an axis if the belief model already has a
`confidence >= 0.8` confirmed hypothesis for it that has not yet been attacked.

### Phase 3: Scout

For axes below 7.0, or axes with unconfirmed hypotheses: dispatch one scout
agent per hypothesis. Scouts read — they do not modify files.

Each scout returns:
```json
{ "hypothesis_id": "...", "confirmed": true, "evidence": "...", "confidence": 0.85 }
```

Run scouts in parallel. Update experiment log:
- `confidence >= 0.7` → `confirmed`
- `confidence 0.4–0.69` → `needs-evidence` (do not attack; add to next cycle)
- `confidence < 0.4` → `rejected`

Skip Phase 3 for any hypothesis already `confirmed` at `confidence >= 0.8` in
the belief model from a prior cycle.

### Phase 4: Prioritize

For each confirmed hypothesis compute:

```
EV = (delta_estimate × axis_weight × confidence) / (effort_tier × collision_multiplier)
```

- `effort_tier`: low=1.0, medium=1.5, high=2.5
- `collision_multiplier`: 2.0 if axis shares primary files with another attack in this cycle

Select top K axes where K = min(confirmed count, 4). Document selection rationale
in cycle digest. If `--axis` was set, skip ranking — attack only that axis.

### Phase 5: Fleet Attack

Dispatch one agent per selected axis in an isolated worktree
(Agent tool, `isolation: "worktree"`). Each agent receives:
- The confirmed hypothesis and its falsification criterion
- The specific files to modify
- Verification oracle: `node scripts/run-with-timeout.js 300 node scripts/test-all.js`

Each agent returns a structured result:
```json
{
  "axis": "...", "skill": "...",
  "delta": 1.2,
  "mechanism_confirmed": true,
  "files_changed": ["..."],
  "approach": "..."
}
```

**Merge rules:**
- Non-conflicting worktrees: merge all
- Conflicting worktrees (same file): keep higher delta, discard lower
- Regression on any previously passing programmatic check: abort that worktree, do not merge
- `mechanism_confirmed: false` (score improved but not via predicted mechanism): record as `incidental_improvement`, mark hypothesis as `needs-revision`

Commit each merged worktree with a message citing the hypothesis ID.

### Phase 6: Synthesize

For each result:
1. Update belief model — append evidence record for (axis, skill)
2. Update experiment log — mark `verified` / `refuted` / `incidental`
3. Identify transferable patterns:

```
PATTERN: {axis_class} | Mechanism: {what caused improvement} | Delta: {avg} across {N} instances | Applies to: {skill list} | Confidence: high/medium/low
```

Write patterns to `.planning/evolve/{target}/pattern-library.md`.

### Phase 7: Cross-Pollinate

For each `confidence: high` pattern, or any pattern confirmed in 2+ skills:
apply to all other applicable skills as targeted single-file edits — without
running a full attack cycle.

Run verification oracle per cross-pollinated skill. Commit only if all
programmatic checks pass and no axis drops > 0.3. Revert on regression; mark
pattern as `context-dependent`.

Write patterns that apply beyond this target to `.planning/research/patterns.md`.

### Phase 8: Loop or Halt

Compute learning velocity:
```
velocity = Σ(delta across all attacked axes this cycle) / axes_attacked
```
Append to `director-state.json` velocity history.

**Halt conditions (check in order):**
1. `--n` cycles completed
2. `--budget` reached (cumulative cost ≥ limit)
3. All axes ≥ 9.0 across all scored skills
4. `velocity < 0.2` for 3 consecutive cycles AND no `needs-evidence` hypotheses remain
5. Level-up triggered (see below)
6. User says stop

**On velocity drop, before halting:** attempt one axis-class switch — attack the
highest-EV axis from a category not touched in the last 2 cycles. If velocity
is still < 0.2 after that cycle, halt.

**On level-up trigger** (no axis improved > 0.5 for 2 loops, ≥ 3 loops run,
no programmatic failures): write level-up proposals to
`.planning/rubrics/{target}-proposals.md`, set `status: level-up-pending` in
director state, halt. The campaign resumes only after the human approves and
edits the live rubric.

**On normal loop:** increment cycle, compress prior cycle findings to
continuation context, return to Phase 1.

---

## Unlimited Mode

No `--n` and no `--budget` = unlimited. Declare before starting:

```
/evolve running in unlimited mode.
Target: {target} | Exit: all axes ≥ 9.0 OR velocity < 0.2 for 3 cycles
Estimated cost: $12–18/cycle | Spend so far: $0
To halt after current cycle: type /stop or press Escape.
```

Every cycle, report:
```
Cycle {n} complete. Spend: ${cycle} | Cumulative: ${total} | Velocity: {v}
```

When context approaches compression territory (session duration > 30 min or
/compact recommended): write continuation checkpoint to director state,
surface the `--continue` command. The next session picks up exactly where this
one stopped.

For overnight / unattended runs: combine with `/daemon`. The director is
daemon-compatible — daemon calls `/evolve {target} --continue` each session.
Set `--budget` to cap total spend.

---

## Fringe Cases

- **No rubric**: error — run `/improve {target}` Phase 0 first. List available targets in `.planning/rubrics/` as hint.
- **No prior scores in belief model**: proceed from cycle 1; all deltas empty on first survey. Expected.
- **All scouts return `needs-evidence`**: attack the top-EV axis anyway under `low-confidence` flag; record as exploratory. Mark result regardless.
- **All axes collide** (every axis shares files): serialize top 2 axes; parallelize remainder. Log collision.
- **Cross-pollination causes regression**: revert that skill, mark pattern `context-dependent`, do not propagate further.
- **Level-up mid-campaign**: pause, write proposals, set `level-up-pending`. `/evolve --continue` after human approval resumes cycle numbering from where it stopped.
- **Budget overrun risk**: if projected spend for current cycle would exceed `--budget` by > 20%, warn and confirm before dispatching fleet.
- **`--continue` with no director state**: error — no campaign to resume. Suggest `/evolve {target}` to start fresh.
- **Pattern library > 50 entries**: consolidate — group by axis class, merge similar patterns, keep highest-confidence instance of each class. Log consolidation.
- **Zero skills match target rubric**: error with message listing all `.planning/rubrics/*.md` targets.

---

## Quality Gates

- Every hypothesis must have an explicit falsification criterion before Phase 3
- Scouts must run before fleet dispatch on any unconfirmed hypothesis
- Belief model written after every phase, not only end of cycle
- Cross-pollination requires passing verification oracle before commit
- Regression on any previously-passing axis aborts that worktree commit
- Pattern library and global patterns updated at every cycle end, even zero-improvement cycles
- Cycle digest written even on abort or no-change cycles

---

## Contextual Gates

**Disclosure:**
- State mode (unlimited / fixed / budget) and exit conditions before first cycle
- Estimate $12–18 per full cycle before starting
- Report spend and velocity at end of every cycle
- Confirm before continuing if cumulative spend exceeds $50

**Reversibility:** Red. Cross-pollination modifies many files across the repo;
level-up rewrites rubric anchors permanently. Each commit is individually
revertable; high volume. Range: `git revert {first}^..{last}`.

**Trust gates:**
- Novice (0-4 sessions): `--status` and `--n=1` only; unlimited blocked
- Familiar (5-19): up to `--n=5`; unlimited requires explicit `--budget` cap
- Trusted (20+): no cap; confirm if projected total > $100

---

## Exit Protocol

```
---HANDOFF---
- Target: {target} | Cycles: {n} | Spend: ${total} | Mode: {unlimited/n/budget}
- Axes improved: {list with deltas}
- Belief model: .planning/evolve/{target}/belief-model.jsonl ({N} confirmed, {M} rejected)
- Pattern library: .planning/evolve/{target}/pattern-library.md ({N} patterns)
- Global patterns: .planning/research/patterns.md
- Cycle digests: .planning/evolve/{target}/cycle-*-digest.md
- Halt reason: {ceiling/velocity/budget/n-complete/user-stop/level-up-pending}
- Level-up proposals: {path or N/A}
- Reversibility: red — {N} commits across {M} files; revert range: git revert {range}
- Recommended next: {level-up and re-run / new target / done}
---
```
