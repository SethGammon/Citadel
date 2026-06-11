# Daemon — Continuous Autonomous Operation

> last-updated: 2026-06-11

The daemon keeps campaigns running unattended by chaining Claude Code
sessions. Each session picks up from the campaign's Continuation State, works
until the phase completes or context runs low, then schedules the next
session. It auto-stops on campaign completion or budget exhaustion. The
executable protocol lives in `skills/daemon/SKILL.md`; this file holds the
architecture, rationale, and state-file reference.

## How It Works

Three cooperating mechanisms:

1. **State file** (`.planning/daemon.json`) is the single source of truth:
   status, target campaign, budget, session count, tick lock, and run log.
   Every tick reads it first and updates it before scheduling anything.
2. **Chain trigger** is a one-shot trigger that fires after the cooldown and
   runs `/daemon tick`. Each successful tick re-creates the next chain
   trigger, forming the session chain.
3. **Watchdog trigger** is a recurring trigger (default every 30m) that runs
   `/daemon tick --watchdog`. If the chain dies (a session crashed before
   scheduling its successor), the watchdog detects the stale `lastTickAt`
   (older than `2 * interval` with `lastTickStatus` not `"running"`) and
   restarts the chain by becoming a chain tick itself.

### SessionStart hook bridge

The daemon's primary continuation mechanism is the `init-project.js`
SessionStart hook, not RemoteTrigger prompt injection. On every session
start, the hook:

1. Reads `.planning/daemon.json`
2. If `status: running`: checks the lock (no overlap), budget (can afford),
   and campaign (still active)
3. If all gates pass: outputs
   `[daemon] Active daemon detected. Campaign: {slug}. Run: /do continue`
4. The agent sees this message first and executes `/do continue`

RemoteTrigger's role is reduced to scheduling session starts. The hook
handles everything else. If RemoteTrigger is unavailable, an OS cron job or
manual restart achieves the same result.

## Execution Paths

### Local runner (default)

`/daemon start` without flags creates the state file only and never calls
`RemoteTrigger`. The user runs the tick loop in a separate terminal:

```
Daemon state created: .planning/daemon.json
  Campaign:  {slug}
  Budget:    ${N}

To start the tick loop, run in a separate terminal:
  npm run daemon:local

Leave that terminal open. It spawns `claude -p "/do continue"` each
session, respects daemon.json status, and consumes zero Anthropic
routine quota. Stop with Ctrl+C or `/daemon stop`.

For true unattended background operation (machine sleeps, user away):
  /daemon start --remote    (uses RemoteTrigger, counts against 15/day cap)
```

### Why local is the default

`RemoteTrigger` counts against the account-wide **15 routine runs / 24h**
cap. A single overnight run can exhaust the quota and pause every other
routine on the account, including unrelated ones. See
[ROUTINE-QUOTA.md](ROUTINE-QUOTA.md). The remote path therefore requires the
explicit `--remote` flag plus a y/N confirmation that names the quota cost.

### Codex automation lane

In Codex, a Codex Automation is the preferred durable scheduler for
unattended daemon ticks when available:

```bash
node scripts/codex-automation.js plan --type daemon --command "/daemon tick" --cadence "<interval>" --target background-worktree --write
```

Use the returned prompt in the Codex app automation surface. Each run must
still read and update `.planning/daemon.json`: Codex owns the scheduling,
Citadel owns the budget/status gates and the run log.

## daemon.json Reference

Written by `/daemon start` before any triggers are created:

```json
{
  "status": "running",
  "campaignSlug": "{slug}",
  "budget": 50,
  "costPerSession": 3,
  "estimatedSpend": 0,
  "sessionCount": 0,
  "interval": "30m",
  "cooldown": "60s",
  "chainTriggerId": "{id or null}",
  "watchdogTriggerId": "{id or null}",
  "startedAt": "{ISO timestamp}",
  "lastTickAt": null,
  "lastTickStatus": null,
  "stoppedAt": null,
  "stopReason": null,
  "log": []
}
```

In the default local path, `chainTriggerId` and `watchdogTriggerId` stay
`null`. Status values: `running`, `paused-level-up` (waiting for human
approval of level-up proposals), `stopped`. Stop reasons: `user`,
`budget-exhausted`, `no-active-work`, `campaign-completed`,
`campaign-failed`, `campaign-parked`.

Each tick appends a log entry:

```json
{
  "session": 4,
  "timestamp": "{ISO timestamp}",
  "status": "completed",
  "phase": "{current_phase}",
  "summary": "{brief description of what happened}",
  "estimatedCost": 3
}
```

`/daemon log` renders these entries most recent first:

```
[{timestamp}] Session #{N}: {status} -- {summary}
  Phase: {phase} | Duration: {duration} | Est. cost: ${cost}
```

## Cost Estimation

**Primary:** read the latest entry from
`.planning/telemetry/session-costs.jsonl` (written by the session-end hook)
for real cost. Use `override_cost` if present, else `estimated_cost`.

**Fallback:** the `costPerSession` flat estimate (default $3). Each tick adds
it to `estimatedSpend`.

When `--cost-per-session` is not passed and the campaign frontmatter has an
`estimated_cost_per_loop` field (improve campaigns set this to 12), the
daemon uses that value instead of the $3 default. This auto-read prevents the
common mistake of running an improve campaign, which spawns 3 evaluator
agents plus attack and verify per loop, with the $3 default that was designed
for simple archon sessions.

The daemon stops when `estimatedSpend >= budget`, or preemptively when
`estimatedSpend + costPerSession > budget` would be exceeded by the next
session. `--budget unlimited` disables the cap entirely and is warned about
at start.

## Pause and Resume (Level-Up)

When an improve campaign hits distribution saturation it sets its own status
to `level-up-pending`. The next tick detects this and pauses (not stops) the
daemon: `status: "paused-level-up"`, triggers left alive so the watchdog can
detect the human resume. The human reviews proposals at
`.planning/rubrics/{target}-proposals.md` and sets the campaign status back
to `active`; the next watchdog tick sees the approval, flips the daemon back
to `running`, logs `daemon-resume`, and continues the chain.

## Fallbacks

- **RemoteTrigger unavailable:** the SessionStart hook bridge still works.
  An OS cron job achieves the same scheduling:
  `*/30 * * * * cd ~/project && claude -p '/do continue'`
- **Session crashes without scheduling the next tick:** the watchdog restarts
  the chain after `2 * interval`.
- **daemon.json corrupted:** treated as no daemon running; `/daemon start`
  begins fresh.
