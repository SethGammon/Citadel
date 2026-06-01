#!/usr/bin/env node

'use strict';

const path = require('path');
const { normalizeCodexHookInput } = require(path.join(__dirname, '..', 'runtimes', 'codex', 'adapters', 'hook-input'));
const { normalizeClaudeHookInput } = require(path.join(__dirname, '..', 'runtimes', 'claude-code', 'adapters', 'hook-input'));
const { toLegacyHookPayload } = require(path.join(__dirname, '..', 'core', 'hooks', 'hook-context'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const codexEnvelope = normalizeCodexHookInput({
    hook_event_name: 'PreToolUse',
    session_id: 'sess-1',
    turn_id: 'turn-1',
    cwd: 'C:\\repo',
    transcript_path: 'C:\\repo\\.codex\\history.jsonl',
    model: 'gpt-5.4',
    tool_name: 'edit',
    tool_input: {
      file_path: 'C:\\repo\\src\\file.ts',
    },
  });

  if (codexEnvelope.runtime !== 'codex') fail('Codex envelope runtime mismatch');
  if (codexEnvelope.event_id !== 'pre_tool') fail('Codex envelope event id mismatch');
  if (codexEnvelope.tool_name !== 'Edit') fail('Codex envelope tool normalization mismatch');
  if (codexEnvelope.tool_input.file_path !== 'C:/repo/src/file.ts') fail('Codex envelope path normalization mismatch');

  const claudeEnvelope = normalizeClaudeHookInput({
    hook_event_name: 'PostToolUse',
    session_id: 'sess-2',
    tool_name: 'Write',
    tool_input: {
      path: 'C:\\repo\\README.md',
    },
  });

  if (claudeEnvelope.runtime !== 'claude-code') fail('Claude envelope runtime mismatch');
  if (claudeEnvelope.event_id !== 'post_tool') fail('Claude envelope event id mismatch');
  if (claudeEnvelope.tool_input.path !== 'C:/repo/README.md') fail('Claude envelope path normalization mismatch');

  const legacy = toLegacyHookPayload(codexEnvelope);
  if (legacy.tool_name !== 'Edit') fail('Legacy hook payload tool mismatch');
  if (legacy._runtime !== 'codex') fail('Legacy hook payload runtime metadata mismatch');

  const codexPermission = normalizeCodexHookInput({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git push' },
  });
  if (codexPermission.event_id !== 'permission_request') fail('Codex permission event normalization mismatch');

  const codexSubagent = normalizeCodexHookInput({
    hook_event_name: 'SubagentStart',
    subagent_type: 'explorer',
  });
  if (codexSubagent.event_id !== 'subagent_start') fail('Codex subagent event normalization mismatch');
  if (legacy._event_id !== 'pre_tool') fail('Legacy hook payload event metadata mismatch');

  console.log('Hook event normalization tests pass.');
}

main();
