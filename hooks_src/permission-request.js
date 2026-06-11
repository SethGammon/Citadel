#!/usr/bin/env node

/**
 * permission-request.js — PermissionRequest hook
 *
 * Fires when the permission dialog appears. Auto-approves known-safe
 * Citadel operations (telemetry writes, campaign state updates, planning
 * directory writes) to avoid interrupting autonomous work for routine ops.
 *
 * Design:
 *   - Allowlist-only: only auto-approves patterns explicitly listed as safe
 *   - Fail-safe: unknown patterns get no decision (defer to user)
 *   - Telemetry: all permission requests logged regardless of outcome
 *
 * Known-safe patterns (auto-approve):
 *   - Bash: node .citadel/scripts/*.js (telemetry delegates)
 *   - Bash: repo-local verification commands
 *   - Write/Edit: .planning/**  (campaign and fleet state)
 *   - Write/Edit: .citadel/**   (harness scaffolding)
 *   - Write/Edit: .codex/**, .agents/**, hooks/** (generated harness artifacts)
 *
 * Exit codes:
 *   0 = always (decision communicated via JSON stdout, not exit code)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const PERMISSION_EVENTS_FILE = path.join(health.TELEMETRY_DIR, 'permission-events.jsonl');

/**
 * Append a compact permission event to the dedicated audit JSONL.
 * Observer-only: failures are swallowed, never affects the hook outcome.
 * One appendFileSync on the hot path (directory already ensured by increment()).
 */
function logPermissionEvent(eventName, tool, target, decision) {
  try {
    if (!fs.existsSync(health.TELEMETRY_DIR)) {
      fs.mkdirSync(health.TELEMETRY_DIR, { recursive: true });
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: eventName,
      tool: tool || 'unknown',
      target: String(target || '').slice(0, 120),
      decision,
    });
    fs.appendFileSync(PERMISSION_EVENTS_FILE, line + '\n', 'utf8');
  } catch { /* telemetry must never break the hook */ }
}

// Patterns that are always safe to auto-approve
const SAFE_BASH_PATTERNS = [
  /^node\s+\.citadel\/scripts\//,
  /^node\s+"[^"]*\.citadel[/\\]scripts[/\\]/,
  /^npm\s+run\s+(test|lint|typecheck|docs:check|design:gate|codex:verify|verify:visual)(?:\s|$)/,
  /^node\s+scripts\/(?:test[-\w]*|verify-hooks|integration-test|skill-lint)\.js(?:\s|$)/,
  /^node\s+hooks_src\/smoke-test\.js(?:\s|$)/,
  /^git\s+(status|diff)(?:\s|$)/,
];

const SAFE_FILE_PREFIXES = [
  path.join(PROJECT_ROOT, '.planning').replace(/\\/g, '/'),
  path.join(PROJECT_ROOT, '.citadel').replace(/\\/g, '/'),
  path.join(PROJECT_ROOT, '.codex').replace(/\\/g, '/'),
  path.join(PROJECT_ROOT, '.Codex').replace(/\\/g, '/'),
  path.join(PROJECT_ROOT, '.agents').replace(/\\/g, '/'),
  path.join(PROJECT_ROOT, 'hooks').replace(/\\/g, '/'),
];

function isSafeBashCommand(command) {
  if (!command) return false;
  const normalized = String(command).replace(/\\/g, '/');
  return SAFE_BASH_PATTERNS.some(p => p.test(normalized));
}

function isSafeFilePath(filePath) {
  if (!filePath) return false;
  const normalized = String(filePath).replace(/\\/g, '/');
  return SAFE_FILE_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(prefix + '/'));
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const eventName = event.hook_event_name || 'PermissionRequest';
    const isDenied = eventName === 'PermissionDenied';
    const toolName = event.tool_name || event.tool || '';
    const toolInput = event.tool_input || {};
    const agentId = event.agent_id || null;

    let decision = null;
    let reason = 'user-review-required';

    // Check if this matches a known-safe pattern
    if (toolName === 'Bash') {
      const command = toolInput.command || '';
      if (isSafeBashCommand(command)) {
        decision = 'allow';
        reason = 'known-safe-citadel-script';
      }
    } else if (toolName === 'Write' || toolName === 'Edit') {
      const filePath = toolInput.file_path || toolInput.path || '';
      if (isSafeFilePath(filePath)) {
        decision = 'allow';
        reason = 'known-safe-citadel-state-write';
      }
    }

    // PermissionDenied events (template wires this same script) carry a final
    // 'deny' decision; never emit an allow for them.
    const recordedDecision = isDenied ? 'deny' : (decision || 'deferred');
    const target = toolInput.command || toolInput.file_path || toolInput.path || '';

    // Log every permission request for governance visibility
    health.increment('permission-request', 'count');
    health.writeAuditLog('permission-request', {
      tool: toolName,
      target: String(target).slice(0, 200),
      agent_id: agentId,
      decision: recordedDecision,
      reason,
      severity: 'low',
    });

    // Dedicated permission audit trail (consumed by scripts/permission-audit.js)
    logPermissionEvent(eventName, toolName, target, recordedDecision);

    if (decision === 'allow' && !isDenied) {
      // Auto-approve: output the structured decision
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
          },
        },
      }));
    }
    // If no decision: exit 0 with no output = defer to normal permission flow

    process.exit(0);
  });
}

main();
