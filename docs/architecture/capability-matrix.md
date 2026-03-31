# Runtime Capability Matrix

Documents what each runtime adapter supports. Used by the runtime registry
and compatibility tests to verify behavior.

Last updated: 2026-03-31

## Capability IDs

Defined in `core/contracts/capabilities.js`. Support levels: `full`, `partial`, `none`.

## Matrix

| Capability | Claude Code | Codex | Notes |
|---|---|---|---|
| `guidance` | Full | Full | CLAUDE.md / AGENTS.md projected from `.citadel/project.md` |
| `skills` | Full | Partial | Codex skill format uses OpenAI YAML adapter |
| `agents` | Full | Partial | Codex uses `.toml` format with model mapping |
| `hooks` | Full | Full | Codex hooks translated via adapter script |
| `workspace` | Full | Full | Both support project-level config |
| `worktrees` | Full | None | Codex lacks git worktree support |
| `approvals` | Full | Partial | Codex has limited hook-based approval flow |
| `history` | Full | Partial | Claude Code exposes session JSONL; Codex uses API logs |
| `telemetry` | Full | Full | Normalized events via `core/hooks/normalize-event.js` |
| `mcp` | Full | None | Codex does not support MCP servers |
| `surfaces` | Full | None | Desktop app reads Claude Code state only (for now) |

## Hook Event Coverage

Claude Code supports all 15 Citadel event types. Codex supports 5:

| Citadel Event | Claude Code | Codex |
|---|---|---|
| `session_start` | SessionStart | SessionStart |
| `pre_tool` | PreToolUse | PreToolUse |
| `post_tool` | PostToolUse | PostToolUse |
| `post_tool_failure` | PostToolUseFailure | (skipped) |
| `user_prompt` | UserPromptSubmit | UserPromptSubmit |
| `stop` | Stop | Stop |
| `stop_failure` | StopFailure | (skipped) |
| `session_end` | SessionEnd | mapped to Stop |
| `pre_compact` | PreCompact | (skipped) |
| `post_compact` | PostCompact | (skipped) |
| `subagent_stop` | SubagentStop | (skipped) |
| `task_created` | TaskCreated | (skipped) |
| `task_completed` | TaskCompleted | (skipped) |
| `worktree_create` | WorktreeCreate | (skipped) |
| `worktree_remove` | WorktreeRemove | (skipped) |

## Codex Hook Translation

When installing hooks for Codex, the translation layer:
1. Maps supported events using `EVENT_MAP` in `runtimes/codex/generators/install-hooks.js`
2. Routes all hooks through `codex-adapter.js` which normalizes input format
3. Skips unsupported events with warnings (logged in translation metadata)
4. Merges with existing user hooks (preserving non-Citadel entries)

The fixture at `scripts/fixtures/codex-translation-meta.json` tracks the exact
installed/skipped breakdown. Any change to hook coverage will be caught by
`test-compat-fixtures.js`.

## Agent Model Mapping

When projecting agents to Codex `.toml` format:

| Citadel Model | Codex Model |
|---|---|
| `opus` | `gpt-5.4` |
| `sonnet` | `gpt-5.4-mini` |
| `haiku` | `gpt-5.4-mini` |

Defined in `core/agents/project-agent.js`.

## Guidance Projection

Both runtimes receive projected guidance from the canonical `.citadel/project.md`:

- **Claude Code**: `CLAUDE.md` via `core/project/render-claude-guidance.js`
- **Codex**: `AGENTS.md` via `core/project/render-codex-guidance.js`

Both renderers produce markdown with the same semantic sections (conventions,
workflows, constraints) but formatted for each runtime's conventions.
