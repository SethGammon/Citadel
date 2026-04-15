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

The rest of the protocol in this file documents the full routine-path flow
for reference and for `--remote` invocations.

## Identity

You are the daemon controller. You turn campaign execution from "human starts
each session" into "sessions restart themselves until the work is done or the
budget runs out." You do not do the work -- Archon does. You are the heartbeat
that keeps Archon alive across sessions.

## Orientation

Use `/daemon` when:
- A campaign needs to run unattended (overnight, over a weekend)
- The user wants continuous progress without manually restarting sessions
- Research or build work spans many sessions and the user doesn't want to babysit

Do NOT use `/daemon` for:
- Quick single-session tasks (just run them directly)
- Work that requires human judgment at every step (use `/archon` interactively)
- Parallel execution (use `/fleet` -- daemon can wrap a fleet campaign though)

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

The daemon uses two RemoteTrigger mechanisms:

**A. Self-rescheduling chain (primary work loop):**

The first tick is a one-shot RemoteTrigger that fires after the cooldown period.
Each tick, after completing work, schedules the next tick. This gives tight
restart cycles -- the next session starts as soon as the previous one finishes
(plus cooldown), not on a fixed clock.

Create the initial trigger:

```
RemoteTrigger create:
  body: {
    "type": "scheduled",
    "schedule": "{cooldown}s",
    "command": "/daemon tick",
    "project_path": "{absolute path to project root}",
    "description": "Daemon: {campaign-slug} tick"
  }
```

Save the returned trigger ID as `chainTriggerId` in daemon.json.

**B. Watchdog (safety net):**

A recurring trigger that fires every `--interval` (default 30m). It checks
whether the chain is still alive. If the last tick completed more than
2x the watchdog interval ago, the chain died -- the watchdog restarts it.

```
RemoteTrigger create:
  body: {
    "type": "recurring",
    "schedule": "{interval}",
    "command": "/daemon tick --watchdog",
    "project_path": "{absolute path to project root}",
    "description": "Daemon: {campaign-slug} watchdog"
  }
```

Save the returned trigger ID as `watchdogTriggerId` in daemon.json.

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

```
node .citadel/scripts/telemetry-log.cjs --event daemon-start --agent daemon --session {campaign-slug} --status success --meta '{"budget":{N},"interval":"{interval}"}'
```

Output to user:

```
Daemon started.
  Campaign:  {slug}
  Budget:    ${N} (~{floor(N/costPerSession)} sessions at ${costPerSession}/session estimate)
  Cooldown:  {cooldown} between sessions
  Watchdog:  every {interval}
  State:     .planning/daemon.json

The campaign will continue autonomously. Sessions restart after each one
completes. Auto-stops when the campaign completes or budget is exhausted.

Use `/daemon status` to check progress.
Use `/daemon stop` to halt.
```

---

### /daemon stop

1. Read `.planning/daemon.json`. If it doesn't exist or status is not `"running"`:
   "No daemon is running."
2. Delete both triggers:
   ```
   RemoteTrigger delete: chainTriggerId
   RemoteTrigger delete: watchdogTriggerId
   ```
   If a trigger ID is missing or deletion fails, continue (it may have already
   been cleaned up).
3. Update daemon.json:
   ```json
   {
     "status": "stopped",
     "stoppedAt": "{ISO timestamp}",
     "stopReason": "user"
   }
   ```
4. Log:
   ```
   node .citadel/scripts/telemetry-log.cjs --event daemon-stop --agent daemon --session {campaign-slug} --status success --meta '{"reason":"user","sessions":{N},"estimatedSpend":{N}}'
   ```
5. Output:
   ```
   Daemon stopped.
     Sessions completed: {N}
     Estimated spend:    ${estimatedSpend}
     Campaign status:    {read current campaign status}
   ```

---

### /daemon status

1. Read `.planning/daemon.json`. If it doesn't exist: "No daemon configured. Use `/daemon start` to begin."
2. Read the campaign file to get current phase and status
3. Output:
   ```
   Daemon: {status}
     Campaign:     {slug} (phase {current_phase}/{phase_count})
     Sessions:     {sessionCount}
     Budget:       ${estimatedSpend} / ${budget} ({remaining} remaining)
     Cost/session: ${costPerSession} (source: {campaign frontmatter | flag | default})
     Last tick:    {lastTickAt} ({lastTickStatus})
     Running for:  {duration since startedAt}
     Watchdog:     every {interval}
     State file:   .planning/daemon.json
   ```
