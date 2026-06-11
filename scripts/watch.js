#!/usr/bin/env node

/**
 * watch.js -- Poll-based file change scanner for the Citadel harness.
 *
 * Detects file modifications since last scan and scans for @citadel marker
 * comments, outputting actionable results. Engine behind the /watch skill.
 *
 * Usage:
 *   node scripts/watch.js --scan              # Run a single scan
 *   node scripts/watch.js --scan --json       # Output as JSON
 *   node scripts/watch.js --scan --intake     # Also generate intake items
 *   node scripts/watch.js --status            # Show current watch state
 *   node scripts/watch.js --reset             # Reset watch state
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// -- Constants ----------------------------------------------------------------

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLANNING_DIR = path.join(ROOT, '.planning');
const STATE_PATH = path.join(PLANNING_DIR, 'watch-state.json');
const INTAKE_DIR = path.join(PLANNING_DIR, 'intake');
const LOCK_PATH = STATE_PATH + '.lock';

const LOCK_RETRIES = 10;
const LOCK_RETRY_MS = 100;
const LOCK_STALE_MS = 30000;
const SCAN_OVERLAP_MS = 60000;
const MAX_TRACKED_MARKERS = 500;

const VALID_ACTIONS = new Set(['review', 'test', 'fix', 'document', 'refactor', 'todo']);

const MARKER_PATTERNS = [
  // // @citadel: action description
  /\/\/\s*@citadel:\s*(\w+)\s*(.*?)$/,
  // # @citadel: action description
  /^#\s*@citadel:\s*(\w+)\s*(.*?)$/,
  // /* @citadel: action description */
  /\/\*\s*@citadel:\s*(\w+)\s*(.*?)\s*\*\//,
  // <!-- @citadel: action description -->
  /<!--\s*@citadel:\s*(\w+)\s*(.*?)\s*-->/,
];

// -- CLI argument parser ------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    mode: null,
    json: false,
    intake: false,
  };

  for (const arg of argv) {
    if (arg === '--scan')   opts.mode = 'scan';
    if (arg === '--status') opts.mode = 'status';
    if (arg === '--reset')  opts.mode = 'reset';
    if (arg === '--json')   opts.json = true;
    if (arg === '--intake') opts.intake = true;
  }

  if (!opts.mode) {
    console.error('Usage: node scripts/watch.js [--scan|--status|--reset] [--json] [--intake]');
    process.exit(1);
  }

  return opts;
}

// -- Marker identity ----------------------------------------------------------

/**
 * Stable identity for a marker: sha256 over file path, action, and normalized
 * marker text (trimmed, internal whitespace collapsed), truncated to 16 hex
 * chars. Line numbers are excluded so the hash survives line shifts.
 */
function markerHash(marker) {
  const normalizedText = String(marker.raw).trim().replace(/\s+/g, ' ');
  return crypto
    .createHash('sha256')
    .update(marker.file + '\0' + marker.action + '\0' + normalizedText)
    .digest('hex')
    .slice(0, 16);
}

/** Drop oldest-lastSeen entries until the map holds at most `max`. */
function pruneByLastSeen(map, max) {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys.sort((a, b) =>
    String(map[a].lastSeen || '').localeCompare(String(map[b].lastSeen || ''))
  );
  for (const key of keys.slice(0, keys.length - max)) {
    delete map[key];
  }
}

// -- State management ---------------------------------------------------------

function defaultState() {
  return {
    lastScanCommit: null,
    stats: { scansRun: 0, markersFound: 0, intakeItemsCreated: 0 },
    pendingActions: {},
    processedMarkers: {},
  };
}

function normalizeState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return defaultState();
  }
  if (!state.stats || typeof state.stats !== 'object') {
    state.stats = { scansRun: 0, markersFound: 0, intakeItemsCreated: 0 };
  }
  if (Array.isArray(state.pendingActions)) {
    // Legacy array format: re-key entries by marker hash.
    const migrated = {};
    for (const entry of state.pendingActions) {
      if (!entry || !entry.file || !entry.action || !entry.raw) continue;
      const seen = entry.timestamp || new Date().toISOString();
      migrated[markerHash(entry)] = {
        file: entry.file,
        line: entry.line,
        action: entry.action,
        description: entry.description || '',
        raw: entry.raw,
        firstSeen: seen,
        lastSeen: seen,
      };
    }
    state.pendingActions = migrated;
  } else if (!state.pendingActions || typeof state.pendingActions !== 'object') {
    state.pendingActions = {};
  }
  if (
    !state.processedMarkers ||
    typeof state.processedMarkers !== 'object' ||
    Array.isArray(state.processedMarkers)
  ) {
    // Legacy "{file}:{line}:{action}" strings cannot be re-keyed by hash
    // (raw marker text is unrecoverable), so start fresh.
    state.processedMarkers = {};
  }
  return state;
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) {
    return defaultState();
  }
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')));
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  if (!fs.existsSync(PLANNING_DIR)) {
    fs.mkdirSync(PLANNING_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// -- Cross-process locking ----------------------------------------------------

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire the state lock via atomic mkdir of a lock directory. Retries up to
 * LOCK_RETRIES times at LOCK_RETRY_MS intervals. A lock older than
 * LOCK_STALE_MS by mtime is considered abandoned and removed.
 */
function acquireLock() {
  if (!fs.existsSync(PLANNING_DIR)) {
    fs.mkdirSync(PLANNING_DIR, { recursive: true });
  }
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      fs.mkdirSync(LOCK_PATH);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.rmdirSync(LOCK_PATH);
          continue;
        }
      } catch {
        // Lock vanished between mkdir and stat; retry immediately.
        continue;
      }
      sleepMs(LOCK_RETRY_MS);
    }
  }
  return false;
}

