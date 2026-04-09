#!/usr/bin/env node

/**
 * momentum-watch-start.cjs — Idempotent launcher for the discovery watcher.
 *
 * Called by Fleet at session start. Starts watch-discoveries.cjs as a detached
 * background process if one isn't already running. Safe to call multiple times
 * from parallel sessions — only one watcher runs per project.
 *
 * Usage:
 *   node .citadel/scripts/momentum-watch-start.cjs
 *
 * Exit codes:
 *   0 — watcher started or already running
 *   1 — failed to start
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { isWatcherRunning, readWatcherPid } = require('../core/momentum/watcher');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const WATCH_SCRIPT = path.join(__dirname, 'watch-discoveries.cjs');

function main() {
  if (isWatcherRunning(PROJECT_ROOT)) {
    const pid = readWatcherPid(PROJECT_ROOT);
    console.log(`Discovery watcher already running (PID ${pid})`);
    return;
  }

  const child = spawn(process.execPath, [WATCH_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_ROOT },
  });

  child.on('error', (err) => {
    process.stderr.write(`[momentum-watch-start] failed to start watcher: ${err.message}\n`);
    process.exit(1);
  });

  child.unref();
  console.log(`Discovery watcher started (PID ${child.pid})`);
}

main();
