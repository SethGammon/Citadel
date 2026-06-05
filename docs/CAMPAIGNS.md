# Campaigns

> last-updated: 2026-05-07

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

Complete and archive a finished campaign with:

```bash
node scripts/campaign.js complete <campaign-slug> --archive
```

The command refuses to complete campaigns with unfinished phases unless
`--force` is used after human review. It also writes a `## Completion Record`
for merge links, verification notes, and final evidence.

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

## Phase Validation

Archon spawns a **Phase Validator** agent at the end of each build or wire phase to confirm exit conditions before the campaign advances. The validator reads the phase plan, checks actual file state, and returns `pass` or `fail` with a specific reason. On `fail`, Archon re-enters the phase rather than advancing — preventing partially-complete phases from silently propagating into later work.

For high-stakes decisions (abort, rollback, scope change), Archon may spawn 3 Phase Validators and require 2/3 agreement. A timed-out validator counts as `pass` to prevent indefinite blocking.

Campaigns can also declare an `## Exit Evidence` table. Run
`node scripts/evidence-validate.js --file <campaign.md> --target phase:<n>`
before advancing a phase. Required rows support file diffs, command results,
test results, screenshots, browser route checks, doc updates, PR links, local
review packages, review thread resolution, and hook status. Missing required
evidence reports a repair task while retries remain, then blocks advancement
when retries are exhausted.

## Policy Enforcement

Before executing Red-reversibility operations (force push, bulk delete, branch reset), Archon spawns a `policy-enforcer` agent — a read-only Haiku judge that checks the proposed action against the 3-tier constitution in `docs/CONSTITUTION.md`. A Tier 1 violation always blocks. The verdict and reason are logged to the Decision Log.

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

To convert the highest-priority pending item into an evidence-backed delivery
campaign:

```bash
node scripts/deliver.js --next
```

To convert a specific intake file:

```bash
node scripts/deliver.js --intake .planning/intake/<item>.md
```

The preflight creates `.planning/campaigns/<slug>.md`, marks the intake item
`in-progress`, records claimed scope and acceptance criteria, and seeds the Exit
Evidence table. Continue with `/do continue`.

When the implementation and verification phases are ready for review, create a
deterministic review package:

```bash
node scripts/package-delivery.js <campaign-slug>
```

This writes `.planning/review-packages/<campaign-slug>.md`, records that package
in the campaign's `review-package` Exit Evidence row, and marks the packaging
phase complete. If a pull request already exists, record it instead:

```bash
node scripts/package-delivery.js <campaign-slug> --pr https://github.com/<owner>/<repo>/pull/<number>
```

## Repair States

The dashboard reports campaign truth problems with executable repairs:

| Status | Meaning | Repair |
|---|---|---|
| `needs-review-package` | Build and verification phases are ready, but review package evidence is still pending or invalid | `node scripts/package-delivery.js <slug>` |
| `needs-completion` | All phases are complete, but campaign status is still active | `node scripts/campaign.js complete <slug> --archive` |
| `needs-archive` | Campaign status is completed, but the file is still in `.planning/campaigns/` | `node scripts/campaign.js complete <slug> --archive` |

## See Also

- `examples/campaign-example.md` — A complete, realistic campaign
- `.planning/_templates/campaign.md` — Campaign template
- `.planning/_templates/intake-item.md` — Intake item template
