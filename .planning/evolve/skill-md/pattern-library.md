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
