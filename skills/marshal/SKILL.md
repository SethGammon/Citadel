---
name: marshal
description: >-
  Meta-orchestrator that takes any direction — broad, specific, or vague — and
  autonomously chains skills and context into actionable work. Gathers context
  from codebase, docs, and memory. Only asks the user when it genuinely cannot
  proceed. Single-session orchestrator.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-20
---

# /marshal — Session Commander

## Orientation

Use Marshal when the task is:
- Multi-step but bounded (completable in one session)
- Needs investigation before action
- Spans multiple skills but doesn't need campaign persistence
- Too complex for a single skill but doesn't need Archon/Fleet

Do NOT use Marshal for:
- Single-file edits (use the skill directly or do it yourself)
- Multi-session work (use Archon)
- Parallel execution (use Fleet)

## Commands

| Command | Behavior |
|---|---|
| `/marshal [direction]` | Full loop: understand → plan → execute → report |
| `/marshal assess [area]` | Read-only: understand the area, produce findings, don't fix |

## Protocol

### Phase 1: UNDERSTAND

Parse the user's direction into structured intent:

1. Read CLAUDE.md to understand the project's architecture and conventions
2. Identify: scope (which files/directories), perspective (user, developer, admin),
   mode (audit, fix, build, improve, map), depth (surface scan vs deep investigation)
3. If the direction is ambiguous, make a reasonable interpretation and state it.
   Do NOT ask clarifying questions unless genuinely stuck.

### Phase 2: PLAN CHAIN

Map the intent to a sequence of actions:

| Direction Pattern | Chain |
|---|---|
| "audit [area]" | explore → analyze → report findings |
| "fix [thing]" | investigate root cause → fix → verify → report |
| "map [area]" | read files in parallel → synthesize → produce analysis |
| "improve [area]" | audit current state → identify gaps → implement → verify |
| "what should [X] be" | research → analyze options → recommend with reasoning |
| "research [topic]" | search codebase + web → synthesize → report |

Announce the chain before executing: "I'll [step 1], then [step 2], then [step 3]."

### Phase 3: EXECUTE

For each step in the chain:

1. Load the relevant skill if one exists (e.g., `/review` for audit steps)
2. Gather context: read relevant files, check git history, search for patterns
3. Perform the action
4. Check the result against the plan — did it produce what was expected?
5. If a step fails, try one alternative approach before escalating

### Phase 4: REPORT

Produce a structured report:

```
=== Marshal Report ===

Direction: {original direction}
Scope: {what was examined}

Findings:
- {finding 1 with file:line reference}
- {finding 2}

Actions Taken:
- {what was changed, if anything}

Recommendations:
- {next steps if applicable}
```

### Phase 5: LEARN

If the investigation revealed reusable patterns or pitfalls:
- Note them in the report
- Suggest creating a skill if a pattern will recur: "This pattern would
  make a good skill. Run `/create-skill` to capture it."

## Agent Timeouts

When Marshal spawns sub-agents (e.g., for parallel investigation or delegated
skill execution), it must enforce execution time limits. Sub-agents can hang
indefinitely on tool calls — the circuit breaker catches failures, not hangs.

### Default Timeouts

| Agent Type | Default Timeout |
|---|---|
| Skill-level agents | 10 minutes |
| Research agents | 15 minutes |

Timeouts are configurable in `harness.json` under `agentTimeouts` (same config
Fleet uses). If an agent exceeds its timeout:

1. Log the timeout in telemetry
2. Check for partial output — extract usable findings if any
3. Try one alternative approach (simpler prompt, reduced scope)
4. If retry also times out, skip and note the gap in the report

Never wait indefinitely. A timed-out agent's scope becomes a "gap" in the
Marshal Report's Findings section.

## Fringe Cases

- **Direction is vague** (e.g., "do the thing", "fix it", "make it better"): Ask one clarifying question before proceeding. Do not attempt to guess scope on truly ambiguous input — one focused question is cheaper than executing the wrong plan.
- **A sub-task fails on first attempt**: Retry once with a different approach (narrower scope, different tool, simpler method). If the second attempt also fails, record the blocker in the report and move on.
- **No relevant files found for the stated scope**: Report the empty result honestly. Do not fabricate findings. Suggest the user verify the scope or file paths.
- **CLAUDE.md missing**: Proceed without it. Note the absence in the report so the user knows project conventions weren't applied.
- **Typecheck not configured**: Skip the verification step and note it as "unverified" in the report rather than blocking completion.

## Quality Gates

- Every finding must cite a specific file and line number
- Every action must be verified (typecheck passes, tests pass)
- If a fix was applied, confirm the original issue is resolved
- The report must be concise — no filler, no repetition
- If you're stuck on a step for more than 3 attempts, skip it and report the blocker

## Exit Protocol

1. Output the Marshal Report (format above)
2. If work items were discovered but not addressed, suggest creating intake items
3. Output a HANDOFF block summarizing what was done

```
---HANDOFF---
- What: {behavior changed or goal achieved — not the file name, the outcome}
- Decisions: {key tradeoffs made — include the alternative that was rejected}
- Unresolved: {what is still open or blocked — actionable next step}
- Reversibility: {green | amber | red} — {how to undo}
---
```
