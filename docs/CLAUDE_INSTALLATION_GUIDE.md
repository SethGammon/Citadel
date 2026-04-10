# Claude Code Installation Guide

Install Citadel as a Claude Code plugin, run project setup, and verify that the harness is active before you start real work.

## What This Guide Covers

This guide is for the Claude Code runtime. It focuses on the Claude-specific installation path:

- loading Citadel as a Claude Code plugin
- running `/do setup`
- installing Citadel hooks into `.claude/settings.json`
- generating project guidance and harness state

## Prerequisites

Before you start, make sure you have:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- Node.js 18 or newer
- Git
- a project directory where you want Citadel enabled

No extra API key setup is required beyond whatever Claude Code already uses.

## 1. Clone Citadel

Clone the repository somewhere stable on disk:

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
cd ~/Citadel
```

PowerShell example:

```powershell
git clone https://github.com/SethGammon/Citadel.git $HOME\Citadel
Set-Location $HOME\Citadel
```

Citadel's hook installation uses absolute paths. If you move the clone later, re-run setup in your project.

## 2. Open the Target Project

Switch to the project where you want to use Citadel:

```bash
cd /path/to/your-project
```

PowerShell example:

```powershell
Set-Location C:\path\to\your-project
```

## 3. Load Citadel Into Claude Code

### Option A: Per-session

Launch Claude Code with the plugin directory directly:

```bash
claude --plugin-dir /path/to/Citadel
```

### Option B: Persistent install

Inside Claude Code, run:

```text
/plugin marketplace add /path/to/Citadel
/plugin install citadel@citadel-local
/reload-plugins
```

If `/plugin install` cannot find the plugin, start with `claude --plugin-dir /path/to/Citadel` first, then add and install it from inside that session.

## 4. Run Citadel Setup

Once Claude Code is open in the target project with Citadel loaded, run:

```text
/do setup
```

This bootstraps the project for Citadel. In the Claude runtime, setup is expected to:

- install hooks into `.claude/settings.json`
- generate `.claude/harness.json`
- scaffold or extend `CLAUDE.md`
- scaffold or extend `AGENTS.md`
- create `.planning/` and `.citadel/`

If you already have `CLAUDE.md` or `AGENTS.md`, Citadel should preserve existing content instead of replacing it wholesale.

## 5. Verify the Installation

Check for these project files and directories:

```text
CLAUDE.md
AGENTS.md
.claude/settings.json
.claude/harness.json
.planning/
.citadel/
```

Then run a simple command in Claude Code:

```text
/do --list
```

You can also try:

```text
/do review src/main.ts
```

Use any real file from your project.

## Why Claude Setup Uses `/do setup`

Claude Code plugins cannot currently rely on relative hook paths alone, so Citadel uses setup to write resolved absolute hook commands into `.claude/settings.json`. If the Citadel clone moves, re-run:

```text
/do setup
```

That refreshes the hook paths for the current project.

## Troubleshooting

### Hooks are not firing

Re-run:

```text
/do setup
```

Or from the project root:

```bash
node /path/to/Citadel/scripts/install-hooks.js
```

### `/do setup` does not create the harness files

Make sure Claude Code is running from the actual project root, not from the Citadel repository. Setup needs to inspect files like `package.json`, `tsconfig.json`, or other project markers.

### Citadel was moved to a different folder

Re-run setup so `.claude/settings.json` gets rewritten with the new absolute paths.

## Recommended First Commands

After installation, these are the fastest checks:

```text
/do setup
/do --list
/do review path/to/file
```

If those work, Citadel is installed for Claude Code and ready for normal use.
