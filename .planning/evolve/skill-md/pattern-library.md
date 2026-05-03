# Pattern Library — skill-md

## Cycle 1 Patterns

### P-01: orientation-neighbor-naming
**Axis class:** orientation_precision
**Mechanism:** Skills that named 2 adjacent skills in a "Don't use when" clause scored measurably higher on orientation clarity than skills that only described their own use case.
**Delta:** +1.0 estimated across 6 skills (fleet, session-handoff, scaffold, postmortem, learn, organize)
**Applies to:** Any skill that has peers in the same category (post-session tools, project health tools, generation tools)
**Confidence:** high — pattern confirmed in 6 skills, all passed lint after application

### P-02: handoff-typed-slots
**Axis class:** output_completeness
**Mechanism:** HANDOFF blocks with typed key-value constraints (e.g., `- Reversibility: green — ...`) allow downstream agents to parse reversibility without reading the full skill. Bare prose slots produce ambiguous handoffs.
**Delta:** +1.0 estimated across 3 skills (marshal, research, postmortem)
**Applies to:** Any skill that writes files or modifies state and has an Exit Protocol HANDOFF block
**Confidence:** high — pattern confirmed in 3 skills; reversibility field directly addresses a rubric anchor

### P-03: dispatch-loop-timeout
**Axis class:** fringe_accuracy
**Mechanism:** Skills that dispatch agents (scouts, fleet agents, sub-agents) score low on fringe accuracy if they don't specify what happens when an agent hangs. Adding an explicit timeout with abort-and-continue behavior closes the gap.
**Delta:** +1.0 estimated across 3 skills (evolve scout timeout, archon hung-agent timeout)
**Applies to:** Any skill that dispatches sub-agents via the Agent tool in a loop or parallel pattern
**Confidence:** high — pattern confirmed in 2 orchestrators; addresses a concrete failure mode not a theoretical one

### P-04: duplicate-block-removal
**Axis class:** density
**Mechanism:** Skills that repeat content blocks (e.g., HANDOFF template in Step N and again in Exit Protocol) inflate word count without adding information. Replacing the duplicate with a forward reference ("Output the HANDOFF block from the Exit Protocol") removes dead weight.
**Delta:** contributing to density +2.0 for this target overall
**Applies to:** Any skill with a protocol step that mirrors the Exit Protocol format verbatim
**Confidence:** high — confirmed in session-handoff (duplicate HANDOFF), postmortem (duplicate HANDOFF)

### P-05: planning-guard
**Axis class:** fringe_accuracy
**Mechanism:** Skills that reference `.planning/` subdirectories in their protocol need an explicit fringe case for `.planning/` not existing. Without it, evaluators dock fringe_accuracy for the gap.
**Delta:** contributed to H-FA-01 delta
**Applies to:** Any skill whose protocol reads from `.planning/campaigns/`, `.planning/fleet/`, `.planning/telemetry/`, or similar
**Confidence:** high — confirmed in session-handoff; lint rule `[WARN] guards .planning/ access when used` independently detects this gap

## Cycle 2 Patterns

### P-06: contextual-gates-classification
**Axis class:** escalation_guidance
**Mechanism:** Skills that declare reversibility as green/amber/red with a specific undo command score higher on escalation_guidance than skills with no gates at all. The color+undo pair is the minimum viable gate — evaluators can verify it is testable (not vague). Absence scores 0; vague prose scores 3; typed classification scores 7+.
**Delta:** +1.5 estimated across 13 skills (9 attacked + 4 cross-pollinated: telemetry, verify, research-fleet, qa)
**Applies to:** Any skill that creates files, modifies source, or writes external state
**Confidence:** high — pattern applied to 13 skills, all passed lint; read-only skills uniformly green; multi-file modifiers uniformly amber

### P-07: fringe-from-real-modes
**Axis class:** fringe_accuracy
**Mechanism:** Fringe cases must derive from real observed failure modes (missing dirs, malformed state, missing tool, API unavailability) — not hypothetical scenarios. Each case must include a specific user-facing message or action, not just "handle it." Hypothetical cases don't move the evaluator's score.
**Delta:** +1.0 estimated across 4 skills (cost, dashboard, refactor, review)
**Applies to:** Any skill adding a Fringe Cases section
**Confidence:** medium — confirmed in 4 skills this cycle; need 2+ more instances to promote to high

### P-08: identity-prose-is-dead-weight
**Axis class:** density
**Mechanism:** "Identity" sections that describe what the skill does in first-person prose ("You are the X manager...") are always dead weight — they restate the frontmatter description and the agent's execution context. Removing them frees word budget for load-bearing protocol without changing behavior.
**Delta:** contributing to density for schedule (trimmed Identity → fell back under 1200-word limit)
**Applies to:** Any skill with an "## Identity" section that restates the frontmatter description
**Confidence:** medium — confirmed in schedule and partially in research-fleet (Identity section present); need broader attack to confirm at high