4. If status is `paused-level-up`, additionally output:
   ```
   PAUSED: Level-up triggered. Improve hit distribution saturation.
     Action needed: Review proposals at .planning/rubrics/{target}-proposals.md
     To resume: Edit the rubric with approved proposals, then set campaign
                status to "active". The watchdog will detect the change and
                restart the daemon automatically.
   ```
5. For improve campaigns, additionally output:
   ```
   Improve: {target}
     Loops:        {completed_loops} / {total_loops}
     Current level: {current_level}
     Last axis:    {last attacked axis from loop history}
   ```

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
   `"running"` -- another session is active. Exit silently. (Handles watchdog firing
   while a chain session is still working.)
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
     - **On next watchdog tick:** if campaign status has changed back to `active`,
       the watchdog will see `status: "paused-level-up"` in daemon.json, detect
       that the campaign is active again, update daemon status to `"running"`,
       and restart the chain. No human intervention needed beyond approving the
       level-up proposals and editing the campaign status.

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

**Step 5: Schedule next tick (self-rescheduling chain)**

1. Re-read daemon.json (status may have changed if campaign completed during execution)
2. If status is still `"running"` AND `estimatedSpend + costPerSession <= budget`:
   - Create a new one-shot RemoteTrigger with the cooldown delay:
     ```
     RemoteTrigger create:
       body: {
         "type": "scheduled",
         "schedule": "{cooldown}",
         "command": "/daemon tick",
         "project_path": "{project root}",
         "description": "Daemon: {campaign-slug} tick #{sessionCount + 1}"
       }
     ```
   - Update `chainTriggerId` in daemon.json with the new trigger ID
3. If budget would be exceeded on next session:
   - Stop the daemon: `status: "stopped"`, `stopReason: "budget-exhausted"`
   - Delete watchdog trigger
   - Log `daemon-stop`

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

This means the watchdog only does work when the chain breaks. During normal
operation, it fires, sees a recent tick, and exits immediately.

---

## SessionStart Hook Bridge (Primary Bootstrap)

The daemon's primary continuation mechanism is the `init-project.js` SessionStart hook,
not RemoteTrigger prompt injection. On every session start, the hook:

1. Reads `.planning/daemon.json`
2. If `status: running`: checks the lock (no overlap), budget (can afford), and campaign (still active)
3. If all gates pass: outputs `[daemon] Active daemon detected. Campaign: {slug}. Run: /do continue`
4. The agent sees this message first and executes `/do continue`

**Why this is better than prompt injection:**
- Works with ANY session start method (RemoteTrigger, CLI, cron, manual)
- Infrastructure enforces, rules advise -- the hook doesn't care how the session started
- Survives API changes -- no dependency on undocumented RemoteTrigger fields
- Self-contained -- the daemon state IS the bootstrap mechanism

**RemoteTrigger's role** is reduced to scheduling session starts (firing a blank session
at intervals). The hook handles everything else. If RemoteTrigger is unavailable, an
OS cron job or manual restart achieves the same result.

---

## Budget Tracking

The daemon tracks cost using two sources, preferring real data over estimates:

**Primary: Session cost telemetry (real data)**

The `session-end` hook writes per-session cost events to `.planning/telemetry/session-costs.jsonl`.
Each event includes agent count, session duration, and a weighted cost estimate
(base $1 + $0.50/agent + $0.10/min). This is more accurate than flat per-session estimates
because it scales with actual work done.

When `/daemon tick` runs Step 4 (Record session), it should:
1. Read the latest entry from `session-costs.jsonl` (the one just written by session-end)
2. Use that entry's `estimated_cost` (or `override_cost` if set) as the real session cost
3. Fall back to `costPerSession` flat estimate only if session-costs.jsonl has no new entry

**Secondary: Flat per-session estimate (fallback)**

- Budget: `$50` (default)
- Cost per session: `$3` (conservative estimate for Opus)
- Each completed tick adds `costPerSession` to `estimatedSpend` when real data unavailable

**How it works:**
- Each completed tick: read real cost from session-costs.jsonl if available, else add `costPerSession`
- When `estimatedSpend >= budget`: daemon stops, triggers deleted
- When `estimatedSpend + costPerSession > budget` after a tick: daemon stops
  preemptively (won't start a session it can't afford to finish)

**User overrides:**
- `--budget {N}`: set the cap (dollars)
- `--budget unlimited`: no cap (must be explicit)
- `--cost-per-session {N}`: adjust the fallback estimate (e.g., $0.50 for Sonnet, $5 for
  long Opus sessions)

