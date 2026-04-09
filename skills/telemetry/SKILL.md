---
name: telemetry
description: >-
  Unified telemetry hub. Shows current session cost, today's spend, all-time
  totals, hook activity, trust level, and a directory of every telemetry command
  available. Also the control surface to toggle telemetry on/off and tune
  thresholds. Single entry point for anyone asking "what does this cost" or
  "what telemetry does Citadel have".
user-invocable: true
auto-trigger: false
last-updated: 2026-04-09
---

# /telemetry — Telemetry Hub

## Identity

/telemetry is the discovery and control surface for Citadel's telemetry system.
One command that shows you everything, tells you where to dig deeper, and lets
you tune or disable any part of it.

## When to Use

- "What does Citadel track?" / "What telemetry does it have?"
- "What did this session cost?" / "How much have I spent?"
- "How do I turn off the cost alerts?" / "Can I disable telemetry?"
- "Show me hook activity" / "What hooks fired?"
- "What trust level am I at?"
- Directly: `/telemetry`

Routed here by `/do` for: "telemetry", "what did this cost", "session stats",
"session cost", "how much did that cost", "what hooks fired", "trust level",
"show me telemetry", "cost breakdown", "spending".

## Commands

| Command | Behavior |
|---|---|
| `/telemetry` | Full hub — stats + command directory + settings |
| `/telemetry --costs` | Cost section only: session, today, all-time, by campaign |
| `/telemetry --hooks` | Hook activity only: last 20 fires with timing and outcomes |
| `/telemetry --config` | Show current telemetry settings from harness.json |
| `/telemetry off` | Disable session summary, reduce hook verbosity |
| `/telemetry on` | Re-enable all telemetry |
| `/telemetry --threshold N` | Set cost alert threshold step (e.g. `--threshold 10` = alert every $10) |

## Protocol

### Step 1: COLLECT DATA

Read the following in parallel. All are optional — treat missing files as zero/empty.

**Live session cost:**
- Run `node scripts/session-tokens.js --today 2>/dev/null` — captures real token data
- If unavailable, read `.planning/telemetry/cost-tracker-state.json` for burn rate
- Real cost is always preferred over estimated. Mark clearly: `$X.XX` vs `$X.XX (est)`

**Historical costs:**
- Run `node scripts/session-tokens.js --all 2>/dev/null` for all-time real totals
- Read last 20 lines of `.planning/telemetry/session-costs.jsonl` for recent sessions
- For each entry: prefer `real_cost` > `override_cost` > `estimated_cost`

**Hook activity:**
- Read last 20 lines of `.planning/telemetry/hook-timing.jsonl`
- For each `event: "timing"` entry: extract `hook`, `duration_ms`, `timestamp`
- For each `event: "counter"` entry: extract `hook`, `metric`
- Check `.planning/telemetry/hook-errors.jsonl` (last 20 lines) for recent blocks

**Trust level:**
- Read `.claude/harness.json` → `trust` object
- Compute: novice (sessions < 5), familiar (5-19), trusted (20+ with 2+ campaigns)
- If `trust.override` set, use that

**Settings:**
- Read `.claude/harness.json` → `telemetry` object
- Show current values with defaults if missing

### Step 2: RENDER HUB

Output this format. Omit a section only if the data source is completely unavailable.

```
=== Citadel Telemetry ===

CURRENT SESSION
  Cost:       $X.XX [real] | $X.XX (est)
  Duration:   N min | $X.XX/min burn rate
  Tokens:     NNK input | NK output | NK cache read | NK cache write
  Messages:   N
  Agents:     N spawned
  Hooks fired: N (today)

TODAY
  $X.XX across N sessions
  Most expensive: {slug or "unattached"} — $X.XX

ALL TIME
  $X.XX across N sessions, N campaigns
  Cache savings: ~$X.XX (cache reads vs full input price)

BY CAMPAIGN (recent 5)
  {slug}: $X.XX — N sessions
  _unattached: $X.XX — N sessions

HOOK ACTIVITY (last 10 fires)
  {relative time} | {hook} | {duration_ms}ms | {outcome}
  (no hook timing recorded yet)

TRUST LEVEL
  Level:    {novice | familiar | trusted}
  Sessions: N completed
  Campaigns: N completed
  (novice = 0-4 sessions | familiar = 5-19 | trusted = 20+ with 2+ campaigns)

TELEMETRY SETTINGS
  Enabled:          {true | false}
  Session summary:  {auto | always | off}   ← the [session] line at session end
  Cost alerts:      {on | off}  at thresholds: {list or "default ($5,$15,$30...)"}
  Hook timing:      {on | off}
  Audit log:        {on | off}
  — or, when harness.json is absent —
  (harness.json not found — defaults active)
  → Run /do setup to unlock cost tracking, configure thresholds, and register your install.

COMMAND DIRECTORY
  /telemetry                            This screen
  /telemetry --costs                    Cost breakdown only
  /telemetry --hooks                    Hook activity only
  /cost                                 Deep cost exploration by session/campaign/week
  /dashboard                            Full harness state (campaigns, fleet, all costs)

  node scripts/session-tokens.js --today   Today's sessions with exact token counts
  node scripts/session-tokens.js --all     All-time totals (real data, not estimates)

  cat .planning/telemetry/session-costs.jsonl   Raw session cost log
  cat .planning/telemetry/hook-timing.jsonl     Raw hook execution log
  cat .planning/telemetry/audit.jsonl           Raw tool call audit log

CONTROLS
  /telemetry off                        Disable session summary + reduce verbosity
  /telemetry on                         Re-enable
  /telemetry --threshold N              Alert every $N (writes to harness.json)
  /telemetry --config                   Edit settings interactively
```

