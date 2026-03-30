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
const { execFileSync } = require('child_process');

// -- Constants ----------------------------------------------------------------

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLANNING_DIR = path.join(ROOT, '.planning');
const STATE_PATH = path.join(PLANNING_DIR, 'watch-state.json');
const INTAKE_DIR = path.join(PLANNING_DIR, 'intake');

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

// -- State management ---------------------------------------------------------

function readState() {
  if (!fs.existsSync(STATE_PATH)) {
    return {
      lastScanCommit: null,
      stats: { scansRun: 0, markersFound: 0, intakeItemsCreated: 0 },
      pendingActions: [],
    };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {
      lastScanCommit: null,
      stats: { scansRun: 0, markersFound: 0, intakeItemsCreated: 0 },
      pendingActions: [],
    };
  }
}

function writeState(state) {
  if (!fs.existsSync(PLANNING_DIR)) {
    fs.mkdirSync(PLANNING_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
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

  return Array.from(files);
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

function generateIntakeItem(marker) {
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
  const state = readState();
  const currentHead = getCurrentHead();

  if (!currentHead) {
    console.error('[watch] Not a git repository or git not available.');
    process.exit(1);
  }

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

  // Generate intake items if requested
  const intakeFiles = [];
  if (opts.intake && allMarkers.length > 0) {
    for (const marker of allMarkers) {
      const filename = generateIntakeItem(marker);
      intakeFiles.push(filename);
    }
  }

  // Update state
  const previousCommit = state.lastScanCommit;
  state.lastScanCommit = currentHead;
  state.stats.scansRun = (state.stats.scansRun || 0) + 1;
  state.stats.markersFound = (state.stats.markersFound || 0) + allMarkers.length;
  state.stats.intakeItemsCreated = (state.stats.intakeItemsCreated || 0) + intakeFiles.length;

  // Merge new markers into pending actions (deduplicate by file+line+action)
  const existing = new Set(
    (state.pendingActions || []).map(a => `${a.file}:${a.line}:${a.action}`)
  );
  for (const m of allMarkers) {
    const key = `${m.file}:${m.line}:${m.action}`;
    if (!existing.has(key)) {
      state.pendingActions.push(m);
      existing.add(key);
    }
  }

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
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTextOutput(changedFiles, allMarkers, categories, previousCommit, currentHead));
    if (intakeFiles.length > 0) {
      console.log(`  Intake items created: ${intakeFiles.length}`);
      for (const f of intakeFiles) {
        console.log(`    ${f}`);
      }
    }
  }

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

  const pending = state.pendingActions || [];
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
  const freshState = {
    lastScanCommit: null,
    stats: { scansRun: 0, markersFound: 0, intakeItemsCreated: 0 },
    pendingActions: [],
  };
  writeState(freshState);
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
