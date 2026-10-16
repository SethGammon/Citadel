# Runtime Capability Matrix

Documents what each runtime adapter supports. Used by the runtime registry
and compatibility tests to verify behavior.

Last reviewed against repository adapter declarations: 2026-10-16.
This is a source capability contract, not a fresh live-runtime or human-use test.

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
| OpenCode | `hook-enabled` | guidance, skills, agents, plugin pre-tool gate, post-tool observers, workspace shell, MCP | Stop cannot block, no native permission gate, no batch/failure events |
| OpenAI | `remote-cloud-task` | agent loop, tool calling, workspace container when provided | local hook lifecycle, native Citadel skill runtime, local worktree lifecycle |
| Unknown | `native-files` | project guidance files | hooks, agents, worktrees, runtime history, approvals |

## Matrix

| Capability | Claude Code | Codex | OpenCode | OpenAI | Notes |
|---|---|---|---|---|---|
| `guidance` | Full | Full | Full | Full | CLAUDE.md / AGENTS.md projected from `.citadel/project.md` |
| `skills` | Full | Full | Full | Partial | OpenCode uses project-local skill projection and generated command wrappers; OpenAI uses Responses API reusable skills |
| `agents` | Full | Partial | Full | Partial | OpenCode loads Markdown agents and native task-tool subagents. Codex projected TOML cannot machine-enforce Citadel tool allow/deny lists. |
| `hooks` | Full | Partial | Partial | Partial | Claude installs a detected compatible subset (safe fallback: eight). Codex and OpenCode have tool/event exceptions. Hooks are guardrails, not a universal sandbox. |
| `workspace` | Full | Full | Full | Full | OpenCode provides file/shell tools; OpenAI provides a container only when configured. |
| `worktrees` | Full | Partial | Partial | None | Codex CLI and OpenCode use Citadel-managed worktrees; app-native and experimental APIs have separate contracts. |
| `approvals` | Full | Partial | Partial | Partial | OpenCode gates covered tools before execution; its permission hook is observational. |
| `history` | Full | Partial | Partial | Partial | Native session persistence does not replace Citadel-owned campaign state. |
| `telemetry` | Full | Full | Partial | Partial | OpenCode event-bus delivery is fire-and-forget; no delivery guarantee is assumed. |
| `mcp` | Full | Full | Full | Partial | OpenCode configures local MCP servers through `opencode.json`; OpenAI bridge support remains partial. |
| `surfaces` | Full | Partial | Partial | Partial | OpenCode supports plugins, skills, Markdown agents and commands; surface parity remains runtime-specific. |

OpenCode values above come from `runtimes/opencode/runtime.js`. Claude/Codex
declarations live beside their adapters; OpenAI's contract remains a separate
remote/API integration. The repository also contains `runtimes/local/` and
`runtimes/github-actions/` workflow compilation targets. Those directories are
not additional interactive coding-runtime registrations and do not imply local
hook, approval, history, or worktree parity. See [Workflow Compiler](../WORKFLOW_COMPILER.md).

## OpenCode evidence and limits

The [installation guide](../OPENCODE_INSTALLATION_GUIDE.md) records a maintainer
live check on 2026-09-10 using OpenCode 1.18.30, Bun 1.4.2 and Node 24.12.0 on
Windows 11. That dated integration check does not establish compatibility with
every later runtime version, independent adoption, or comparative usefulness.

OpenCode uses an in-process plugin to invoke Citadel's Node hooks. Covered
model-issued tools can be blocked at `tool.execute.before`. Stop findings are
delivered on a later turn; optional bounded re-prompting does not make Stop
blocking. The human-issued shell endpoint bypasses that pre-tool gate. Plugin
discovery requires an OpenCode restart after installation. Use the installer and
readiness checks from the guide for the target project rather than inferring
activation from source presence.

## Hook Event Coverage

Citadel defines a full 29-name Claude Code event template. The Claude installer
activates the subset compatible with the detected runtime profile, with eight
events in the safe fallback. Codex translates a supported native subset.
OpenAI Responses API supports agent-loop events natively through its adapter.
The table below describes Claude Code, Codex and OpenAI mappings, not guaranteed
activation in every installation. OpenCode's plugin boundary is described above:

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
