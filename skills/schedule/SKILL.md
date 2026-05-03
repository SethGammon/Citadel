---
name: schedule
description: >-
  Manages recurring and one-off scheduled tasks. Session-scoped scheduling via
  CronCreate/CronDelete/CronList. Documents the cloud path for tasks that need
  to survive machine sleep or network drops.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-26
---

# /schedule — Task Scheduling

## Orientation

**Use when:** scheduling a recurring or one-off remote agent run (cron-style, outside the current session).
**Don't use when:** repeating work within the current session (use /loop); continuous unattended campaigns (use /daemon).

## Default execution path (READ FIRST)

**`/schedule add` does NOT call `CronCreate` by default.** It shells out to
`node scripts/local-schedule.js` which installs a native OS entry (Windows
Task Scheduler or Unix cron). Only pass `--remote` to use Anthropic's routine
system, and only after explicit user confirmation.

**Why:** `CronCreate` counts against the account-wide **15 routine runs / 24h**
cap; every fire of the scheduled task counts. See
[docs/ROUTINE-QUOTA.md](../../docs/ROUTINE-QUOTA.md).

### Default flow — `/schedule add "<expr>" "<command>"` (no `--remote`)
Run:
```bash
node scripts/local-schedule.js add "<expr>" "<command>"
```
Then report the returned ID and the removal command. This survives session
end, machine reboot, and consumes zero routine quota. Use
`/schedule list` and `/schedule remove {id}` (which also shell out to
`local-schedule.js`) by default.

### Opt-in routine flow — `/schedule add --remote ...`
Only when `--remote` is explicitly passed:
1. Confirm: "This will use `CronCreate`, which counts against your 15 routine
   runs / 24h quota and is cleared at session end. Continue? (y/N)"
2. On confirmation, run the `CronCreate`-based flow documented below.

The rest of the protocol documents the full `CronCreate` flow for reference
and for `--remote` invocations.

## When to Route Here

- "run pr-watch every hour"
- "check my PRs automatically"
- "schedule a thing"
- "remind me to run tests every 30 minutes"
- "set up a recurring task"
- "list my scheduled tasks"
- "cancel the PR check"
- Any mention of "schedule", "recurring", "every N minutes/hours", "cron"

## Protocol

### /schedule list

List all currently scheduled tasks using CronList.

Output format:
```
Active schedules (N):
  [id] {description} — {cron expression} — next run: {time}

No schedules active.
```

If CronList is not available: output a helpful error (see Fringe Cases).

---

### /schedule add "{description}" {/skill-or-command}

Create a recurring task.

Steps:
1. Parse the user's description to extract:
   - Natural language interval: "every 30 minutes", "hourly", "every day at 9am"
   - The skill or command to run: `/pr-watch`, `/do status`, etc.
2. Convert natural language to a cron expression (see Conversion Table below)
3. Confirm with user: "I'll run `{command}` {natural-language-interval} (cron: `{expression}`). OK?"
4. If confirmed: call CronCreate with the expression and command
5. Output: "Scheduled. ID: {id}. Use `/schedule remove {id}` to cancel."

**Cron Expression Conversion Table:**

| Natural Language | Cron Expression |
|---|---|
| every minute | `* * * * *` |
| every 5 minutes | `*/5 * * * *` |
| every 15 minutes | `*/15 * * * *` |
| every 30 minutes | `*/30 * * * *` |
| every hour / hourly | `0 * * * *` |
| every 2 hours | `0 */2 * * *` |
| every 6 hours | `0 */6 * * *` |
| every day / daily | `0 9 * * *` (default 9am) |
| every day at {H}am/pm | `0 {H} * * *` |
| every weekday | `0 9 * * 1-5` |
| every Monday | `0 9 * * 1` |

If the user provides a raw cron expression directly, use it as-is without
converting. Validate it has 5 fields before accepting.

---

### /schedule remove {id}

Remove a scheduled task by ID using CronDelete.

If the user doesn't know the ID: run `/schedule list` first, show the list,
and ask which one to remove.

Output: "Removed schedule {id} ({description})."

---

### /schedule status

Show all active schedules and their next run times. Equivalent to `/schedule list`
with additional context about what each task does and when it last ran (if available).

---

## Session-Scoped vs. Cloud-Persistent Scheduling

### Session-Scoped (CronCreate)

CronCreate schedules tasks that run during the **current Claude Code session only**.
When the session ends (Claude Code closes or the conversation is reset), all
session-scoped schedules are cleared.

**Use session-scoped when:**
- Running checks during an active work session ("remind me every 30min to commit")
- Polling for PR feedback while you're at the computer
- Triggering skill runs during a long coding session

### Cloud-Persistent (RemoteTrigger)

For tasks that need to survive machine sleep, network drops, or session restarts,
use **RemoteTrigger** — a one-off cloud trigger that fires from Anthropic's
infrastructure rather than your local session.

**Use cloud-persistent when:**
- The task needs to run overnight or while you're away
- You want notifications when you return to your machine
- The interval spans multiple days or calendar dates

**How to set up a one-off cloud trigger:**
1. Call RemoteTrigger with the desired delay and the command to run
2. Claude Code registers the trigger in Anthropic's cloud scheduler
3. When the trigger fires, it wakes a new Claude Code session and runs the command
4. Results are delivered as a notification

**Note:** RemoteTrigger requires Claude Code with cloud features enabled (Pro or
Team plan). CronCreate works on all plans but is session-scoped only.

---

## Fringe Cases

**CronCreate not available:**
Output: "CronCreate requires Claude Code with task scheduling enabled. This feature
is available in Claude Code version X.X+. Check `claude --version` and update if
needed. Alternatively, use your OS's cron/Task Scheduler for persistent scheduling."
Never fail silently.

**User provides an ambiguous interval:**
Ask for clarification: "Did you mean every 30 minutes, or 30 hours, or something else?"

**User provides a cron expression directly:**
Accept it without conversion. Validate it has exactly 5 space-separated fields.
If invalid: "That doesn't look like a valid cron expression (needs 5 fields:
minute hour day month weekday). Example: `*/30 * * * *` = every 30 minutes."

**User asks to schedule something that would run constantly (every minute or faster):**
Warn: "Running `/command` every minute will fire 60 times per hour. Are you sure?
Consider every 5 or 15 minutes instead."

**No schedules exist when listing:**
Output: "No active schedules. Use `/schedule add` to create one."

**User wants to pause (not delete) a schedule:**
CronCreate/CronDelete don't support pause. Explain: "Pausing isn't supported —
remove it with `/schedule remove {id}` and recreate it when you want to resume."

---

## Quality Gates

- Always confirm before creating (CronCreate is a side effect)
- Always show the cron expression alongside the natural-language description
- Always provide the ID after creation so the user can remove it
- Never leave a user unable to remove a schedule they created

## Exit Protocol

/schedule does not produce a HANDOFF block. After each action, output a concise
confirmation or list and wait for the next command.

- After `add`: "Scheduled. ID: {id}. Use `/schedule remove {id}` to cancel."
- After `remove`: "Removed schedule {id}."
- After `list` or `status`: the active schedule list (or "No active schedules.")
- After any error: a clear message and actionable suggestion.
