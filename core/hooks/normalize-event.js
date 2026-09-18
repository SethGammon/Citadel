#!/usr/bin/env node

'use strict';

const path = require('path');
const { CIT_EVENT_IDS } = require(path.join(__dirname, '..', 'contracts', 'events'));

const TOOL_MAP = Object.freeze({
  shell: 'Bash',
  bash: 'Bash',
  // Compatibility for pre-canonical/synthetic payloads. Current Codex hook
  // telemetry uses the authoritative Bash tool name.
  shell_command: 'Bash',
  edit: 'Edit',
  write: 'Write',
  read: 'Read',
  glob: 'Glob',
  grep: 'Grep',
  agent: 'Agent',
  // opencode tool ids are lowercase. `task` is its subagent spawn tool, so it
  // normalizes to Agent and the governance hook's Agent matcher keeps firing.
  // `apply_patch` is deliberately absent: adapters split it into per-target
  // Edit/Write projections, which needs the original id to survive.
  task: 'Agent',
  skill: 'Skill',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  todowrite: 'TodoWrite',
});

const CODEX_EVENT_MAP = Object.freeze({
  SessionStart: CIT_EVENT_IDS.SESSION_START,
  PreToolUse: CIT_EVENT_IDS.PRE_TOOL,
  PermissionRequest: CIT_EVENT_IDS.PERMISSION_REQUEST,
  PostToolUse: CIT_EVENT_IDS.POST_TOOL,
  PreCompact: CIT_EVENT_IDS.PRE_COMPACT,
  PostCompact: CIT_EVENT_IDS.POST_COMPACT,
  UserPromptSubmit: CIT_EVENT_IDS.USER_PROMPT_SUBMIT,
  SubagentStart: CIT_EVENT_IDS.SUBAGENT_START,
  SubagentStop: CIT_EVENT_IDS.SUBAGENT_STOP,
  Stop: CIT_EVENT_IDS.STOP,
  SessionEnd: CIT_EVENT_IDS.SESSION_END,
});

// opencode has no command hooks. Its native names are plugin hook keys
// (`tool.execute.before`, `chat.message`, `config`, `dispose`) and event-bus
// types (`session.idle`, `file.edited`). Only events with a real Citadel
// counterpart are mapped; everything else stays unmapped on purpose so the
// adapter records a skip rather than inventing a lifecycle event.
//
// Deliberately absent:
//   permission.replied  - a reply may allow or deny, so only the adapter can
//                         tell whether it is a denial. Mapping it statically to
//                         permission_denied would be wrong half the time.
//   session.error       - a session failure is not Claude Code's StopFailure,
//                         which fires when the stop hook itself fails.
//   chat.params, chat.headers, shell.env, tool.definition, command.execute.before,
//   todo.updated, command.executed, lsp.*, message.*, tui.*, server.connected,
//   installation.updated, session.{created,updated,deleted,status,diff}
//
// OpenCode emits no task lifecycle bus events. The plugin synthesizes the two
// task and subagent events around successful `task` tool calls so delegated
// agents retain Claude Code-compatible telemetry boundaries.
const OPENCODE_EVENT_MAP = Object.freeze({
  'tool.execute.before': CIT_EVENT_IDS.PRE_TOOL,
  'tool.execute.after': CIT_EVENT_IDS.POST_TOOL,
  'chat.message': CIT_EVENT_IDS.USER_PROMPT_SUBMIT,
  // The plugin's own init function is the only thing that runs once per project
  // directory before any turn, so it stands in for SessionStart.
  'plugin.init': CIT_EVENT_IDS.SESSION_START,
  dispose: CIT_EVENT_IDS.SESSION_END,
  config: CIT_EVENT_IDS.CONFIG_CHANGE,
  'experimental.session.compacting': CIT_EVENT_IDS.PRE_COMPACT,
  'session.compacted': CIT_EVENT_IDS.POST_COMPACT,
  // Observe-only: opencode dispatches bus events fire-and-forget, so nothing
  // here can block the way a Claude Code Stop hook can.
  'session.idle': CIT_EVENT_IDS.STOP,
  'file.edited': CIT_EVENT_IDS.FILE_CHANGED,
  'file.watcher.updated': CIT_EVENT_IDS.FILE_CHANGED,
  'permission.asked': CIT_EVENT_IDS.PERMISSION_REQUEST,
  'task.created': CIT_EVENT_IDS.TASK_CREATED,
  'task.completed': CIT_EVENT_IDS.TASK_COMPLETED,
  'subagent.start': CIT_EVENT_IDS.SUBAGENT_START,
  'subagent.stop': CIT_EVENT_IDS.SUBAGENT_STOP,
});

