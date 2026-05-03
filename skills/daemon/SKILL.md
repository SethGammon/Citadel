---
name: daemon
description: >-
  Continuous autonomous operation mode. Keeps campaigns running 24/7 by
  chaining Claude Code sessions via RemoteTrigger. Each session picks up
  from the campaign's continuation state, works until context runs low or
  the phase completes, then schedules the next session. Auto-stops on
  campaign completion or budget exhaustion. The thing that makes Citadel
  run overnight.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-28
---

# /daemon -- Continuous Autonomous Operation

## Orientation

**Use when:** running campaigns overnight or unattended -- chains sessions automatically until a ceiling or budget is hit.
**Don't use when:** a single autonomous session is enough (use /archon); you want manual control between cycles (use /loop).

## Default execution path (READ FIRST)

**`/daemon start` does NOT call `RemoteTrigger` by default.** The local
runner is the default. Only pass `--remote` to use Anthropic's routine
system, and only after explicit user confirmation.

**Why:** `RemoteTrigger` counts against the account-wide **15 routine runs /
24h** cap. A single overnight run can exhaust the quota and pause every other
routine on the account (including unrelated ones). See
[docs/ROUTINE-QUOTA.md](../../docs/ROUTINE-QUOTA.md).

### Default flow — `/daemon start` (no `--remote` flag)
1. Do Steps 1, 2, and 4 below (validate, check existing, write `daemon.json`).
2. **Skip Step 3** — do NOT create any `RemoteTrigger`. Leave `chainTriggerId`
   and `watchdogTriggerId` as `null` in the state file.
3. Instead of Step 5's trigger-confirmation, output:
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

### Opt-in routine flow — `/daemon start --remote`
Only when the user has explicitly passed `--remote`:
1. Before proceeding, confirm: "This will use Anthropic's `RemoteTrigger`,
   which counts against your 15 routine runs / 24h quota. A single overnight
   daemon can exhaust it. Continue? (y/N)"
