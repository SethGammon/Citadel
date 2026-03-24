# Contributing to Citadel

Contributions are welcome. Issues, bug reports, new skills, and hook improvements all help.

## Reporting Issues

Open an issue on [GitHub](https://github.com/SethGammon/Citadel/issues). Include:

- What you expected to happen
- What actually happened
- Error messages (full text, not screenshots of text)
- Your OS, shell, and Node version

## Submitting Pull Requests

1. Fork the repo
2. Create a branch from `main` (e.g., `fix/issue-10-description` or `feat/new-skill`)
3. Make your changes
4. Run `npm run test:hooks` to verify hooks are healthy
5. Open a PR against `main`

**Branch protection is enabled.** All changes go through a PR. Direct pushes to main are blocked.

### What to watch out for

**Cross-platform compatibility.** Citadel runs on Windows, macOS, and Linux. Before submitting:

- Do NOT use `$CLAUDE_PROJECT_DIR` in hook commands. It doesn't expand on Windows. Use relative paths (`node .claude/hooks/your-hook.js`). See [#10](https://github.com/SethGammon/Citadel/issues/10).
- Do NOT hardcode `/bin/bash`, `/bin/sh`, or other Unix-only paths
- Do NOT assume forward-slash path separators in Node scripts (use `path.join()`)
- Test on your platform and note which platform you tested on in the PR

**Hook commands use relative paths.** All hook commands in `settings.json` use the form `node .claude/hooks/<script>.js`. Claude Code sets cwd to the project root, so relative paths work everywhere.

**settings.json vs settings.local.json.** `settings.json` is tracked and ships to every user. `settings.local.json` is gitignored and is for personal configuration. If your hook or feature is only useful to specific workflows (not all users), it belongs in `settings.local.json`.

## Adding a New Skill

Skills live in `.claude/skills/<name>/SKILL.md`. Every skill needs:

```yaml
---
name: skill-name
description: >-
  One or two sentences explaining what the skill does.
user-invocable: true
auto-trigger: false
---
```

Follow the patterns in existing skills. Read 2-3 before writing your own.

## Adding a New Hook

Hooks live in `.claude/hooks/`. Before adding one:

1. Read `harness-health-util.js` for shared utilities (telemetry, config, validation)
2. Use `execFileSync` (not `execSync`) to avoid shell injection
3. Use `require('./harness-health-util')` for the project root path
4. Add your hook to `settings.json` (if universal) or document it for `settings.local.json` (if opt-in)
5. Run `npm run test:hooks` to make sure the smoke test picks it up

## Code Style

- Node.js scripts use CommonJS (`require`), not ESM
- Keep hooks fast (under 5s for PreToolUse, under 30s for PostToolUse)
- Fail-closed for security hooks (exit 2 on error), fail-open for non-critical hooks (exit 0 on error)
- No external dependencies. Hooks use only Node built-ins.
