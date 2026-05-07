#!/usr/bin/env node

/**
 * instructions-loaded.js — InstructionsLoaded hook
 *
 * Fires each time CLAUDE.md or .claude/rules/*.md is loaded into the
 * context window. This is the trigger point for doc-sync detection:
 * if the loaded file is newer than the last-sync timestamp, queue a
 * doc-sync review so stale guidance doesn't accumulate silently.
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

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.planning', 'telemetry');
const STATE_FILE = path.join(TELEMETRY_DIR, 'instructions-state.json');

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { return {}; }
}

function writeState(state) {
  try {
    if (!fs.existsSync(TELEMETRY_DIR)) return;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-critical */ }
}

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

    const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

    // Check if the file has changed since we last saw it
    try {
      const state = readState();
      let mtime = null;
      try {
        mtime = fs.statSync(filePath).mtimeMs;
      } catch { /* file may be virtual */ }

      const lastSeen = state[relativePath] || null;
      const changed = mtime !== null && lastSeen !== null && mtime > lastSeen;

      if (changed) {
        // Queue a doc-sync review for this file
        const queuePath = path.join(TELEMETRY_DIR, 'doc-sync-queue.jsonl');
        if (fs.existsSync(TELEMETRY_DIR)) {
          const entry = JSON.stringify({
            event: 'instructions-changed',
            file: relativePath,
            timestamp: new Date().toISOString(),
            status: 'needs-review',
            prev_mtime: lastSeen,
            curr_mtime: mtime,
          });
          fs.appendFileSync(queuePath, entry + '\n');
        }
      }

      // Update last-seen mtime
      if (mtime !== null) {
        state[relativePath] = mtime;
        writeState(state);
      }
    } catch { /* fail-safe: never block */ }

    process.exit(0);
  });
}

main();
