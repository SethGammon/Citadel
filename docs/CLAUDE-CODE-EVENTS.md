# Claude Code Events — Complete Reference

> Written: 2026-05-07
> Coverage: all 29 Claude Code lifecycle events
> Citadel coverage: 29 / 29

Claude Code exposes a lifecycle hook system that lets you intercept, observe, and
react to every meaningful event in an agent session. Each event fires a registered
hook script via stdin/stdout. This document covers all 29 events — what each one
is, when it fires, what data it carries, and how Citadel uses it.

---

## How the Hook System Works

Every hook is a script that:

1. Receives a JSON payload on **stdin**
2. Writes output to **stdout** (structured JSON) or **stderr** (error text)
3. Exits with a code that signals intent to Claude Code

**Exit codes:**

| Code | Meaning | Works on |
|------|---------|---------|
| `0` | Success — continue normally | All events |
| `2` | Block — abort this tool/prompt | PreToolUse, UserPromptSubmit, UserPromptExpansion only |

**Structured stdout outputs:**

| Field | Effect |
|-------|--------|
| `{"additionalContext": "text"}` | Inject text directly into Claude's context window |
| `{"hookSpecificOutput": {...}}` | Event-specific response (e.g., permission decisions, elicitation responses) |

**Async execution:**

Register a hook with `"async": true, "asyncRewake": true` and it runs in the
background — zero blocking penalty on the edit path. If it exits 2, Claude Code
wakes Claude with the stderr as feedback. Used by Citadel on PostToolBatch for
wave-level quality checks that shouldn't stall the editor.

---

## Event Categories

Events group into eight categories based on when they fire in the session lifecycle:

```
Session  →  Prompt  →  Tool Loop  →  Agents  →  Permissions  →  Context  →  Environment  →  Platform
```

---

## Session Events

### `Setup`
**When:** Claude Code starts in `--init-only` or `--maintenance` mode — before any
user interaction. This is a CI/CD and tooling entry point separate from normal
session startup.

**Payload fields:** `session_id`, `mode` (`init-only` | `maintenance`)

**What it's for:** Running scaffolding and maintenance tasks without starting a
full conversation. Useful for `claude --init-only` in deployment scripts.

**Citadel use:** Registered with `init-project.js` — the same scaffolding script
that runs on SessionStart. This ensures `.planning/` directories, `.citadel/scripts/`
delegates, and templates are created in maintenance runs, not just interactive sessions.

---

### `SessionStart`
**When:** A new Claude Code conversation begins — fires once per session, before any
user prompt is processed.

**Payload fields:** `session_id`, `cwd`, `model`, `transcript_path`

**What it's for:** Session initialization — scaffolding project state, restoring
saved context, detecting pending work.

**Citadel use:** Three hooks registered here, each with a distinct purpose:
- `init-project.js` — scaffolds `.planning/`, `.citadel/scripts/` delegates,
  and `_templates/` if not present (idempotent — safe to re-run every session)
- `restore-compact.js` — if this session follows a compaction, restores the
  saved context snapshot so campaign state isn't lost
- `intake-scanner.js` — scans `.planning/intake/` for pending work items and
  surfaces a count so Claude knows there's a queue to process

---

### `SessionEnd`
**When:** The session terminates — user closes the session, `ctrl+c`, or the
process exits. Fires after the final turn completes.

**Payload fields:** `session_id`, `stop_reason`, `usage` (token counts)

**What it's for:** Flushing state, writing session summaries, final telemetry.

**Citadel use:** `session-end.js` flushes the session's timing data and records
a session boundary entry in `hook-timing.jsonl`. This allows `/telemetry` to
reconstruct session cost and duration from the JSONL trail.

---

## Prompt Events

### `UserPromptSubmit`
**When:** The user submits a message — fires before Claude sees it. This is the
earliest interception point in the turn lifecycle and can block or modify the prompt.

