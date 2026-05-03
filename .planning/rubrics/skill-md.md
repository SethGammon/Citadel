# Rubric: skill-md

> Target: The SKILL.md corpus — evaluated as prompt engineering artifacts, not documentation.
> Created: 2026-05-02
> Version: 1
> Status: approved

The question this rubric answers is not "does the skill exist?" or "does it pass lint?" It is:
**When an agent receives this SKILL.md as its instruction set, does it behave correctly?**

---

## Scoring Protocol

Three independent evaluator agents score every axis. Personas:

- **Evaluator A — The Agent**: Score from the perspective of an agent that receives this skill as its only instruction. Would this exact text cause correct behavior on the first try, without inferring intent or filling gaps?
- **Evaluator B — The Skeptic**: Challenge every line. For each section, ask: "If this were removed, would agent behavior change observably?" If no, the section is dead weight. Score density and specificity harshly.
- **Evaluator C — The Newcomer Agent**: A fresh Claude instance with no prior context. Would this agent know what to do, when to stop, when to escalate, and what output to produce?

Final score per axis = **minimum** of three evaluators.
Disagreement > 3 points between any two evaluators = flag axis as `needs-refinement`.
Programmatic failures cap the axis at 5 regardless of evaluator scores.

---

## Category: Instruction Fidelity

How well does the skill text cause agents to follow the correct protocol?

### Axis: protocol_completeness
Weight: 0.25
Category: instruction-fidelity

#### Anchors
- **0**: Agent hallucinates steps not in the skill. Multiple branching decisions have no explicit guidance. Different runs produce structurally incompatible outputs. Agents improvise on any non-trivial input.
- **5**: Happy path is fully specified. Branching decisions on partial state, missing dependencies, or ambiguous input are not covered. Agent follows protocol on clean inputs and improvises on real-world messiness.
- **10**: Every decision point is explicitly specified. An agent can execute the protocol mechanically without inferring intent. No branch (error, missing state, ambiguous input) is left to improvisation. Scenario pass rate ≥ 90% on execute mode.

#### Verification
- **programmatic**: `node scripts/skill-bench.js --execute --tag happy-path` — count pass rate per skill. Skills with 0 passing happy-path scenarios score 0 regardless of evaluator opinion.
- **structural**: Every conditional in the protocol (if X / else Y) has an explicit handler for both branches. No step says only "proceed" without specifying what proceeding looks like.
- **perceptual**: Evaluator mentally executes the skill on three inputs: clean happy path, missing state, and ambiguous input. Scores whether the protocol would produce correct behavior on all three without the agent needing to invent steps.

---

### Axis: fringe_accuracy
Weight: 0.15
Category: instruction-fidelity

#### Anchors
- **0**: Fringe cases are hypothetical ("what if the network is down?") rather than derived from observed failures. Common real failure modes (missing `.planning/`, missing tool, corrupted state file) are absent. Agent crashes or fails silently on inputs seen in production.
- **5**: The three most common fringe cases are covered. Less common but real failure modes are not. Agent handles approximately 60% of observed failures gracefully; the rest produce confusing errors.
- **10**: Fringe cases map to observed failure modes from real sessions, not theorized ones. Every case the agent can realistically encounter produces a user-facing message with an actionable fix. No failure mode produces a raw stack trace or silent exit.

#### Verification
- **programmatic**: `node scripts/skill-bench.js --execute --tag fringe` — pass rate on fringe scenarios. Skills with no fringe scenarios score 5 (unknown, not bad).
- **structural**: Fringe cases section covers: (1) missing `.planning/` directory, (2) missing required tool, (3) corrupted or missing state file. Each case specifies the exact user-facing message to emit.
- **perceptual**: Evaluator lists the five most likely real failure modes for this skill from memory. Checks how many are explicitly handled.

---

## Category: Agent Output Quality

What does an agent produce when following this skill?

### Axis: output_completeness
Weight: 0.15
Category: output-quality

#### Anchors
- **0**: HANDOFF blocks absent or inconsistently present. Required fields (what changed, key decisions, next steps) often missing. Output format spec so vague that downstream parsing is impossible. Different runs produce structurally incompatible outputs.
- **5**: HANDOFF present in most scenarios. Some required fields (decisions, reversibility) frequently empty. Format specified but not tight enough to enforce consistency across agents.
- **10**: HANDOFF format is unambiguously specified with every field defined. Scenario runs consistently produce complete HANDOFF blocks. A downstream parser (or another agent reading the handoff) could rely on the format without inspecting the skill.

#### Verification
- **programmatic**: Parse HANDOFF blocks from `skill-bench --execute` outputs. Count fields present vs. required. Skills scoring < 3 fields out of 5 required cap at 5.
- **structural**: Exit protocol section specifies every required HANDOFF field with a description of what belongs in it. Format is tight enough that "what was changed" cannot be interpreted as "what file was touched" vs. "what behavior changed."
- **perceptual**: Evaluator simulates executing the skill on a standard input and predicts the HANDOFF output. Scores how complete and unambiguous that predicted output would be.

---

### Axis: escalation_guidance
Weight: 0.10
Category: output-quality

#### Anchors
- **0**: No contextual gates. Agent has no basis for knowing when to escalate, confirm, or halt. Agent proceeds autonomously on tasks that require human approval.
- **5**: Has a contextual gates section but conditions are vague ("if the task is large") or thresholds are arbitrary. Agent sometimes over-escalates on trivial tasks or under-escalates on risky ones.
- **10**: Escalation conditions are specific and testable: explicit cost thresholds, trust level gates, scope limits. Agent escalates precisely when required and proceeds precisely when safe. Red/amber/green reversibility classification is present and accurate.

