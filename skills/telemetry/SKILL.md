---
name: telemetry
license: MIT
description: >-
  Unified telemetry hub. Shows current session cost, today's spend, all-time
  totals, hook activity, trust level, and a directory of every telemetry command
  available. Also the control surface to toggle telemetry on/off and tune
  thresholds. Single entry point for anyone asking "what does this cost" or
  "what telemetry does Citadel have".
user-invocable: true
auto-trigger: false
trigger_keywords:
  - telemetry
  - what did this cost
  - session cost
  - how much did that cost
  - how much have I spent
  - what hooks fired
  - trust level
  - show me telemetry
  - spending
  - session stats
  - what telemetry
  - verify audit
  - audit integrity
  - check audit
  - tampered records
last-updated: 2026-04-09
---

# /telemetry — Telemetry Hub

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
| `/telemetry --verify` | Telemetry and artifact integrity check: verify hashes/signatures, flag tampered records, report legacy records |
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
  /telemetry --verify                   Telemetry/artifact integrity check (hash/signature verification)
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

**`/telemetry off`:** Set `telemetry.sessionSummary = "off"` and `telemetry.costAlerts = false` in harness.json. Output: "Telemetry summary disabled. Hook safety checks remain active." Safety hooks (protect-files, circuit-breaker, external-action-gate) are never disabled.

**`/telemetry on`:** Set `telemetry.sessionSummary = "auto"` and `telemetry.costAlerts = true`. Output: "Telemetry re-enabled."

**`/telemetry --threshold N`:** Validate N is positive. Generate `[N, N*2, N*5, N*10, N*20, N*50, N*100]` (capped at 500). Write to `harness.json` under `policy.costTracker.thresholds`.

**`/telemetry --verify`:** Run the project verifier:

```
node scripts/verify-telemetry-integrity.js
```

The verifier scans `.planning/telemetry/*.jsonl` and `.planning/artifacts/*.jsonl`. Display verified, signed, legacy, tampered, invalid, and signature-warning counts. Use `--strict-legacy` only when old unsigned records should fail the check.

Output format:
```
=== Telemetry Integrity ===

file.jsonl
  Total records:    N
  Verified (hash):  N
  Verified (signed): N
  Legacy (no hash): N
  TAMPERED:         N
  Invalid JSON:     N
  Signature warnings: N

Status: CLEAN or FAILED
```

If any tampered records: list each with `timestamp`, `event`, and both the stored and expected hash (first 16 chars each). Tampering can indicate log corruption, manual edits, or a bug — not necessarily malicious.

If only legacy records (no tampered): note "Legacy records were written before telemetry integrity hashing was added. New telemetry and artifact records are hashed automatically."

**`/telemetry --config`:** Show current settings with the `node -e "..."` command to change each — don't auto-apply.

### Step 4: ACCURACY BADGES

Always mark data source clearly:
- `[real]` — data from Claude Code's native session JSONL (exact)
- `(est)` — estimated from the fallback model ($1 base + $0.50/agent + $0.10/min)
- `(override)` — manually entered by the user

Never blend real and estimated in the same total without flagging it.

## What Telemetry Covers

**Covered:** session cost (real token data), duration/burn rate/message count, agent spawn count, hook timing and outcomes, campaign cost attribution, trust level.

**Not covered (by design):** per-tool-call cost, per-subagent cost isolation, real-time streaming token count.

**Safety hooks always on (cannot be disabled):** protect-files, external-action-gate, circuit-breaker, quality-gate.

## OTLP Export

The JSONL files under `.planning/telemetry/` stay canonical. For standard observability
stacks, `scripts/telemetry-otlp-export.js` translates new records into OTLP/HTTP JSON
metrics and POSTs them to a collector. Byte offsets per source file live in
`.planning/telemetry/otlp-export-state.json`, so repeat runs export only new records.

```bash
# Preview the OTLP payload without sending or advancing state
node scripts/telemetry-otlp-export.js --dry-run

# Export new records to a local collector (/v1/metrics appended when the url has no path)
node scripts/telemetry-otlp-export.js --endpoint http://localhost:4318
```

| Metric | Type | Source file |
|---|---|---|
| `citadel.session.cost.usd` | sum (delta), `session.id` / `cost.source` attributes | `session-costs.jsonl` |
| `citadel.session.tokens` | sum (delta), `token.type` attribute | `session-costs.jsonl` |
| `citadel.hook.duration.ms` | gauge, `hook.name` attribute | `hook-timing.jsonl` |
| `citadel.agent.runs` | sum (delta), `run.status` / `run.event` attributes | `agent-runs.jsonl` |

`--reset` clears the offsets for a full re-export. On a non-2xx response or network
error the exporter exits 1 without advancing state, so the next run retries the same
records. Data point timestamps come from the JSONL records, never the current clock.
Test with `node scripts/test-telemetry-otlp.js`.

**Local collector demo:** `examples/otel-collector/` contains a ready-made collector
config (OTLP HTTP receiver on 4318, debug exporter to stdout) and a README with the
two-command flow: `docker run` with the config mounted, then
`node scripts/telemetry-otlp-export.js --endpoint http://localhost:4318`. Without
Docker, `--dry-run` prints the exact OTLP payload instead.

## Quality Gates

- Never show raw JSONL to the user — always parse and format
- Cost totals must be labeled with their source (real / est / mixed)
- `/telemetry off` must NOT disable safety hooks — make this explicit in output
- Relative timestamps required — no raw ISO strings in output
- If all data sources are missing, show the empty-state version with setup hint

## Fringe Cases

- **`.planning/telemetry/` missing:** Show empty state with "Run `/do setup` to initialize telemetry."
- **`session-tokens.js` unavailable:** Fall back to session-costs.jsonl; mark `(est)`.
- **harness.json missing:** Show "(harness.json not found — defaults active)" and "→ Run /do setup to unlock cost tracking."
- **`telemetry.enabled: false`:** Show banner "Telemetry is disabled. Run `/telemetry on` to re-enable."
- **`--verify` with missing files:** Report "No telemetry or artifact JSONL files found." Not an error.
- **`--verify` when `scripts/verify-telemetry-integrity.js` is unavailable:** Report that the verifier is missing and show the raw file paths to inspect; do not claim hash verification ran.

## Contextual Gates

**Disclosure:** Read-only by default. `--threshold`, `off`, `on`, `--config` write `harness.json`.
**Reversibility:** amber — `harness.json` writes; undo with `git checkout .claude/harness.json`.
**Trust gates:** Any — no restrictions.

## Exit Protocol

/telemetry does not produce a HANDOFF block. It is a read-only observability
tool (except for `--threshold`, `off`, `on`, `--config` which write harness.json).
After displaying output, wait for the next user command.