**Payload fields:** `session_id`, `prompt` (the raw user text), `agent_id` (if inside
a subagent)

**What it's for:** Prompt-level gating before Claude processes anything. Can block
prompt injection, enforce prompt policies, or inject additional context. Can also
set `sessionTitle` to auto-name the session.

**Citadel use:** `user-prompt-submit.js` — currently observe-only. Logs the turn
boundary to `hook-timing.jsonl` for session reconstruction without logging prompt
content (privacy). This is Citadel's extension point for prompt security screening
if needed — the hook is in place and wired, the semantic gate is not yet active.

---

### `UserPromptExpansion`
**When:** A slash command expands — fires after `/do`, `/marshal`, `/fleet` etc.
are recognized but before Claude processes the expanded content. Can block or inject
context into the expansion.

**Payload fields:** `session_id`, `original_prompt` (what the user typed),
`expanded_prompt` (the post-expansion content), `skill_name` (the command name)

**What it's for:** Tracking which skills are invoked, injecting skill-specific
context, or blocking unsafe commands before expansion.

**Citadel use:** `user-prompt-expansion.js` — extracts the skill name from the
prompt and appends a line to `skill-usage.jsonl`. This feeds `/telemetry` skill
usage stats: which skills are used most, trend over sessions. The `KNOWN_SERVERS`
pattern is a natural future extension point for skill-level context injection.

---

## Tool Loop Events

### `PreToolUse`
**When:** Before a tool executes. Fires for every tool call — Edit, Write, Read,
Bash, Agent, WebSearch, etc. Can block the tool by exiting 2.

**Payload fields:** `tool_name`, `tool_input` (full tool parameters), `session_id`,
`agent_id` (if inside subagent), `cwd`

**What it's for:** The enforcement gate. Block dangerous operations, enforce
scope constraints, audit what's about to happen.

**Citadel use:** Three hooks registered with matchers:
- `protect-files.js` (Edit|Write|Read) — blocks edits to `.claude/harness.json`,
  `.env*`, and files in active campaign's Restricted Files list; warns for
  edits outside the campaign's Claimed Scope
- `external-action-gate.js` (Bash) — gates external actions like `git push`,
  `gh pr create`, Slack/email sends; first encounter triggers consent flow;
  hard-blocks secrets patterns regardless of consent
- `governance.js` (Edit|Write|Bash|Agent) — writes every significant tool call
  to `audit.jsonl` including `agent_id` and `agent_type` for attribution; never blocks

---

### `PostToolUse`
**When:** After a tool completes successfully. Fires for every successful tool call.

**Payload fields:** `tool_name`, `tool_input`, `tool_output` (result), `duration_ms`
(wall-clock time excluding permission prompts), `session_id`, `agent_id`, `agent_type`

**What it's for:** React to what just happened — typecheck the file that was edited,
update cost counters, enforce conventions.

**Citadel use:** Four hooks registered:
- `post-edit.js` (all tools) — for Edit/Write: runs hot-path lenses (typecheck,
  structural, performance, visual, cross-reference). Records `duration_ms`,
  `agent_id`, `agent_type` in timing telemetry so tool timing is attributable
  per fleet agent
- `organize-enforce.js` (Edit|Write) — checks that newly-written files are in
  their correct directory per the project's organization conventions
- `circuit-breaker.js` (Bash) — tracks Bash failures; trips at 3 consecutive
  failures to suggest alternatives; escalates at 5
- `cost-tracker.js` (all tools) — time-gated cost monitoring; computes session
  cost from token JSONL; surfaces threshold alerts and burn rate

---

### `PostToolBatch`
**When:** After ALL parallel tool calls in a single wave settle — fires once per
reasoning step, not once per tool. If Claude calls 5 tools in parallel, this fires
once when all 5 complete.

**Payload fields:** `session_id`, `agent_id`, `agent_type`, `tool_count`

**What it's for:** Wave-level quality checkpoints that would be too expensive to
run per-tool (typecheck, lint, dependency analysis). By waiting for the full wave,
you avoid redundant checks on intermediate file states.

