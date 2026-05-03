---
name: session-handoff
description: >-
  Synthesizes the current session into a structured HANDOFF block for context
  transfer between sessions. Captures what was built, decisions made, and
  unresolved items.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-20
---

# /session-handoff — Context Transfer

## Orientation

Use when ending a session and wanting to preserve context for the next one.
Also used automatically by orchestrators (Archon, Fleet) at session boundaries.

## Protocol

1. **Collect session data** (run in parallel):
   - `git log --oneline -20` and `git diff HEAD --stat`
   - Read `.planning/campaigns/` for files with `status: active`
   - Read `.planning/fleet/` for files with `status: active` or `needs-continue`

2. **Identify the primary thread**: If an active campaign exists, use its current phase as the anchor. If multiple campaigns are active, list each. If no campaign, use the most recent git commits as the frame.

3. **Map data to HANDOFF fields**:
   - *What changed*: campaign phase output if campaign active; otherwise commit subjects from this session
   - *Key decisions*: commit messages with a tradeoff word ("instead", "because", "not"); or explicit statements from the conversation
   - *Unresolved items*: campaign items marked `blocked` or `parked`; TODOs added this session; anything explicitly deferred
   - *Next steps*: campaign's next phase if active; otherwise the top open item from above

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

**`.planning/` does not exist**: Skip campaign and fleet checks. Treat as "no active campaigns" and proceed with git-only context.

**No active campaign and no git changes**: If there is nothing to summarize, say so explicitly: "No active campaign or session changes found. Nothing to hand off." Do not fabricate a handoff.

**No context to summarize** (fresh session with no edits): Output a minimal handoff noting the session start state. At minimum, include what the user asked about and what was found.

**Campaign is in a blocked/parked state**: Include the block reason and the recommended next action in the handoff so the next session can resume immediately.

## Contextual Gates

**Reversibility:** Green — this skill writes nothing to disk; the HANDOFF block is display-only.
**Cost:** No cost actions — synthesis only; no agents spawned, no confirmation needed.
**Trust:** No gates — safe at all trust levels.

## Exit Protocol

Output the HANDOFF block and then wait for the next command. This skill does not write to disk — the HANDOFF block is the deliverable, for the user to copy into the next session or save manually.
