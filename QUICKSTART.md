# Quickstart

From `git clone` to your first working `/do` command.

## TL;DR

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
claude --plugin-dir ~/Citadel
```

Then in Claude Code:
```
/do setup
/do review src/main.ts
```

Three commands. Clone, launch, go. `/do setup` handles everything else.

---

## Prerequisites

- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** -- the CLI this plugin extends
- **[Node.js 18+](https://nodejs.org/)** -- required for hooks and scripts

No API key setup needed -- Citadel uses Claude Code's existing authentication.

## 1. Clone Citadel

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
```

That's it. No build step, no `npm install`. Citadel runs directly on Node.js.

## 2. Launch with the plugin

### Option A: Per-session (try it first)

```bash
cd ~/your-project
claude --plugin-dir ~/Citadel
```

Loads the plugin for this session only. Good for evaluation before committing.

### Option B: Persistent (recommended)

Inside Claude Code:
```
/plugin marketplace add ~/Citadel
/plugin install citadel@citadel-local
/reload-plugins
```

> If `/plugin install` says "Plugin not found", launch with
> `claude --plugin-dir ~/Citadel` first, then run the marketplace add
> and install from inside that session.

## 3. Run setup

Open your project in Claude Code (with the plugin loaded):

```
/do setup
```

### Choose your mode

Setup opens with a mode selection — pick based on how much time you have:

```
  [1] Recommended  — auto-detect your stack, install hooks, live demo  (~3 min)
  [2] Full Tour    — everything in Recommended + guided skill walkthrough (~8 min)
  [3] Express      — zero questions, auto-detect, hooks installed, done  (~30 sec)
```

**Recommended** is the default. It walks you through stack confirmation, runs a
live demo on your actual code, and ends with a reference card showing every
command and what's now protecting your session.

**Full Tour** adds a guided walkthrough of all five skill families after the demo.
Good for your first time or when onboarding a teammate.

**Express** skips every question. Detects your stack, installs hooks, registers
skills, and exits in under 30 seconds. Good for quick starts on familiar stacks.

You can also run `/do setup --express` to skip mode selection entirely.

### What setup does

In all modes, setup:

1. **Installs hooks first** -- before any questions. 22 lifecycle hooks are written
   into `.claude/settings.json` with resolved absolute paths. Hooks are live for
   the rest of this session immediately.

2. **Detects your stack** -- language, framework, package manager, test framework.
   Reads `tsconfig.json`, `package.json`, lock files. No questions if detection succeeds.

3. **Generates `.claude/harness.json`** -- your project config with skill registry,
   typecheck settings, quality rules, and agent timeouts.

4. **Scaffolds CLAUDE.md and AGENTS.md** -- creates them if missing, appends a
   Citadel section if they exist. Never overwrites existing content.

5. **Optional integrations** -- GitHub triage workflow + MCP server config, if you want them.

6. **Runs a live demo** -- on a recently changed file in your repo (Recommended + Full Tour).

