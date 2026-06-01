# Install Citadel

Citadel installs into the project you already have open in Claude Code or OpenAI Codex.

## Easiest Path: Ask Your Agent

Paste this into the agent running inside your target repository:

```text
Install Citadel in this repository.

Use https://github.com/SethGammon/Citadel as the source. If a local clone
already exists, reuse it or update it. Detect whether this session is running
in OpenAI Codex or Claude Code. From this project's root, run the matching
Citadel installer and follow any printed plugin enable step.

After Citadel is enabled in a fresh thread, run:

/do setup --express

Do not ask me to edit placeholder paths. Use the current repository as the
target project.
```

That prompt is intentionally path-free. The agent should use the repository it is already in as the target project.

## Manual Install

Run the commands below from the project you want Citadel to manage. Do not run them from the Citadel clone unless Citadel itself is the target project.

First, clone or update Citadel once:

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
```

If `~/Citadel` already exists, update it instead:

```bash
git -C ~/Citadel pull
```

### OpenAI Codex

From your target project root:

```bash
node ~/Citadel/scripts/install.js --runtime codex --add-marketplace
codex
```

In Codex, open **Plugins**, choose **Citadel Local Plugins**, select **Add to Codex** for **Citadel Harness**, start a new thread, then run:

```text
/do setup --express
```

### Claude Code

From your target project root:

```bash
node ~/Citadel/scripts/install.js --runtime claude --install --scope local
claude
```

In Claude Code, run:

```text
/do setup --express
```

`--scope local` installs Citadel for you in this repository only. It is the safest default.

## Preview Before Writing

Both installers support dry-run JSON output from the target project root:

```bash
node ~/Citadel/scripts/install.js --runtime codex --dry-run --json
node ~/Citadel/scripts/install.js --runtime claude --install --dry-run --json
```

## Verify

From the Citadel clone:

```bash
npm test
```

More detail:

- [Quickstart](QUICKSTART.md)
- [Claude Code installation guide](docs/CLAUDE_INSTALLATION_GUIDE.md)
- [Codex installation guide](docs/CODEX_INSTALLATION_GUIDE.md)