function releaseLock() {
  try {
    fs.rmdirSync(LOCK_PATH);
  } catch {
    // Already released or removed as stale by another process.
  }
}

// -- Git helpers --------------------------------------------------------------

/**
 * Execute a git command safely using execFileSync (array args — never shell-interpolated).
 * @param {string[]} args - Git arguments as an array (e.g. ['diff', '--name-only', 'HEAD'])
 * @returns {string} stdout, trimmed. Empty string on error.
 */
function gitExec(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getCurrentHead() {
  return gitExec(['rev-parse', 'HEAD']);
}

function getChangedFiles(lastCommit) {
  const files = new Set();

  // Committed changes since last scan — lastCommit passed as array arg, never shell-interpolated
  if (lastCommit) {
    const committed = gitExec(['diff', '--name-only', lastCommit, 'HEAD']);
    if (committed) {
      for (const f of committed.split('\n')) {
        if (f.trim()) files.add(f.trim());
      }
    }
  } else {
    // First run: last commit only
    const firstRun = gitExec(['diff', '--name-only', 'HEAD~1', 'HEAD']);
    if (firstRun) {
      for (const f of firstRun.split('\n')) {
        if (f.trim()) files.add(f.trim());
      }
    }
  }

  // Unstaged changes
  const unstaged = gitExec(['diff', '--name-only']);
  if (unstaged) {
    for (const f of unstaged.split('\n')) {
      if (f.trim()) files.add(f.trim());
    }
  }

  // Staged changes
  const staged = gitExec(['diff', '--name-only', '--cached']);
  if (staged) {
    for (const f of staged.split('\n')) {
      if (f.trim()) files.add(f.trim());
    }
  }

  // Untracked files (new files not yet committed)
  const untracked = gitExec(['ls-files', '--others', '--exclude-standard']);
  if (untracked) {
    for (const f of untracked.split('\n')) {
      if (f.trim()) files.add(f.trim());
    }
  }

  // Never scan the watcher's own state and intake output: intake items quote
  // raw marker lines, so self-scanning would mint new markers every scan.
  return Array.from(files).filter((f) => !/^\.planning([\\/]|$)/.test(f));
}

// -- Marker scanning ----------------------------------------------------------

function scanFileForMarkers(filePath, relPath) {
  const markers = [];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return markers;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of MARKER_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const action = match[1].toLowerCase();
        const description = (match[2] || '').trim();
        if (VALID_ACTIONS.has(action)) {
          markers.push({
            file: relPath,
            line: i + 1,
            action,
            description,
            raw: line.trim(),
            timestamp: new Date().toISOString(),
          });
        }
        break; // one marker per line
      }
    }
  }

  return markers;
}

// -- File categorization ------------------------------------------------------

function categorizeFiles(files) {
  const categories = {
    Source: [],
    Tests: [],
    Docs: [],
    Config: [],
    Skills: [],
    Hooks: [],
    Scripts: [],
    Other: [],
  };

  for (const f of files) {
    const lower = f.toLowerCase();
    if (/\.(test|spec)\.\w+$/.test(lower) || lower.includes('__test')) {
      categories.Tests.push(f);
    } else if (lower.startsWith('skills/') || lower.includes('/skills/')) {
      categories.Skills.push(f);
    } else if (lower.startsWith('hooks_src/') || lower.includes('/hooks/')) {
      categories.Hooks.push(f);
    } else if (lower.startsWith('scripts/') || lower.includes('/scripts/')) {
      categories.Scripts.push(f);
    } else if (/\.(md|txt|rst)$/.test(lower) || lower.includes('readme') || lower.includes('docs/')) {
      categories.Docs.push(f);
    } else if (/\.(json|ya?ml|toml|ini|env|config)$/.test(lower) || lower.includes('config')) {
      categories.Config.push(f);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(lower)) {
      categories.Source.push(f);
    } else {
      categories.Other.push(f);
    }
  }

  return categories;
}

