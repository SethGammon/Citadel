#!/usr/bin/env node

/**
 * state-hygiene.js -- Cleanup sweep for harness state that expires but is
 * never deleted.
 *
 * Removes exactly three categories of dead state, nothing else:
 *   1. Expired session-allow consent markers
 *      {PLUGIN_DATA_DIR}/consent-session-{category}.json  (6 hour TTL,
 *      see hasSessionAllow in hooks_src/harness-health-util.js)
 *   2. Expired one-time approval tokens
 *      {PLUGIN_DATA_DIR}/consent-onetime-{category}.json  (120 second TTL,
 *      see consumeOneTimeAllow in hooks_src/harness-health-util.js)
 *   3. Stale lockdirs: directories named *.lock under .planning/ whose
 *      mtime is older than 10 minutes (crashed-process leftovers, e.g.
 *      watch-state.json.lock from scripts/watch.js)
 *
 * Safety rules:
 *   - Never follows symlinks; symlinked entries are skipped entirely
 *   - Only deletes files matching the exact consent marker filename shape
 *   - Only deletes DIRECTORIES named *.lock (plain files like
 *     .planning/telemetry/session-end.lock are left alone)
 *   - Every removal is individually try/caught so one locked file never
 *     aborts the sweep
 *
 * Usage:
 *   node scripts/state-hygiene.js [--dry-run] [--json]
 *
 * Module:
 *   const { cleanState } = require('./scripts/state-hygiene');
 *   const result = cleanState({ dryRun: true });
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Mirrors PLUGIN_DATA_DIR in hooks_src/harness-health-util.js
const DEFAULT_PLUGIN_DATA_DIR = process.env.CLAUDE_PLUGIN_DATA || path.join(PROJECT_ROOT, '.claude');
const DEFAULT_PLANNING_DIR = path.join(PROJECT_ROOT, '.planning');

// Exact filename shapes written by grantSessionAllow / grantOneTimeAllow.
// Category names are plain identifiers (externalActions, daemonSpend, ...).
const SESSION_MARKER_RE = /^consent-session-[A-Za-z0-9_-]+\.json$/;
const ONETIME_MARKER_RE = /^consent-onetime-[A-Za-z0-9_-]+\.json$/;

// TTLs mirror the read-side expiry logic in harness-health-util.js
const SESSION_ALLOW_TTL_MS = 6 * 60 * 60 * 1000; // hasSessionAllow
const ONETIME_TTL_MS = 120 * 1000;               // consumeOneTimeAllow

// Lockdirs are stale after 30s by the watch.js convention; the hygiene sweep
// uses a much more conservative 10 minutes so it can never race a live scan.
const LOCKDIR_STALE_MS = 10 * 60 * 1000;
const MAX_LOCK_SCAN_DEPTH = 6;

/**
 * Decide whether a consent marker file is expired.
 * A marker that cannot be parsed or has an invalid timestamp can never grant
 * access again (the read paths treat it as absent), so it counts as expired.
 */
function markerIsExpired(filePath, ttlMs, nowMs) {
  try {
    const marker = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const age = nowMs - new Date(marker.timestamp).getTime();
    if (Number.isNaN(age)) return true; // invalid timestamp, dead marker
    return age >= ttlMs;
  } catch {
    return true; // unreadable or malformed, dead marker
  }
}

/**
 * Sweep expired consent markers of one kind from the plugin data dir.
 */
function sweepMarkers(dir, nameRe, ttlMs, nowMs, dryRun, result, counterKey) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return; // dir missing or unreadable, nothing to sweep
  }
  for (const name of names) {
    if (!nameRe.test(name)) continue;
    const filePath = path.join(dir, name);
    try {
      const st = fs.lstatSync(filePath);
      if (st.isSymbolicLink() || !st.isFile()) continue; // never follow symlinks
      if (!markerIsExpired(filePath, ttlMs, nowMs)) continue;
      if (dryRun) {
        result[counterKey]++;
        result.removed.push(filePath);
        continue;
      }
      fs.unlinkSync(filePath);
      result[counterKey]++;
      result.removed.push(filePath);
    } catch (err) {
      result.errors++;
      result.failed.push({ path: filePath, error: String(err && err.message || err) });
    }
  }
}

