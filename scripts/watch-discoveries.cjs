#!/usr/bin/env node

/**
 * watch-discoveries.cjs — Real-time momentum synthesizer.
 *
 * Long-running process. Watches .planning/discoveries/ for new JSONL writes
 * and re-synthesizes momentum.json within ~500ms of each change.
 *
 * Enables parallel Fleet/Workspace sessions in different terminals to share
 * discoveries while they are running — not just on the next session start.
 *
 * Started by Fleet at session open (via momentum-watch-start.cjs).
 * Exits automatically after 2 hours of idle (no new discoveries written).
 *
 * Usage (usually called indirectly via momentum-watch-start.cjs):
 *   node .citadel/scripts/watch-discoveries.cjs
 *
 * PID file: .planning/discoveries/.watcher.pid
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeWatcherPid, clearWatcherPid } = require('../core/momentum/watcher');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DISCOVERIES_DIR = path.join(PROJECT_ROOT, '.planning', 'discoveries');
const SYNTHESIZE_SCRIPT = path.join(__dirname, 'momentum-synthesize.cjs');

const DEBOUNCE_MS = 500;
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

let debounceTimer = null;
let idleTimer = null;
let watcher = null;

function synthesize() {
  try {
    execFileSync(process.execPath, [SYNTHESIZE_SCRIPT], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    process.stderr.write(`[watch-discoveries] synthesized ${new Date().toISOString()}\n`);
  } catch (err) {
    process.stderr.write(`[watch-discoveries] synthesis failed: ${err.message}\n`);
  }
}

function resetIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    process.stderr.write('[watch-discoveries] idle 2h — exiting\n');
    cleanup();
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
}

function onDiscoveryChange(filename) {
  if (!filename || !filename.endsWith('.jsonl')) return;
  resetIdle();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(synthesize, DEBOUNCE_MS);
}

function cleanup() {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (idleTimer) clearTimeout(idleTimer);
  if (watcher) { try { watcher.close(); } catch {} }
  clearWatcherPid(PROJECT_ROOT);
}

function main() {
  if (!fs.existsSync(DISCOVERIES_DIR)) {
    fs.mkdirSync(DISCOVERIES_DIR, { recursive: true });
  }

  writeWatcherPid(PROJECT_ROOT, process.pid);

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  watcher = fs.watch(DISCOVERIES_DIR, (eventType, filename) => {
    if (eventType === 'change' || eventType === 'rename') {
      onDiscoveryChange(filename);
    }
  });

  watcher.on('error', (err) => {
    process.stderr.write(`[watch-discoveries] watcher error: ${err.message}\n`);
  });

  resetIdle();
  process.stderr.write(`[watch-discoveries] watching ${DISCOVERIES_DIR} (PID ${process.pid})\n`);
}

main();