> **Why does setup install hooks instead of a pre-step?**
> Claude Code plugins can't yet resolve relative paths in hook commands
> ([tracking issue](https://github.com/anthropics/claude-code/issues/24529)).
> Setup runs `node /path/to/Citadel/scripts/install-hooks.js` to write absolute
> paths directly into your project's `.claude/settings.json`. Once the upstream
> fix lands, this step goes away and hooks install automatically with the plugin.
> In the meantime, re-run `/do setup` after moving Citadel to a new location.

### Try a command after setup

```
/do review src/main.ts              # 5-pass code review
/do generate tests for utils        # Tests that actually run
/do why is the login slow           # Root cause analysis
/do refactor the auth module        # Safe multi-file refactoring
```

Or describe what you want in plain English -- the `/do` router picks the right tool:

```
/do fix the login bug
/do what's wrong with the API
/do build a caching layer
```

## 4. Scale up when ready

```
/marshal audit the codebase         # Multi-step, single session
/archon build the payment system    # Multi-session campaign
/fleet overhaul all three services  # Parallel agents, shared discovery
/improve citadel --n=5              # Autonomous quality loops
```

Or let `/do` escalate automatically -- it routes to orchestrators when the task requires it.

Create custom skills to capture patterns you keep repeating:
```
/create-skill
```

---

## Troubleshooting

**Hook not firing / "command not found" errors:**
Re-run setup: `/do setup` (or use Update mode if already configured). Setup rewrites
`.claude/settings.json` with freshly resolved absolute paths. If you moved Citadel
to a new location, this is the fix.

Alternatively, run directly from your project directory:
```bash
node /path/to/Citadel/scripts/install-hooks.js
```

**"[protect-files] Blocked" message:**
Citadel prevented an edit to a protected file. The message names the specific file and
the pattern that triggered the block. To allow the edit, remove the pattern from
`protectedFiles` in `.claude/harness.json`.

**"[Circuit Breaker] tool has failed N times" message:**
A tool failed repeatedly. This is Citadel suggesting you try a different approach, not
an error in Citadel itself. The message names the specific tool and shows the last error.
Read the suggestions and switch strategy.

**Campaign file in broken state:**
If a campaign file in `.planning/campaigns/` has corrupted YAML frontmatter or invalid
status, delete the file and restart the campaign. Campaign logs in `.planning/improvement-logs/`
and `.planning/telemetry/` are preserved independently.

**"/do setup" fails or produces empty harness.json:**
Ensure you are running from your project root (not the Citadel plugin directory).
Setup needs to detect your project's language and framework from files like
`package.json`, `tsconfig.json`, or `Cargo.toml`.

**Daemon won't start / "No active campaign" error:**
The daemon attaches to an active campaign. Check `.planning/campaigns/` for a file
with `Status: active`. If none exists, start work first with `/improve`, `/archon`,
or `/fleet`, then attach the daemon.

**Daemon is paused (level-up-pending):**
An improve loop hit distribution saturation and needs human approval for the next
quality level. Review the proposals at `.planning/rubrics/{target}-proposals.md`,
edit the rubric with approved changes, and set the campaign status back to `active`.
The daemon's watchdog will detect the change and resume automatically.

---

## What's Next

- Add your project's conventions to `CLAUDE.md` -- the more specific, the better
- Run `/do --list` to see all 42 installed skills
- Drop a task in `.planning/intake/` and run `/autopilot` for hands-off execution
- [docs/SKILLS.md](docs/SKILLS.md) -- full skills reference
- [docs/CAMPAIGNS.md](docs/CAMPAIGNS.md) -- multi-session campaign docs
- [docs/migrating.md](docs/migrating.md) -- migrating from copy-based install

---

## What the plugin scaffolds per-project

On first session start, the `init-project` hook creates:

```
your-project/
  .planning/              # Campaign state, fleet sessions, intake, telemetry
    _templates/           # Campaign and fleet templates (copied from plugin)
    campaigns/            # Active + completed campaigns
    fleet/                # Fleet session state + discovery briefs
    coordination/         # Multi-instance scope claims
    intake/               # Work items pending processing
    telemetry/            # Agent run + hook timing logs (JSONL, stays local)
  .citadel/
    scripts/              # Utility scripts synced from plugin each session
    plugin-root.txt       # Pointer to plugin install location
  .claude/
    harness.json          # Project config (generated by /do setup)
    agent-context/        # Rules injected into sub-agents
```

## Telemetry

The harness logs agent events, hook timing, and discovery compression to
`.planning/telemetry/` in JSONL format. Logs never leave your machine.

## Relationship to Superpowers

[Superpowers](https://github.com/obra/superpowers) teaches good methodology --
brainstorm before coding, write tests first, review before shipping. Citadel gives
it the infrastructure to execute that methodology at scale: campaign persistence,
fleet coordination, lifecycle hooks, and telemetry. They are complementary.
