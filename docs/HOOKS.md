# Hooks

> last-updated: 2026-03-25

Hooks are shell scripts that fire automatically at lifecycle events in Claude Code.
You never invoke them manually. They provide automated quality enforcement.

## Active Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| `post-edit.js` | PostToolUse | Per-file typecheck on every edit |
| `circuit-breaker.js` | PostToolUseFailure | Detect failure loops |
| `quality-gate.js` | Stop | Anti-pattern scan before session ends |
| `intake-scanner.js` | SessionStart | Report pending work items |
| `protect-files.js` | PreToolUse | Block edits to protected files |
| `pre-compact.js` | PreCompact | Save context before compression |
| `restore-compact.js` | SessionStart (compact) | Restore context after compression |
| `worktree-setup.js` | WorktreeCreate | Initialize agent worktrees |

## Lifecycle Events

| Event | When | Can Block? |
|-------|------|-----------|
| SessionStart | New conversation begins | No |
| PreToolUse | Before a tool is called | Yes (exit 2) |
| PostToolUse | After a tool completes | No |
| PostToolUseFailure | After a tool fails | No |
| PreCompact | Before message compression | No |
| Stop | Session ending | No |
| WorktreeCreate | Agent creates a worktree | No |

## Configuration

Hook definitions live in `hooks/hooks-template.json`. They are installed per-project
via `scripts/install-hooks.js`, which resolves `${CLAUDE_PLUGIN_ROOT}` to absolute paths
and filters out hook events unsupported by the installed Claude Code version:

```bash
# From your project directory:
node /path/to/Citadel/scripts/install-hooks.js
```

If Claude Code is unavailable on `PATH`, Citadel falls back to a safe compatibility
profile and skips newer hook events instead of writing a broken `.claude/settings.json`.

To force the full hook surface after upgrading Claude Code:

```bash
node /path/to/Citadel/scripts/install-hooks.js --hook-profile latest
```

This writes resolved hooks into your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/Citadel/hooks_src/post-edit.js",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Language-Adaptive Typecheck

The `post-edit.js` hook detects your project's language from `.claude/harness.json`
and runs the appropriate checker:

| Language | Checker | Per-File? |
|----------|---------|-----------|
| TypeScript | `tsc --noEmit` | Yes |
| Python | `mypy` or `pyright` | Yes |
| Go | `go vet` | Package-level |
| Rust | `cargo check` | Project-level |

Configure in `harness.json`:

```json
{
  "typecheck": {
    "command": "npx tsc --noEmit",
    "perFile": true
  }
}
```

## Dependency-Aware Pattern Detection

The `post-edit.js` hook can warn agents when they use raw APIs that an installed
library already handles. This prevents agents from reinventing what your project
already has.

Configure in `harness.json`:

```json
{
  "dependencyPatterns": [
    {
      "dependency": "@tanstack/react-query",
      "banned": ["fetch(", "axios(", "XMLHttpRequest"],
      "message": "Use tanstack query instead of raw fetch. See: https://tanstack.com/query"
    },
    {
      "dependency": "zustand",
      "banned": ["React.createContext", "useContext"],
      "message": "Use Zustand store instead of React Context for shared state"
    },
    {
      "dependency": "date-fns",
      "banned": ["new Date().toLocaleDateString", "moment("],
      "message": "Use date-fns for date formatting — it's already installed"
    },
    {
      "dependency": "zod",
      "banned": ["typeof ", "instanceof "],
      "message": "Use Zod schemas for runtime validation instead of manual type checks"
    }
  ]
}
```

**How it works:**

1. On each edit, reads `dependencyPatterns` from harness.json (skips entirely if missing)
2. Reads `package.json` once per session and caches the dependency list
3. For each pattern entry: if the dependency is installed, scans the edited file for banned strings
4. Surfaces warnings (not blocks) — the agent sees the feedback and self-corrects

**Rules:**

- `dependencyPatterns` is optional. If absent, zero cost — the section is skipped entirely.
- Only the edited file is scanned, not the whole project.
- `package.json` is read once and cached for the process lifetime.
- Warnings only. The agent receives the feedback but the edit is not blocked.
- One warning per dependency per edit (not per match).

`/do setup` will detect common dependencies and offer to add patterns during first run.

## Circuit Breaker

Tracks tool failures. After 3 failures:
- Suggests alternative approaches
- After 5 trips: escalates to "stop and rethink" message

State stored in `.claude/circuit-breaker-state.json` (gitignored).

**Note:** The failure counter increments on every `PostToolUseFailure` event and resets
when the threshold is hit (tripped). There is no success-reset mechanism — the counter
tracks failures since the last trip, not strictly consecutive failures. In practice this
means scattered failures across a long session can eventually trip the breaker, which is
conservative by design.

## Quality Gate

Scans recently modified files on session end. Built-in rules:

| Rule | What It Catches |
|------|----------------|
| `no-confirm-alert` | `confirm()`, `alert()`, `prompt()` in JS/TS |
| `no-transition-all` | `transition-all` in CSS/JSX |
| `no-magic-intervals` | Hardcoded `setInterval` numbers |

Add custom rules in `harness.json`:

```json
{
  "qualityRules": {
    "builtIn": ["no-confirm-alert", "no-transition-all"],
    "custom": [
      {
        "name": "no-console-log",
        "pattern": "console\\.log\\(",
        "filePattern": "\\.(ts|tsx)$",
        "message": "Remove console.log before committing"
      }
    ]
  }
}
```

## Rules

1. **One hook per lifecycle event.** Don't chain multiple scripts on the same event.
2. **Hooks must be fast.** PostToolUse fires on every edit — keep it under 5 seconds.
3. **Hook output goes to Claude.** Use it for actionable feedback, not noise.
4. **PreToolUse can block.** Exit code 2 prevents the tool from executing.
5. **Everything else is advisory.** Other hooks report but don't block.