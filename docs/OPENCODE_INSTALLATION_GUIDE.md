# Citadel on opencode — Installation Guide

Citadel runs on opencode as a third runtime alongside Claude Code and Codex.
opencode has no command hooks, so Citadel ships an **in-process plugin** that
spawns the existing `hooks_src/*.js` Node processes and translates their exit
codes into opencode's throw/mutate semantics. Every hook is reused unchanged.

Verified live against **opencode 1.18.30 / Bun 1.4.2 / Node 24.12.0 on Windows 11**
(2026-09-10). See `docs/OPENCODE_SUPPORT_PLAN.md` section 5 for the evidence log.

## Requirements

| | |
|---|---|
| opencode | 1.18.x (`bun add -g opencode-ai`) |
| Node | 18+ **on `PATH`** — the hooks are Node scripts, and under Bun `process.execPath` is the Bun binary, so the plugin resolves Node via `which`/`where node` |
| Bun | whatever opencode ships with |
| Citadel | a local checkout; the plugin stub points at it by absolute path |

## Install

```bash
# 1. preview — writes nothing
node /path/to/Citadel/scripts/opencode-install.js --project-root /path/to/project --dry-run

# 2. install
node /path/to/Citadel/scripts/opencode-install.js --project-root /path/to/project

# 3. verify
node /path/to/Citadel/scripts/opencode-readiness-check.js --project-root /path/to/project
#    exits 0 when the required checks pass; add --strict to also fail on advisory gaps
```

`scripts/install.js --runtime opencode` dispatches to the same installer.

### What it writes

| Path | Purpose |
|---|---|
| `.opencode/plugin/citadel.js` | Stub re-exporting the adapter from your Citadel checkout, so a Citadel upgrade takes effect without reinstalling |
| `opencode.json` | Merged key by key: adds `$schema` and `mcp.citadel-state`. User keys are preserved |
| `.opencode/agent/*.md` | Seven Citadel subagents |
| `.citadel/skills/**/SKILL.md` | Project-local skill projection referenced by `skills.paths` |
| `.citadel/scripts/*` | Thin delegates for every Citadel utility named by an installed skill |

Re-running the installer is a no-op and preserves hand-edited keys (verified: a
hand-added `provider` block survived a second install untouched).

### Native OpenCode surfaces

- **Guidance** — `AGENTS.md`, then `CLAUDE.md`.
- **Skills** — OpenCode reads the installed `.citadel/skills` projection through
  `skills.paths`, in addition to its native `.claude`, `.agents`, and `.opencode`
  skill roots.
- **Commands** — opencode registers every discovered skill as a command
  (`source: "skill"`). Do **not** write `.opencode/command/*.md` for a skill: an
  explicit command file *shadows* the live skill.

### Readiness check output

A healthy install:

```
PASS  plugin stub present
PASS  opencode.json parses
PASS  citadel-state MCP registered
PASS  agents projected — 7 in .opencode/agent
PASS  node binary resolved for hooks — C:\nvm4w\nodejs\node.exe
PASS  skill route executes from project root — node .citadel/scripts/dashboard.js
PASS  pre-tool gate blocks a .env read
```

Confirm the resolved Node path is a **real Node**, not Bun. Override with
`CITADEL_NODE=/path/to/node` if the probe picks the wrong one.

A default install leaves no gaps: all nine checks pass. Using `--skip-guidance`
or `--skip-skills` turns the corresponding check into a WARN with a remedy, which
`--strict` refuses.

## Confirming the plugin actually loaded

**A plugin that fails to load is silent.** opencode publishes a plugin error and
then runs normally **with no Citadel gating at all**. An absence of errors in the
TUI is not evidence. Read the log:

```bash
opencode --print-logs --log-level DEBUG
```

Look for Citadel's own line, written through opencode's logger at startup:

```
level=INFO message="citadel session start" messages="[\"[citadel] hooks ok (24 recent events), gates active, ...\"]"
```

If that line is absent, the plugin did not load and you are unprotected.

The fastest positive check is the readiness script's live gate probe, which
refuses a `.env` read through the real hook.

## Verifying the gate end to end

Ask opencode to read a `.env`. Expect the tool call to come back as an **error**
whose text is the hook's own message, with the session continuing normally:

```
TOOL read  status=error
  error: [protect-files] Blocked: cannot read .env — .env files contain secrets.
```

