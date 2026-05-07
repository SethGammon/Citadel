#!/usr/bin/env node

/**
 * file-changed.js — FileChanged hook
 *
 * Fires when a watched file changes on disk. This is the event-driven
 * alternative to polling in /watch — Claude Code notifies hooks when
 * files it's monitoring actually change, instead of Citadel polling.
 *
 * Key behaviors:
 *   - CLAUDE.md or rules/*.md changed → queue doc-sync review
 *     (same queue as instructions-loaded.js, different trigger)
 *   - hooks_src/*.js changed → log reload advisory to telemetry
 *   - skills/**\/SKILL.md changed → queue skill-lint review
 *   - All changes logged to telemetry for audit trail
 *
 * Design:
 *   - Observer only: always exit 0 (never blocks)
 *   - Complements /watch skill — provides the event signal /watch
 *     used to poll for via setInterval
 *
 * Exit codes:
 *   0 = always
 */

'use strict';

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.planning', 'telemetry');

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const filePath = event.file_path || event.path || null;
    const changeType = event.change_type || event.type || 'modified';
    const sessionId = event.session_id || null;

    health.increment('file-changed', 'count');

    const relative = filePath
      ? path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/')
      : null;

    health.logTiming('file-changed', 0, {
      event: 'file-changed',
      file: relative,
      change_type: changeType,
      session_id: sessionId,
    });

    if (!relative) {
      process.exit(0);
      return;
    }

    // CLAUDE.md or rules/*.md changed → queue doc-sync review
    const isInstructions = relative === 'CLAUDE.md' ||
      /^\.claude\/rules\/.*\.md$/.test(relative);

    if (isInstructions) {
      queueDocSync(relative, 'file-changed');
    }

    // hooks_src/*.js changed → flag for reload so next session picks up changes
    const isHookScript = /^hooks_src\/.*\.js$/.test(relative);
    if (isHookScript) {
      health.writeAuditLog('hook-script-changed', {
        file: relative,
        change_type: changeType,
        advisory: 'Run scripts/install-hooks.js to apply hook changes',
        severity: 'low',
      });
    }

    // skills/**\/SKILL.md changed → queue skill-lint
    const isSkillFile = /^skills\/.*\/SKILL\.md$/.test(relative);
    if (isSkillFile) {
      queueSkillLint(relative);
    }

    process.exit(0);
  });
}

function queueDocSync(relative, trigger) {
  try {
    if (!fs.existsSync(TELEMETRY_DIR)) return;
    const queuePath = path.join(TELEMETRY_DIR, 'doc-sync-queue.jsonl');
    const entry = JSON.stringify({
      event: 'file-changed',
      file: relative,
      trigger,
      timestamp: new Date().toISOString(),
      status: 'needs-review',
    });
    fs.appendFileSync(queuePath, entry + '\n');
  } catch { /* fail-safe */ }
}

function queueSkillLint(relative) {
  try {
    if (!fs.existsSync(TELEMETRY_DIR)) return;
    const queuePath = path.join(TELEMETRY_DIR, 'skill-lint-queue.jsonl');
    const entry = JSON.stringify({
      event: 'skill-changed',
      file: relative,
      timestamp: new Date().toISOString(),
      status: 'needs-lint',
    });
    fs.appendFileSync(queuePath, entry + '\n');
  } catch { /* fail-safe */ }
}

main();
