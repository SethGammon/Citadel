#!/usr/bin/env node

/**
 * config-change.js — ConfigChange hook
 *
 * Fires when any Claude Code settings file changes mid-session
 * (.claude/settings.json, harness.json, etc.). Allows Citadel to
 * react to live configuration changes without restarting.
 *
 * Key behaviors:
 *   - harness.json changed → emit additionalContext so Claude knows
 *     to re-read configuration before its next action
 *   - hooks settings changed → advisory to re-run install-hooks.js
 *   - All config changes → telemetry for audit trail
 *
 * Design:
 *   - Observer only: always exit 0
 *   - additionalContext emitted when harness config changes
 *
 * Exit codes:
 *   0 = always
 */

'use strict';

const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const CITADEL_UI = process.env.CITADEL_UI === 'true';

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const filePath = event.file_path || event.path || null;
    const sessionId = event.session_id || null;

    health.increment('config-change', 'count');

    const relative = filePath
      ? path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/')
      : null;

    health.logTiming('config-change', 0, {
      event: 'config-change',
      file: relative,
      session_id: sessionId,
    });

    if (!relative) {
      process.exit(0);
      return;
    }

    const isHarnessConfig = relative === '.claude/harness.json' ||
      relative.endsWith('harness.json');
    const isHookSettings = relative === '.claude/settings.json' ||
      relative.endsWith('settings.json');

    if (isHarnessConfig) {
      const msg = `[config-change] harness.json updated — re-read configuration before next action`;
      if (!CITADEL_UI) {
        process.stdout.write(JSON.stringify({ additionalContext: msg }));
      }
    }

    if (isHookSettings) {
      health.writeAuditLog('hook-settings-changed', {
        file: relative,
        advisory: 'Hook configuration changed mid-session',
        severity: 'low',
      });
    }

    process.exit(0);
  });
}

main();
