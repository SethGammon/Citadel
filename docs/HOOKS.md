# Hooks

> last-updated: 2026-05-07

Hooks are Node.js scripts that fire automatically at lifecycle events in Claude Code.
You never invoke them manually. They provide automated quality enforcement and telemetry.

## Active Hooks (29 of 29 Claude Code events)

| Hook | Event | Purpose |
|------|-------|---------|
| `protect-files.js` | PreToolUse | Block edits to protected files and out-of-scope paths |
| `external-action-gate.js` | PreToolUse (Bash) | Gate external actions (git push, API calls) |
| `governance.js` | PreToolUse (Edit/Write/Bash/Agent) | Audit every significant tool call |
| `post-edit.js` | PostToolUse | Project-scope incremental typecheck + structural/performance/visual lenses |
| `organize-enforce.js` | PostToolUse (Edit/Write) | Enforce file placement conventions |
| `circuit-breaker.js` | PostToolUse (Bash) + PostToolUseFailure | Detect failure loops |
| `cost-tracker.js` | PostToolUse | Real-time session cost monitoring |
| `complexity-check.js` | PostToolUse (Edit/Write) | Advisory complexity score for JS/TS files |
| `post-tool-batch.js` | PostToolBatch | Wave-level quality checkpoint (async, asyncRewake) |
| `quality-gate.js` | Stop | Cold-path anti-pattern scan before session ends |
| `stop-failure.js` | StopFailure | Log hook failures |
| `user-prompt-submit.js` | UserPromptSubmit | Log turn boundaries; extension point for prompt gating |
| `user-prompt-expansion.js` | UserPromptExpansion | Log skill invocations to skill-usage.jsonl |
| `init-project.js` | SessionStart + Setup | Scaffold .planning/ state; also runs in --init-only mode |
| `restore-compact.js` | SessionStart (compact) | Restore context after compression |
| `intake-scanner.js` | SessionStart | Report pending work items |
| `session-end.js` | SessionEnd | Flush session telemetry |
| `subagent-start.js` | SubagentStart | Bind fleet agent identity at spawn time |
| `subagent-stop.js` | SubagentStop | Log agent completion + flag abnormal exits |
| `teammate-idle.js` | TeammateIdle | Log teammate idle events (multi-instance fleet) |
| `permission-request.js` | PermissionRequest + PermissionDenied | Auto-approve safe Citadel ops, log all decisions |
| `instructions-loaded.js` | InstructionsLoaded | Detect CLAUDE.md reloads, queue doc-sync |
| `file-changed.js` | FileChanged | React to file-on-disk changes; queue doc-sync and skill-lint |
| `cwd-changed.js` | CwdChanged | Log directory changes; flag when moving outside project root |
| `config-change.js` | ConfigChange | Detect harness.json / settings.json changes mid-session |
| `elicitation.js` | Elicitation + ElicitationResult | Log MCP elicitation requests; never auto-responds |
| `notification.js` | Notification | Elevated audit for auth events; log idle alerts |
| `task-events.js` | TaskCreated + TaskCompleted | Task lifecycle telemetry |
| `worktree-setup.js` | WorktreeCreate | Initialize agent worktrees |
| `worktree-remove.js` | WorktreeRemove | Clean up worktree state |
| `pre-compact.js` | PreCompact | Save context before compression |
| `post-compact.js` | PostCompact | Restore compact state |

## Lifecycle Events (all 29)

