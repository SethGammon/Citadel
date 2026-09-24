# Codex Installation Guide

Install Citadel into a project you use with Codex, then verify that Codex can see the plugin, hooks, skills, MCP state, and project guidance.

## Stable Release Install (Recommended)

Citadel's supported stable acquisition path is the complete asset trio from a
single [GitHub Release](https://github.com/SethGammon/Citadel/releases/latest):

- `citadel-vX.Y.Z.tar.gz`
- `citadel-vX.Y.Z.tar.gz.manifest.json`
- `citadel-vX.Y.Z.tar.gz.sha256`

Download all three files for the same version, verify them using the
[release verification instructions](RELEASES.md#consumer-verification), and
extract the archive into a standalone Citadel directory. Do not substitute an
npm package or `npx` command.

On macOS or Linux:

```bash
mkdir -p ~/Citadel
tar -xzf /path/to/citadel-vX.Y.Z.tar.gz -C ~/Citadel --strip-components=1
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\Citadel" | Out-Null
tar -xzf C:\path\to\citadel-vX.Y.Z.tar.gz -C "$HOME\Citadel" --strip-components=1
```

## Fast Path: One Command, Then Add to Codex

Codex plugins can bundle skills, app integrations, hooks, and MCP servers, and Codex can install plugins from local or repo marketplace files. The [official Codex plugin docs](https://developers.openai.com/codex/plugins) describe the app flow as opening Plugins and selecting **Add to Codex** or the CLI flow as running `/plugins`; the [plugin authoring docs](https://developers.openai.com/codex/plugins/build) describe repo and personal marketplace files.

Citadel's installer gets everything ready for that final install click:

```bash
cd /path/to/your-project
node ~/Citadel/scripts/codex-install.js --add-marketplace
codex
```

Equivalent unified installer:

```bash
node ~/Citadel/scripts/install.js --runtime codex --add-marketplace
```

On Windows PowerShell:

```powershell
Set-Location C:\path\to\your-project
node $HOME\Citadel\scripts\codex-install.js --add-marketplace
codex
```

Then install or enable the plugin:

- Codex app: open **Plugins**, choose **Citadel Local Plugins**, select **Add to Codex** for **Citadel Harness**, then start a new thread.
- Codex CLI: run `/plugins`, install or enable **Citadel Harness**, then start a new thread.

Once enabled, run:

```text
/do setup --express
```

`--add-marketplace` asks Codex CLI to register the local marketplace. Omit it when you only want the script to prepare files and print the app/CLI steps. Use `--plugin-only` when you want to prepare the Citadel plugin package without generating target-project fallback artifacts.

## Development-Only Repository Marketplace

The GitHub repository marketplace source follows repository development rather
than the verified release trio. Use it only when intentionally testing current
source-main behavior and you do not need local project fallback artifacts:

```bash
codex plugin marketplace add SethGammon/Citadel
codex
```

Then use `/plugins` or the Codex app plugin directory to install **Citadel
Harness**. This is a GitHub source install, not an npm package-install claim.
It is not the stable release path. A direct `git clone` of the repository has
the same development-only boundary. Stable users should register the local
marketplace from an extracted, verified GitHub Release. The local installer
also verifies the target project and records readiness evidence.

## What The Installer Does

`scripts/codex-install.js` wraps the previously manual Codex setup steps:

- `.codex-plugin/plugin.json` describes Citadel as a Codex-native harness.
- `skills/` provides the installed skill set.
- `runtimes/codex/hooks.json` bundles translated Codex hook commands outside Claude Code's conventional auto-discovery path. These hooks are guardrails on covered local tool paths, not a universal sandbox.
- `.mcp.json` exposes the `citadel-state` MCP server.
- `.agents/plugins/marketplace.json` exposes the local marketplace Codex can browse.
- Target-project `AGENTS.md`, `.codex/config.toml`, `.codex/agents/*.toml`, `.agents/skills/*`, `.codex-plugin/plugin.json`, and `runtimes/codex/hooks.json` are generated as a verified fallback for projects where plugin install is not available yet.
- `.planning/verification/codex-readiness.json` records the readiness checks.
- On Windows, the installer runs the Codex sandbox/shell readiness check unless `--skip-windows-check` is passed.

Useful variants:

```bash
node ~/Citadel/scripts/codex-install.js --dry-run
node ~/Citadel/scripts/codex-install.js --plugin-only
node ~/Citadel/scripts/codex-install.js --project-root /path/to/your-project
npm run codex:install -- --project-root /path/to/your-project
npm run codex:verify
```

## Choose Models And Reasoning Effort

Citadel uses current Codex defaults when it projects `agents/*.md` into
`.codex/agents/*.toml`:

- `fable` and `opus` roles use `gpt-5.6-sol`
- `sonnet` roles use `gpt-5.6-terra`
- `haiku` roles use `gpt-5.6-luna`

You can change a family default or one agent without editing Citadel source.
The governed config command previews the exact change first and writes only
when `--apply` is present:

```bash
node /path/to/Citadel/scripts/citadel-config.js configure-codex-agents \
  --agent-model arbiter=gpt-5.6-sol \
  --agent-effort arbiter=ultra

# Review the plan, then apply it and refresh the managed agent files.
node /path/to/Citadel/scripts/citadel-config.js configure-codex-agents \
  --agent-model arbiter=gpt-5.6-sol \
  --agent-effort arbiter=ultra \
  --apply
node /path/to/Citadel/scripts/generate-agent-projections.js --project-root .
```

Available Codex reasoning levels are `low`, `medium`, `high`, `xhigh`, `max`,
and `ultra`. The selected Codex model must support the selected level. Claude
Code executor profiles accept `low`, `medium`, `high`, `xhigh`, and `max`;
`ultra` is not offered there because Claude Code does not support it.

The setting is stored under
`extensions["citadel.codex-agents"]` in `.claude/harness.json`. Family aliases,
`defaultModel`, `defaultReasoningEffort`, and per-agent `model` or
`reasoningEffort` overrides are supported. Use the config command so the
protected file remains plan-bound and recoverable.

## Manual Steps The Installer Replaces

The installer is equivalent to running the old sequence:

```bash
node /path/to/Citadel/scripts/codex-compat.js /path/to/Citadel
node /path/to/Citadel/scripts/codex-plugin-smoke.js --project-root /path/to/Citadel --write
node /path/to/Citadel/scripts/codex-compat.js /path/to/your-project
node /path/to/Citadel/scripts/codex-readiness-check.js --project-root /path/to/your-project --write
```

On Windows it also runs:

```bash
node /path/to/Citadel/scripts/codex-windows-check.js --project-root /path/to/your-project
```

## Project Artifact Fallback

For projects where plugin install is not available, generate the Codex-facing artifacts directly into the target project:

```bash
cd /path/to/your-project
node /path/to/Citadel/scripts/codex-install.js --project-root . --skip-plugin-refresh
```

This writes:

- `AGENTS.md` when one does not already exist
- `.codex/config.toml` with `hooks = true`, history, agents, shell policy, and `citadel-state` MCP config
- `.codex/agents/*.toml`
- `.agents/skills/*`
- `.codex-plugin/plugin.json`
- `runtimes/codex/hooks.json`

Plugin-bundled hooks (`runtimes/codex/hooks.json`) are the Codex hook path; per-project `.codex/hooks.json` installs are no longer generated.

## Verify

From the Citadel clone:

```bash
node scripts/test-codex-native-integrations.js
node scripts/test-hook-installers.js
node scripts/test-project-guidance.js
node scripts/skill-lint.js
node scripts/codex-install.js --plugin-only --dry-run
node scripts/codex-plugin-smoke.js --write
```

From a target project after setup, check:

```text
AGENTS.md
.codex/config.toml
.codex/agents/
.agents/skills/
.planning/
.citadel/
```

Then run the readiness verifier, or use the local package-script alias from the
Citadel source checkout:

```bash
node /path/to/Citadel/scripts/codex-readiness-check.js --write
npm run codex:verify
```

It writes `.planning/verification/codex-readiness.json` and fails if Codex plugin metadata, hooks, MCP, agents, guidance, or artifact tracking are not usable.

Then in Codex:

```text
/do --list
/do review path/to/file
```

## Native Codex Surfaces Citadel Uses

- **Skills and plugins:** Citadel loads as reusable Codex workflows instead of one-off copied prompts.
- **Hooks:** Citadel maps blocking guardrails and telemetry hooks to supported Codex lifecycle events. The adapter projects covered `apply_patch` targets for protected-file checks; specialized tool paths can remain outside the local function-hook path.
- **MCP:** `citadel-state` exposes campaign/fleet/telemetry/artifact state as structured tools and resources.
- **Subagents and worktrees:** projected `.codex/agents/` files let Codex run specialized agents while Citadel keeps coordination state.
- **Automations:** `scripts/codex-automation.js` generates Codex Automation prompts for schedule, daemon, and PR-watch workflows.
- **PR review:** `scripts/codex-pr-review.js` chooses local Citadel review, `@codex review`, or both.
- **QA artifacts:** `scripts/codex-app-artifacts.js` records screenshots and artifact evidence for Codex app review.
- **Windows:** `scripts/codex-windows-check.js` checks Codex Windows sandbox and shell readiness.
- **Readiness:** `scripts/codex-readiness-check.js` proves the generated/plugin surfaces are actually usable.
- **Plugin smoke:** `scripts/codex-plugin-smoke.js` validates and writes the local marketplace manifest Codex uses to enable the Citadel plugin.
- **Bootstrap install:** `scripts/codex-install.js` wraps plugin refresh, marketplace generation, target artifact generation, readiness verification, and optional Codex CLI marketplace registration.
- **Review fetching:** `scripts/codex-review-fetch.js` fetches Codex GitHub review findings through `gh api` and records them into Citadel PR state.
- **App-server capture:** `scripts/codex-app-server-capture.js` records and verifies a real local app-server handshake plus idle thread start, with opt-in turn capture, `--turn-file` support, controlled approval probes, and safe default approval decline.
- **App-server dashboard:** `scripts/codex-app-server-dashboard.js` summarizes app-server JSONL output and writes a local dashboard.

See [CODEX_NATIVE_INTEGRATIONS.md](CODEX_NATIVE_INTEGRATIONS.md) for the full 12-entry matrix and verification commands.
