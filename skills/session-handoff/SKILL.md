---
name: session-handoff
license: MIT
description: >-
  Synthesizes the current session into a structured HANDOFF block for context
  transfer between sessions. Captures what was built, decisions made, and
  unresolved items.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - handoff
  - session summary
last-updated: 2026-10-15
---

# /session-handoff — Context Transfer

## Identity

You summarize the current task accurately and economically so another session can continue it.

## Orientation

Use when ending a session and wanting to preserve context for the next one.
Also used automatically by orchestrators (Archon, Fleet) at session boundaries.

**Don't use when:** You want to extract reusable patterns from a completed campaign (use `/learn`), write a structured postmortem for a failed campaign (use `/postmortem`), or produce documentation rather than a context transfer.

## Protocol

1. **Reuse current evidence first**:
   - Start with the task, edits, verification results, decisions, and blockers already established in this session. If they are sufficient for a truthful handoff, make no tool calls.
   - Do not repeat Git inspections, scan campaign/fleet directories, or read unrelated history merely to fill the format. A handoff summarizes work; it does not start a new audit.
   - If a material fact is missing or may have changed since it was checked, perform one targeted read. Batch related checks into that call and limit them to the task's files or known campaign. If no budget remains, state the uncertainty rather than delaying or inventing a verification result.

2. **Identify the primary thread**: Use the current task and its known campaign, if any, as the anchor. Mention other campaigns only when they are already known and affect the handoff. Do not discover unrelated work to create a frame.

3. **Map data to HANDOFF fields**:
   - *What changed*: actual task output and files changed; distinguish committed, uncommitted, and proposed work when known
   - *Key decisions*: the decisions and reasons established while doing the task
   - *Unresolved items*: failed or missing verification, known blockers, and explicitly deferred work
   - *Next steps*: the next actionable step, or "none" when the task is complete

4. Output the HANDOFF block.

## Output Format

```
---HANDOFF---
- {what was built or changed — be specific}
- {key decisions and tradeoffs — include reasoning}
- {unresolved items — what's blocking}
- {next steps — what the next session should do first}
---
```

Keep it to 3-5 bullets, under 150 words. This is a context transfer, not a report.

## Quality Gates

- Every bullet must be actionable or informative
- No vague statements ("made progress on X")
- Specific file references where relevant
- Decisions include reasoning, not just the choice

## Fringe Cases

**`.planning/` does not exist or was not inspected**: Summarize the current task from session evidence. Do not inspect Git or infer campaign status merely to fill the handoff.

**A relevant campaign file was found to be corrupted or unparseable**: State that its status is unknown and name the file. Do not treat unreadable state as inactive or scan for other campaigns.

**No active campaign and no git changes**: If there is nothing to summarize, say so explicitly: "No active campaign or session changes found. Nothing to hand off." Do not fabricate a handoff.

**No context to summarize** (fresh session with no edits): Output a minimal handoff noting the session start state. At minimum, include what the user asked about and what was found.

**Campaign is in a blocked/parked state**: Include the block reason and the recommended next action in the handoff so the next session can resume immediately.

## Contextual Gates

**Reversibility:** Green — this skill writes nothing to disk; the HANDOFF block is display-only.
**Cost:** No cost actions — synthesis only; no agents spawned, no confirmation needed.
**Trust:** No gates — safe at all trust levels.

## Exit Protocol

Output the HANDOFF block and then wait for the next command. This skill does not write to disk — the HANDOFF block is the deliverable, for the user to copy into the next session or save manually.
