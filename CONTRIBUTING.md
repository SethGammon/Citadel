# Contributing to Citadel

Thanks for being here. Issues, bug reports, new skills, loop templates, hook improvements, and docs fixes all genuinely help. This page gets you from clone to merged PR with no surprises.

## Ways to contribute

| Path | Good first move | Where it lives |
|---|---|---|
| **Report a bug** | Open an issue with the template | [Issues](https://github.com/SethGammon/Citadel/issues) |
| **Add a skill** | Read 2-3 existing skills, then scaffold your own | [`skills/`](skills/) |
| **Improve a hook** | Read the shared utilities first | [`hooks_src/`](hooks_src/) |
| **Add a loop template** | Study the loop contract | [`core/loops/templates.js`](core/loops/templates.js), [docs/LOOP_CONTRACT.md](docs/LOOP_CONTRACT.md) |
| **Fix docs** | Generated counts regenerate; prose edits are welcome | [`docs/`](docs/) |

Looking for a starting point? Check issues labeled [good first issue](https://github.com/SethGammon/Citadel/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Reporting issues

Include what you expected, what actually happened, the full error text (not a screenshot of text), and your OS, shell, and Node version. The issue templates ask for exactly these.

## Pull requests

1. Fork and branch from `main` (`fix/issue-10-description`, `feat/new-skill`).
2. Make your changes.
3. Run the verification suite (table below).
4. Open a PR against `main` and note which platform you tested on.

> [!IMPORTANT]
> Branch protection is enabled: all changes go through a PR, and CI runs the full suite on Ubuntu and Windows across Node 18 and 20. A PR that passes locally but only on one platform will usually fail the matrix; the cross-platform rules below are how you avoid that.

### Verification commands

| Command | What it checks | When to run |
|---|---|---|
| `npm test` | The full fast suite (hooks, skills, runtimes, docs, dashboard) | Before every PR |
| `node hooks_src/smoke-test.js` | Hooks only | After hook changes |
| `node scripts/verify-hooks.js` | Hook install plus runtime with synthetic payloads | After hook changes |
| `node scripts/skill-lint.js {name}` | One skill's structure | After skill changes |
| `node scripts/skill-bench.js --skill {name}` | Benchmark scenario validity | After adding benchmarks |

### Cross-platform rules

Citadel runs on Windows, macOS, and Linux. The suite enforces most of this, but save yourself a CI round trip:

- Never hardcode `/bin/bash`, `/bin/sh`, or other Unix-only paths.
- Never assume forward-slash separators; use `path.join()`.
- Use `execFileSync`, not `execSync`, to avoid shell injection.
- Use `process.env.CLAUDE_PROJECT_DIR || process.cwd()` for the user's project root.

## Adding a skill

Skills live in `skills/{name}/SKILL.md`, one directory per skill, with frontmatter:

```yaml
---
name: skill-name
description: >-
  One or two sentences explaining what the skill does.
user-invocable: true
auto-trigger: false
---
```

Read a few existing skills before writing your own; the patterns are deliberate. Keep SKILL.md terse and accurate: stale or vague guidance actively degrades agent accuracy, and lint enforces a 300-line budget. Then:

```bash
node scripts/skill-lint.js {name}
```

Users can also create project-level skills in their own `.claude/skills/` via `/create-skill`; built-in skills are for workflows broadly useful across projects.

## Adding a hook

Hooks live in `hooks_src/`. Before adding one:

1. Read `harness-health-util.js` for shared utilities (telemetry, config, validation, project root).
2. Add the hook to `hooks/hooks-template.json`; the installer resolves `${CLAUDE_PLUGIN_ROOT}` at install time.
3. If it needs a newer Claude Code event, update the compatibility gating in `runtimes/claude-code/generators/hook-support.js`.
4. Run `node hooks_src/smoke-test.js` to confirm the smoke test picks it up.

Style contract for hooks: CommonJS, Node built-ins only (no dependencies), fast (under 5s for PreToolUse, under 30s for PostToolUse), fail-closed for security hooks (exit 2 on error) and fail-open for non-critical ones (exit 0).

### Opt-in hooks

Some hooks ship in `hooks_src/` but are not in the default template. Wire them into your project's `.claude/settings.local.json`:

- **`external-action-gate.js`** blocks git push, PR creation, issue comments, and other external actions until approved:

  ```json
  {
    "hooks": {
      "PreToolUse": [{
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks_src/external-action-gate.js'", "timeout": 5 }]
      }]
    }
  }
  ```

- **`issue-monitor.js`** checks for new GitHub issues on session start:

  ```json
  {
    "hooks": {
      "SessionStart": [{
        "hooks": [{ "type": "command", "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks_src/issue-monitor.js'", "timeout": 20 }]
      }]
    }
  }
  ```

> [!NOTE]
> Migrating from the old copy-based install? Paths change from `node .claude/hooks/<hook>.js` to the `${CLAUDE_PLUGIN_ROOT}` form above.

## Repository layout

```
citadel/
  .claude-plugin/       # Plugin manifest
  skills/               # Built-in skills ({name}/SKILL.md)
  agents/               # Sub-agent definitions
  hooks/                # Hook definitions (hooks-template.json)
  hooks_src/            # Hook script implementations
  core/                 # Shared modules (campaigns, loops, fleet, telemetry, ...)
  dashboard/            # Local web dashboard UI
  runtimes/             # Claude Code and Codex adapters
  scripts/              # Installers, verification, utilities
  docs/                 # Reference documentation
```

The `init-project` SessionStart hook auto-scaffolds per-project state (`.planning/`, `.citadel/scripts/`); per-project configuration lives in `.claude/harness.json`, generated by `/do setup`.

## Code style

- Node.js scripts use CommonJS (`require`), not ESM.
- No external dependencies anywhere in the harness; Node built-ins only.
- Generated doc surfaces (counts, tables) are regenerated by script; do not hand-edit content between `GENERATED` markers.