#### Verification
- **programmatic**: n/a
- **structural**: Has explicit cost confirmation threshold (or states "no cost actions"), reversibility classification (green/amber/red), and trust level gates (novice/familiar/trusted).
- **perceptual**: Evaluator identifies three scenarios where wrong escalation (over or under) would cause real harm. Checks whether the skill's contextual gates would prevent each.

---

## Category: Efficiency

Is every token in the file doing work?

### Axis: density
Weight: 0.20
Category: efficiency

#### Anchors
- **0**: File contains worked examples with sample data, identity/background prose, redundant restatements of the same rule, step descriptions that just say "do the obvious thing." Word count > 3000 for any skill. Removing 30% of the file would not change agent behavior.
- **5**: Some redundancy visible on inspection. At least one section that could be removed without changing behavior. 1500–3000 words for a complex orchestrator skill, or > 1200 for a simple skill.
- **10**: Every line is load-bearing. Removing any section creates a detectable gap in behavior. File formats are described as schemas, not illustrated with populated instances. Complex orchestrator: < 2500 words. Simple skill: < 1200 words.

#### Verification
- **programmatic**: Word counts: `wc -w skills/*/SKILL.md`. Flag any skill > 3000 words as programmatic failure (cap at 5). Flag complex orchestrators (archon, fleet, daemon, improve) > 2500 or simple skills > 1200 as warnings.
- **structural**: No section contains only examples or background prose. No rule is stated twice. No step says only "proceed" or "continue" without specifying what that means.
- **perceptual**: Evaluator reads each section and marks whether removing it would change agent behavior. Section marked "no change" = dead weight. Percentage of dead-weight lines is the signal.

---

### Axis: orientation_precision
Weight: 0.15
Category: efficiency

#### Anchors
- **0**: No orientation, or orientation so broad it matches everything. `/do` misroutes: sends inputs to this skill that belong elsewhere, or misses inputs this skill should handle.
- **5**: Orientation correctly describes the primary use case but is ambiguous about adjacent skills (e.g., doesn't distinguish `/marshal` from `/archon`). Occasional misrouting from `/do`.
- **10**: Orientation explicitly distinguishes this skill from its two closest neighbors with concrete "use this, not that" guidance. `/do` routes correctly on ≥ 95% of realistic inputs. Orientation prevents a lazy agent from defaulting here when a simpler tool suffices.

#### Verification
- **programmatic**: Route the 3 closest alternative inputs through `/do` in `skill-bench --execute` mode and verify they route away from this skill. Route the 3 canonical inputs and verify they route here.
- **structural**: Orientation names the two skills this one is most confused with and states the distinguishing criterion.
- **perceptual**: Evaluator reads orientation and predicts how `/do` would route five real-world inputs. Checks against expected routing.

---

## Programmatic Check Suite

Run before scoring. Failures cap the relevant axis at 5.

```bash
# Structural validity
node scripts/skill-lint.js          # All skills must pass (0 FAILs)

# Word count thresholds
node -e "
const fs = require('fs');
const path = require('path');
const skills = fs.readdirSync('skills').filter(s => fs.existsSync(\`skills/\${s}/SKILL.md\`));
const complex = ['archon','fleet','daemon','improve','create-app','workspace','do','organize','setup','triage','watch','pr-watch','ascii-diagram','scaffold'];
let ok = true;
skills.forEach(s => {
  const wc = fs.readFileSync(\`skills/\${s}/SKILL.md\`, 'utf8').split(/\s+/).length;
  const limit = complex.includes(s) ? 2500 : 1200;
  if (wc > limit) { console.log(\`OVER \${s}: \${wc} words (limit: \${limit})\`); ok = false; }
});
if (ok) console.log('All skills within word count thresholds.');
"

# Scenario file validity
node scripts/skill-bench.js         # All scenario files must validate (static mode, no LLM)

# Execute mode (run periodically, costs tokens)
# node scripts/skill-bench.js --execute --tag happy-path
# node scripts/skill-bench.js --execute --tag fringe
```

---

## Behavioral Simulation (Phase 4, applicable axes)

Required when targeted axis is: `protocol_completeness`, `output_completeness`

Clone repo into a temp directory. Give a fresh Claude instance only the targeted SKILL.md and a standard scenario input. No harness context, no CLAUDE.md. Measure:

1. Does the agent follow the protocol steps in order without inventing new steps?
2. Does the HANDOFF block contain all required fields?
3. Does the agent escalate when the protocol requires it?

Record: `PASS {wall_time}` or `FAIL at step {n}: {what diverged}`

A behavioral FAIL overrides a passing perceptual score. Do not commit on behavioral FAIL.

---

## Scoring Notes

This rubric evaluates the corpus as a whole, not individual skills. When running `/improve skill-md`:

- **Phase 1** scores the full corpus against all axes (average score across skills for density, worst score for protocol_completeness)
- **Phase 3** attacks by targeting the specific skill(s) dragging the axis score down
- The **behavioral simulation** sample should cover: one complex orchestrator (archon or fleet), one simple skill (research or scaffold), one recently modified skill

A rubric score of 7.0+ across all axes means the SKILL.md corpus is a reliable prompt substrate. Below 5.0 on any axis means agents are regularly improvising in ways that are invisible to structural tests.
