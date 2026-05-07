#!/usr/bin/env node

/**
 * governance.js — PreToolUse hook (Edit|Write|Bash|Agent)
 *
 * Writes every significant tool call to the audit log for governance and
 * accountability purposes. This hook NEVER blocks — it only observes.
 *
 * Logged tools: Edit, Write, Bash, Agent
 * Skipped (too noisy): Read, WebSearch, WebFetch, and everything else
 *
 * Audit entry format:
 *   { event: "tool-call", tool, target, timestamp, project }
 *
 * Performance target: < 5ms overhead per call.
 */

'use strict';

const health = require('./harness-health-util');

const LOGGED_TOOLS = new Set(['Edit', 'Write', 'Bash', 'Agent']);

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      run(input);
    } catch {
      // Governance hook must never block — swallow all errors
    }
    process.exit(0);
  });
}

function run(input) {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    // Malformed input — skip logging, do not block
    return;
  }

  const toolName = event.tool_name || '';
  if (!LOGGED_TOOLS.has(toolName)) {
    return; // Not a tool we log — skip
  }

  // Fleet agent identity — bound to the spawning agent when inside a subagent
  const agentId = event.agent_id || null;
  const agentType = event.agent_type || null;

  // Derive a human-readable target string from tool input
  let target = '';
  const inp = event.tool_input || {};
  if (toolName === 'Edit' || toolName === 'Write') {
    target = inp.file_path || inp.path || '';
  } else if (toolName === 'Bash') {
    target = inp.command || '';
  } else if (toolName === 'Agent') {
    target = inp.prompt || inp.description || '';
  }

  // Truncate to 200 chars to keep the log compact
  if (target.length > 200) {
    target = target.slice(0, 197) + '...';
  }

  health.writeAuditLog('tool-call', {
    tool: toolName,
    target,
    agent_id: agentId,
    agent_type: agentType,
  });
}

main();
