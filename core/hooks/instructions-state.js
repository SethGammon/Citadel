'use strict';

// Shared "instruction file loaded" bookkeeping for doc-sync.
//
// InstructionsLoaded fires for CLAUDE.md and .claude/rules/*.md, but not when
// Claude Code reads AGENTS.md directly as project instructions. Both that hook
// and the SessionStart path that covers AGENTS.md record loads here, so a file
// edited between loads queues exactly one doc-sync review.

const fs = require('fs');
const path = require('path');

function telemetryDir(projectRoot) {
  return path.join(projectRoot, '.planning', 'telemetry');
}

function readState(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) return {};
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch { return {}; }
}

/**
 * Record that an instruction file was loaded and queue a doc-sync review when
 * it changed since the previous recorded load. Never throws.
 *
 * @param {string} projectRoot
 * @param {string} filePath - Absolute path of the loaded instruction file
 * @returns {{relativePath: string, changed: boolean}}
 */
function recordInstructionLoad(projectRoot, filePath) {
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  const dir = telemetryDir(projectRoot);
  const stateFile = path.join(dir, 'instructions-state.json');
  let changed = false;
  try {
    const state = readState(stateFile);
    let mtime = null;
    try {
      mtime = fs.statSync(filePath).mtimeMs;
    } catch { /* file may be virtual */ }

    const lastSeen = state[relativePath] || null;
    changed = mtime !== null && lastSeen !== null && mtime > lastSeen;

    if (changed && fs.existsSync(dir)) {
      fs.appendFileSync(path.join(dir, 'doc-sync-queue.jsonl'), JSON.stringify({
        event: 'instructions-changed',
        file: relativePath,
        timestamp: new Date().toISOString(),
        status: 'needs-review',
        prev_mtime: lastSeen,
        curr_mtime: mtime,
      }) + '\n');
    }

    if (mtime !== null && fs.existsSync(dir)) {
      state[relativePath] = mtime;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    }
  } catch { /* fail-safe: never block */ }
  return { relativePath, changed };
}

module.exports = { recordInstructionLoad };
