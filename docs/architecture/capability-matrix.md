# Runtime Capability Matrix

Documents what each runtime adapter supports. Used by the runtime registry
and compatibility tests to verify behavior.

Last updated: 2026-06-01

## Capability IDs

Defined in `core/contracts/capabilities.js`. Support levels: `full`, `partial`, `none`.

## Matrix

| Capability | Claude Code | Codex | OpenAI | Notes |
|---|---|---|---|---|
| `guidance` | Full | Full | Full | CLAUDE.md / AGENTS.md projected from `.citadel/project.md` |
| `skills` | Full | Full | Partial | Codex supports repo/user/admin/system/plugin skills; OpenAI uses Responses API reusable skills |
| `agents` | Full | Full | Partial | Codex supports `.codex/agents/*.toml` and native subagents; OpenAI uses Responses API agent loop |
| `hooks` | Full | Partial | Partial | Codex supports native lifecycle hooks, but Citadel still needs an adapter for hook contract parity |
| `workspace` | Full | Full | Full | OpenAI Responses API provides shell tool + hosted container |
| `worktrees` | Full | Partial | None | Codex app supports native Git worktrees and handoff; CLI flows still rely on Citadel-managed worktrees |
| `approvals` | Full | Partial | Partial | Both Codex and OpenAI need adapter-level policy handling |
| `history` | Full | Partial | Partial | Claude Code exposes session JSONL; Codex uses API logs; OpenAI uses Responses API state |
| `telemetry` | Full | Full | Partial | Normalized events via `core/hooks/normalize-event.js` |
| `mcp` | Full | Full | Partial | Codex supports MCP servers in CLI/IDE and can run as an MCP server; OpenAI has native tool support, MCP bridge possible |
| `surfaces` | Full | Partial | Partial | Codex supports skills, plugins, app/IDE/CLI surfaces, browser/artifacts, and automations |

## Hook Event Coverage

Claude Code supports the full Citadel event template. Codex supports a growing native subset. OpenAI Responses API supports agent-loop events natively (adapter extends coverage):

| Citadel Event | Claude Code | Codex | OpenAI |
|---|---|---|---|
| `session_start` | SessionStart | SessionStart | Agent loop start |
| `pre_tool` | PreToolUse | PreToolUse | (via adapter) |
| `post_tool` | PostToolUse | PostToolUse | (via adapter) |
| `post_tool_failure` | PostToolUseFailure | (skipped) | (via adapter) |
| `user_prompt` | UserPromptSubmit | UserPromptSubmit | Input message |
| `stop` | Stop | Stop | Agent loop end |
| `stop_failure` | StopFailure | (skipped) | (skipped) |
| `session_end` | SessionEnd | mapped to Stop | Agent loop end |
| `pre_compact` | PreCompact | PreCompact | Context compaction trigger |
| `post_compact` | PostCompact | PostCompact | (skipped) |
| `subagent_start` | SubagentStart | SubagentStart | (skipped) |
| `subagent_stop` | SubagentStop | SubagentStop | (skipped) |
| `permission_request` | PermissionRequest | PermissionRequest | Approval request |
| `task_created` | TaskCreated | (skipped) | (skipped) |
| `task_completed` | TaskCompleted | (skipped) | (skipped) |
| `worktree_create` | WorktreeCreate | app-native only | (skipped) |
| `worktree_remove` | WorktreeRemove | app-native only | (skipped) |

## Codex Hook Translation

When installing hooks for Codex, the translation layer:
1. Maps supported events using `EVENT_MAP` in `runtimes/codex/generators/install-hooks.js`
2. Routes all hooks through `codex-adapter.js` which normalizes input format
3. Maps current Codex-native events including permission, compaction, and subagent hooks
4. Skips unsupported task/worktree-only events with warnings (logged in translation metadata)
5. Merges with existing user hooks (preserving non-Citadel entries)

The fixture at `scripts/fixtures/codex-translation-meta.json` tracks the exact
installed/skipped breakdown. Any change to hook coverage will be caught by
`test-compat-fixtures.js`.

## Agent Model Mapping

When projecting agents to Codex `.toml` format or OpenAI Responses API:

| Citadel Model | Codex Model | OpenAI Model |
|---|---|---|
| `opus` | `gpt-5.4` | `gpt-5.4` (configurable via `CITADEL_OPENAI_MODEL`) |
| `sonnet` | `gpt-5.4-mini` | `gpt-5.4-mini` |
| `haiku` | `gpt-5.4-mini` | `gpt-5.4-mini` |

Defined in `core/agents/project-agent.js`. OpenAI model mapping is configurable
via environment variables (see `packages/runtime-openai/README.md`).

## Guidance Projection

Both runtimes receive projected guidance from the canonical `.citadel/project.md`:

- **Claude Code**: `CLAUDE.md` via `core/project/render-claude-guidance.js`
- **Codex**: `AGENTS.md` via `core/project/render-codex-guidance.js`

Both renderers produce markdown with the same semantic sections (conventions,
workflows, constraints) but formatted for each runtime's conventions.