**Citadel use:** `post-tool-batch.js` — registered with `async: true, asyncRewake: true`.
Runs in the background so it doesn't block the next reasoning step. Scans the last
30 seconds of `hook-timing.jsonl` entries to find typecheck failures from the wave
and injects a summary into Claude's context via `additionalContext`. Only exits 2
(triggering a wake) if serious failures are found. Currently surfaces wave size
summaries (>3 files modified) to keep Claude oriented.

---

### `PostToolUseFailure`
**When:** After a tool fails — the tool threw an error, timed out, or was blocked
by Claude Code's sandbox.

**Payload fields:** `tool_name`, `tool_input`, `error` (error message), `session_id`

**What it's for:** React to failures — log them, update failure counters, decide
whether to escalate.

**Citadel use:** `circuit-breaker.js` also runs here (same script as PostToolUse).
Failure events increment the circuit breaker's counter regardless of which tool
failed. This means a mix of Bash failures and tool errors all count toward the
circuit-breaker threshold.

---

## Turn Events

### `Stop`
**When:** Claude finishes responding — the turn is complete, before Claude waits
for the next user message.

**Payload fields:** `session_id`, `stop_reason` (`end_turn` | `stop_sequence` etc.),
`stop_hook_active` (true if a previous Stop hook triggered another Stop)

**What it's for:** Post-turn quality enforcement — the "cold path" that runs
heavier checks that would be too slow per-edit.

