'use strict';

/**
 * watcher.js — PID management utilities for the discovery watcher process.
 *
 * Keeps the long-running watch-discoveries process idempotent:
 * only one watcher per project, tracked by PID file.
 */

const fs = require('fs');
const path = require('path');

const PID_FILENAME = '.watcher.pid';

/**
 * Check if a process is alive without sending a signal.
 * Returns false if pid is falsy, process is dead, or permission is denied.
 */
function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number' || !isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but no permission (still alive)
    return err.code === 'EPERM';
  }
}

/** Read the watcher PID from disk. Returns null if missing or invalid. */
function readWatcherPid(projectRoot) {
  const file = path.join(projectRoot, '.planning', 'discoveries', PID_FILENAME);
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Write the watcher PID to disk. Creates directories if needed. */
function writeWatcherPid(projectRoot, pid) {
  const dir = path.join(projectRoot, '.planning', 'discoveries');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PID_FILENAME), String(pid));
}

/** Delete the watcher PID file. Ignores missing file. */
function clearWatcherPid(projectRoot) {
  const file = path.join(projectRoot, '.planning', 'discoveries', PID_FILENAME);
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

/** Returns true if a watcher process is running for this project. */
function isWatcherRunning(projectRoot) {
  const pid = readWatcherPid(projectRoot);
  return pid !== null && isPidAlive(pid);
}

module.exports = { isPidAlive, readWatcherPid, writeWatcherPid, clearWatcherPid, isWatcherRunning };
