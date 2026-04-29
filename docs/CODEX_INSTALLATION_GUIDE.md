# Codex Installation Guide

Install Citadel into a project you use with Codex, generate the Codex-facing artifacts, and verify that the harness is active before you start real work.

## What This Guide Covers

This guide is for the Codex runtime, not Claude Code. It focuses on the parts Citadel needs in order to show up correctly inside Codex:

- `AGENTS.md` project guidance for Codex
- `.codex/config.toml` for Codex feature flags and runtime wiring
- `.codex/hooks.json` for translated Citadel hooks
- `.codex/agents/` and `.agents/skills/` projections for Codex discovery

## Prerequisites

Before you start, make sure you have:

- Codex installed and working in your shell
- Node.js 18 or newer
- Git
- A project directory where you want Codex to use Citadel

## 1. Clone Citadel

Clone the Citadel repository somewhere stable on disk:

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
cd ~/Citadel
```

On Windows PowerShell, the same step looks like:

```powershell
git clone https://github.com/SethGammon/Citadel.git $HOME\Citadel
Set-Location $HOME\Citadel
```

Citadel's hook installer writes absolute paths into generated Codex files. If you move the repository later, regenerate the Codex artifacts and reinstall hooks.

## 2. Open the Target Project

Switch to the project where you want Citadel enabled:

```bash
cd /path/to/your-project
```

Or in PowerShell:

```powershell
Set-Location C:\path\to\your-project
```

Everything in the next steps is generated into this project, not into the Citadel repository.

## 3. Generate Codex Compatibility Artifacts

From the target project root, run the compatibility generator from the Citadel clone:

```bash
node /path/to/Citadel/scripts/codex-compat.js
```

PowerShell example:

```powershell
node C:\Users\you\Citadel\scripts\codex-compat.js
```

This generates the Codex-facing files Citadel needs:

- `.codex/config.toml`
- `.codex-plugin/plugin.json`
- `.codex/agents/*.toml`
- `.agents/skills/*/SKILL.md`
- `.agents/skills/*/agents/openai.yaml`

If `AGENTS.md` does not already exist, the generator also creates an initial version for Codex to read.

## 4. Install Codex Hooks

Still from the target project root, install the translated hook configuration:

```bash
node /path/to/Citadel/scripts/install-hooks-codex.js
```

PowerShell example:

```powershell
node C:\Users\you\Citadel\scripts\install-hooks-codex.js
```

This writes `.codex/hooks.json` and points the entries at `hooks_src/codex-adapter.js` inside your Citadel clone.

## 5. Start Codex in the Project

Launch Codex from the same project root after the files above exist:

```bash
codex
```

Codex should now see the generated `AGENTS.md` guidance and the `.codex/` runtime config for that project.

## 6. Run Citadel Setup Inside Codex

Once Codex is open in the project, run:

```text
$do setup
```

This is the project bootstrap step for the harness itself. For Codex projects it is expected to create or refresh project-level guidance and state such as:

- `.planning/`
- `.citadel/`
- `AGENTS.md`
- Codex-oriented harness configuration

If your project already has `AGENTS.md`, Citadel should extend or preserve it rather than replacing your hand-authored content wholesale.

## 7. Verify the Installation

Check for these files in the target project:

```text
AGENTS.md
.codex/config.toml
.codex/hooks.json
.codex/agents/
.agents/skills/
.planning/
.citadel/
```

Then run a simple command in Codex:

```text
$do --list
```

If installation is working, Codex should discover the Citadel skills and the project should contain the generated state directories.

You can also try:

```text
$do review src/main.ts
```

Use any real file in your project for the first command.

## How the Codex Install Differs From Claude Code

Claude Code can load Citadel through Claude's plugin flow. Codex currently relies on generated project artifacts instead:

- Codex reads `AGENTS.md` for project guidance
- Codex uses `.codex/config.toml` for runtime feature flags
- Codex uses `.codex/hooks.json` for translated lifecycle hooks
- Citadel projects its skills and agents into Codex-readable locations

For that reason, `node scripts/codex-compat.js` and `node scripts/install-hooks-codex.js` are the key install steps for Codex.

## Troubleshooting

### Codex does not seem to pick up Citadel

Verify that you launched Codex from the same project root where `AGENTS.md` and `.codex/config.toml` were generated.

### Hooks are not firing

Re-run:

```bash
node /path/to/Citadel/scripts/install-hooks-codex.js
```

If Citadel was moved to a different folder, this is required because `.codex/hooks.json` contains absolute adapter paths.

### `AGENTS.md` is missing

Re-run:

```bash
node /path/to/Citadel/scripts/codex-compat.js
```

If the file still does not appear, create it by running `$do setup` inside Codex after the compatibility artifacts exist.

### You changed or pulled new Citadel code

Refresh the generated artifacts in your project:

```bash
node /path/to/Citadel/scripts/codex-compat.js
node /path/to/Citadel/scripts/install-hooks-codex.js
```

## Recommended First Commands

After installation, these are the fastest checks:

```text
$do setup
$do --list
$do review path/to/file
```

If those work, Citadel is installed for Codex and ready for normal use.
