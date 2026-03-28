# citadel Level 2 Proposals

> Generated: 2026-03-28
> Level 1 final state: .planning/rubrics/citadel-level-1-final.md
> Status: APPROVED — applied to citadel.md v2 (2026-03-28)
> Modifications: readme_quality 10 (no dynamic rendering; pain point resonance), demo_page_effectiveness 10 (realistic output previews, no OAuth), test_coverage re-anchored to semantic correctness instead of retired, team_adoption_friction V4+ cap note added, skill_authoring_quality capped at 6-7.

---

## Re-anchored axes

These axes have their Level 1 ceiling as the new Level 2 floor (5).
The proposed 10 describes what only became imaginable after reaching Level 1.

---

### onboarding_friction
**Level 1 ceiling (now the 5):** "git clone → /do setup → first successful /do review in under 3 minutes. Zero errors. User thinks 'I need this.'"

Proposed Level 2 anchors:
- **0**: User finds Citadel, can't understand what it does or why they'd want it without significant research.
- **5**: Today's Level 1 ceiling — 3-minute install, zero errors, sees value on their own project. (Established.)
- **10**: User encounters Citadel on a device they don't develop on (phone, shared computer). One command on the demo page starts a live session on their actual GitHub repo. First real task completes in under 60 seconds — without reading QUICKSTART. Installation is the last step, not the first, because value was demonstrated before commitment was required.

---

### error_recovery
**Level 1 ceiling (now the 5):** "Every error includes: what happened, why, and what to do next. No error requires source-reading to recover."

Proposed Level 2 anchors:
- **0**: Errors are cryptic or silent. User is stuck with no path forward.
- **5**: Today's Level 1 ceiling — every error is explained and actionable. (Not fully achieved; current score 5.)
- **10**: System detects the failure pattern *before* the user hits it. Circuit breaker intercepts with: "this approach has a high failure rate for this task type — here's what works instead." Recovery is anticipatory, not reactive. The system builds a failure pattern library from telemetry and improves its interception over time. A user who has never hit a failure mode is protected because a previous user already did.

---

### demo_page_effectiveness
**Level 1 ceiling (now the 5):** "Creates 'I need to try this' reaction. Live input. <2s load. One CTA. Mobile works."

Proposed Level 2 anchors:
- **0**: Demo is static or broken. Does not demonstrate Citadel's behavior.
- **5**: Today's Level 1 ceiling — interactive routing demo, fast, clean CTA. (Current score 6, approaching.)
- **10**: Demo runs on the visitor's actual code. User pastes a GitHub repo URL; demo runs a real Citadel routing cascade on a file from that repo and shows them what the output would look like. The install CTA is pre-filled with their repo context. The visitor sees their own problem solved before installing anything. Conversion is driven by personal relevance, not generic capability demonstration.

---

### differentiation_clarity
**Level 1 ceiling (now the 5):** "Within 30 seconds, reader can explain to a colleague what Citadel does that CLAUDE.md alone doesn't."

Proposed Level 2 anchors:
- **0**: Reader cannot distinguish Citadel from alternatives.
- **5**: Today's Level 1 ceiling — 30-second comprehension, verbal explanation possible. (Current score 7.)
- **10**: Differentiation is demonstrated through observable comparison. Visitor can run the same complex multi-session task with and without Citadel and see the difference in context retention, step count, and output quality measured against each other. The positioning is not claimed — it is shown. A developer who was skeptical becomes convinced because they witnessed the difference on their own task, not because they read about it.

---

### readme_quality
**Level 1 ceiling (now the 5):** "Best single page about Citadel. ≤5 steps. Shows, doesn't tell. Developer wants to star."

Proposed Level 2 anchors:
- **0**: README is a feature dump. No hierarchy. Reader leaves without understanding the project.
- **5**: Today's Level 1 ceiling — strong structure, FAQ, architecture cards. (Current score 7.)
- **10**: README is personalized to the reader's context. Detects visitor's primary language from referrer or explicit selection; shows quickstart commands for their stack. The hero section contains a one-sentence answer to "what was the last thing I tried to do with Claude Code that failed because it forgot context" — phrased to be instantly recognizable to the target user. Cold visitors understand the value in under 10 seconds without prior context on what agent orchestration is.

---

### command_discoverability
**Level 1 ceiling (now the 5):** "/do routes natural language; user never needs to know skill names."

Proposed Level 2 anchors:
- **0**: User knows something is installed but has no idea what it can do.
- **5**: Today's Level 1 ceiling — /do routes, /do --list groups, natural language works. (Current score 7.)
- **10**: System surfaces the right skill *before the user asks*. When a session detects a repeating pattern (same type of fix three times, same type of review three times), Citadel offers: "You've done this 3 times. Want to make it a skill?" When a .planning/intake/ item appears, Citadel flags it on session start. Discovery is push (contextually offered) not pull (user must search). The system is proactive about its own utility.

---

### documentation_coverage
**Level 1 ceiling (now the 5):** "Every skill has an example; every hook has a 'what you'll see'; worked campaign walkthrough exists."

Proposed Level 2 anchors:
- **0**: Docs are sparse. Users must read source.
- **5**: Today's Level 1 ceiling — comprehensive reference docs, examples, hook explanations. (Current score 7.)
- **10**: Documentation is generated from execution, not written by hand. Every "what you'll see" section is pulled from actual hook output captured in CI. Every skill example is a real session log, not a hand-crafted example. Docs cannot go stale because they are not authored — they are observed and formatted. A documentation gap is a test failure.