**Cost override for exact accounting:**

Users who want exact costs from their Anthropic dashboard can add entries to
`session-costs.jsonl` with `override_cost` set. The aggregation functions in
`telemetry-stats.js` (`readCostByCampaign`, `readTotalCost`) prefer `override_cost`
over `estimated_cost` when present. The `/dashboard` COSTS section shows the aggregate.

---

## Fringe Cases

**RemoteTrigger not available:**
If RemoteTrigger is not available (plan doesn't support it, tool not loaded):
The daemon still works through the **SessionStart hook bridge**. The `init-project.js`
hook checks `.planning/daemon.json` on every session start. If a daemon is running, it
outputs `[daemon] Active daemon detected. Run: /do continue` -- and the agent acts on it.
This means the daemon works with ANY session start mechanism:
- `claude --plugin-dir ~/Citadel` (manual restart)
- OS-level cron job: `claude -p '/do continue' --plugin-dir ~/Citadel`
- RemoteTrigger (when prompt injection is supported)
- CronCreate with `durable: true`
Tell the user: "RemoteTrigger is unavailable. The daemon is active and will auto-continue
when any new session starts in this project. For overnight operation, set up a cron job:
`*/30 * * * * cd ~/your-project && claude -p '/do continue' --plugin-dir ~/Citadel`"

**`.planning/` does not exist:**
"No planning directory. Run `/do setup` to initialize the harness for this project."

**Campaign has no Continuation State:**
"Campaign {slug} has no Continuation State section. Archon needs this to know where
to resume. Run `/archon` interactively for one session first to establish the
continuation point."

**daemon.json is corrupted or missing required fields:**
Treat as "no daemon running." The user can `/daemon start` fresh.

**Session crashes without scheduling next tick:**
The watchdog catches this. After `2 * interval` with no tick, the watchdog
restarts the chain. This is the entire purpose of the watchdog.

**Multiple daemons requested:**
Only one daemon can run at a time per project. If the user wants to run daemons
on multiple campaigns, they should use separate project directories (each with
their own `.planning/`).

**User runs `/daemon tick` manually:**
It works -- the gate checks still apply. But warn: "This is an internal command.
The daemon's triggers handle tick scheduling automatically."

**Budget exactly exhausted:**
When `estimatedSpend == budget` after a tick, the daemon stops even if the campaign
isn't done. Output in the log: "Budget exhausted ($X/$X). Campaign at phase {N}.
Restart with `/daemon start --budget {higher}` to continue."

**Level-up during daemon run:**
Improve campaigns can trigger a level-up (distribution saturation). The daemon detects
`status: level-up-pending` on the campaign and sets its own status to `paused-level-up`.
The watchdog stays alive. When the human approves the level-up proposals and sets the
campaign status back to `active`, the next watchdog tick detects the change and resumes
the daemon automatically. No manual `/daemon start` needed.

**Campaign completes mid-session:**
Archon marks the campaign as completed. The tick's Step 4 reads the updated status.
The no-work gate catches it and stops the daemon. Clean exit.

**Campaign completed but daemon.json not updated (the idle loop bug):**
If the campaign completed but daemon.json still says `status: "running"`, the daemon
keeps spawning sessions that find no work. Three layers now prevent this:
1. Campaign gate (Step 1.5): checks campaign file status before executing
2. No-work gate (Step 4.2): checks after `/do continue` returns
3. `/do` Tier 1: if "continue" finds no active campaign and daemon.json is running,
   stops the daemon directly
All three write `stopReason: "no-active-work"` to daemon.json.

---

## Contextual Gates

Before activating the daemon, verify contextual appropriateness:

### Disclosure
Always disclose, regardless of trust level -- daemon is persistent state:
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
- **Familiar** (5-19 sessions): Allow with full disclosure and explicit confirmation. Explain what "continuous" means.
- **Trusted** (20+ sessions): Allow with cost-only confirmation. Skip the explanation.

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

### After `/daemon start`:
Output the confirmation block (see Step 5 above). No HANDOFF block -- the daemon
is now running in the background.

### After `/daemon stop`:
Output the stop summary. No HANDOFF block.

### After `/daemon tick`:
No user-visible output (runs in a headless session). Updates daemon.json and
campaign file. Schedules next tick or stops.

### After `/daemon status` or `/daemon log`:
Output the requested information. Wait for next command.

### On error during any command:
Output a clear error message with actionable fix. Never leave triggers running
if the daemon state is inconsistent -- clean up on error.
