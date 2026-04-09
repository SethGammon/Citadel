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

## Identity

/dashboard reads the live state of the harness and presents it in a single,
readable snapshot. No wall of JSON. No scrolling through log files. One
command, one screen, full picture.

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

Source 1 -- Real token data (primary):
- Run `node scripts/session-tokens.js --today` and `node scripts/session-tokens.js --all`
- If the script exists and produces output, use its numbers (they read Claude Code's
  native session JSONL files for exact token counts and compute cost from API pricing).

Source 2 -- Session costs JSONL (fallback, also provides campaign attribution):
- Read `.planning/telemetry/session-costs.jsonl` (if it exists)
- For each line, parse as JSON
- Cost priority: `real_cost` > `override_cost` > `estimated_cost`
- Group by `campaign_slug`. For each group:
  - Count sessions
  - Sum best available cost
  - Sum agents spawned and duration minutes
- Compute grand total across all campaigns

Live session:
- Read `.planning/telemetry/cost-tracker-state.json` for current session burn rate

Data source indicator:
- If `real_cost` fields are present in session-costs.jsonl entries, note "(real)"
- If only `estimated_cost`, note "(est)" so users know accuracy level

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
- For each entry with `event: "timing"`, extract:
  - `hook` — which hook fired (e.g., `post-edit`, `circuit-breaker`)
  - `duration_ms` — execution time in milliseconds
  - `timestamp` — convert to relative time
  - `outcome` — derive from context: if `duration_ms` is present and no matching
    error entry in `hook-errors.jsonl`, outcome is `pass`; if a block entry exists
    for the same hook within 1 second, outcome is `block`
- For entries with `event: "counter"` (from `increment()`), extract metric name
  as the "event" column with count context
- This section makes silently-firing hooks visible without digging through raw files

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

### Step 2: FORMAT RELATIVE TIMESTAMPS

Convert ISO timestamps to human-readable relative time:
- < 60 seconds ago: "just now"
- < 60 minutes ago: "{N} min ago"
- < 24 hours ago: "{N} hr ago"
- >= 24 hours ago: "{N} days ago"

If a timestamp is unparseable, display it as-is without crashing.

### Step 3: RENDER DASHBOARD

Output the following format verbatim, substituting real values.
Omit sections that are entirely empty only if explicitly noted below.
Always show the section header even when the content is "(none active)".

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

QUICK COMMANDS
  /do continue    — resume active campaign
  /do rollback    — restore last checkpoint
  /triage prs     — review open PRs
  /pr-watch       — watch PR CI
  /learn          — extract patterns from last completed campaign
```

### Step 4: FRINGE CASE HANDLING

**If .planning/ does not exist:**
Show the dashboard with all counts as 0 and all lists as "(none active)" or
"(no telemetry recorded yet)". Add a note below the dashboard:

```
NOTE: .planning/ not found. Run /do setup to initialize harness state.
```

**If harness.json is missing or malformed:**
Show "not configured" for hooks count. Do not crash.

**If a campaign file is malformed markdown:**
Skip that file. Log `(1 campaign file skipped — malformed)` in the CAMPAIGNS
section if any were skipped.

**If telemetry files are very large:**
Only read the last 50 lines of each telemetry file. This caps read cost
regardless of file size. Note: "Showing last 50 events per log file."

**If timestamps are missing from telemetry entries:**
Use the file's modification time as a fallback. If that's also unavailable,
display the entry without a timestamp.

## Quality Gates

- Dashboard must render even when all state files are missing
- Never display raw JSON to the user — always parse and format
- Relative timestamps required — never show raw ISO strings in output
- Campaign direction truncated to 60 chars with "..." if longer
- Total output must be skimmable in under 30 seconds

## Exit Protocol

/dashboard does not produce a HANDOFF block. It is a read-only observability
tool. After displaying the dashboard, wait for the next user command.
