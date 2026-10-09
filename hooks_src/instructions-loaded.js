#!/usr/bin/env node

/**
 * instructions-loaded.js — InstructionsLoaded hook
 *
 * Fires each time CLAUDE.md or .claude/rules/*.md is loaded into the
 * context window. This is the trigger point for doc-sync detection:
 * if the loaded file is newer than the last-sync timestamp, queue a
 * doc-sync review so stale guidance doesn't accumulate silently.
 *
 * Claude Code does not fire this event when it reads AGENTS.md directly;
 * init-project.js records that load at SessionStart through the same
 * core/hooks/instructions-state.js bookkeeping.
 *
 * Design:
 *   - Observer only: always exit 0 (never blocks context load)
 *   - Doc-sync queue: appends to .planning/telemetry/doc-sync-queue.jsonl
 *     (same queue used by post-edit.js for source-level staleness)
 *   - Change detection: compares mtime against last-seen timestamp in state
 *
 * Exit codes:
 *   0 = always
 */

'use strict';

const path = require('path');
const health = require('./harness-health-util');
const { recordInstructionLoad } = require('../core/hooks/instructions-state');

const PROJECT_ROOT = health.PROJECT_ROOT;

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const filePath = event.file_path || event.path || null;
    const sessionId = event.session_id || null;

    health.increment('instructions-loaded', 'count');

    health.logTiming('instructions-loaded', 0, {
      event: 'instructions-loaded',
      file: filePath ? path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/') : null,
      session_id: sessionId,
    });

    if (!filePath) {
      process.exit(0);
      return;
    }

    // Queue a doc-sync review when the file changed since we last saw it
    recordInstructionLoad(PROJECT_ROOT, filePath);

    process.exit(0);
  });
}

main();
