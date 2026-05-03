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
- Count lines in `.planning/telemetry/doc-sync-queue.jsonl` (or 0 if missing)
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

**`.planning/` missing:** Show dashboard with all zeros and "(none active)"; add `NOTE: .planning/ not found. Run /do setup to initialize harness state.`

**harness.json missing or malformed:** Show "not configured" for hooks count; do not crash.

**Malformed campaign file:** Skip it; note `(N campaign file(s) skipped — malformed)` in CAMPAIGNS.

**Large telemetry files:** Read last 50 lines only; note "Showing last 50 events per log file."

**Missing timestamps:** Fall back to file modification time; if unavailable, display entry without timestamp.

## Fringe Cases

- **No `.planning/` directory**: render the dashboard with all sections showing "(none active)" and zero counts; append: "No campaigns or fleet sessions found. Run /setup first, or start a campaign with /marshal or /fleet."
- **All campaigns completed**: show each campaign with its final status and completion date; note "No active campaigns — all campaigns are completed." at the top of the CAMPAIGNS section.
- **All fleet sessions idle or empty**: show the FLEET SESSIONS section with the idle sessions listed; note "No active fleet sessions. Start a fleet campaign with /fleet."
- **Mixed state (some dirs present, some missing)**: proceed with whatever state exists; note each missing directory inline, e.g. "(fleet: .planning/fleet/ not found)" under the relevant section.

## Quality Gates

- Dashboard must render even when all state files are missing
- Never display raw JSON to the user — always parse and format
- Relative timestamps required — never show raw ISO strings in output
- Campaign direction truncated to 60 chars with "..." if longer
- Total output must be skimmable in under 30 seconds

## Exit Protocol

/dashboard does not produce a HANDOFF block. It is a read-only observability
tool. After displaying the dashboard, wait for the next user command.
