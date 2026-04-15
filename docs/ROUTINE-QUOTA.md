# Anthropic Routine Quota and Local Alternatives

Anthropic's Claude Code accounts include **15 routine runs per rolling 24-hour
window** (Claude.ai → Settings → Usage → *Daily included routine runs*). Any
scheduled, self-waking, or remotely-triggered execution counts against this
cap. When the cap is hit, **all routines across your account pause** — including
unrelated ones — unless Extra Usage is enabled.

The mechanisms that consume routine runs:

- `CronCreate` / `CronDelete` / `CronList`
- `ScheduleWakeup` (including `/loop` without a fixed interval)
- `RemoteTrigger`

A single long-running watcher at a 5-minute interval exhausts the quota in
under an hour. The daemon can burn through it in a single overnight run.

## How Citadel handles this

Every skill in this harness that historically used a routine mechanism now
ships with a **local, quota-free runner** as the default path. The routine
version is still supported for users who need cloud-persistent execution
(machine off, away from desk), but it is no longer the recommended default.

| Skill | Routine version | Local runner (default) |
|---|---|---|
| `/watch` | `CronCreate` poll | `node scripts/local-watch.js` — filesystem events, real-time, zero quota |
| `/daemon` | `RemoteTrigger` chain | `node scripts/local-daemon.js` — spawns `claude -p "/do continue"` subprocess loop |
| `/schedule` | `CronCreate` | `node scripts/local-schedule.js` — emits OS cron / Task Scheduler entries |
| `/loop` (dynamic) | `ScheduleWakeup` | Run foreground during the active session; otherwise use `local-daemon.js` |
| `/pr-watch` | (already local) | No change — reference implementation |

Local runners work anywhere Node.js works (Windows, macOS, Linux). They
invoke `claude` as a subprocess, which does **not** count as a routine — only
the scheduling mechanisms listed above do.

## Trade-offs

| Concern | Routine system | Local runner |
|---|---|---|
| Works when machine is off | ✅ | ❌ |
| Works when machine is asleep | ✅ | ❌ (wakes on resume) |
| Counts against 15/day cap | ✅ | ❌ |
| Works across network drops | ✅ | ✅ (local) |
| Survives session end | ✅ | ✅ (separate process) |
| Real-time file events | ❌ (polls) | ✅ |
| Setup complexity | Low | Low (single `npm run` command) |

**Rule of thumb:** if the user's machine is on when the work needs to happen,
use the local runner. Reserve routine spend for scheduled work that truly
needs cloud persistence.

## Using Extra Usage instead

If you prefer to keep using the routine path, enable **Settings → Usage →
Extra Usage** on your Anthropic account. Additional routine runs beyond the
15/day baseline are billed at the standard Extra Usage rate. Your daemon and
watchers will keep running past the cap.

## Quick commands

```bash
# Real-time file watcher (replaces /watch start)
npm run watch:local

# Continuous campaign daemon (replaces /daemon start)
npm run daemon:local

# Install a scheduled task via OS cron / Task Scheduler (replaces /schedule add)
node scripts/local-schedule.js add "every 30m" "/pr-watch"
node scripts/local-schedule.js list
node scripts/local-schedule.js remove {id}
```

See each script's `--help` flag for full options.