const CLAUDE_EVENT_MAP = Object.freeze({
  SessionStart: CIT_EVENT_IDS.SESSION_START,
  Setup: CIT_EVENT_IDS.SETUP,
  PreToolUse: CIT_EVENT_IDS.PRE_TOOL,
  PostToolUse: CIT_EVENT_IDS.POST_TOOL,
  PostToolBatch: CIT_EVENT_IDS.POST_TOOL_BATCH,
  PostToolUseFailure: CIT_EVENT_IDS.POST_TOOL_FAILURE,
  UserPromptSubmit: CIT_EVENT_IDS.USER_PROMPT_SUBMIT,
  UserPromptExpansion: CIT_EVENT_IDS.USER_PROMPT_EXPANSION,
  Stop: CIT_EVENT_IDS.STOP,
  StopFailure: CIT_EVENT_IDS.STOP_FAILURE,
  SessionEnd: CIT_EVENT_IDS.SESSION_END,
  PreCompact: CIT_EVENT_IDS.PRE_COMPACT,
  PostCompact: CIT_EVENT_IDS.POST_COMPACT,
  SubagentStart: CIT_EVENT_IDS.SUBAGENT_START,
  SubagentStop: CIT_EVENT_IDS.SUBAGENT_STOP,
  TeammateIdle: CIT_EVENT_IDS.TEAMMATE_IDLE,
  PermissionRequest: CIT_EVENT_IDS.PERMISSION_REQUEST,
  PermissionDenied: CIT_EVENT_IDS.PERMISSION_DENIED,
  InstructionsLoaded: CIT_EVENT_IDS.INSTRUCTIONS_LOADED,
  FileChanged: CIT_EVENT_IDS.FILE_CHANGED,
  CwdChanged: CIT_EVENT_IDS.CWD_CHANGED,
  ConfigChange: CIT_EVENT_IDS.CONFIG_CHANGE,
  Elicitation: CIT_EVENT_IDS.ELICITATION,
  ElicitationResult: CIT_EVENT_IDS.ELICITATION_RESULT,
  Notification: CIT_EVENT_IDS.NOTIFICATION,
  TaskCreated: CIT_EVENT_IDS.TASK_CREATED,
  TaskCompleted: CIT_EVENT_IDS.TASK_COMPLETED,
  WorktreeCreate: CIT_EVENT_IDS.WORKTREE_CREATE,
  WorktreeRemove: CIT_EVENT_IDS.WORKTREE_REMOVE,
});

function normalizeToolName(toolName) {
  if (!toolName) return 'Unknown';
  const lower = String(toolName).toLowerCase();
  return TOOL_MAP[lower] || toolName;
}

function normalizePathFields(toolInput) {
  const normalized = { ...(toolInput || {}) };
  // opencode names its file argument `filePath`. Canonicalize to `file_path` so
  // hooks keep reading one key, without clobbering an explicit `file_path`. The
  // untouched original is always available on the envelope's `raw` payload.
  if (typeof normalized.filePath === 'string' && typeof normalized.file_path !== 'string') {
    normalized.file_path = normalized.filePath;
    delete normalized.filePath;
  }
  // opencode's apply_patch argument is `patchText` (tool/apply_patch.ts in
  // 1.18.30), not `command`. Without this the adapter cannot find the patch body
  // and fails closed, so a perfectly harmless patch is refused before any hook
  // runs. Canonicalize to `command`, which is what the Codex adapter and the
  // patch splitter already read.
  if (typeof normalized.patchText === 'string' && typeof normalized.command !== 'string') {
    normalized.command = normalized.patchText;
    delete normalized.patchText;
  }
  if (typeof normalized.file_path === 'string') normalized.file_path = normalized.file_path.replace(/\\/g, '/');
  if (typeof normalized.path === 'string') normalized.path = normalized.path.replace(/\\/g, '/');
  return normalized;
}

const EVENT_MAPS = Object.freeze({
  codex: CODEX_EVENT_MAP,
  opencode: OPENCODE_EVENT_MAP,
  'claude-code': CLAUDE_EVENT_MAP,
});

function eventMapFor(runtime) {
  return EVENT_MAPS[runtime] || CLAUDE_EVENT_MAP;
}

function createEnvelope(runtime, nativeEventName, payload) {
  const eventMap = eventMapFor(runtime);
  const normalizedEventId = eventMap[nativeEventName] || nativeEventName || 'unknown';
  const toolName = normalizeToolName(payload.tool_name || payload.tool_type || payload.toolName || '');
  const toolInput = normalizePathFields(payload.tool_input || payload.toolInput || {});

  return {
    event_id: normalizedEventId,
    runtime,
    native_event_name: nativeEventName || null,
    timestamp: payload.timestamp || new Date().toISOString(),
    session_id: payload.session_id || null,
    turn_id: payload.turn_id || null,
    cwd: payload.cwd || null,
    transcript_path: payload.transcript_path || null,
    model: payload.model || null,
    tool_name: toolName,
    tool_input: toolInput,
    raw: payload,
  };
}

module.exports = Object.freeze({
  CODEX_EVENT_MAP,
  CLAUDE_EVENT_MAP,
  OPENCODE_EVENT_MAP,
  eventMapFor,
  normalizeToolName,
  normalizePathFields,
  createEnvelope,
});
