# Runtime Capability Matrix

Documents what each runtime adapter supports. Used by the runtime registry
and compatibility tests to verify behavior.

Last updated: 2026-09-11

## Capability IDs

Defined in `core/contracts/capabilities.js`. Support levels: `full`, `partial`,
`none`. `Full` describes adapter support for the capability, not activation of
every optional lifecycle event or coverage of every runtime tool path.

## Adapter Levels

Defined in `core/contracts/runtime.js` and printable with
`node scripts/runtime-matrix.js`.

| Level | Meaning |
|---|---|
| `native-files` | Citadel can project guidance/config files only. No runtime lifecycle guarantees. |
| `cli-session` | Citadel can drive a CLI session and normalize metadata, without assuming hooks. |
| `hook-enabled` | Runtime exposes enough lifecycle hooks for high Citadel parity. |
| `managed-subagent` | Runtime can manage agents/subagents and workspace state, but Citadel still owns evidence and policy normalization. |
| `remote-cloud-task` | Runtime executes remotely or in hosted containers; Citadel should use explicit evidence artifacts instead of local hook parity. |

| Runtime | Adapter Level | Guarantees | Main Gaps |
|---|---|---|---|
| Claude Code | `hook-enabled` | guidance, skills, agents, hooks, workspace shell, worktrees | runtime-native MCP server mode |
| Codex | `managed-subagent` | guidance, skills, agents, workspace shell, MCP, app artifacts | full hook parity, uniform CLI worktree handoff |
| OpenAI | `remote-cloud-task` | agent loop, tool calling, workspace container when provided | local hook lifecycle, native Citadel skill runtime, local worktree lifecycle |
| Unknown | `native-files` | project guidance files | hooks, agents, worktrees, runtime history, approvals |

## Matrix

| Capability | Claude Code | Codex | OpenAI | Notes |
|---|---|---|---|---|
| `guidance` | Full | Full | Full | CLAUDE.md / AGENTS.md projected from `.citadel/project.md` |
| `skills` | Full | Full | Partial | Codex supports repo/user/admin/system/plugin skills; OpenAI uses Responses API reusable skills |
| `agents` | Full | Partial | Partial | Codex supports `.codex/agents/*.toml` and native subagents, but projected TOML cannot machine-enforce Citadel tool allow/deny lists; OpenAI uses Responses API agent loop |
| `hooks` | Full | Partial | Partial | Claude has 29 defined handler names but installs a detected compatible subset (safe fallback: eight). Codex translates a supported subset and has specialized tool exceptions. Hooks are guardrails, not a universal sandbox. |
| `workspace` | Full | Full | Full | OpenAI Responses API provides shell tool + hosted container |
| `worktrees` | Full | Partial | None | Codex app supports native Git worktrees and handoff; CLI flows still rely on Citadel-managed worktrees |
| `approvals` | Full | Partial | Partial | Both Codex and OpenAI need adapter-level policy handling |
| `history` | Full | Partial | Partial | Claude Code exposes session JSONL; Codex uses API logs; OpenAI uses Responses API state |
| `telemetry` | Full | Full | Partial | Normalized events via `core/hooks/normalize-event.js` |
| `mcp` | Full | Full | Partial | Codex supports MCP servers in CLI/IDE and can run as an MCP server; OpenAI has native tool support, MCP bridge possible |
| `surfaces` | Full | Partial | Partial | Codex supports skills, plugins, app/IDE/CLI surfaces, browser/artifacts, and automations |

## Hook Event Coverage

Citadel defines a full 29-name Claude Code event template. The Claude installer
activates the subset compatible with the detected runtime profile, with eight
events in the safe fallback. Codex translates a supported native subset.
OpenAI Responses API supports agent-loop events natively through its adapter.
The table below describes defined mappings, not guaranteed activation in every
installation:

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
3. Projects covered `apply_patch` targets into the Edit/Write path shape used by `protect-files.js`
4. Maps current Codex-native events including permission, compaction, and subagent hooks
5. Skips unsupported task/worktree-only events with warnings (logged in translation metadata)
6. Merges with existing user hooks (preserving non-Citadel entries)

This projection makes P-006 deterministic for covered `apply_patch` calls. It
does not turn local hooks into a complete security boundary: Codex documents
specialized tool paths that may not invoke the local function-hook path.

The fixture at `scripts/fixtures/codex-translation-meta.json` tracks the exact
installed/skipped breakdown. Any change to hook coverage will be caught by
`test-compat-fixtures.js`.

## Agent Model Mapping

When projecting agents to Codex `.toml` format or OpenAI Responses API:

| Citadel model family | Default Codex model | OpenAI model |
|---|---|---|
| `fable` / `opus` | `gpt-5.6-sol` | Runtime-configured |
| `sonnet` | `gpt-5.6-terra` | Runtime-configured |
| `haiku` | `gpt-5.6-luna` | Runtime-configured |

The defaults and validation contract live in `core/agents/model-config.js`.
Projects can override a family, one agent, or the default reasoning effort in
the governed `extensions["citadel.codex-agents"]` config. Codex supports
`low`, `medium`, `high`, `xhigh`, `max`, and, on capable models, `ultra`.
Claude Code supports through `max`; Citadel does not incorrectly offer
Codex-only `ultra` to Claude executors.

## Guidance Projection

Both runtimes receive projected guidance from the canonical `.citadel/project.md`:

- **Claude Code**: `CLAUDE.md` via `core/project/render-claude-guidance.js`
- **Codex**: `AGENTS.md` via `core/project/render-codex-guidance.js`

Both renderers produce markdown with the same semantic sections (conventions,
workflows, constraints) but formatted for each runtime's conventions.