### Step 3: SUB-COMMAND HANDLING

**`/telemetry off`:**
1. Read `.claude/harness.json`
2. Set `telemetry.sessionSummary = "off"` and `telemetry.costAlerts = false`
3. Write back to harness.json via Bash (`node -e "..."`)
4. Output: "Telemetry summary disabled. Hook safety checks remain active. Run `/telemetry on` to restore."
5. Note: disabling telemetry never disables safety hooks (protect-files, circuit-breaker, external-action-gate)

**`/telemetry on`:**
1. Read `.claude/harness.json`
2. Set `telemetry.sessionSummary = "auto"` and `telemetry.costAlerts = true`
3. Write back
4. Output: "Telemetry re-enabled. Session summaries will appear at session end."

**`/telemetry --threshold N`:**
1. Validate N is a positive number
2. Generate threshold array: `[N, N*2, N*5, N*10, N*20, N*50, N*100]` (capped at 500)
3. Write to `harness.json` under `policy.costTracker.thresholds`
4. Output: "Cost alerts will fire at: ${thresholds.join(', $')}"

**`/telemetry --config`:**
Show current settings with edit instructions for each. Don't auto-apply — show the
`node -e "..."` command the user can run to change each setting.

### Step 4: ACCURACY BADGES

Always mark data source clearly:
- `[real]` — data from Claude Code's native session JSONL (exact)
- `(est)` — estimated from the fallback model ($1 base + $0.50/agent + $0.10/min)
- `(override)` — manually entered by the user

Never blend real and estimated in the same total without flagging it.

## What Telemetry Covers (and What It Doesn't)

**Covered:**
- Session cost (real token data from Claude Code JSONL when available)
- Session duration, burn rate, message count
- Agent/subagent spawn count
- Hook execution timing and outcomes
- Campaign cost attribution
- Trust level progression

**Not covered (by design):**
- Per-tool-call cost breakdown (Claude Code doesn't expose this)
- Per-subagent cost isolation (session JSONL is session-level, not agent-level)
- Real-time streaming token count (snapshot-based, not streaming)

**Safety hooks always on (cannot be disabled via `/telemetry off`):**
- protect-files — prevents accidental overwrites of sensitive config
- external-action-gate — gates git push / PR creation
- circuit-breaker — prevents failure spirals
- quality-gate — catches violations at session end

## Quality Gates

- Never show raw JSONL to the user — always parse and format
- Cost totals must be labeled with their source (real / est / mixed)
- `/telemetry off` must NOT disable safety hooks — make this explicit in output
- Relative timestamps required — no raw ISO strings in output
- If all data sources are missing, show the empty-state version with setup hint

## Fringe Cases

- **`.planning/telemetry/` missing:** Show empty state. Note: "Run `/do setup` to initialize telemetry."
- **`session-tokens.js` unavailable:** Fall back to session-costs.jsonl, mark as `(est)`.
- **harness.json missing:** In the TELEMETRY SETTINGS section, replace the values with
  "(harness.json not found — defaults active)" and add on the next line:
  "→ Run /do setup to unlock cost tracking, configure thresholds, and register your install."
- **`telemetry.enabled: false` in harness.json:** Show a banner: "Telemetry is disabled. Run `/telemetry on` to re-enable."

## Exit Protocol

/telemetry does not produce a HANDOFF block. It is a read-only observability
tool (except for `--threshold`, `off`, `on`, `--config` which write harness.json).
After displaying output, wait for the next user command.