// -- Intake item generation ---------------------------------------------------

function slugify(str) {
  return str
    .replace(/[/\\]/g, '-')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** Collect marker_hash values from existing intake item frontmatter. */
function readExistingIntakeHashes() {
  const hashes = new Set();
  if (!fs.existsSync(INTAKE_DIR)) return hashes;
  for (const name of fs.readdirSync(INTAKE_DIR)) {
    if (!name.endsWith('.md')) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(INTAKE_DIR, name), 'utf8');
    } catch {
      continue;
    }
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) continue;
    const hashLine = frontmatter[1].match(/^marker_hash:\s*"?([0-9a-f]{16})"?\s*$/m);
    if (hashLine) hashes.add(hashLine[1]);
  }
  return hashes;
}

function generateIntakeItem(marker, hash) {
  if (!fs.existsSync(INTAKE_DIR)) {
    fs.mkdirSync(INTAKE_DIR, { recursive: true });
  }

  const timestamp = Date.now();
  const slug = slugify(marker.file);
  const filename = `watch-${marker.action}-${slug}-${timestamp}.md`;
  const filePath = path.join(INTAKE_DIR, filename);

  const descriptionBlock = marker.description ? `\n${marker.description}\n` : '';

  const content = `---
title: "${marker.action} ${marker.file}:${marker.line}"
status: pending
priority: normal
target: ${marker.file}
source: watch
marker_hash: ${hash}
---

Marker comment found at ${marker.file}:${marker.line}:
\`${marker.raw}\`
${descriptionBlock}`;

  fs.writeFileSync(filePath, content, 'utf8');
  return filename;
}

// -- Output formatting --------------------------------------------------------

function formatTextOutput(changedFiles, markers, categories, lastCommit, currentHead) {
  const shortCommit = lastCommit ? lastCommit.slice(0, 7) : 'initial';
  const lines = [];

  lines.push(`[watch] Scanned ${changedFiles.length} files since ${shortCommit}`);

  if (markers.length > 0) {
    lines.push('  Markers found:');
    for (const m of markers) {
      const desc = m.description ? ` ${m.description}` : '';
      lines.push(`    ${m.file}:${m.line} -- @citadel: ${m.action}${desc}`);
    }
  }

  const nonEmpty = Object.entries(categories).filter(([, files]) => files.length > 0);
  if (nonEmpty.length > 0) {
    lines.push('  File changes by category:');
    for (const [cat, files] of nonEmpty) {
      lines.push(`    ${cat}: ${files.join(', ')}`);
    }
  }

  // Actions summary
  const actionLines = [];
  if (markers.length > 0) {
    actionLines.push(`${markers.length} marker action${markers.length === 1 ? '' : 's'} ready for dispatch`);
  }
  if (categories.Tests.length > 0) {
    actionLines.push(`${categories.Tests.length} test file${categories.Tests.length === 1 ? '' : 's'} changed (suggest test run)`);
  }
  if (actionLines.length > 0) {
    lines.push('  Actions:');
    for (const a of actionLines) {
      lines.push(`    ${a}`);
    }
  }

  if (changedFiles.length === 0 && markers.length === 0) {
    lines.push('  No changes detected.');
  }

  return lines.join('\n');
}

// -- Commands -----------------------------------------------------------------