## Known limits

These are upstream properties of opencode, not Citadel bugs.

### `session.idle` cannot block

opencode dispatches bus events fire-and-forget (`void hook["event"]?.(...)`), so
`quality-gate` is **observational** on this runtime — it records findings but
cannot force continuation. Contract: `stop-cannot-block`.

Findings are still delivered, one turn late, and a project can opt into having
Citadel start that turn itself rather than waiting for a human — see
[Quality-gate findings arrive one turn late](#quality-gate-findings-arrive-one-turn-late).
Neither makes the event refusable.

### `permission.ask` never fires

Declared in the plugin SDK but never triggered (upstream anomalyco/opencode
[#7006](https://github.com/anomalyco/opencode/issues/7006),
[#9229](https://github.com/anomalyco/opencode/issues/9229)). Gating rides
`tool.execute.before`, where blocking is real and tested. Do not build on
`permission.ask`. Contract: `permission-gate-not-native`.

### Plugin load failure fails open

If the module cannot load, opencode continues with no Citadel hooks. The load
path is kept minimal to reduce the chance. Contract:
`plugin-load-failure-fails-open`.

### The `!` shell bypasses the gate

`POST /session/{id}/shell` — the TUI's `!command` — does **not** fire
`tool.execute.before`. A command run this way is not gated: a force-push issued
through it completes ungated, and a probe plugin on `tool.execute.before`
records nothing.

This does not weaken gating of **agent** actions, which is what Citadel gates:
model-issued `bash` calls go through the tool wrapper and are gated normally.
But a human typing `!` at the TUI is outside Citadel's reach on this runtime.

### Adding a plugin needs a server restart

Plugin discovery happens once per opencode **process**. Disposing and recreating
the project instance re-runs each loaded plugin's init but does **not** rescan
`.opencode/plugin/`. After installing Citadel into a project, restart opencode.

## Skills and utility delegates are project-local

The installer copies Citadel's skills into `.citadel/skills` and adds that
project-relative directory to `skills.paths` in
`opencode.json`:

```json
{
  "skills": { "paths": ["./.citadel/skills"] }
}
```

opencode scans every configured path with `**/SKILL.md`, so all Citadel skills
are discovered and each is also registered as a slash command with
`source: "skill"`. Re-run the idempotent installer after a Citadel upgrade to
refresh this projection. The plugin stub itself still loads adapter code directly
from the checkout.

Skill bodies intentionally keep the canonical cross-runtime form
`node scripts/<name>.js`. Before an OpenCode model-issued `bash` call runs, the
Citadel plugin translates only allowlisted Citadel routes whose generated
delegate exists to `node .citadel/scripts/<name>.js`. The delegate then launches
the real utility from the current Citadel checkout while retaining the target
project as `cwd`. Unrelated shell commands are not rewritten.

The plugin's `shell.env` hook also supplies `CITADEL_RUNTIME=opencode`, the
absolute `CITADEL_PROJECT_ROOT`, and `CLAUDE_PROJECT_DIR`. This makes runtime
detection unambiguous when `.claude`, `.codex`, and `.opencode` coexist.

`skills.paths` is user-owned, so Citadel appends to it and never replaces it;
re-running the installer does not duplicate the entry. `--skip-skills` leaves the
key absent entirely.

**Requires opencode >= 1.18.30**, where `skills.paths` was verified to exist. The
top-level config is a strict schema, so on an older build this key would fail the
decode and opencode would refuse to start.

If the Citadel checkout moves, re-run the installer to update the machine-local
plugin pointer and delegates. The shared `skills.paths` entry remains portable
because it is project-relative.

opencode warns `duplicate skill name` when the same skill is found in several
roots. The later scan wins: global `.claude`/`.agents`, then project
`.claude`/`.agents`, then `.opencode` config dirs, then `skills.paths`. So a
project-local copy of a skill can be overridden by the `skills.paths` projection.
To customize one, configure a later skill path with a distinct ownership policy
rather than editing `.citadel/skills`, which reinstall refreshes.

OpenCode natively recognizes only standard skill frontmatter such as `name`,
`description`, `license`, `compatibility`, and string metadata. Citadel fields
including `user-invocable`, `auto-trigger`, and `trigger_keywords` remain useful
to Citadel's router but are ignored by OpenCode's native skill loader. The skill
body becoming the command template is expected behavior, not an execution error.

## Guidance is rendered into AGENTS.md

The installer renders `AGENTS.md` from the canonical spec at
`.citadel/project.md`, creating the spec from a template if the project has none.
opencode reads `AGENTS.md` first and falls back to `CLAUDE.md`.

**An existing `AGENTS.md` is never replaced.** It is opencode's primary guidance
file and may be hand-written, so clobbering it would silently change how every
agent behaves in the project. The installer reports `guidance: kept …` and moves
on; pass `--overwrite-guidance` to replace it deliberately, or `--skip-guidance`
to leave guidance alone entirely.

Edit `.citadel/project.md` and re-run with `--overwrite-guidance` to regenerate —
`AGENTS.md` is a projection, not a source.

The rendered file is opencode-specific, not a copy of the Codex projection: it
states that skills are `/` slash commands, that agents come through `@`, and the
three limits an agent in the project should know about — the `!` shell is
ungated, the stop event cannot block, and a plugin load failure fails open.

A fresh, correct install passes every check and reports `READY.`. The readiness
check separates two severities: *required* covers what the
installer guarantees plus the live proof that the gate blocks, and only those set
the exit code; *advisory* covers capability a project gains by supplying
something Citadel does not project. Pass `--strict` to make the advisory gaps
exit non-zero too, which is what you want in CI.

Earlier builds marked all discovery checks alike and did not execute a skill
route, so an install with broken delegates could report `READY`. The required
dashboard route probe now catches path and runtime-identity regressions. Older
builds also marked all eight checks alike, so a correct install failed its own
verification and exited 1.

## Quality-gate findings arrive one turn late

opencode dispatches bus events fire-and-forget, so `session.idle` cannot refuse
anything — by the time `quality-gate` has a verdict the turn is already over.
Rather than discard it, the plugin persists the finding to
`.planning/opencode/pending-notices.json` and pushes it into the next turn's
prompt, prefixed with a note explaining why it is arriving late.

So a violation you introduce in one turn is raised at the start of the next. That
is delivery, not enforcement: nothing stops the turn that introduced it, which is
why `stop-cannot-block` remains a declared degradation.

Findings are deduped by content — `session.idle` fires many times per session and
usually says the same thing — capped at 20 notices, and delivered once. The store
is safe to delete; you will simply lose any finding not yet delivered.

`.planning/opencode/` is transient per-session state. Citadel adds it to the
checkout's machine-local Git exclude block automatically.

The store is one file per project, but findings are scoped to the session that
produced them, so several opencode sessions can share a project without one
collecting another's findings.

### Optional: act on findings without waiting for a human

By default the finding waits for whoever types the next prompt. A project can
instead have Citadel start that turn itself:

```json
{
  "opencode": {
    "repromptOnStopFindings": true,
    "maxRepromptsPerSession": 2
  }
}
```

in `.claude/harness.json`. When a turn ends with a finding, the plugin asks
opencode for one more turn through `client.session.promptAsync`, and the finding
rides into it the same way it would into a human-typed prompt. In practice the
model reads the finding and fixes it — in the verification run it went `grep` →
`read` → `edit` and replaced the offending `confirm()` call unprompted.

**This spends tokens without anyone asking**, which is why it is off unless you
switch it on, and why two guards bound it:

- **A per-session cap**, default 2, clamped to a hard maximum of 5 that config
  cannot raise. Once spent, that session never re-prompts again. A re-prompt that
  fails to send still costs its slot.
- **Citadel never re-prompts its own re-prompt.** The idle produced by a turn
  Citadel started is always declined, whether or not the finding was fixed.

Both decisions are logged, so `opencode serve --print-logs` shows exactly what
happened:

```
citadel reprompt sent     sessionID=ses_… sent=1 cap=2
citadel reprompt skipped  reason=idle-follows-reprompt
```

This does **not** lift `stop-cannot-block`. The turn that introduced the violation
still ended; re-prompting only shortens the wait for the next one.

One caveat if you run headless: a re-prompt starts a turn nobody is watching, and
that turn can hit an opencode permission prompt with no one to answer it. The
session then sits `busy` and further prompts to it return nothing —
`POST /session/{id}/abort` clears it. Pre-approve the permissions your project
needs before enabling this under `opencode serve`.

## Agent tool restrictions carry over

Citadel agents declare tool access with a `tools` allow-list and a
`disallowedTools` deny-list. opencode has no such field, so the projection
translates them into its native `permission` map:

| Citadel tool | opencode permission |
|---|---|
| `Read` | `read` |
| `Grep` | `grep` |
| `Glob` | `glob` |
| `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | `edit` (opencode has no separate write permission) |
| `Bash` | `bash` |
| `WebFetch`, `WebSearch` | `webfetch` |
| `Agent`, `Task` | `task` |
| `Skill` | `skill` |

The translated allow-list is exhaustive for the built-in tool names Citadel
maps above. An agent restricted to `Read`/`Grep`/`Glob` keeps those mapped
built-ins and loses the other mapped built-ins. Tools from unrelated,
user-configured MCP servers remain governed by their own configuration and are
outside this projection boundary.

`task` matters more than it looks: a subagent runs with its own permissions, not
its caller's, so an agent that can delegate can have someone else do whatever it
is forbidden to do itself.

An agent restricted in anything also loses the **citadel-state MCP tools**, via
`"citadel-state_*": deny`. Those tools can submit control intents, and the server
checks the intent, not which agent sent it. opencode gates an MCP tool by its
`<server>_<tool>` name; the generic `mcp` key does not reach it. `archon` and
`fleet` grant every tool Citadel can name, project with no permission block, and
keep the server.

Not gated: `todowrite`, which Citadel's frontmatter cannot name; tools from
unrelated, user-configured MCP servers; and opencode's read-only MCP resource
tools (`list_mcp_resources`, `read_mcp_resource`,
`list_mcp_resource_templates`), which no permission key withheld on 1.18.30.
citadel-state's one resource is the same summary `citadel_status` returns.

So `arch-reviewer` projects with:

```yaml
permission:
  edit: deny
  bash: deny
  webfetch: deny
  task: deny
  skill: deny
  "citadel-state_*": deny
```

opencode withholds those mapped built-ins and Citadel-state tools from the agent
rather than refusing the call. A read-only reviewer therefore has no mapped
built-in write tool, while tools from unrelated MCP servers remain subject to
their own configuration. An agent with no restrictions gets no permission block
and keeps opencode's defaults.

## Performance

Each gated tool call spawns one Node process per matching hook. Measured on
Windows (Bun 1.4.2, Node 24):

| Tool | Hooks spawned | Latency |
|---|---|---|
| `glob`, `grep`, `webfetch` | 0 | ~0 ms |
| `read` | 1 (`protect-files`) | ~50 ms |
| `bash` | 2 (`external-action-gate`, `governance`) | ~99 ms |
| `edit` / `write` | 2 (`protect-files`, `governance`) | ~100 ms |

Plugin init (the session-start chain) is ~214 ms warm; the first run in a new
project takes several seconds because it also scaffolds `.planning/` and
`.citadel/`.

Trimming `CITADEL_BUNDLES` does **not** reduce this: every pre-tool hook is in
the core security bundle, so `CORE_BUNDLE` selects exactly the same set. If the
latency ever bites, a persistent hook worker is the fix, not bundle trimming.

## Telemetry

Hooks write to the **project's** `.planning/telemetry/`, not the Citadel
checkout — verified: entries carry the project's own name and no path resolves
back to Citadel.

```
.planning/telemetry/audit.jsonl         tool-call events, canonical tool names
.planning/telemetry/hook-errors.jsonl   blocks, e.g. {"hook":"protect-files","action":"blocked"}
.planning/telemetry/hook-timing.jsonl   per-hook durations
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| No gating, no errors | Plugin did not load. Check the log for `citadel session start` |
| Citadel line absent after installing | opencode was already running — restart it |
| `node binary resolved` shows a Bun path | Node is not on `PATH`; set `CITADEL_NODE` |
| No Citadel slash commands | Skills are not projected — see *Skills* above |
| `/do status` reports `MODULE_NOT_FOUND` | Re-run the installer to restore delegates, restart OpenCode, then run readiness with `--strict` |
| `CITADEL_RUNTIME_AMBIGUOUS` in a skill command | Restart OpenCode so the installed plugin's `shell.env` hook supplies runtime identity |
| `!command` not gated | Expected; the shell endpoint bypasses `tool.execute.before` |
| `quality-gate` never blocks | Expected; `session.idle` cannot block |
