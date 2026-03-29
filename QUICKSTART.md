# Quickstart

From `git clone` to your first working `/do` command.

## TL;DR

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
cd your-project && node ~/Citadel/scripts/install-hooks.js
claude --plugin-dir ~/Citadel
```

Then in Claude Code:
```
/do setup
/do review src/main.ts
```

Four commands. Clone, install hooks, launch, go.

---

## Prerequisites

- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** -- the CLI this plugin extends
- **[Node.js 18+](https://nodejs.org/)** -- required for hooks and scripts

No API key setup needed -- Citadel uses Claude Code's existing authentication.

## 1. Clone and install hooks

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
```

Then from **your project directory** (not the Citadel directory):

```bash
cd ~/your-project
node ~/Citadel/scripts/install-hooks.js
```

This writes resolved hook paths into your project's `.claude/settings.json`.
It's idempotent -- safe to re-run after Citadel updates. Hooks are what give
Citadel its quality enforcement, security protection, and campaign persistence.

> **Why a separate hook install step?** Claude Code plugins can't yet resolve
> relative paths in hook commands ([tracking issue](https://github.com/anthropics/claude-code/issues/24529)).
> This script writes absolute paths as a workaround. Once the upstream fix lands,
> this step goes away and hooks install automatically with the plugin.

## 2. Launch with the plugin

### Option A: Per-session (try it first)

```bash
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

## 3. Run setup and try it

Open your project in Claude Code (with the plugin loaded):

```
/do setup
```

This detects your language and framework, configures the typecheck hook for your stack,
generates `.claude/harness.json`, and scaffolds the `.planning/` directory.

Then try a command:

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
Hooks require absolute paths. Re-run `node /path/to/Citadel/scripts/install-hooks.js`
from your project directory. This rewrites `.claude/settings.json` with resolved paths.

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

- Add your project's conventions to `CLAUDE.md` — the more specific, the better
- Run `/do --list` to see all 34 installed skills
- Drop a task in `.planning/intake/` and run `/autopilot` for hands-off execution
- [docs/SKILLS.md](docs/SKILLS.md) — full skills reference
- [docs/CAMPAIGNS.md](docs/CAMPAIGNS.md) — multi-session campaign docs
- [docs/migrating.md](docs/migrating.md) — migrating from copy-based install

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

[Superpowers](https://github.com/obra/superpowers) teaches good methodology —
brainstorm before coding, write tests first, review before shipping. Citadel gives
it the infrastructure to execute that methodology at scale: campaign persistence,
fleet coordination, lifecycle hooks, and telemetry. They are complementary.
