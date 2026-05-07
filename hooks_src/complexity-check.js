#!/usr/bin/env node

/**
 * complexity-check.js — PostToolUse hook (Edit|Write on .js/.ts/.jsx/.tsx files)
 *
 * Advisory complexity enforcement — Constitution rule E-003.
 * Computes an approximate cyclomatic complexity score for modified JS/TS files
 * by counting decision points (if, else if, while, for, switch, case, catch,
 * &&, ||, ternary ?:). Logs results to telemetry. Emits a context-visible
 * warning when a file crosses the threshold.
 *
 * This hook NEVER blocks (always exits 0). Complexity enforcement is advisory:
 * it surfaces the information so Claude can act on it, not hard-gates the edit.
 *
 * Threshold: > 10 total decision points in a file triggers a warning.
 * This is a file-level heuristic, not function-level cyclomatic complexity.
 * It catches files that are getting complex without requiring an AST parser.
 *
 * Exit codes: always 0 (observe-only)
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const health = require('./harness-health-util');

const COMPLEXITY_LOG = path.join(health.PROJECT_ROOT, '.planning', 'telemetry', 'complexity.jsonl');
const WARN_THRESHOLD = 10;

const TRACKED_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

// Decision-point keywords and operators that each add 1 to the score
const DECISION_PATTERNS = [
  /\bif\s*\(/g,
  /\belse\s+if\s*\(/g,
  /\bwhile\s*\(/g,
  /\bfor\s*\(/g,
  /\bswitch\s*\(/g,
  /\bcase\s+[^:]+:/g,
  /\bcatch\s*\(/g,
  /&&/g,
  /\|\|/g,
  /\?\s*[^:]/g,   // ternary — matches "? value" but not "?." optional chaining
];

function countDecisionPoints(source) {
  let total = 0;
  for (const pattern of DECISION_PATTERNS) {
    const matches = source.match(pattern);
    if (matches) total += matches.length;
  }
  return total;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      run(input);
    } catch {
      // Complexity check must never block — swallow all errors
    }
    process.exit(0);
  });
}

function run(input) {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return;
  }

  const toolName = event.tool_name || '';
  if (toolName !== 'Edit' && toolName !== 'Write') return;

  const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
  if (!filePath) return;

  const ext = path.extname(filePath).toLowerCase();
  if (!TRACKED_EXTENSIONS.has(ext)) return;

  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const score = countDecisionPoints(source);
  const lineCount = source.split('\n').length;
  const relativePath = path.relative(health.PROJECT_ROOT, filePath).split(path.sep).join('/');

  // Log to telemetry (fire-and-forget, never block on failure)
  try {
    const base = {
      hook:     'complexity-check',
      file:     relativePath,
      score,
      lines:    lineCount,
      threshold: WARN_THRESHOLD,
      warned:   score > WARN_THRESHOLD,
      timestamp: new Date().toISOString(),
    };
    const entry = JSON.stringify({
      ...base,
      _hash: health.hashRecord(base),
      _hash_v: 1,
    });
    const dir = path.dirname(COMPLEXITY_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(COMPLEXITY_LOG, entry + '\n', 'utf8');
  } catch { /* telemetry is best-effort */ }

  if (score > WARN_THRESHOLD) {
    process.stdout.write(
      `[complexity-check] ${relativePath}: ${score} decision points (threshold: ${WARN_THRESHOLD}). ` +
      `Constitution E-003: functions with cyclomatic complexity > 10 require explanatory comments. ` +
      `Consider splitting this file or adding comments to explain the branching structure.\n`
    );
  }
}

main();