| Event | When | Can Block? | Citadel Hook |
|-------|------|------------|--------------|
| `Setup` | `--init-only` or `--maintenance` mode | No | `init-project.js` |
| `UserPromptSubmit` | Before Claude processes each user prompt | Yes | `user-prompt-submit.js` |
| `UserPromptExpansion` | Slash command expands | Yes | `user-prompt-expansion.js` |
| `SessionStart` | New conversation begins | No | `init-project.js`, `restore-compact.js`, `intake-scanner.js` |
| `PreToolUse` | Before a tool executes | Yes (exit 2) | `protect-files.js`, `external-action-gate.js`, `governance.js` |
| `PostToolUse` | After a tool completes | No | `post-edit.js`, `organize-enforce.js`, `circuit-breaker.js`, `cost-tracker.js`, `complexity-check.js` |
| `PostToolBatch` | After ALL parallel tools in a wave settle | No | `post-tool-batch.js` |
| `PostToolUseFailure` | After a tool fails | No | `circuit-breaker.js` |
| `Stop` | Session turn ending | No | `quality-gate.js` |
| `StopFailure` | Hook error on Stop | No | `stop-failure.js` |
| `SessionEnd` | Session terminated | No | `session-end.js` |
| `SubagentStart` | Subagent spawns (Agent tool) | No | `subagent-start.js` |
| `SubagentStop` | Subagent session ends | No | `subagent-stop.js` |
| `TeammateIdle` | A Claude Code teammate goes idle | No | `teammate-idle.js` |
| `PermissionRequest` | Permission dialog appears | Yes (via JSON output) | `permission-request.js` |
| `PermissionDenied` | Auto-mode denies a tool | No | `permission-request.js` |
| `InstructionsLoaded` | CLAUDE.md or rules/*.md loaded | No | `instructions-loaded.js` |
| `FileChanged` | Watched file changes on disk | No | `file-changed.js` |
| `CwdChanged` | Working directory changes | No | `cwd-changed.js` |
| `ConfigChange` | Settings file changes mid-session | No | `config-change.js` |
| `Elicitation` | MCP server requests user input | No | `elicitation.js` |
| `ElicitationResult` | User responds to MCP elicitation | No | `elicitation.js` |
| `Notification` | Permission prompts, idle alerts, auth events | No | `notification.js` |
| `TaskCreated` | Task created | No | `task-events.js` |
| `TaskCompleted` | Task completed | No | `task-events.js` |
| `PreCompact` | Before message compression | No | `pre-compact.js` |
| `PostCompact` | After compression | No | `post-compact.js` |
| `WorktreeCreate` | Agent creates a worktree | No | `worktree-setup.js` |
| `WorktreeRemove` | Worktree deleted | No | `worktree-remove.js` |

## Hook Protocol

Hooks receive a JSON payload on stdin and communicate results via:

| Mechanism | How | When |
|-----------|-----|------|
| **Exit 0** | Success — no block | Always for observer hooks |
| **Exit 2** | Block — abort the tool | PreToolUse and UserPromptSubmit only |
| **`additionalContext`** | JSON `{"additionalContext": "text"}` on stdout | Inject text into Claude's context window |
| **`hookSpecificOutput`** | JSON on stdout | PermissionRequest auto-approve decisions |
| **`asyncRewake: true`** | Declared in hook registration | Run async, wake Claude only on exit 2 |

Key protocol fields from the event payload that hooks consume:

| Field | Available On | Used By |
|-------|-------------|---------|
| `agent_id` | All events inside subagents | `governance.js`, `subagent-start.js`, `post-edit.js` |
| `agent_type` | All events inside subagents | `governance.js`, `subagent-start.js`, `post-edit.js` |
| `duration_ms` | PostToolUse | `post-edit.js` (wall-clock timing, excluding permission prompts) |
| `file_path` | PostToolUse (Write/Edit/Read) | `post-edit.js`, `organize-enforce.js` |

## Configuration

Hook definitions live in `hooks/hooks-template.json`. Installed per-project via `scripts/install-hooks.js`:

```bash
# From your project directory:
node /path/to/Citadel/scripts/install-hooks.js
```

To force the full hook surface after upgrading Claude Code:

```bash
node /path/to/Citadel/scripts/install-hooks.js --hook-profile latest
```

## PostToolBatch — Wave-Level Quality Checkpoint

`post-tool-batch.js` fires **once** after all parallel tool calls in a wave settle,
rather than once per tool. This is the wave-level checkpoint — more efficient than
per-tool checks for multi-file edit waves.

Registered with `async: true, asyncRewake: true` — runs in the background without
blocking the edit path. If it exits 2, Claude Code wakes Claude with the stderr as
feedback. Currently exit 0 only (observer mode).

## Permission Auto-Approval

`permission-request.js` auto-approves known-safe Citadel operations without showing
the permission dialog. Safe patterns:

- `node .citadel/scripts/*.js` (telemetry delegates)
- Write/Edit to `.planning/**` (campaign and fleet state)
- Write/Edit to `.citadel/**` (harness scaffolding)

All permission requests (approved and deferred) are logged to `audit.jsonl`.

## additionalContext Output

`quality-gate.js` (Stop) and `post-tool-batch.js` (PostToolBatch) inject quality signals
directly into Claude's context window via the `additionalContext` protocol field, rather
than printing to stderr. This means Claude sees the violation summary in its context
without relying on stderr display.

CITADEL_UI mode (when `CITADEL_UI=true`) uses the Citadel-formatted JSON instead.

## Language-Adaptive Typecheck

The `post-edit.js` hook detects your project's language from `.claude/harness.json`
and runs the appropriate checker:

| Language | Checker | Scope |
|----------|---------|-------|
| TypeScript | `tsc --noEmit` | Project-scope incremental (build info cached in `.planning/cache/`) |
| Python | `mypy` or `pyright` | Per-file |
| Go | `go vet` | Package-level |
| Rust | `cargo check` | Project-level |

Configure in `harness.json`:

```json
{
  "typecheck": {
    "command": "npx tsc --noEmit",
    "timeoutMs": 25000
  }
}
```

For TypeScript, the check runs on every `.ts`/`.tsx` edit (declaration files
excluded) as a project-scope incremental `tsc --noEmit`. The binary is resolved
directly (the project's `typescript` package, `node_modules/.bin/tsc`, or PATH,
honoring `.cmd` on Windows) and is never spawned through `npx` or a shell. A
custom `typecheck.command` is honored. The check has four outcomes: pass,
errors, unavailable, and timeout. When the checker is missing or exceeds
`timeoutMs`, the hook reports explicitly that the typecheck DID NOT RUN and
why, exits 0, and never blocks on those infrastructure failures. `perFile` is
not supported for TypeScript; if set, the hook warns and runs the project-scope
incremental check instead.

## Dependency-Aware Pattern Detection

The `post-edit.js` hook warns agents when they use raw APIs that an installed
library already handles. Configure in `harness.json`:

```json
{
  "dependencyPatterns": [
    {
      "dependency": "@tanstack/react-query",
      "banned": ["fetch(", "axios("],
      "message": "Use tanstack query instead of raw fetch"
    }
  ]
}
```

## Quality Gate Rules

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

## Circuit Breaker

Tracks tool failures. After 3 failures: suggests alternatives. After 5: escalates to
"stop and rethink". State stored in `.claude/circuit-breaker-state.json` (gitignored).

## Rules

1. **Hooks are fail-safe.** Observer hooks always exit 0. Only PreToolUse and UserPromptSubmit can block (exit 2).
2. **Hot-path hooks must be fast.** PostToolUse fires on every edit — keep it under 5 seconds.
3. **Use `additionalContext` for feedback.** Inject quality signals into Claude's context window rather than printing to stderr.
4. **Heavy checks use `asyncRewake`.** Slow quality checks (typecheck, test runs) run async on PostToolBatch — zero blocking penalty on the edit path.
5. **Fleet agents are attributed.** `agent_id` and `agent_type` are captured on every audit log entry when inside a subagent.
