#!/usr/bin/env node

/**
 * test-teammate-rebalance.js: verifies the TeammateIdle hook appends
 * rebalance signals to .planning/fleet/rebalance.jsonl.
 *
 * Pipes synthetic TeammateIdle payloads into hooks_src/teammate-idle.js with
 * a temp CLAUDE_PROJECT_DIR and asserts:
 *   1. Valid payload: exit 0 and a parseable appended JSONL line
 *   2. Repeated events append, never truncate
 *   3. Malformed stdin still exits 0 and never corrupts the JSONL file
 *
 * Stdlib only. Run: node scripts/test-teammate-rebalance.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks_src', 'teammate-idle.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === undefined || result === true) {
      passed++;
      console.log(`  PASS  ${name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${name}: ${result}`);
    }
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function fireHook(input, projectDir) {
  return spawnSync('node', [HOOK], {
    input,
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
    timeout: 10000,
  });
}

function rebalancePath(projectDir) {
  return path.join(projectDir, '.planning', 'fleet', 'rebalance.jsonl');
}

function readLines(projectDir) {
  const file = rebalancePath(projectDir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-rebalance-'));

console.log('\nTeammate Rebalance Test\n' + '='.repeat(40));

test('valid TeammateIdle payload exits 0', () => {
  const r = fireHook(
    JSON.stringify({ teammate_id: 'agent-rb1', reason: 'no-work', session_id: 'sess-rb' }),
    tmpDir
  );
  if (r.status !== 0) return `exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`;
});

test('rebalance.jsonl created with a parseable idle line', () => {
  const lines = readLines(tmpDir);
  if (lines.length !== 1) return `expected 1 line, got ${lines.length}`;
  const entry = JSON.parse(lines[0]);
  if (entry.event !== 'idle') return `event "${entry.event}" !== "idle"`;
  if (entry.teammate_id !== 'agent-rb1') return `teammate_id "${entry.teammate_id}"`;
  if (entry.reason !== 'no-work') return `reason "${entry.reason}"`;
  if (entry.session_id !== 'sess-rb') return `session_id "${entry.session_id}"`;
  if (!entry.ts || Number.isNaN(Date.parse(entry.ts))) return `unparseable ts "${entry.ts}"`;
});

test('second event appends rather than truncates', () => {
  const r = fireHook(JSON.stringify({ teammate_id: 'agent-rb2' }), tmpDir);
  if (r.status !== 0) return `exit ${r.status}`;
  const lines = readLines(tmpDir);
  if (lines.length !== 2) return `expected 2 lines, got ${lines.length}`;
  const entry = JSON.parse(lines[1]);
  if (entry.teammate_id !== 'agent-rb2') return `teammate_id "${entry.teammate_id}"`;
});

test('malformed stdin still exits 0', () => {
  const r = fireHook('{not json at all', tmpDir);
  if (r.status !== 0) return `exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`;
});

test('every rebalance line remains parseable JSONL after malformed input', () => {
  const lines = readLines(tmpDir);
  if (lines.length < 2) return `expected at least 2 lines, got ${lines.length}`;
  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.event !== 'idle') return `non-idle event in line: ${line.slice(0, 120)}`;
  }
});

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
