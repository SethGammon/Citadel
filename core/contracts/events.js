#!/usr/bin/env node

'use strict';

const CIT_EVENT_IDS = Object.freeze({
  SESSION_START: 'session_start',
  SETUP: 'setup',
  PRE_TOOL: 'pre_tool',
  POST_TOOL: 'post_tool',
  POST_TOOL_BATCH: 'post_tool_batch',
  POST_TOOL_FAILURE: 'post_tool_failure',
  USER_PROMPT: 'user_prompt',
  USER_PROMPT_SUBMIT: 'user_prompt_submit',
  USER_PROMPT_EXPANSION: 'user_prompt_expansion',
  STOP: 'stop',
  STOP_FAILURE: 'stop_failure',
  SESSION_END: 'session_end',
  PRE_COMPACT: 'pre_compact',
  POST_COMPACT: 'post_compact',
  SUBAGENT_START: 'subagent_start',
  SUBAGENT_STOP: 'subagent_stop',
  PERMISSION_REQUEST: 'permission_request',
  PERMISSION_DENIED: 'permission_denied',
  INSTRUCTIONS_LOADED: 'instructions_loaded',
  FILE_CHANGED: 'file_changed',
  CWD_CHANGED: 'cwd_changed',
  CONFIG_CHANGE: 'config_change',
  TEAMMATE_IDLE: 'teammate_idle',
  ELICITATION: 'elicitation',
  ELICITATION_RESULT: 'elicitation_result',
  NOTIFICATION: 'notification',
  TASK_CREATED: 'task_created',
  TASK_COMPLETED: 'task_completed',
  WORKTREE_CREATE: 'worktree_create',
  WORKTREE_REMOVE: 'worktree_remove',
});

const CIT_EVENT_ORDER = Object.freeze([
  CIT_EVENT_IDS.SESSION_START,
  CIT_EVENT_IDS.SETUP,
  CIT_EVENT_IDS.USER_PROMPT_SUBMIT,
  CIT_EVENT_IDS.USER_PROMPT_EXPANSION,
  CIT_EVENT_IDS.PRE_TOOL,
  CIT_EVENT_IDS.POST_TOOL,
  CIT_EVENT_IDS.POST_TOOL_BATCH,
  CIT_EVENT_IDS.POST_TOOL_FAILURE,
  CIT_EVENT_IDS.USER_PROMPT,
  CIT_EVENT_IDS.STOP,
  CIT_EVENT_IDS.STOP_FAILURE,
  CIT_EVENT_IDS.SESSION_END,
  CIT_EVENT_IDS.PRE_COMPACT,
  CIT_EVENT_IDS.POST_COMPACT,
  CIT_EVENT_IDS.SUBAGENT_START,
  CIT_EVENT_IDS.SUBAGENT_STOP,
  CIT_EVENT_IDS.TEAMMATE_IDLE,
  CIT_EVENT_IDS.PERMISSION_REQUEST,
  CIT_EVENT_IDS.PERMISSION_DENIED,
  CIT_EVENT_IDS.INSTRUCTIONS_LOADED,
  CIT_EVENT_IDS.FILE_CHANGED,
  CIT_EVENT_IDS.CWD_CHANGED,
  CIT_EVENT_IDS.CONFIG_CHANGE,
  CIT_EVENT_IDS.ELICITATION,
  CIT_EVENT_IDS.ELICITATION_RESULT,
  CIT_EVENT_IDS.NOTIFICATION,
  CIT_EVENT_IDS.TASK_CREATED,
  CIT_EVENT_IDS.TASK_COMPLETED,
  CIT_EVENT_IDS.WORKTREE_CREATE,
  CIT_EVENT_IDS.WORKTREE_REMOVE,
]);

const REQUIRED_EVENT_FIELDS = Object.freeze([
  'event_id',
  'runtime',
  'timestamp',
]);

function isKnownCitadelEvent(eventId) {
  return CIT_EVENT_ORDER.includes(eventId);
}

module.exports = Object.freeze({
  CIT_EVENT_IDS,
  CIT_EVENT_ORDER,
  REQUIRED_EVENT_FIELDS,
  isKnownCitadelEvent,
});