2. If the user confirms, run the full Step 1–5 protocol below (including
   Step 3's trigger creation).

## Commands

| Command | Behavior |
|---|---|
| `/daemon start` | Default: create state file, prompt user to run `npm run daemon:local` (zero routine cost) |
| `/daemon start --remote` | Use `RemoteTrigger` instead (counts against 15/day routine quota — requires confirmation) |
| `/daemon start --campaign {slug}` | Target a specific campaign |
| `/daemon start --budget {N}` | Set budget cap in dollars (default: $50) |
| `/daemon start --budget unlimited` | Explicitly disable budget cap |
| `/daemon start --interval {N}m` | Set watchdog interval (default: 30m) |
| `/daemon start --cooldown {N}s` | Set delay between sessions (default: 60s) |
| `/daemon start --cost-per-session {N}` | Override per-session cost estimate (default: $3) |
| `/daemon stop` | Stop the daemon, tear down triggers |
| `/daemon status` | Show daemon state, session count, budget remaining |
| `/daemon log` | Show recent daemon session history |
| `/daemon tick` | Internal: heartbeat handler fired by triggers. Not user-facing. |

## Protocol

### /daemon start

**Step 1: Validate prerequisites**

1. Check `.planning/` exists. If not: "No planning directory found. Run `/do setup` first."
2. Find the target campaign:
   - If `--campaign {slug}` provided: read `.planning/campaigns/{slug}.md`
   - Otherwise: scan `.planning/campaigns/` (excluding `completed/`) for files with
     `status: active` in frontmatter
   - If no active campaign found: "No active campaign. Start one with `/archon` first."
   - If multiple active campaigns and no `--campaign` flag: list them, ask user to specify
3. Verify the campaign has a Continuation State section (Archon knows where to resume)
4. Parse budget:
   - Default: `$50`
   - If `--budget unlimited`: set budget to `Infinity`, warn: "No budget cap. You will not
     be protected from runaway costs. Monitor usage at your Anthropic dashboard."
   - If `--budget {N}`: parse as number, must be > 0
5. Parse cost-per-session:
   - If `--cost-per-session {N}` provided: use that value
   - If not provided AND the campaign has an `estimated_cost_per_loop` field in frontmatter
     (improve campaigns set this to 12): use that value
   - Otherwise: default `$3`
   - This auto-read prevents the common mistake of running an improve campaign
     (which spawns 3 evaluator agents + attack + verify per loop) with the $3
     default designed for simple archon sessions

**Step 2: Check for existing daemon**

1. Read `.planning/daemon.json` if it exists
2. If a daemon is already running (`status: "running"`):
   - Show its state: campaign, sessions completed, budget remaining
   - Ask: "A daemon is already running. Stop it and start a new one?"
   - If yes: run `/daemon stop` first, then continue
   - If no: abort

**Step 3: Create triggers**

**A. Chain trigger** — one-shot, fires after cooldown, `command: "/daemon tick"`. Save ID as `chainTriggerId`.

**B. Watchdog trigger** — recurring, fires every `--interval`, `command: "/daemon tick --watchdog"`. Save ID as `watchdogTriggerId`.

Both use `type: scheduled/recurring`, `project_path: {absolute project root}`, `description: "Daemon: {slug} tick/watchdog"`.

**Step 4: Write state file**

Write `.planning/daemon.json`:

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
  "chainTriggerId": "{id from step 3A}",
  "watchdogTriggerId": "{id from step 3B}",
  "startedAt": "{ISO timestamp}",
  "lastTickAt": null,
  "lastTickStatus": null,
  "stoppedAt": null,
  "stopReason": null,
  "log": []
}
```

**Step 5: Log and confirm**

Log: `daemon-start` event with budget and interval. Output confirmation: campaign slug, budget (estimated sessions), cooldown, watchdog interval, state file path. Suggest `/daemon status` and `/daemon stop`.

---

### /daemon stop

1. Read `.planning/daemon.json`. If missing or not `running`: "No daemon is running."
2. Delete both triggers (ignore failures — may already be cleaned up).
3. Update daemon.json: `status: stopped`, `stoppedAt`, `stopReason: user`.
4. Log `daemon-stop` event. Output: sessions completed, estimated spend, campaign status.

---

### /daemon status

Output: status, campaign (slug + phase), sessions, budget (spent/cap/remaining), cost/session source, last tick (time + status), running duration, watchdog interval, state file path.

If `paused-level-up`: add instructions to review proposals at `.planning/rubrics/{target}-proposals.md` and set campaign `status: active` to resume.

For improve campaigns: add loops completed/total, current level, last axis attacked.

---

### /daemon log

1. Read `.planning/daemon.json`
2. Output the `log` array, most recent first, formatted as:
   ```
   [{timestamp}] Session #{N}: {status} -- {summary}
     Phase: {phase} | Duration: {duration} | Est. cost: ${cost}
   ```
3. Show the last 20 entries. If more exist: "Showing last 20 of {total}. Full log in .planning/daemon.json"

---

### /daemon tick

**This is the heartbeat handler. It runs in a fresh Claude Code session spawned
by RemoteTrigger. It is not user-facing.**

**Step 1: Gate checks**

1. Read `.planning/daemon.json`
2. **Status gate**: If status is not `"running"` and not `"paused-level-up"` -- exit silently. The daemon was stopped.
   - If status is `"paused-level-up"`: read the campaign file. If campaign status is now
     `active` (human approved the level-up), update daemon.json `status: "running"`,
     clear `pauseReason`, log `daemon-resume` with reason `level-up-approved`, and
     continue to Step 2 (acquire lock). If campaign is still `level-up-pending`: exit
     silently (still waiting for human).
3. **Lock gate**: If `lastTickAt` is within the last 2 minutes and `lastTickStatus` is
   `"running"` -- another session is active. Exit silently.
4. **Budget gate**: If `estimatedSpend >= budget` -- stop the daemon:
   - Update daemon.json: `status: "stopped"`, `stopReason: "budget-exhausted"`
   - Delete both triggers (RemoteTrigger delete)
   - Log: `daemon-stop` with reason `budget-exhausted`
   - Exit.
5. **Campaign gate**: Read the campaign file.
   - If the campaign file does not exist -- stop the daemon:
     - Update daemon.json: `status: "stopped"`, `stopReason: "no-active-work"`
     - Delete both triggers
     - Log: `daemon-stop` with reason `no-active-work`
     - Exit.
   - If `status: completed` or `status: failed` -- stop the daemon:
     - Update daemon.json: `status: "stopped"`, `stopReason: "campaign-{status}"`
     - Delete both triggers
     - Log: `daemon-stop` with reason `campaign-completed` or `campaign-failed`
     - Exit.
   - If `status: parked` -- stop the daemon:
     - Same as above with `stopReason: "campaign-parked"`
     - Exit.
   - If `status: level-up-pending` -- **pause** the daemon (do not stop):
     - Update daemon.json: `status: "paused-level-up"`, `pauseReason: "Improve hit distribution saturation. Human approval required for level-up proposals."`
     - Do NOT delete triggers (the watchdog stays alive to detect when the human resumes)
     - Log: `daemon-pause` with reason `level-up-pending`
     - Append to daemon.json log: `"Paused: level-up triggered. Approve proposals at .planning/rubrics/{target}-proposals.md and set campaign status to active to resume."`
     - Exit.

**Step 2: Acquire lock**

Update daemon.json:
- `lastTickAt`: current ISO timestamp
- `lastTickStatus`: `"running"`

**Step 3: Execute**

Run `/do continue` -- this routes to Archon, which reads the campaign's Continuation
State and picks up where the last session left off.

Archon will work until:
- The current phase completes (normal exit)
- Context runs low and PreCompact fires (saves state, session can end)
- An error parks the campaign

**Step 4: Record session**

After `/do continue` returns (or the session is winding down):

1. Read the campaign file again to get updated status and phase
2. **No-work gate**: If the campaign status is `completed`, `failed`, `parked`, or
   the campaign file no longer exists -- stop the daemon immediately:
   - Update daemon.json: `status: "stopped"`, `stopReason: "no-active-work"`,
     `stoppedAt: "{ISO timestamp}"`
   - Delete both triggers (RemoteTrigger delete)
   - Log: `daemon-stop` with reason `no-active-work`
   - Do NOT schedule the next tick. Exit after recording the session.
3. Update daemon.json:
   - `sessionCount`: increment by 1
   - `estimatedSpend`: add `costPerSession`
   - `lastTickStatus`: `"completed"`
   - Append to `log` array:
     ```json
     {
       "session": {sessionCount},
       "timestamp": "{ISO timestamp}",
       "status": "completed",
       "phase": "{current_phase}",
       "summary": "{brief description of what happened}",
       "estimatedCost": {costPerSession}
     }
     ```

**Step 5: Schedule next tick**

Re-read daemon.json. If still `running` and `estimatedSpend + costPerSession <= budget`: create new chain trigger (one-shot, cooldown delay), update `chainTriggerId`. If budget would be exceeded: stop daemon (`budget-exhausted`), delete watchdog, log `daemon-stop`.

**Step 6: Exit**

Session ends cleanly. PreCompact hook saves campaign state. The next tick
will start a fresh session with full context budget.

---

### /daemon tick --watchdog

Same as `/daemon tick` but with an additional check at Step 1:

After the standard gate checks pass, check whether the chain is alive:
- Read `lastTickAt` from daemon.json
- If `lastTickAt` is more than `2 * interval` ago AND `lastTickStatus` is not `"running"`:
  - The chain died. Log: `"Watchdog: chain appears dead. Last tick at {lastTickAt}. Restarting chain."`
  - Proceed with Step 2 onwards (this watchdog tick becomes a chain tick)
  - Schedule the next chain tick in Step 5
- If `lastTickAt` is recent (within `2 * interval`): the chain is healthy. Exit silently.

---

## SessionStart Hook Bridge (Primary Bootstrap)

The daemon's primary continuation mechanism is the `init-project.js` SessionStart hook,
not RemoteTrigger prompt injection. On every session start, the hook:

1. Reads `.planning/daemon.json`
2. If `status: running`: checks the lock (no overlap), budget (can afford), and campaign (still active)
3. If all gates pass: outputs `[daemon] Active daemon detected. Campaign: {slug}. Run: /do continue`
4. The agent sees this message first and executes `/do continue`

RemoteTrigger's role is reduced to scheduling session starts. The hook handles everything
else. If RemoteTrigger is unavailable, an OS cron job or manual restart achieves the same result.

---

## Budget Tracking

**Primary:** Read latest entry from `.planning/telemetry/session-costs.jsonl` (written by session-end hook) for real cost. Use `override_cost` if present, else `estimated_cost`.

**Fallback:** `costPerSession` flat estimate (default $3). Each tick adds it to `estimatedSpend`.

Stop when `estimatedSpend >= budget` or `estimatedSpend + costPerSession > budget` (preemptive).

Overrides: `--budget {N}` | `--budget unlimited` (explicit, warns) | `--cost-per-session {N}`

---

## Fringe Cases

- **RemoteTrigger unavailable**: SessionStart hook bridge still works. Suggest OS cron: `*/30 * * * * cd ~/project && claude -p '/do continue'`
- **No `.planning/`**: "Run `/do setup` first."
- **Campaign has no Continuation State**: run `/archon` once interactively to establish it.
- **daemon.json corrupted**: treat as no daemon running; `/daemon start` fresh.
- **Session crashes without next tick**: watchdog restarts chain after `2 * interval`.
- **Multiple daemons**: one per project. Block with "daemon already running" prompt.
- **`/daemon tick` called manually**: works, gate checks apply. Warn it's internal.
- **Budget exhausted**: stop, log "Budget exhausted. Restart with `--budget {higher}`."
- **Level-up during run**: detect `level-up-pending`, set `paused-level-up`, keep watchdog alive for human-resume detection.
- **Campaign completes mid-session**: no-work gate (Step 4) catches it, stops daemon.
- **Idle loop bug (campaign done but daemon still running)**: three layers prevent it — campaign gate (Step 1), no-work gate (Step 4), `/do` Tier 1 stop. All write `stopReason: no-active-work`.

---

## Contextual Gates

### Disclosure
Always disclose, regardless of trust level:
- "Starting continuous mode on campaign {slug}. Budget: ${N} (~{sessions} sessions at ${cost}/session). Sessions restart automatically until done or budget exhausted."
- For unlimited budget: "WARNING: No budget cap. Sessions will continue until the campaign completes or you run `/daemon stop`."

### Reversibility
- **Amber:** Standard daemon with budget cap -- stop with `/daemon stop`, no work is lost
- **Red:** Daemon with `--budget unlimited` -- no automatic cost protection

Red actions (unlimited budget) require explicit confirmation at ALL trust levels.

### Proportionality
Before starting, verify daemon is warranted:
- If campaign has only 1 remaining phase: suggest running it directly instead
- If estimated sessions <= 2: suggest manual continuation instead
- If campaign is type `improve` and no rubric exists: block -- rubric requires human approval first

### Trust Gating
Read trust level from `harness.json`:
- **Novice** (0-4 sessions): Block daemon activation entirely. Output: "Daemon mode requires familiarity with the harness. Complete a few sessions first, then daemon will be available."
- **Familiar** (5-19 sessions): Allow with full disclosure and explicit confirmation.
- **Trusted** (20+ sessions): Allow with cost-only confirmation.

## Quality Gates

- Budget cap MUST be set (default $50, explicit `unlimited` to bypass)
- Daemon state file MUST be written before any triggers are created
- Both triggers (chain + watchdog) must be created; if either fails, abort and clean up
- Every tick must update daemon.json BEFORE scheduling the next tick
- Campaign must have Continuation State before daemon can start
- Lock mechanism must prevent overlapping sessions
- Watchdog must detect and recover from dead chains
- Stop must clean up ALL triggers (no orphaned triggers)

## Exit Protocol

- `start`: confirmation output, no HANDOFF
- `stop`: stop summary, no HANDOFF
- `tick`: no user output (headless); updates daemon.json, schedules or stops
- `status`/`log`: output requested info
- On error: actionable message, clean up any dangling triggers before exiting
