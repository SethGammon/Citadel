# Install Citadel

Citadel installs as a plugin for the agent runtime you already use. Pick one runtime, run one bootstrap command from your target project, then run `/do setup --express`.

## OpenAI Codex

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
cd /path/to/your-project
node ~/Citadel/scripts/install.js --runtime codex --add-marketplace
codex
```

In Codex, open **Plugins**, choose **Citadel Local Plugins**, select **Add to Codex**, start a new thread, then run:

```text
/do setup --express
```

## Claude Code

```bash
git clone https://github.com/SethGammon/Citadel.git ~/Citadel
cd /path/to/your-project
node ~/Citadel/scripts/install.js --runtime claude --install --scope local
claude
```

In Claude Code, run:

```text
/do setup --express
```

`--scope local` is the safest default. It installs Citadel for you in this repository only.

## Preview Before Writing

Both installers support dry-run JSON output:

```bash
node ~/Citadel/scripts/install.js --runtime codex --dry-run --json
node ~/Citadel/scripts/install.js --runtime claude --install --dry-run --json
```

## Verify

From the Citadel clone:

```bash
npm test
```

Detailed guides:

- [Quickstart](QUICKSTART.md)
- [Claude Code installation guide](docs/CLAUDE_INSTALLATION_GUIDE.md)
- [Codex installation guide](docs/CODEX_INSTALLATION_GUIDE.md)
