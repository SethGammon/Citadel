#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isPidAlive,
  readWatcherPid,
  writeWatcherPid,
  clearWatcherPid,
  isWatcherRunning,
} = require('../core/momentum/watcher');

// --- isPidAlive ---
assert.equal(isPidAlive(process.pid), true, 'current process should be alive');
assert.equal(isPidAlive(0), false, 'pid 0 should return false');
assert.equal(isPidAlive(-1), false, 'negative pid should return false');
assert.equal(isPidAlive(null), false, 'null pid should return false');
assert.equal(isPidAlive(999999999), false, 'nonexistent pid should return false');

// --- PID file round-trip ---
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-watcher-'));
try {
  // No PID file yet
  assert.equal(readWatcherPid(tempRoot), null, 'no pid file → null');
  assert.equal(isWatcherRunning(tempRoot), false, 'no pid file → not running');

  // Write current PID (definitely alive)
  writeWatcherPid(tempRoot, process.pid);
  assert.equal(readWatcherPid(tempRoot), process.pid, 'should read back same pid');
  assert.equal(isWatcherRunning(tempRoot), true, 'current process pid → running');

  // Overwrite with dead PID
  writeWatcherPid(tempRoot, 999999999);
  assert.equal(readWatcherPid(tempRoot), 999999999);
  assert.equal(isWatcherRunning(tempRoot), false, 'dead pid → not running');

  // Clear
  clearWatcherPid(tempRoot);
  assert.equal(readWatcherPid(tempRoot), null, 'after clear → null');
  assert.equal(isWatcherRunning(tempRoot), false, 'after clear → not running');

  // clearWatcherPid is idempotent
  clearWatcherPid(tempRoot); // should not throw

  // Write with invalid content
  const pidFile = path.join(tempRoot, '.planning', 'discoveries', '.watcher.pid');
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, 'not-a-number');
  assert.equal(readWatcherPid(tempRoot), null, 'invalid content → null');

} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('momentum-watcher tests passed');
