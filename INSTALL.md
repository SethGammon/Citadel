# Install Citadel

The canonical installation guide. Citadel installs into the project you already have open in Claude Code or OpenAI Codex. This page covers the agent-paste path, manual install for both runtimes, the first-run walkthrough, verification, and troubleshooting.

## Prerequisites

- **Claude Code** or **OpenAI Codex**: the runtime Citadel extends.
- **[Node.js 18+](https://nodejs.org/)**: required for hooks and scripts.
- A git repository you want Citadel to manage.

Authentication depends on the runtime you use. Citadel layers on top of the runtime you already have configured. There is no build step and no `npm install`; Citadel runs directly on Node.js.

## Recommended: Paste This Into Your Agent

Open the repository you want Citadel to manage in Claude Code or OpenAI Codex and paste this:

<!-- This prompt is copied verbatim from README.md (Quick Install). If you edit it here, make the same edit in README.md so the two never drift. -->

```text
Install Citadel in this repository.

Use https://github.com/SethGammon/Citadel as the source. If a local clone
already exists, reuse it or update it. Detect whether this session is running
in OpenAI Codex or Claude Code. From this project's root, run the matching
Citadel installer and follow any printed plugin enable step.

After Citadel is enabled in a fresh thread, run:

/do setup --express

Use the current repository as the target project. Do not require placeholder
path edits.
```

That prompt is intentionally path-free. The agent should clone or update Citadel, choose the correct runtime installer, and use the repository it is already running in as the target. Follow any plugin enable step the installer prints, start a fresh session if the runtime asks for one, then run `/do setup --express`.

## Manual Install

Run the commands below from the project you want Citadel to manage. Do not run them from the Citadel clone unless Citadel itself is the target project. Both runtimes converge on the same harness commands once the runtime-specific install step is done.

First, clone Citadel once:

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
```

If `~/Citadel` already exists, update it instead:

```bash
git -C ~/Citadel pull
```

`scripts/install.js` is a dispatcher: `--runtime claude` runs `scripts/claude-install.js` and `--runtime codex` runs `scripts/codex-install.js`. The commands below use the dispatcher; the runtime-specific scripts accept the same flags if you prefer to call them directly.

### Claude Code

From your target project root:

```bash
node ~/Citadel/scripts/install.js --runtime claude --install --scope local
claude
```

The installer validates the Claude marketplace, adds Citadel from the local clone, installs **Citadel Harness** into local scope, and writes resolved hook paths to the target project. `--scope local` is the safest default: it is gitignored and affects only you in this repository.

In Claude Code, run:

```text
/do setup --express
```

Alternative manual install from inside Claude Code:

```text
/plugin marketplace add ~/Citadel
/plugin install citadel@citadel-local --scope local
```

For a one-session trial without registering the marketplace:

```bash
claude --plugin-dir ~/Citadel
```

To preview what the installer would write without changing anything:

```bash
node ~/Citadel/scripts/install.js --runtime claude --install --dry-run --json
```

For the full Claude-specific flow, see [docs/CLAUDE_INSTALLATION_GUIDE.md](docs/CLAUDE_INSTALLATION_GUIDE.md).

### OpenAI Codex

From your target project root:

```bash
node ~/Citadel/scripts/install.js --runtime codex --add-marketplace
codex
```

This single command refreshes Citadel's Codex plugin package, writes the local plugin marketplace entry, generates the target project's Codex fallback artifacts, and runs the readiness verifier. On Windows it also checks the Codex shell and sandbox settings. It creates Codex-facing files such as `AGENTS.md`, `.codex/config.toml`, `.codex-plugin/plugin.json`, plugin-bundled `hooks/hooks.json`, projected agents, projected skills, and Citadel MCP wiring.

The `--add-marketplace` flag also runs Codex CLI marketplace registration when the CLI is installed. Omit it when you only want to prepare files and follow the printed Codex app steps.

Then install or enable Citadel from Codex:

- App: open **Plugins**, choose **Citadel Local Plugins**, select **Add to Codex** for **Citadel Harness**, then start a new thread.
- CLI: run `/plugins`, install or enable **Citadel Harness**, then start a new thread.

In the new thread, run:

```text
/do setup --express
```

To preview what the installer would write without changing anything:

```bash
node ~/Citadel/scripts/install.js --runtime codex --dry-run --json
```

`scripts/install-hooks-codex.js` remains available for legacy per-project `.codex/hooks.json` installs, but plugin-bundled hooks are the preferred Codex path.

For the full Codex-specific flow, see [docs/CODEX_INSTALLATION_GUIDE.md](docs/CODEX_INSTALLATION_GUIDE.md).

## First Run

Start a fresh Claude Code or Codex thread in your project and run:

```text
/do setup --express
/do next
/do review src/main.ts
```

`/do next` is the fastest check that Citadel sees the project state and can explain the next action, approval boundary, and verification profile. Substitute any real file in the review command.

### Setup modes

`/do setup` (without flags) opens with a mode selection:

- **Recommended** (~3 min): auto-detects your stack, installs hooks, runs a live demo on your actual code, and ends with a reference card showing every command and what is now protecting your session. This is the default.
- **Full Tour** (~8 min): everything in Recommended plus a guided walkthrough of all five skill families. Good for your first time or when onboarding a teammate.
- **Express** (~30 sec): zero questions. Detects your stack, installs hooks, registers skills, and exits. Good for quick starts on familiar stacks.

Run `/do setup --express` to skip mode selection entirely.

### What setup does

In all modes, setup:

1. **Installs or refreshes runtime hooks first**, before any questions. On Claude Code this writes resolved absolute hook paths into `.claude/settings.json`. On Codex, the runtime-specific compatibility files and translated hooks are expected to already exist and setup continues from there.
2. **Detects your stack**: language, framework, package manager, test framework. Reads `tsconfig.json`, `package.json`, lock files. No questions if detection succeeds.
3. **Generates runtime project config**, for example `.claude/harness.json` in the Claude path, along with the project-level Citadel state used by the harness.
4. **Scaffolds `CLAUDE.md` and `AGENTS.md`**: creates them if missing, appends a Citadel section if they exist. Never overwrites existing content.
5. **Optional integrations**: GitHub triage workflow plus MCP server config, if you want them.
6. **Runs a live demo** on a recently changed file in your repo (Recommended and Full Tour modes).

> **Why does the runtime-specific install still matter?**
> Claude Code and Codex load Citadel differently. Claude relies on the plugin path and hook installation into `.claude/settings.json`. Codex can load Citadel as a plugin with bundled skills/hooks/MCP and can also use generated project artifacts like `AGENTS.md`, `.codex/config.toml`, and projected agents. After moving Citadel to a new location, refresh the runtime-specific install step and then re-run `/do setup`.

### Route your first task

```text
/do review src/main.ts              # 5-pass code review
/do generate tests for utils        # Tests that actually run
/do why is the login slow           # Root cause analysis
/do refactor the auth module        # Safe multi-file refactoring
```

Or describe what you want in plain English and let the `/do` router pick the tool:

```text
/do fix the login bug
/do what's wrong with the API
/do build a caching layer
```

### Scale up when ready

```text
/marshal audit the codebase         # Multi-step, single session
/archon build the payment system    # Multi-session campaign
/fleet overhaul all three services  # Parallel agents, shared discovery
/improve citadel --n=5              # Autonomous quality loops
```

Or let `/do` escalate automatically; it routes to orchestrators when the task requires it. Capture patterns you keep repeating with `/create-skill`.

## Verify

From the Citadel clone:

```bash
npm test
```

Success is a zero exit code; the suite covers hooks, skill structure, and installer checks.

In your target project, success looks like this scaffold, created by the `init-project` hook on first session start:

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

The harness logs agent events, hook timing, and discovery compression to `.planning/telemetry/` in JSONL format. Logs never leave your machine.

## Troubleshooting

**Hook not firing / "command not found" errors:**
Re-run the runtime-specific install step from your project root, then re-run `/do setup`:

```bash
node ~/Citadel/scripts/install.js --runtime claude --install --scope local
node ~/Citadel/scripts/install.js --runtime codex --add-marketplace
```

Alternatively, run the hook installer directly from your project directory:

```bash
node /path/to/Citadel/scripts/install-hooks.js
```

**Moved the Citadel clone:**
Resolved hook paths point at the old location. Refresh the runtime-specific install step, then re-run `/do setup`.

**"[protect-files] Blocked" message:**
Citadel prevented an edit to a protected file. The message names the specific file and the pattern that triggered the block. To allow the edit, remove the pattern from `protectedFiles` in `.claude/harness.json`.

**"[Circuit Breaker] tool has failed N times" message:**
A tool failed repeatedly. This is Citadel suggesting you try a different approach, not an error in Citadel itself. The message names the specific tool and shows the last error. Read the suggestions and switch strategy.

**Campaign file in broken state:**
If a campaign file in `.planning/campaigns/` has corrupted YAML frontmatter or invalid status, delete the file and restart the campaign. Campaign logs in `.planning/improvement-logs/` and `.planning/telemetry/` are preserved independently.

**"/do setup" fails or produces empty harness.json:**
Ensure you are running from your project root (not the Citadel plugin directory). Setup needs to detect your project's language and framework from files like `package.json`, `tsconfig.json`, or `Cargo.toml`.

**Daemon won't start / "No active campaign" error:**
The daemon attaches to an active campaign. Check `.planning/campaigns/` for a file with `Status: active`. If none exists, start work first with `/improve`, `/archon`, or `/fleet`, then attach the daemon.

**Daemon is paused (level-up-pending):**
An improve loop hit distribution saturation and needs human approval for the next quality level. Review the proposals at `.planning/rubrics/{target}-proposals.md`, edit the rubric with approved changes, and set the campaign status back to `active`. The daemon's watchdog will detect the change and resume automatically.

## Next Steps

- Add your project's conventions to `CLAUDE.md`; the more specific, the better.
- Add your project's conventions to `AGENTS.md` if you use Codex.
- Run `/do --list` to see all <!-- GENERATED: skill-count -->48<!-- /GENERATED --> installed skills.
- Drop a task in `.planning/intake/` and run `/autopilot` for hands-off execution.
- Try the copyable demo workflow in [DEMO.md](DEMO.md).
- [docs/CLAUDE_INSTALLATION_GUIDE.md](docs/CLAUDE_INSTALLATION_GUIDE.md): Claude-specific install flow.
- [docs/CODEX_INSTALLATION_GUIDE.md](docs/CODEX_INSTALLATION_GUIDE.md): Codex-specific install flow.
- [docs/SKILLS.md](docs/SKILLS.md): full skills reference.
- [docs/CAMPAIGNS.md](docs/CAMPAIGNS.md): multi-session campaign docs.
- [docs/migrating.md](docs/migrating.md): migrating from copy-based install.

Citadel pairs well with [Superpowers](https://github.com/obra/superpowers), which teaches methodology: brainstorm before coding, write tests first, review before shipping. Citadel supplies the infrastructure to execute that methodology at scale with campaign persistence, fleet coordination, lifecycle hooks, and telemetry. They are complementary.
