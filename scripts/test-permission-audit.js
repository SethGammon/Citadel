#!/usr/bin/env node

/**
 * test-permission-audit.js — Tests for the permission audit pipeline.
 *
 * Covers:
 *   1. Report counts from a synthetic permission-events.jsonl fixture
 *   2. Anomaly flags (denial rate > 20%, tool dominance > 80%)
 *   3. Graceful empty state
 *   4. Historical audit.jsonl merge without double counting
 *   5. End-to-end: pipe a synthetic PermissionRequest event into
 *      hooks_src/permission-request.js, assert the JSONL line appears
 *      and the hook exits 0
 *
 * Zero dependencies. Uses temp directories, cleans up after itself.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const AUDIT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'permission-audit.js');
const HOOK_SCRIPT = path.join(REPO_ROOT, 'hooks_src', 'permission-request.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

function makeTempRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `citadel-perm-audit-${name}-`));
  fs.mkdirSync(path.join(dir, '.planning', 'telemetry'), { recursive: true });
  return dir;
}

function writeEvents(root, events) {
  const file = path.join(root, '.planning', 'telemetry', 'permission-events.jsonl');
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

function runAudit(root) {
  return spawnSync(process.execPath, [AUDIT_SCRIPT, '--root', root], { encoding: 'utf8' });
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function evt(ts, tool, target, decision) {
  return { ts, event: 'PermissionRequest', tool, target, decision };
}

// ── Test 1: counts and denial anomaly ───────────────────────────────────────

function testCountsAndDenialAnomaly() {
  console.log('Test 1: counts and denial-rate anomaly');
  const root = makeTempRoot('counts');
  writeEvents(root, [
    evt('2026-06-11T09:01:00.000Z', 'Bash', 'git push origin main', 'deferred'),
    evt('2026-06-11T09:02:00.000Z', 'Bash', 'git push origin main', 'deny'),
    evt('2026-06-11T09:03:00.000Z', 'Bash', 'npm run test', 'allow'),
    evt('2026-06-11T10:04:00.000Z', 'Write', '.planning/state.json', 'allow'),
    evt('2026-06-11T10:05:00.000Z', 'Write', '.planning/state.json', 'allow'),
    evt('2026-06-11T10:06:00.000Z', 'Edit', 'src/index.ts', 'deferred'),
    evt('2026-06-11T10:07:00.000Z', 'Bash', 'rm -rf /', 'deny'),
    evt('2026-06-11T10:08:00.000Z', 'Bash', 'git push origin main', 'deny'),
    evt('2026-06-11T10:09:00.000Z', 'Write', 'README.md', 'deferred'),
    evt('2026-06-11T10:10:00.000Z', 'Bash', 'npm run lint', 'allow'),
  ]);

  const res = runAudit(root);
  const out = res.stdout || '';
  assert(res.status === 0, 'audit exits 0');
  assert(out.includes('Total permission events: 10'), 'total count is 10');
  assert(/Bash\s+6\s+\(60\.0%\)/.test(out), 'Bash counted 6 (60.0%)');
  assert(/Write\s+3\s+\(30\.0%\)/.test(out), 'Write counted 3 (30.0%)');
  assert(/Edit\s+1\s+\(10\.0%\)/.test(out), 'Edit counted 1 (10.0%)');
  assert(/3\s+git push origin main/.test(out), 'top target shows git push x3');
  assert(out.includes('3 of 10 events denied (30.0%)'), 'denial summary present');
  assert(/10:00\s+7/.test(out), 'busiest hour bucket 10:00 has 7 events');
  assert(out.includes('ANOMALY:'), 'anomaly line present');
  assert(out.includes('denial rate 30.0% exceeds 20%'), 'denial-rate anomaly flagged');
  cleanup(root);
}

// ── Test 2: tool dominance anomaly ──────────────────────────────────────────

function testToolDominanceAnomaly() {
  console.log('Test 2: tool-dominance anomaly');
  const root = makeTempRoot('dominance');
  const events = [];
  for (let i = 0; i < 9; i++) {
    events.push(evt(`2026-06-11T11:0${i}:00.000Z`, 'Bash', `command-${i}`, 'deferred'));
  }
  events.push(evt('2026-06-11T11:09:00.000Z', 'Write', 'file.txt', 'deferred'));
  writeEvents(root, events);

  const res = runAudit(root);
  const out = res.stdout || '';
  assert(res.status === 0, 'audit exits 0');
  assert(out.includes('ANOMALY:'), 'anomaly line present');
  assert(out.includes('tool "Bash" accounts for 90.0% of requests'), 'dominance anomaly flagged');
  assert(!out.includes('denial rate'), 'no denial anomaly (0% denials)');
  cleanup(root);
}

// ── Test 3: empty state ─────────────────────────────────────────────────────

function testEmptyState() {
  console.log('Test 3: graceful empty state');
  const root = makeTempRoot('empty');

  const res = runAudit(root);
  const out = res.stdout || '';
  assert(res.status === 0, 'audit exits 0 with no telemetry');
  assert(out.includes('No permission telemetry recorded yet.'), 'empty-state message shown');
  assert(!out.includes('ANOMALY'), 'no anomaly on empty data');
  cleanup(root);
}

// ── Test 4: historical audit.jsonl merge without double counting ───────────

function testHistoricalMerge() {
  console.log('Test 4: historical audit.jsonl merge');
  const root = makeTempRoot('merge');

  // Two historical records: one before the dedicated log existed (counted),
  // one at/after the earliest dedicated record (skipped to avoid double count).
  const auditFile = path.join(root, '.planning', 'telemetry', 'audit.jsonl');
  fs.writeFileSync(auditFile, [
    JSON.stringify({ schema: 1, event: 'permission-request', timestamp: '2026-06-10T08:00:00.000Z', tool: 'Bash', target: 'old command', decision: 'deferred' }),
    JSON.stringify({ schema: 1, event: 'permission-request', timestamp: '2026-06-11T09:00:30.000Z', tool: 'Bash', target: 'duplicate of dedicated', decision: 'deferred' }),
    JSON.stringify({ schema: 1, event: 'scope-violation', timestamp: '2026-06-10T08:01:00.000Z', tool: 'Edit' }),
  ].join('\n') + '\n', 'utf8');

  writeEvents(root, [
    evt('2026-06-11T09:00:00.000Z', 'Write', 'a.txt', 'allow'),
    evt('2026-06-11T09:05:00.000Z', 'Edit', 'b.txt', 'allow'),
  ]);

  const res = runAudit(root);
  const out = res.stdout || '';
  assert(res.status === 0, 'audit exits 0');
  assert(out.includes('Total permission events: 3'), 'merged total is 3 (1 historical + 2 dedicated)');
  assert(out.includes('old command'), 'historical target included');
  assert(!out.includes('duplicate of dedicated'), 'overlapping audit entry excluded');
  cleanup(root);
}

// ── Test 5: hook end-to-end ─────────────────────────────────────────────────

function testHookPipeline() {
  console.log('Test 5: hook writes permission-events.jsonl and exits 0');
  const root = makeTempRoot('hook');

  const payload = JSON.stringify({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main ' + 'x'.repeat(200) },
  });

  const res = spawnSync(process.execPath, [HOOK_SCRIPT], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });

  assert(res.status === 0, 'hook exits 0');

  const eventsFile = path.join(root, '.planning', 'telemetry', 'permission-events.jsonl');
  assert(fs.existsSync(eventsFile), 'permission-events.jsonl created');

  let record = null;
  if (fs.existsSync(eventsFile)) {
    const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
    assert(lines.length === 1, 'exactly one JSONL line written');
    try { record = JSON.parse(lines[0]); } catch { /* assert below */ }
  }
  assert(record !== null, 'JSONL line parses');
  if (record) {
    assert(record.tool === 'Bash', 'record.tool is Bash');
    assert(record.event === 'PermissionRequest', 'record.event is PermissionRequest');
    assert(record.decision === 'deferred', 'unsafe command recorded as deferred');
    assert(typeof record.target === 'string' && record.target.length === 120, 'target truncated to 120 chars');
    assert(typeof record.ts === 'string' && !Number.isNaN(Date.parse(record.ts)), 'ts is a valid timestamp');
  }

  // Denied event through the same hook records decision deny and no allow output
  const deniedRes = spawnSync(process.execPath, [HOOK_SCRIPT], {
    input: JSON.stringify({
      hook_event_name: 'PermissionDenied',
      tool_name: 'Write',
      tool_input: { file_path: path.join(root, '.planning', 'x.json') },
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert(deniedRes.status === 0, 'hook exits 0 on PermissionDenied');
  assert(!(deniedRes.stdout || '').includes('"behavior":"allow"'), 'no allow decision emitted for denied event');
  const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
  assert(lines.length === 2, 'denied event appended');
  const denied = JSON.parse(lines[1]);
  assert(denied.decision === 'deny', 'denied event recorded with decision deny');
  assert(denied.event === 'PermissionDenied', 'denied event name recorded');

  cleanup(root);
}

// ── Run ─────────────────────────────────────────────────────────────────────

testCountsAndDenialAnomaly();
testToolDominanceAnomaly();
testEmptyState();
testHistoricalMerge();
testHookPipeline();

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
