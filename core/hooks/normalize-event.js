#!/usr/bin/env node

'use strict';

const path = require('path');
const { CIT_EVENT_IDS } = require(path.join(__dirname, '..', 'contracts', 'events'));

const TOOL_MAP = Object.freeze({
  shell: 'Bash',
  bash: 'Bash',
  edit: 'Edit',
  write: 'Write',
  read: 'Read',
  glob: 'Glob',
  grep: 'Grep',
  agent: 'Agent',
});

const CODEX_EVENT_MAP = Object.freeze({
  SessionStart: CIT_EVENT_IDS.SESSION_START,
  PreToolUse: CIT_EVENT_IDS.PRE_TOOL,
  PostToolUse: CIT_EVENT_IDS.POST_TOOL,
  UserPromptSubmit: CIT_EVENT_IDS.USER_PROMPT,
  Stop: CIT_EVENT_IDS.STOP,
});

const CLAUDE_EVENT_MAP = Object.freeze({
  SessionStart: CIT_EVENT_IDS.SESSION_START,
  PreToolUse: CIT_EVENT_IDS.PRE_TOOL,
  PostToolUse: CIT_EVENT_IDS.POST_TOOL,
  PostToolUseFailure: CIT_EVENT_IDS.POST_TOOL_FAILURE,
  UserPromptSubmit: CIT_EVENT_IDS.USER_PROMPT,
  Stop: CIT_EVENT_IDS.STOP,
  StopFailure: CIT_EVENT_IDS.STOP_FAILURE,
  SessionEnd: CIT_EVENT_IDS.SESSION_END,
  PreCompact: CIT_EVENT_IDS.PRE_COMPACT,
  PostCompact: CIT_EVENT_IDS.POST_COMPACT,
  SubagentStop: CIT_EVENT_IDS.SUBAGENT_STOP,
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
  if (typeof normalized.file_path === 'string') normalized.file_path = normalized.file_path.replace(/\\/g, '/');
  if (typeof normalized.path === 'string') normalized.path = normalized.path.replace(/\\/g, '/');
  return normalized;
}

function createEnvelope(runtime, nativeEventName, payload) {
  const eventMap = runtime === 'codex' ? CODEX_EVENT_MAP : CLAUDE_EVENT_MAP;
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
  normalizeToolName,
  normalizePathFields,
  createEnvelope,
});
