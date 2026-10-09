#!/usr/bin/env node

/**
 * instructions-watch.js — SessionStart hook
 *
 * Claude Code builds the FileChanged watch list only from a hook's matcher
 * and from SessionStart `watchPaths`. The template's FileChanged entry has no
 * matcher (OpenCode's runner would apply it to tool names and skip every file
 * event), so this hook supplies the project's instruction files instead:
 * AGENTS.md, CLAUDE.md and .claude/rules/**\/*.md. file-changed.js then queues
 * doc-sync reviews when any of them change mid-session.
 *
 * Design:
 *   - Claude Code only: other runtimes set CITADEL_RUNTIME and get no output
 *   - Observer only: always exit 0, never blocks session start
 *
 * Exit codes:
 *   0 = always
 */

'use strict';

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const ROOT_GUIDANCE = Object.freeze(['AGENTS.md', 'CLAUDE.md']);

function isClaudeCode() {
  const runtime = process.env.CITADEL_RUNTIME;
  return !runtime || runtime === 'claude-code';
}

function listRuleFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRuleFiles(child));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(child);
  }
  return files;
}

/**
 * Absolute instruction paths to watch. Root guidance files are listed even
 * when absent so that creating one is noticed too.
 */
function instructionWatchPaths(projectRoot) {
  return [
    ...ROOT_GUIDANCE.map((name) => path.join(projectRoot, name)),
    ...listRuleFiles(path.join(projectRoot, '.claude', 'rules')),
  ];
}

function main() {
  try {
    health.increment('instructions-watch', 'count');
    if (!isClaudeCode()) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        watchPaths: instructionWatchPaths(PROJECT_ROOT),
      },
    }));
  } catch { /* non-critical: never block session start */ }
}

if (require.main === module) {
  main();
  process.exit(0);
}

module.exports = { instructionWatchPaths, isClaudeCode };
