---
name: postmortem
description: >-
  Auto-generates a structured postmortem from a completed campaign. Reads the
  campaign file, telemetry logs, and feature ledger. Produces a documented
  analysis of what broke, what the safety systems caught, and what patterns
  emerged. Can also be invoked manually for any incident.
user-invocable: true
auto-trigger: false
effort: medium
---

# /postmortem — Campaign Postmortem Generator

## Orientation

**Use when:** A campaign just completed and you want a structured analysis of what broke, what safety systems caught, and what patterns emerged. Also for ad-hoc incident analysis from recent git history.

**Don't use when:** You want to preserve session context for the next conversation (use `/session-handoff`), extract reusable patterns from findings into the knowledge base (use `/learn`), or score and improve quality iteratively (use `/improve`).

## When to Use

- After any Archon campaign completes (Archon should suggest it)
- After a difficult debugging session
- When the user says "what just happened" or "what broke"
- When /do routes "postmortem", "retro", "what broke", "what happened"

## Inputs

One of:
1. A campaign file path (.planning/campaigns/*.md)
2. A time range ("last session", "today", "this week")
3. Nothing (reads the most recent completed campaign)

## Protocol

### Step 1: GATHER

Collect data from all available sources:

**From the campaign file (if it exists):**
- Direction vs what was actually built (scope drift?)
- Phase completion timeline (which phases needed rework?)
- Decision log entries (what architectural choices were made?)
- Review queue items (what needed human eyes?)
- Circuit breaker activations (what hit the limit?)
- Feature ledger (what shipped?)

**From telemetry (.planning/telemetry/):**
- hook-timing.jsonl: which hooks fired most, any patterns
- hook-errors.log: what was blocked, what failed, what had parse errors
- Circuit breaker trips
- Quality gate violations

**From git history:**
- Commits during the campaign period
- Files changed (which areas got the most churn?)
- Any reverts (what was undone?)
- Commit message patterns (fix: commits indicate bugs found)

**From the session itself (if no campaign):**
- Recent tool calls and their outcomes
- Files edited and errors encountered

### Step 2: ANALYZE

Identify patterns across the data:

1. **What broke:** List every failure, error, or unexpected outcome.
   For each: what happened, what caught it (hook/gate/human/nothing),
   what it cost (time, rework, tokens).

2. **What the safety systems caught:** Circuit breaker activations,
   quality gate blocks, anti-pattern warnings, typecheck failures.
   This is the "invisible value" section — problems prevented.

3. **What drifted:** Compare the campaign direction to what was built.
   Did scope expand? Did phases get skipped or reordered? Did the
   architecture change mid-build?

4. **What patterns emerged:** Recurring error types, files that kept
   needing fixes, phases that took longest, common anti-patterns.

### Step 3: PRODUCE

Write to `.planning/postmortems/postmortem-{slug}-{date}.md`:

```markdown
# Postmortem: {Campaign Name or Session Description}

> Date: {ISO date}
> Campaign: {path to campaign file, or "ad-hoc session"}
> Duration: {time from first to last commit}
> Outcome: {completed | partial | parked}

## Summary
{2-3 sentences: what was attempted, what happened, what the result was}

## What Broke
{Numbered list. For each:}
### {N}. {Short description}
- **What happened:** {the failure}
- **Caught by:** {hook name / quality gate / human / nothing}
- **Cost:** {rework time, files affected, phases repeated}
- **Fix:** {what resolved it}
- **Infrastructure created:** {new hook rule, new anti-pattern, new end condition — or "none needed"}

## What Safety Systems Caught
{Things that WOULD have been problems without the hooks/gates}
| System | What It Caught | Times | Impact Prevented |
|--------|---------------|-------|-----------------|
| {hook/gate name} | {description} | {count} | {what would have happened} |

## Scope Analysis
- **Planned:** {what the campaign direction said}
- **Built:** {what the feature ledger shows}
- **Drift:** {none | minor | significant — with specifics}

## Patterns
{Recurring themes worth watching:}
- {pattern 1}
- {pattern 2}

## Recommendations
{Concrete next actions:}
1. {recommendation — e.g., "Add anti-pattern rule for X"}
2. {recommendation — e.g., "Phase Y needs tighter end conditions"}

## Numbers
| Metric | Value |
|--------|-------|
| Phases planned | {N} |
| Phases completed | {N} |
| Commits | {N} |
| Files changed | {N} |
| Circuit breaker trips | {N} |
| Quality gate blocks | {N} |
| Anti-pattern warnings | {N} |
| Rework cycles | {N} |
```

### Step 4: HANDOFF

Output the HANDOFF block from the Exit Protocol, then suggest: `Run /learn {campaign-slug} to extract patterns into the knowledge base.`

## What /postmortem Does NOT Do

- Invent failures that didn't happen (real data only)
- Blame the user or the model (document what happened, not whose fault)
- Recommend changes to skill files (that's for the user to decide)
- Run during a campaign (only after completion or on demand)

## Quality Gates

- Every "What Broke" entry has all 5 fields filled
- Numbers section has real data (not estimates)
- Recommendations are concrete actions (not "be more careful")
- If no failures occurred, say so honestly (don't manufacture drama)

## Fringe Cases

**Campaign not found**: If the specified campaign file doesn't exist, check `.planning/campaigns/` for the most recently modified campaign. If no campaigns exist, run in ad-hoc mode using recent git history and session context.

**No telemetry data**: Proceed without telemetry. Mark the "What Safety Systems Caught" table as "No telemetry available" and the Numbers section fields as "N/A". Don't manufacture data.

**Partial campaign** (parked or in-progress): Generate the postmortem with `Outcome: partial`. Document what was completed and what was parked. Include a "Remaining Work" section listing incomplete phases.

**If .planning/postmortems/ does not exist**: Create it before writing. If `.planning/` itself doesn't exist, output the postmortem inline and note: "Run /do setup to initialize .planning/ for future storage."

## Exit Protocol

```
---HANDOFF---
- Postmortem: {name}
- Document: .planning/postmortems/postmortem-{slug}-{date}.md
- Failures documented: {count}
- Safety catches: {count}
- Recommendations: {count}
- Reversibility: green — one file written to .planning/postmortems/; git rm to undo
---
```

After displaying the HANDOFF block, suggest: `Run /learn {campaign-slug} to extract patterns into the knowledge base.`
