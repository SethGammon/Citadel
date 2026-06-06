---
name: dashboard
description: >-
  Real-time harness observability dashboard. Reads campaigns, fleet sessions,
  telemetry, and pending queues to present a snapshot of harness state at a
  glance. Invoked by /dashboard, /do status, or phrases like "what's happening"
  and "show activity".
user-invocable: true
auto-trigger: false
last-updated: 2026-03-26
---

# /dashboard — Harness Observability Dashboard

## When to Use

- "What's happening?" / "Status?" / "What's going on?"
- "Show activity" / "Show me the dashboard"
- After returning to a project after time away
- When /do routes "status", "dashboard", "what's happening", "what's going on", "show activity"
- Directly: `/dashboard`

## Inputs

None required. Works with whatever state exists on disk.

## Protocol

### Step 0: RUN DASHBOARD IMPLEMENTATION

Run the local dashboard implementation from the project root:

```bash
node scripts/dashboard.js
```

If the package scripts are available, this equivalent command is also valid:

```bash
npm run dashboard
```

The script is read-only. It renders a user-facing control-plane snapshot from
`.planning/`, telemetry, hook config, coordination state, worktrees, and cost
data. Use the manual collection protocol below only as a fallback if the script
is missing or fails in the current project.

### Step 1: COLLECT STATE

Read the following sources. Each is optional — if a file or directory doesn't
exist, treat it as empty. Never crash on missing state.

**Campaigns:**
- Glob `.planning/campaigns/*.md`
- For each file, read the first 40 lines to extract:
  - `Status:` field
  - `Direction:` field (truncate to 60 chars)
  - Phase progress (search for `Phase N of M` or `## Phase` headings)
  - Most recent line starting with `- [` from the Decision Log
- If all phases are complete but status is still active, report
  `needs-completion` and show:
  `node scripts/campaign.js complete <slug> --archive`
- If a campaign is marked completed but still lives in `.planning/campaigns/`,
  report `needs-archive` and show the same archive command.
- If prior build/verify phases are complete but the `review-package` Exit
  Evidence row is still pending, missing, or points at a missing local package,
  report a repair before campaign completion:
  `node scripts/package-delivery.js <slug>`

**Cost Data (two sources, prefer real):**

- Primary: run `node scripts/session-tokens.js --today` and `--all` — reads Claude Code's native session JSONL for exact token counts
- Fallback: read `.planning/telemetry/session-costs.jsonl`; cost priority `real_cost` > `override_cost` > `estimated_cost`; group by `campaign_slug`, sum cost/agents/minutes, compute grand total
- Live session: read `.planning/telemetry/cost-tracker-state.json` for burn rate
- Label real data "(real)" and estimates "(est)"

**Fleet Sessions:**
- Glob `.planning/fleet/session-*.md`
- For each file, read the first 30 lines to extract:
  - `status:` field
  - `wave:` or wave number
  - `agents:` or agent count

**Recent Telemetry:**
- Read last 50 lines of `.planning/telemetry/hook-timing.jsonl` (if it exists)
- Read last 50 lines of `.planning/telemetry/audit.jsonl` (if it exists)
- Merge and sort by timestamp (descending). Take the 10 most recent entries.
- For each entry: extract `ts` (or `timestamp`), `hook` (or `event`), and a
  short description field. Format as relative time.

**Recent Hook Activity (separate from general telemetry):**
- Read last 20 lines of `.planning/telemetry/hook-timing.jsonl`
- For `event: "timing"` entries: extract `hook`, `duration_ms`, `timestamp` (relative), and `outcome` (pass if no matching error in hook-errors.jsonl within 1s; block if a block entry exists)
- For `event: "counter"` entries: extract metric name as the "event" column with count context

**Pending Queues:**
- Count actionable entries in `.planning/telemetry/doc-sync-queue.jsonl` where `status` is `pending` or `needs-review` (or 0 if missing)
- Count lines in `.planning/telemetry/merge-check-queue.jsonl` (or 0 if missing)
- Count files in `.planning/intake/` (or 0 if missing)

