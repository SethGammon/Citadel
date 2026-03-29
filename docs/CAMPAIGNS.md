# Campaigns

> last-updated: 2026-03-20

Campaigns are the persistence mechanism for multi-session work. They're the only
state that survives across context windows.

## The Pipeline

```
Intake → Brief → Plan → Build → Verify → Archive
```

1. **Intake**: Ideas enter as files in `.planning/intake/`
2. **Brief**: `/autopilot brief` researches and scopes the idea
3. **Plan**: Archon decomposes into 3-8 phases
4. **Build**: Sub-agents execute each phase
5. **Verify**: Typecheck, tests, quality checks
6. **Archive**: Campaign moves to `campaigns/completed/`

## Campaign File Format

```markdown
# Campaign: {Name}

Status: active | completed | parked
Started: {ISO timestamp}
Direction: {original user direction}

## Claimed Scope
- {directories this campaign modifies}

## Phases
1. [pending] Research: {what to investigate}
2. [pending] Build: {what to construct}
3. [pending] Verify: {what to check}

## Feature Ledger
| Feature | Status | Phase | Notes |
|---------|--------|-------|-------|

## Decision Log
- {timestamp}: {decision}
  Reason: {why}

## Active Context
{where the campaign is right now — updated every session}

## Continuation State
Phase: {number}
Sub-step: {within the phase}
Files modified: {list}
Blocking: {any blockers}
```

## Section Purposes

| Section | Purpose |
|---------|---------|
| Claimed Scope | Coordination — prevents other agents from touching these files |
| Phases | Progress tracking — what's done, what's left |
| Feature Ledger | Artifact tracking — what was actually built |
| Decision Log | Prevents re-debating — choices are recorded with reasoning |
| Active Context | Human-readable status — where we are right now |
| Continuation State | Machine-readable — next Archon picks up here |

## Continuation Across Sessions

Each Archon invocation is amnesiac. It rebuilds context from:

1. **Campaign file** — state, decisions, progress
2. **CLAUDE.md** — project conventions
3. **Recent files** — what changed since last session

This is why the campaign file must be thorough. Everything Archon needs
to continue must be in the file.

## Phase Types

| Type | Purpose | Typical Duration |
|------|---------|-----------------|
| research | Read-only investigation | 15-30 min |
| plan | Architecture decisions | 15-30 min |
| build | Write code | 30-120 min |
| wire | Connect systems | 15-60 min |
| verify | Test and check | 15-30 min |
| prune | Clean up | 15-30 min |

## Intake Items

Drop a markdown file in `.planning/intake/`:

```markdown
---
title: "Feature Name"
status: pending
priority: normal
target: src/path/to/area/
---

Description of what needs to be done...
```

The SessionStart hook reports pending items on every new session.
Process them with `/autopilot` or manually with `/do`.

## See Also

- `examples/campaign-example.md` — A complete, realistic campaign
- `.planning/_templates/campaign.md` — Campaign template
- `.planning/_templates/intake-item.md` — Intake item template
