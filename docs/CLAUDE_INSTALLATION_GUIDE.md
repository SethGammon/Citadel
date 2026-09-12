# Claude Code Installation Guide

Install Citadel as a Claude Code plugin, verify the marketplace, write project hooks, and run setup from the target repo.

Sources: Claude Code's current plugin docs support marketplace discovery, local paths, GitHub sources, install scopes, and non-interactive `claude plugin marketplace` / `claude plugin install` commands. See [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins), [Create and distribute marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), and [Plugins reference](https://code.claude.com/docs/en/plugins-reference).

## Stable Release Install (Recommended)

Citadel's supported stable acquisition path is the complete asset trio from a
single [GitHub Release](https://github.com/SethGammon/Citadel/releases/latest):

- `citadel-vX.Y.Z.tar.gz`
- `citadel-vX.Y.Z.tar.gz.manifest.json`
- `citadel-vX.Y.Z.tar.gz.sha256`

Download all three files for the same version, verify them using the
[release verification instructions](RELEASES.md#consumer-verification), and
extract the archive into a standalone Citadel directory. For example:

```bash
mkdir -p ~/Citadel
tar -xzf /path/to/citadel-vX.Y.Z.tar.gz -C ~/Citadel --strip-components=1
```

Do not substitute an npm package or `npx` command. This project publishes
stable builds only through GitHub Releases.

## Fast Path: Local Project Enablement

After extracting the verified release, run from the project where you want
Citadel enabled:

```bash
cd /path/to/your-project
node ~/Citadel/scripts/claude-install.js --install --scope local
claude
```

Then in Claude Code:

```text
/do setup --express
/do --list
/do review path/to/file
```

Local scope is the safest default for trying Citadel: it installs the plugin for you in this repository only and avoids committing project-wide Claude settings.

## What The Installer Does

`scripts/claude-install.js --install --scope local` wraps the manual Claude Code setup:

- validates `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`
- runs `claude plugin marketplace add <Citadel> --scope local`
- runs `claude plugin install citadel@citadel-local --scope local`
- runs `scripts/install-hooks.js <project>` so `.claude/settings.json` gets resolved absolute hook paths
- prints the next Claude Code commands to run

Useful variants:

```bash
node ~/Citadel/scripts/claude-install.js --dry-run --json
node ~/Citadel/scripts/claude-install.js --add-marketplace --scope user
node ~/Citadel/scripts/claude-install.js --install-plugin --scope project
node ~/Citadel/scripts/install.js --runtime claude --install --scope local
npm run claude:install -- --install --scope local
```

## Manual Install

Inside Claude Code:

```text
/plugin marketplace add /path/to/Citadel
/plugin install citadel@citadel-local --scope local
```

Or from the shell:

```bash
claude plugin marketplace add /path/to/Citadel --scope local
claude plugin install citadel@citadel-local --scope local
node /path/to/Citadel/scripts/install-hooks.js /path/to/your-project
```

For a one-session trial without registering a marketplace:

```bash
cd /path/to/your-project
claude --plugin-dir /path/to/Citadel
```

## Development-Only Source Install

The GitHub repository marketplace source follows repository development rather
than the verified release trio. Use it only when intentionally testing current
source-main behavior:

```bash
claude plugin marketplace add SethGammon/Citadel --scope local
claude plugin install citadel@citadel-local --scope local
```

Likewise, a direct clone follows development source and is not the stable
installation path:

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
```

For either development-only path, run `/do setup --express` in the target
project so Citadel can detect the stack, initialize state, and refresh hooks.

## Verify

Expected project files after the installer and `/do setup`:

```text
CLAUDE.md
AGENTS.md
.claude/settings.json
.claude/harness.json
.planning/
.citadel/
```

Fast checks:

```bash
claude plugin validate /path/to/Citadel
node /path/to/Citadel/scripts/test-installers.js
```

In Claude Code:

```text
/do --list
/do review path/to/file
```

## Troubleshooting

### Hooks are not firing

Re-run the installer from the target project:

```bash
node /path/to/Citadel/scripts/claude-install.js --install --scope local
```

Or install only hooks:

```bash
node /path/to/Citadel/scripts/install-hooks.js /path/to/your-project
```

### Claude says the plugin is not found

Refresh the marketplace and install again:

```bash
claude plugin marketplace update citadel-local
claude plugin install citadel@citadel-local --scope local
```

If the local clone moved, run:

```bash
claude plugin marketplace remove citadel-local
claude plugin marketplace add /new/path/to/Citadel --scope local
```

### Setup runs in the wrong project

Start Claude Code from the actual target project root. Setup detects stack files such as `package.json`, `tsconfig.json`, `Cargo.toml`, and similar project markers.

### You want a team-shared install

Use `--scope project` only when you want the plugin registration limited to this checkout. Citadel treats `.claude/settings.json` as machine-local and writes it to the checkout's Git exclude file, so each teammate must install the plugin for their own checkout:

```bash
node /path/to/Citadel/scripts/claude-install.js --install --scope project
```

Review the settings diff before committing.