---

## Axes proposed for retirement

### test_coverage
**Rationale:** Hit Level 1 ceiling (9). The structural ceiling has been reached — every hook has tests, every skill has benchmarks, the suite is fast. Level 2 improvement would require semantic correctness testing (does the agent actually route correctly, not just does the routing file parse). This is better captured as part of `verification_depth` (a process axis) than as a standalone axis. Recommend retiring `test_coverage` from the scoring rubric at Level 2 — it has served its purpose.

**Replacement:** Let `verification_depth` (process axis) absorb this concern at Level 2.

---

## New emergent axes
These became visible only after reaching Level 1 quality. They were not conceivable at Level 1 baseline.

---

### compound_value_visibility
**Weight:** 0.85
**Category:** experience
**Why now:** At Level 1, Citadel was too new and inconsistent for compound value to accumulate. At Level 2, users have real session history, campaign logs, telemetry. Whether that history is visible and usable becomes a meaningful quality dimension.

Draft anchors:
- **0**: User has no way to see their history of work done through Citadel. Campaigns completed, skills created, improvements made are invisible.
- **5**: Campaign files and loop logs exist. A developer can manually read them to reconstruct history. Telemetry JSONL is present but requires tooling to interpret.
- **10**: Citadel surfaces a session-start summary: "Last week: 3 campaigns completed, 2 skills created, 47 hook interventions, 12 errors caught before commit. Current open campaigns: 2." The compound value of the system is visible to the user at every session start. They can see the ROI accumulating.

---

### team_adoption_friction
**Weight:** 0.80
**Category:** experience
**Why now:** Individual onboarding (onboarding_friction) is different from team adoption. At Level 2, the question is: can a lead install Citadel, configure a shared harness.json, push shared skills, and have 5 teammates productive in the same session — without each person needing to independently set up the full system.

Draft anchors:
- **0**: Each team member must independently install and configure Citadel. No shared state, no shared skills, no coordination.
- **5**: Shared harness.json can be committed to a project repo. Team members who clone the repo get the project's skill configuration. But they still need individual plugin install and hook setup.
- **10**: A team lead installs Citadel once. Commits `.claude/harness.json` and `.claude/skills/`. Every team member who opens the project in Claude Code gets full Citadel capability with zero individual setup. Fleet sessions can be shared — one member starts a fleet, another monitors it. The system is a team tool, not a personal tool.

---

### skill_authoring_quality
**Weight:** 0.70
**Category:** technical
**Why now:** At Level 1, skills existed. At Level 2, skills are being authored by users with /create-skill. Whether those user-created skills are actually good — reusable, maintainable, improving over time — becomes measurable.

Draft anchors:
- **0**: User-created skills are one-offs, never reused. /create-skill produces files that are never invoked again after the first use.
- **5**: User-created skills are used 2-3 times. They're specific enough to be useful for the original use case but too narrow to generalize. No mechanism for improving them over time.
- **10**: User-created skills improve automatically. Each invocation produces an implicit feedback signal (did the agent complete the task, did the user accept the output). After 5 uses, /improve can target user skills with the same loop protocol. The harness treats user knowledge as a first-class asset that compounds in quality.

---

## Process axes (activate at Level 2)

Already defined in the rubric under "Category: Process Quality":
- `decomposition_quality` (weight 0.85) — diagnosis before execution
- `scope_appropriateness` (weight 0.75) — change proportional to gap
- `verification_depth` (weight 0.80) — verify actually tests what changed

These should be added to the active scoring rubric at Level 2. Their first scores will be low (the loops at Level 1 were not designed to be scored on these dimensions). This is expected — they define what good process looks like, and Level 2 loops will optimize against them.

---

## Axes to carry forward unchanged

These are in good shape and their Level 1 definitions remain valid as Level 2 floors:
- `security_posture` (8) — carry forward, re-anchor ceiling toward adversarial robustness
- `hook_reliability` (8) — carry forward
- `api_surface_consistency` (8) — carry forward
- `documentation_accuracy` (8) — carry forward, level 2 anchor is auto-generation from tests
- `competitive_feature_coverage` (8) — carry forward
- `visual_coherence` (8) — carry forward

---

## Summary for human review

| Decision | Axis | Recommendation |
|---|---|---|
| Re-anchor | onboarding_friction | Level 2 ceiling: zero-install, value before commitment |
| Re-anchor | error_recovery | Level 2 ceiling: anticipatory recovery, failure pattern library |
| Re-anchor | demo_page_effectiveness | Level 2 ceiling: demo on visitor's own repo |
| Re-anchor | differentiation_clarity | Level 2 ceiling: demonstrated comparison, not claimed |
| Re-anchor | readme_quality | Level 2 ceiling: personalized to reader's stack/context |
| Re-anchor | command_discoverability | Level 2 ceiling: push discovery, proactive surfacing |
| Re-anchor | documentation_coverage | Level 2 ceiling: generated from execution, cannot go stale |
| Retire | test_coverage | Structural ceiling reached; absorbed by verification_depth |
| New axis | compound_value_visibility | Only possible at Level 2 quality |
| New axis | team_adoption_friction | Individual vs. team install story |
| New axis | skill_authoring_quality | User-created skills as a quality dimension |
| Activate | decomposition_quality | Process axis, already defined |
| Activate | scope_appropriateness | Process axis, already defined |
| Activate | verification_depth | Process axis, already defined |