/**
 * Recursively sweep stale *.lock directories under the planning dir.
 * Symlinks are never followed or deleted. Plain files named *.lock are
 * intentionally left alone (session-end.lock is a regular file).
 */
function sweepLockdirs(dir, nowMs, dryRun, result, depth) {
  if (depth > MAX_LOCK_SCAN_DEPTH) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // dir missing or unreadable
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.name.endsWith('.lock')) {
      try {
        const st = fs.lstatSync(entryPath);
        if (st.isSymbolicLink() || !st.isDirectory()) continue;
        if (nowMs - st.mtimeMs < LOCKDIR_STALE_MS) continue; // fresh, maybe live
        if (dryRun) {
          result.lockdirs++;
          result.removed.push(entryPath);
          continue;
        }
        fs.rmSync(entryPath, { recursive: true, force: true });
        result.lockdirs++;
        result.removed.push(entryPath);
      } catch (err) {
        result.errors++;
        result.failed.push({ path: entryPath, error: String(err && err.message || err) });
      }
    } else {
      sweepLockdirs(entryPath, nowMs, dryRun, result, depth + 1);
    }
  }
}

/**
 * Run the hygiene sweep.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]   Report what would be removed without deleting
 * @param {string}  [options.pluginDataDir]  Override consent marker location (tests)
 * @param {string}  [options.planningDir]    Override .planning location (tests)
 * @param {number}  [options.now]            Override clock in ms (tests)
 * @returns {{ dryRun: boolean, sessionMarkers: number, onetimeTokens: number,
 *             lockdirs: number, errors: number, removed: string[],
 *             failed: {path: string, error: string}[] }}
 *   Counts are successful removals, or would-be removals when dryRun is true.
 */
function cleanState(options = {}) {
  const dryRun = options.dryRun === true;
  const pluginDataDir = options.pluginDataDir || DEFAULT_PLUGIN_DATA_DIR;
  const planningDir = options.planningDir || DEFAULT_PLANNING_DIR;
  const nowMs = typeof options.now === 'number' ? options.now : Date.now();

  const result = {
    dryRun,
    sessionMarkers: 0,
    onetimeTokens: 0,
    lockdirs: 0,
    errors: 0,
    removed: [],
    failed: [],
  };

  sweepMarkers(pluginDataDir, SESSION_MARKER_RE, SESSION_ALLOW_TTL_MS, nowMs, dryRun, result, 'sessionMarkers');
  sweepMarkers(pluginDataDir, ONETIME_MARKER_RE, ONETIME_TTL_MS, nowMs, dryRun, result, 'onetimeTokens');
  sweepLockdirs(planningDir, nowMs, dryRun, result, 0);

  return result;
}

// -- CLI ----------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const asJson = args.includes('--json');

  const result = cleanState({ dryRun });

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.errors > 0 ? 1 : 0);
  }

  const verb = dryRun ? 'would remove' : 'removed';
  for (const p of result.removed) {
    console.log(`[state-hygiene] ${verb}: ${p}`);
  }
  for (const f of result.failed) {
    console.log(`[state-hygiene] failed: ${f.path} (${f.error})`);
  }
  console.log(
    `[state-hygiene] ${dryRun ? 'dry-run: ' : ''}` +
    `${result.sessionMarkers} session marker(s), ` +
    `${result.onetimeTokens} one-time token(s), ` +
    `${result.lockdirs} lockdir(s)` +
    (result.errors ? `, ${result.errors} error(s)` : '')
  );
  process.exit(result.errors > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  cleanState,
  SESSION_MARKER_RE,
  ONETIME_MARKER_RE,
  SESSION_ALLOW_TTL_MS,
  ONETIME_TTL_MS,
  LOCKDIR_STALE_MS,
};