function runScan(opts) {
  const currentHead = getCurrentHead();

  if (!currentHead) {
    console.error('[watch] Not a git repository or git not available.');
    process.exit(1);
  }

  if (!acquireLock()) {
    // Another process holds the lock. If it recorded a scan start within the
    // overlap window, this is a concurrent scan: skip cleanly.
    const lockedState = readState();
    const startedAt = lockedState.scanStartedAt
      ? Date.parse(lockedState.scanStartedAt)
      : NaN;
    if (Number.isFinite(startedAt) && Date.now() - startedAt < SCAN_OVERLAP_MS) {
      const ageSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      console.log(
        `[watch] Scan skipped: another scan (pid ${lockedState.scanPid ?? 'unknown'}) started ${ageSec}s ago and still holds the lock.`
      );
      process.exit(0);
    }
    console.error(
      `[watch] Could not acquire state lock after ${LOCK_RETRIES} attempts. Remove ${path.relative(ROOT, LOCK_PATH)} if no scan is running.`
    );
    process.exit(1);
  }

  // process.exit() skips finally blocks, so all exits below happen only after
  // this try/finally has released the lock.
  let outputText;
  try {
    const state = readState();
    state.scanStartedAt = new Date().toISOString();
    state.scanPid = process.pid;
    writeState(state);

    const changedFiles = getChangedFiles(state.lastScanCommit);

    // Scan for markers in changed files that exist on disk
    const allMarkers = [];
    for (const relFile of changedFiles) {
      const fullPath = path.join(ROOT, relFile);
      if (fs.existsSync(fullPath)) {
        const markers = scanFileForMarkers(fullPath, relFile);
        allMarkers.push(...markers);
      }
    }

    const categories = categorizeFiles(changedFiles);

    // Dedup markers by hash; write intake items only for never-seen markers
    const intakeFiles = [];
    const existingIntakeHashes =
      opts.intake && allMarkers.length > 0 ? readExistingIntakeHashes() : new Set();
    const now = new Date().toISOString();

    for (const marker of allMarkers) {
      const hash = markerHash(marker);
      const seenBefore = Object.prototype.hasOwnProperty.call(
        state.processedMarkers,
        hash
      );

      if (opts.intake && !seenBefore && !existingIntakeHashes.has(hash)) {
        intakeFiles.push(generateIntakeItem(marker, hash));
        existingIntakeHashes.add(hash);
      }

      if (seenBefore) {
        state.processedMarkers[hash].lastSeen = now;
      } else {
        state.processedMarkers[hash] = {
          file: marker.file,
          action: marker.action,
          firstSeen: now,
          lastSeen: now,
        };
      }

      const pending = state.pendingActions[hash];
      if (pending) {
        pending.line = marker.line;
        pending.description = marker.description;
        pending.raw = marker.raw;
        pending.lastSeen = now;
      } else {
        state.pendingActions[hash] = {
          file: marker.file,
          line: marker.line,
          action: marker.action,
          description: marker.description,
          raw: marker.raw,
          firstSeen: now,
          lastSeen: now,
        };
      }
    }

    pruneByLastSeen(state.processedMarkers, MAX_TRACKED_MARKERS);
    pruneByLastSeen(state.pendingActions, MAX_TRACKED_MARKERS);

    // Update state
    const previousCommit = state.lastScanCommit;
    state.lastScanCommit = currentHead;
    state.stats.scansRun = (state.stats.scansRun || 0) + 1;
    state.stats.markersFound = (state.stats.markersFound || 0) + allMarkers.length;
    state.stats.intakeItemsCreated =
      (state.stats.intakeItemsCreated || 0) + intakeFiles.length;

    writeState(state);

    // Output
    if (opts.json) {
      const result = {
        scannedFiles: changedFiles.length,
        sinceCommit: previousCommit ? previousCommit.slice(0, 7) : 'initial',
        currentHead: currentHead.slice(0, 7),
        changedFiles,
        markers: allMarkers,
        categories,
        intakeItemsCreated: intakeFiles,
        stats: state.stats,
      };
      outputText = JSON.stringify(result, null, 2);
    } else {
      const lines = [
        formatTextOutput(changedFiles, allMarkers, categories, previousCommit, currentHead),
      ];
      if (intakeFiles.length > 0) {
        lines.push(`  Intake items created: ${intakeFiles.length}`);
        for (const f of intakeFiles) {
          lines.push(`    ${f}`);
        }
      }
      outputText = lines.join('\n');
    }
  } finally {
    releaseLock();
  }

  console.log(outputText);
  process.exit(0);
}

function runStatus() {
  const state = readState();

  if (!state.lastScanCommit) {
    console.log('[watch] No scans have been run yet.');
    process.exit(0);
  }

  console.log('[watch] Current state:');
  console.log(`  Last scan commit: ${state.lastScanCommit.slice(0, 7)}`);
  console.log(`  Scans run: ${state.stats.scansRun || 0}`);
  console.log(`  Markers found (total): ${state.stats.markersFound || 0}`);
  console.log(`  Intake items created (total): ${state.stats.intakeItemsCreated || 0}`);

  const pending = Object.values(state.pendingActions || {});
  if (pending.length > 0) {
    console.log(`  Pending actions: ${pending.length}`);
    for (const a of pending) {
      const desc = a.description ? ` ${a.description}` : '';
      console.log(`    ${a.file}:${a.line} -- ${a.action}${desc}`);
    }
  } else {
    console.log('  Pending actions: 0');
  }

  process.exit(0);
}

function runReset() {
  if (!acquireLock()) {
    console.error('[watch] Could not acquire state lock; a scan may be running. Try again shortly.');
    process.exit(1);
  }
  try {
    writeState(defaultState());
  } finally {
    releaseLock();
  }
  console.log('[watch] State reset. Next scan will use HEAD~1 as baseline.');
  process.exit(0);
}

// -- Main ---------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === 'scan')   runScan(opts);
  if (opts.mode === 'status') runStatus();
  if (opts.mode === 'reset')  runReset();
}

main();