**Citadel use:** `quality-gate.js` — scans all recently-modified files from `git diff HEAD`
and runs cold-path lenses: performance (confirm/alert, transition-all, magic intervals),
accessibility (missing aria-labels, icon buttons without labels), adversarial
(eval, innerHTML, dangerouslySetInnerHTML), contractual (skill SKILL.md structure),
cross-reference (referenced file paths that don't exist), and custom rules from
`harness.json`. When violations are found, emits `{"additionalContext": "..."}` so
Claude sees the issues in its context window rather than just stderr.

Guards against infinite loops via `stop_hook_active` check.

---

### `StopFailure`
**When:** A Stop hook itself fails — threw an error, timed out, or exited abnormally.

**Payload fields:** `hook_name` (which hook failed), `error`, `session_id`

**What it's for:** Catch hook infrastructure failures — the meta-layer that ensures
hook failures are visible and don't silently corrupt session state.

**Citadel use:** `stop-failure.js` — writes a medium-severity audit entry so hook
failures appear in `audit.jsonl`. This is how you discover when `quality-gate.js`
times out on a large session.

---

## Compaction Events

### `PreCompact`
**When:** Before Claude Code compresses the message history (context window
management). Fires when the context approaches its limit.

**Payload fields:** `session_id`, `message_count`

**What it's for:** Save state before the compaction wipes conversational context.
Any in-memory state that isn't written to disk will be lost.

**Citadel use:** `pre-compact.js` — saves a compaction snapshot to
`.planning/telemetry/` capturing current campaign state, active fleet sessions,
and timing data. This is what allows `restore-compact.js` to reconstruct context
after the compaction completes.

---

### `PostCompact`
**When:** After context compression completes — the old messages are gone, the
compressed summary is now the conversation start.

**Payload fields:** `session_id`, `summary` (the generated compact text)

**What it's for:** Restore state from the pre-compaction snapshot, inject any
critical context that didn't survive compression.

**Citadel use:** `post-compact.js` — reads the snapshot written by `pre-compact.js`
and restores campaign context. Works in tandem with `restore-compact.js` on
SessionStart — the SessionStart hook handles the case where a session opens after
a compaction rather than during one.

---

## Subagent Events

### `SubagentStart`
**When:** A subagent spawns via the Agent tool — fires when the agent context
window opens, before the agent does any work.

**Payload fields:** `agent_id`, `subagent_type` (agent type: marshal, fleet, Explore, etc.),
`description` (the agent's task), `session_id`

**What it's for:** Fleet agent initialization — bind agent identity before the
first tool call, inject environment, set up per-agent state.

**Citadel use:** `subagent-start.js` — logs the spawn with full identity context
(`agent_id`, `agent_type`, `description`) to `hook-timing.jsonl` and writes an
audit entry for typed agents (non-anonymous spawns). This establishes the identity
anchor that makes every subsequent `governance.js` audit entry attributable to the
correct fleet agent.

---

### `SubagentStop`
**When:** A subagent session ends — the agent has finished (or failed or timed out)
and its context window closes.

**Payload fields:** `agent_id`, `subagent_type`, `status` (`end_turn` | `timeout` |
`error` etc.), `output_tokens`, `session_id`

**What it's for:** Fleet health monitoring — know when agents complete, detect
abnormal exits, track token spend per agent.

**Citadel use:** `subagent-stop.js` — logs the completion. If `status` is abnormal
(timeout, error, killed) rather than a clean `end_turn`/`success`/`completed`,
writes a medium-severity audit entry flagged for investigation. This is how you
find hung fleet agents in long campaigns.

---

### `TeammateIdle`
**When:** A Claude Code teammate (separate Claude Code process in a multi-instance
team) is about to go idle due to inactivity.

**Payload fields:** `teammate_id`, `reason` (why it's idling), `session_id`

**What it's for:** Multi-instance fleet coordination — detect when parallel Claude
Code sessions go idle and decide whether to prevent it or let it happen.

**Note:** Citadel's fleet model uses the Agent tool (SubagentStart/SubagentStop) rather
than separate Claude Code processes, so this event fires in multi-instance deployments,
not Citadel's standard fleet. Registered as an observer now; can be extended to block
idling (exit 2) if Citadel adds multi-process fleet modes.

**Citadel use:** `teammate-idle.js` — observer only. Logs to `hook-timing.jsonl`
for diagnostic visibility in multi-instance setups.

---

## Permission Events

### `PermissionRequest`
**When:** The permission dialog is about to appear — Claude Code needs user approval
for a tool that isn't auto-allowed by the current settings.

**Payload fields:** `tool_name`, `tool_input`, `agent_id`, `session_id`

**Output:** The hook can emit a JSON decision to auto-approve or deny without showing
the dialog:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```
Can also add rules to the session via `updatedPermissions`.

**What it's for:** Programmatic auto-approval of routine operations so they don't
interrupt autonomous work. Without this, every telemetry write or campaign state
update could trigger a dialog.

**Citadel use:** `permission-request.js` — auto-approves two categories of
known-safe operations:
- Bash: `node .citadel/scripts/*.js` (telemetry delegates — these are Citadel's own scripts)
- Write/Edit: paths under `.planning/` and `.citadel/` (campaign state, harness scaffolding)

Unknown patterns emit no decision (defer to user). All requests logged to `audit.jsonl`
regardless of outcome.

---

### `PermissionDenied`
**When:** Claude Code's auto-mode classifier denies a tool — the operation was
blocked by the classifier before reaching the user, not by a hook.

**Payload fields:** `tool_name`, `tool_input`, `reason`, `session_id`

**What it's for:** React to automatic denials — log them, enable retry logic,
or emit `{"retry": true}` to tell Claude to try the operation again.

**Citadel use:** `permission-request.js` (same script) — observe-only for denials.
Logs the denial to `audit.jsonl` so governance has visibility into what the
classifier is blocking. Denial patterns in the audit log are the signal to add
an allow rule via `updatedPermissions` on PermissionRequest.

---

## Context Events

### `InstructionsLoaded`
**When:** CLAUDE.md or any `.claude/rules/*.md` file is loaded into Claude's
context — fires at session start and whenever a rules file is reloaded.

**Payload fields:** `file_path` (absolute path to the loaded file), `session_id`

**What it's for:** Doc-sync detection — if the instructions file has changed
since the last load, it may contain updated guidance that should be reviewed
for drift from the codebase.

**Citadel use:** `instructions-loaded.js` — maintains a state file
(`telemetry/instructions-state.json`) with the last-seen mtime for each rules
file. If the current mtime is newer than the stored value, appends a
`"instructions-changed"` entry to `doc-sync-queue.jsonl`. This is the trigger
for the doc-sync pipeline: CLAUDE.md updated → queue entry → `/learn` processes
queue → knowledge wiki updated.

---

## Environment Events

### `FileChanged`
**When:** A file that Claude Code is watching changes on disk — created, modified,
or deleted.

**Payload fields:** `file_path`, `change_type` (`created` | `modified` | `deleted`),
`session_id`

**What it's for:** Event-driven file watching — replaces polling loops like the one
in Citadel's `/watch` skill. Claude Code can watch specific files and fire this event
when they change, instead of a script polling on an interval.

**Citadel use:** `file-changed.js` — three behaviors depending on what changed:
- `CLAUDE.md` or `.claude/rules/*.md` → appends to `doc-sync-queue.jsonl`
  (same queue as InstructionsLoaded; different trigger, same consumer)
- `hooks_src/*.js` → writes an advisory audit entry flagging that hook scripts
  changed and `install-hooks.js` should be re-run
- `skills/*/SKILL.md` → appends to `skill-lint-queue.jsonl`, signaling that a
  skill file changed and should be re-linted

---

### `CwdChanged`
**When:** The working directory changes mid-session — via `cd`, an Agent tool
change, or a worktree switch.

**Payload fields:** `cwd` (new directory), `old_cwd` (previous directory),
`session_id`, `agent_id`

**What it's for:** Track directory drift across a session. Relevant for fleet
agents that operate in worktrees (different cwd per agent).

**Citadel use:** `cwd-changed.js` — logs the old/new pair to `hook-timing.jsonl`
for session reconstruction. If the new cwd is outside the project root, writes a
low-severity audit entry — this is unexpected behavior that may indicate a
misconfigured agent or an escape from the intended working scope.

---

### `ConfigChange`
**When:** Any Claude Code settings file changes mid-session —
`.claude/settings.json`, `harness.json`, or other configuration files Claude Code
monitors.

**Payload fields:** `file_path` (which file changed), `session_id`

**What it's for:** React to live configuration changes without restarting the session.
Particularly useful when hook settings or harness configuration is updated while
Claude Code is running.

**Citadel use:** `config-change.js` — two behaviors:
- `harness.json` changed → emits `{"additionalContext": "..."}` telling Claude
  to re-read configuration before its next action (harness.json drives many
  decisions about what the agent is allowed to do)
- `.claude/settings.json` changed → writes an advisory audit entry noting that
  hook configuration changed mid-session (hooks may not hot-reload; a session
  restart may be needed)

---

## MCP Events

### `Elicitation`
**When:** A connected MCP server requests user input during a tool call — the server
needs information from the user before it can complete the tool execution.

**Payload fields:** `server_name`, `form_fields` (the fields being requested),
`timeout_ms`, `session_id`

**Output:** The hook can auto-respond:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "Elicitation",
    "action": "accept",
    "content": { "field_name": "auto-filled-value" }
  }
}
```

**What it's for:** Programmatic handling of MCP form inputs — auto-fill known
fields for trusted servers, decline for unknown ones.

**Citadel use:** `elicitation.js` — observer only. Does not auto-respond.
Logs the request to `hook-timing.jsonl`. A `KNOWN_SERVERS` allowlist is defined
(currently empty) — when Citadel ships MCP servers that use elicitation, their
server names go in that set and the hook gains auto-fill logic for their specific
form fields. Unknown servers get no response, deferring to the user.

---

### `ElicitationResult`
**When:** The user (or a hook) responds to an MCP elicitation — the form was
accepted or declined.

**Payload fields:** `server_name`, `accepted` (boolean), `content` (the response
data if accepted), `session_id`

**What it's for:** Log the elicitation outcome for audit purposes.

**Citadel use:** `elicitation.js` (same script) — logs the result including
whether it was accepted. Enables audit reconstruction of what data was passed
to which MCP server.

---

## Platform Events

### `Notification`
**When:** A system-level event fires — permission prompts, idle alerts, auth events
(auth required, success, failure), or elicitation dialogs appearing.

**Payload fields:** `notification_type` (the kind of notification), `message`,
`session_id`

**What it's for:** Monitor system health — auth failures in long sessions,
idle conditions, permission dialog appearances.

**Citadel use:** `notification.js` — two behaviors by notification type:
- Auth events (`auth_required`, `auth_failure`, `auth_error`) → medium-severity
  audit entry; `auth_success` → low-severity log. Auth failures in long autonomous
  sessions are silent killers — the agent keeps running, the API calls start failing,
  and nothing surfaces it until human review.
- Idle alerts (`idle`, `agent_idle`) → low-severity audit entry for diagnostics.
- All notifications → `hook-timing.jsonl` entry for session health monitoring.

---

## Task Events

### `TaskCreated`
**When:** A task is created via the TaskCreate tool — an agent has created a new
work item.

**Payload fields:** `task_id`, `title`, `description`, `hook_event_name`, `session_id`

**What it's for:** Track task lifecycle for campaign telemetry and progress monitoring.

**Citadel use:** `task-events.js` — logs creation to `hook-timing.jsonl` with task
ID and title. Task creation events are how `/dashboard` reconstructs the current
work breakdown without requiring the agent to manually report its task list.

---

### `TaskCompleted`
**When:** A task is marked completed via the TaskUpdate tool.

**Payload fields:** `task_id`, `title`, `status`, `hook_event_name`, `session_id`

**What it's for:** Detect phase completion — when all tasks for a campaign phase
complete, the phase is done.

**Citadel use:** `task-events.js` (same script) — logs completion. The combination
of TaskCreated and TaskCompleted entries in `hook-timing.jsonl` gives a full task
timeline per session, enabling `/telemetry` to show task throughput and `/postmortem`
to reconstruct what work happened.

---

## Worktree Events

### `WorktreeCreate`
**When:** A git worktree is created — fires when the Agent tool creates an isolated
worktree for a fleet agent.

**Payload fields:** `worktree_path`, `branch`, `session_id`

**What it's for:** Initialize per-agent environment before the agent starts working
in the worktree.

**Citadel use:** `worktree-setup.js` — scaffolds the worktree with Citadel
infrastructure: creates `.citadel/` directory, writes a `plugin-root.txt` pointing
back to the Citadel install, creates delegate scripts in `.citadel/scripts/` so
fleet agents can log telemetry from their isolated worktree. This is what enables
fleet agents in separate worktrees to still write to the shared `.planning/telemetry/`
directory via delegates that resolve the real Citadel root.

---

### `WorktreeRemove`
**When:** A git worktree is deleted — the fleet agent's isolated branch is cleaned up
after the agent completes its work.

**Payload fields:** `worktree_path`, `branch`, `session_id`

**What it's for:** Clean up per-agent state, log the fleet boundary event, flag
if the worktree ended abnormally (branch has unmerged commits).

**Citadel use:** `worktree-remove.js` — logs the removal to `hook-timing.jsonl`.
If the branch still had unmerged commits at removal time (agent's work wasn't merged),
flags this as a potential data loss condition in the audit log. Enables fleet
session reconstruction — the pair of WorktreeCreate and WorktreeRemove entries
define the exact lifetime of each fleet agent.

---

## Event Firing Order in a Typical Turn

```
UserPromptSubmit    ← user types message
UserPromptExpansion ← if it's a slash command
  [Claude reasons...]
  PreToolUse        ← before each tool (can block)
  PostToolUse       ← after each tool
  PostToolBatch     ← after all parallel tools in a wave settle (async)
  [Claude reasons more...]
  [More tool waves...]
Stop                ← Claude finishes responding
```

Session boundaries:
```
Setup / SessionStart
  [Many turns of the above...]
PreCompact → PostCompact  (if context limit hit)
SessionEnd
```

Agent spawning:
```
SubagentStart       ← inside the parent turn
  [Agent runs its own tool loop, with its own PreToolUse/PostToolUse events]
SubagentStop        ← agent session ends
```

---

## Hook Output Summary

| Hook | Events | Output | Blocking? |
|------|--------|--------|-----------|
| `init-project.js` | Setup, SessionStart | None | No |
| `restore-compact.js` | SessionStart (compact) | None | No |
| `intake-scanner.js` | SessionStart | Plain text (work item count) | No |
| `session-end.js` | SessionEnd | None | No |
| `pre-compact.js` | PreCompact | None | No |
| `post-compact.js` | PostCompact | None | No |
| `user-prompt-submit.js` | UserPromptSubmit | None | No (observer) |
| `user-prompt-expansion.js` | UserPromptExpansion | None | No (observer) |
| `protect-files.js` | PreToolUse | Block message (exit 2) | Yes |
| `external-action-gate.js` | PreToolUse | Block or consent flow | Yes |
| `governance.js` | PreToolUse | None | No |
| `post-edit.js` | PostToolUse | Typecheck errors | No |
| `organize-enforce.js` | PostToolUse | Placement warnings | No |
| `circuit-breaker.js` | PostToolUse, PostToolUseFailure | Failure escalation | No |
| `cost-tracker.js` | PostToolUse | Cost threshold alerts | No |
| `post-tool-batch.js` | PostToolBatch | `additionalContext` (async) | No |
| `quality-gate.js` | Stop | `additionalContext` with violations | No |
| `stop-failure.js` | StopFailure | None | No |
| `subagent-start.js` | SubagentStart | None | No |
| `subagent-stop.js` | SubagentStop | None | No |
| `teammate-idle.js` | TeammateIdle | None | No |
| `permission-request.js` | PermissionRequest, PermissionDenied | `hookSpecificOutput` (allow decision) | Via output |
| `instructions-loaded.js` | InstructionsLoaded | None | No |
| `file-changed.js` | FileChanged | None | No |
| `cwd-changed.js` | CwdChanged | None | No |
| `config-change.js` | ConfigChange | `additionalContext` (harness.json changes) | No |
| `elicitation.js` | Elicitation, ElicitationResult | None (observer) | No |
| `notification.js` | Notification | None | No |
| `task-events.js` | TaskCreated, TaskCompleted | None | No |
| `worktree-setup.js` | WorktreeCreate | None | No |
| `worktree-remove.js` | WorktreeRemove | None | No |

---

## Design Principles

**Fail-safe:** Every observer hook exits 0 regardless of internal errors. A broken
telemetry hook must never block Claude from working.

**Agent attribution:** `agent_id` and `agent_type` are captured on PreToolUse,
PostToolUse, SubagentStart, and SubagentStop. Every audit entry from inside a
subagent is attributable to the specific fleet agent that caused it.

**`additionalContext` over stderr:** Quality signals (quality-gate violations,
wave-level typecheck failures, config changes) are injected into Claude's context
window via `additionalContext` rather than printed to stderr. Claude sees them
in context; they don't get lost in terminal output.

**`asyncRewake` for slow checks:** Heavy checks that would block the edit path
(PostToolBatch quality scan) run async and only wake Claude on failure. This
eliminates the latency penalty for checks that pass — the common case.

**Audit log for governance:** Every blocking decision (protect-files, external-action-gate,
permission-request) and every subagent spawn writes to `audit.jsonl`. The audit
log is the governance artifact — it records what happened and why, not just what
files were touched.