**Hook Value Data (for HOOKS VALUE section):**
- Read `.planning/telemetry/hook-errors.jsonl` (if it exists, last 200 lines)
  - Count entries where `hook` = "protect-files" (blocked file access)
  - Count entries where `hook` = "external-action-gate" (gated external actions)
  - Count entries where `hook` = "quality-gate" (quality violations)
- Read `.planning/telemetry/hook-timing.jsonl` (if it exists, last 200 lines)
  - Count entries where `hook` = "circuit-breaker" and `metric` = "trips"
  - Count total entries from today (entries containing today's ISO date prefix)
- Read `.planning/telemetry/audit.jsonl` (if it exists, last 200 lines)
  - Count entries mentioning "circuit-breaker" or "circuit_breaker"

**Hook Problem Taxonomy:**
- Read last 100 entries from `.planning/telemetry/hook-errors.jsonl`.
- Classify `protect-files` blocks and hard `external-action-gate` blocks as
  `safety-block` with `info` severity; they prove protection fired and do not
  create a repair action by themselves.
- Classify `error` and `parse-fail` actions as `hook-failure` with `high`
  severity; these are actionable.
- Classify `blocked-restricted` as `restricted-scope-block` with `high`
  severity; this is actionable.
- Classify `first-encounter` and `consent-block` from `external-action-gate` as
  `approval-needed` with `medium` severity; this is actionable.
- If an `external-action-gate` approval entry has a later matching
  `tool-call` entry in `audit.jsonl`, classify it as `resolved-approval` with
  `info` severity; it should not create a repair action. Treat `git push -u`
  and `git push` as equivalent for the same branch, and allow a small
  near-simultaneous timestamp skew between hook and tool-call entries.
- If an unresolved external approval entry is older than 15 minutes, classify
  it as `stale-approval` with `low` severity; it should not create a current
  repair action.
- Classify entries older than 24 hours as `stale` with `low` severity and do
  not create a repair action from stale entries.
- The `/telemetry` repair action should appear only when actionable entries are
  present. Safety blocks remain visible in PROBLEMS and HOOKS VALUE.

**Health:**
- Count circuit breaker entries from audit.jsonl (from hook value data above)
- Count total lines in `.planning/telemetry/audit.jsonl` written today
- Count entries in `hooks` array of `.claude/hooks-template.json` (or
  `.claude/hooks.json` if template not present); use 0 if neither exists
- Read `.claude/harness.json` → `trust` object:
  - `sessions_completed`, `campaigns_completed` counters
  - Compute level: novice (sessions < 5), familiar (5-19), trusted (20+ with 2+ campaigns)
  - If `trust.override` is set, use that and note "(override)"

### Step 2: FORMAT RELATIVE TIMESTAMPS

Convert ISO timestamps: <60s → "just now" | <60min → "{N} min ago" | <24h → "{N} hr ago" | else → "{N} days ago". Display unparseable timestamps as-is.

### Step 3: RENDER DASHBOARD

Output verbatim, substituting real values. Always show section headers even when content is "(none active)".

```
=== Citadel Dashboard ===
As of: {relative timestamp of most recent event, or "now"}

NEXT ACTION
  Command: {exact command}
  Why: {why this is next}
  Confidence: {low | medium | high}
  Repair available: {yes | no}
  Runbook: {docs or skill path}

REPAIR CONSOLE
  {repair|review} | {confidence} | {label}
    command: {exact command}
    why: {short reason}
    runbook: {docs or skill path}

CAMPAIGNS
  {slug}: Phase {N}/{total} — {direction, max 60 chars, ellipsis if truncated}
  Last event: {most recent telemetry entry for this campaign, or "no telemetry"}
  (none active)

COSTS
  This session: ${cost} | {duration} min | ${rate}/min | {messages} msgs | {agents} agents
  Today:        ${today_total} across {today_sessions} sessions
  All time:     ${all_time_total} across {all_time_sessions} sessions ({data_source})

  By campaign:
    {slug}: ${total_cost} across {sessions} sessions ({agents} agents, {minutes} min)
    _unattached: ${total_cost} across {sessions} sessions
  (no cost data recorded yet)

HOOKS VALUE
  Circuit breaker: {N} trips (prevented token spirals)
  Quality gate:    {N} violations caught pre-commit
  Protect-files:   {N} blocks (path traversal, secrets)
  External gate:   {N} actions gated
  Total hook fires today: {N}
  (raw facts only -- no inflated savings claims)

FLEET SESSIONS
  {slug}: Wave {N} — {agent count} agents — {status}
  (none active)

RECENT ACTIVITY (last 10 events)
  {relative time} | {hook/event name} | {description}
  (no telemetry recorded yet)

HOOK ACTIVITY (last 10 hook fires)
  {relative time} | {hook name} | {duration_ms}ms | {outcome: pass/block/warn}
  (no hook timing recorded yet — set CITADEL_DEBUG=true in settings.json for verbose output)

PROBLEMS
  Actionable: {N} | Safety blocks: {N} | Resolved approvals: {N} | Stale: {N}
  {relative time} | {severity} | {category} | {hook name} | {description}
  (none recorded)

PENDING
  Doc sync:     {N} items queued
  Merge reviews: {N} items queued
  Intake items:  {N} in .planning/intake/

HEALTH
  Circuit breaker trips this session: {N}
  Audit entries today:                {N}
  Hooks installed:                    {N}
  Trust level:                        {novice | familiar | trusted} ({N} sessions, {N} campaigns)

QUICK COMMANDS
  /do continue    — resume active campaign
  /do rollback    — restore last checkpoint
  /telemetry      — cost breakdown, hook activity, telemetry settings
  /triage prs     — review open PRs
  /pr-watch       — watch PR CI
  /learn          — extract patterns from last completed campaign
```

### Step 4: FRINGE CASE HANDLING

**`.planning/` missing:** All zeros, "(none active)"; add "Run /do setup --express to initialize."
**harness.json missing or malformed:** Show "not configured" for hooks count; do not crash.
**Malformed campaign file:** Skip it; note `(N campaign file(s) skipped — malformed)`.
**Large telemetry files:** Read last 50 lines only.
**Missing timestamps:** Fall back to file modification time; display entry without timestamp if unavailable.
**All campaigns completed:** Note "No active campaigns" at top of CAMPAIGNS section.
**Completed campaign still active:** Show the exact `node scripts/campaign.js complete <slug> --archive` repair command; do not tell the user to `/do continue`.
**Campaign ready for review package:** Show the exact `node scripts/package-delivery.js <slug>` repair command before showing campaign completion.
**All fleet sessions idle:** Note "No active fleet sessions" under FLEET SESSIONS.
**Mixed state:** Proceed with whatever state exists; note each missing directory inline.
**Doc-sync backlog:** Surface `/learn --doc-sync` as a repair action with `skills/learn/SKILL.md` as runbook.
**Dirty worktree:** Surface `git status --short` as a review action; do not suggest destructive cleanup.
**Only safety blocks recorded:** Show them in PROBLEMS and HOOKS VALUE, but do not surface `/telemetry` as NEXT ACTION.
**Actionable hook problem recorded:** Surface `/telemetry` as repair action with `skills/telemetry/SKILL.md` as runbook.

## Contextual Gates

**Disclosure:** "Displaying harness dashboard. No files modified."
**Reversibility:** green — read-only; no files modified
**Trust gates:**
- Any: view the full dashboard

## Quality Gates

- Dashboard must render even when all state files are missing
- Never display raw JSON to the user — always parse and format
- Relative timestamps required — never show raw ISO strings in output
- Campaign direction truncated to 60 chars with "..." if longer
- NEXT ACTION must include command, why, confidence, repair availability, and runbook when known
- REPAIR CONSOLE must list actionable repairs before raw activity logs
- Safety blocks must not be treated as urgent repairs unless paired with an actionable hook failure, approval, or restricted-scope block
- Total output must be skimmable in under 30 seconds

## Exit Protocol

/dashboard does not produce a HANDOFF block. It is a read-only observability
tool. After displaying the dashboard, wait for the next user command.
