#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createRepairTask,
  getBlockedTasks,
  getMergeCandidates,
  getReadyTasks,
  getScopeConflicts,
  parseWorkQueue,
  serializeWorkQueue,
  updateWorkQueue,
  validateMergeOrder,
} = require('../core/fleet/session');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const sample = [
  '# Fleet Session: Example',
  '',
  'Status: active',
  '',
  '## Work Queue',
  '| # | Campaign | Scope | Deps | Status | Wave | Agent | Branch | Evidence |',
  '|---|----------|-------|------|--------|------|-------|--------|----------|',
  '| 1 | API | src/api | none | merged | 1 | build | codex/fleet-api | validator pass |',
  '| 2 | UI | src/ui | 1 | pending | 1 | build | codex/fleet-ui | - |',
  '| 3 | Integration | src | 2 | pending | 2 | verify | - | - |',
  '| 4 | Docs | docs | none | validated | 1 | docs | codex/fleet-docs | validator pass |',
  '| 5 | API child | src/api/auth | none | pending | 1 | build | - | - |',
  '| 6 | Package | package.json | 4 | complete | 2 | build | codex/package | validator pass |',
  '',
  '## Continuation State',
  'Next wave: 1',
].join('\n');

const tasks = parseWorkQueue(sample);
assert.equal(tasks.length, 6, 'work queue rows should parse');
assert.deepEqual(tasks[1].deps, ['1'], 'deps should parse as ids');
assert.deepEqual(tasks[1].scope, ['src/ui'], 'scope should parse as a list');

const ready = getReadyTasks(tasks).map((task) => task.id);
assert.deepEqual(ready.sort(), ['2', '5'], 'ready tasks should have pending status and satisfied deps');

const blocked = getBlockedTasks(tasks);
assert.equal(blocked.length, 1, 'one task should be dependency-blocked');
assert.equal(blocked[0].task.id, '3');
assert.equal(blocked[0].blockers[0].dep, '2');

const mergeCandidates = getMergeCandidates(tasks).map((task) => task.id);
assert.deepEqual(mergeCandidates, ['4'], 'only no-dep validated work should be merge-ready');

const blockedMerge = validateMergeOrder('6', tasks);
assert.equal(blockedMerge.ok, false, 'completed dependent work should wait for merged deps');
assert.equal(blockedMerge.blockers[0].dep, '4');
assert.equal(blockedMerge.blockers[0].reason, 'dependency has not been merged');

const conflicts = getScopeConflicts(tasks);
assert.equal(conflicts.length, 1, 'same-wave parent-child scopes should conflict');
assert.equal(conflicts[0].left.id, '1');
assert.equal(conflicts[0].right.id, '5');

const repair = createRepairTask(tasks, tasks[2], 'integration failed verification');
assert.equal(repair.id, '7');
assert.equal(repair.status, 'pending');
assert(repair.evidence.includes('Repairs #3'), 'repair task should cite source task');

const serialized = serializeWorkQueue(tasks);
assert(serialized.includes('| # | Campaign | Scope | Deps | Status | Wave | Agent | Branch | Evidence |'));
assert(!serialized.includes('undefined'));

const updated = updateWorkQueue(sample, tasks);
assert(updated.includes('## Continuation State'), 'update should preserve later sections');
assert(updated.includes('| 6 | Package | package.json | 4 | complete | 2 | build | codex/package | validator pass |'));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fleet-session-'));
try {
  const emptyOutput = execFileSync(process.execPath, [
    path.join(__dirname, 'fleet-steward.js'),
    '--project-root',
    tempRoot,
  ], { encoding: 'utf8' });
  assert(emptyOutput.includes('No fleet session file found') === false, 'no-session default should stay operator-friendly');
  assert(emptyOutput.includes('Session: (none found)'), 'no-session default should report the missing session without failing');

  const sessionFile = path.join(tempRoot, '.planning', 'fleet', 'session-example.md');
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, sample);
  write(path.join(tempRoot, '.planning', 'verification', 'worktree-readiness', 'codex-fleet-ui.json'), JSON.stringify({
    schema: 1,
    timestamp: '2026-06-04T12:00:00.000Z',
    worktreePath: path.join(tempRoot, 'worktrees', 'ui'),
    worktreeName: 'ui',
    branch: 'codex/fleet-ui',
    status: 'blocked',
    blockFleet: true,
    checks: [{ name: 'dependencies:node', status: 'fail', detail: 'node_modules is missing after worktree setup.' }],
  }));

  const output = execFileSync(process.execPath, [
    path.join(__dirname, 'fleet-steward.js'),
    '--project-root',
    tempRoot,
    '--session',
    sessionFile,
  ], { encoding: 'utf8' });
  assert(output.includes('Fleet Steward'));
  assert(output.includes('READY TO RUN'));
  assert(!output.includes('#2 UI [pending] - wave 1'), 'readiness-blocked task should not remain in ready list');
  assert(output.includes('READINESS BLOCKED'));
  assert(output.includes('#2 UI [pending] blocked by blocked worktree readiness'));
  assert(output.includes('MERGE BLOCKED'));
  assert(output.includes('#6 Package [complete]'));
  assert(output.includes('SCOPE CONFLICTS'));
  assert(!output.includes('undefined'));

  const json = execFileSync(process.execPath, [
    path.join(__dirname, 'fleet-steward.js'),
    '--project-root',
    tempRoot,
    '--session',
    sessionFile,
    '--json',
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(json);
  assert.equal(parsed.analysis.ready.length, 1, 'json output should exclude readiness-blocked tasks by default');
  assert.equal(parsed.analysis.readinessBlocked.length, 1, 'json output should expose readiness blockers');

  const override = execFileSync(process.execPath, [
    path.join(__dirname, 'fleet-steward.js'),
    '--project-root',
    tempRoot,
    '--session',
    sessionFile,
    '--override-readiness',
  ], { encoding: 'utf8' });
  assert(override.includes('#2 UI [pending] - wave 1'), 'override should restore readiness-blocked task to ready list');

  execFileSync(process.execPath, [
    path.join(__dirname, 'fleet-steward.js'),
    '--project-root',
    tempRoot,
    '--session',
    sessionFile,
    '--mark-failed',
    '2',
    '--reason',
    'UI validator failed',
    '--write',
  ], { encoding: 'utf8' });
  const afterWrite = fs.readFileSync(sessionFile, 'utf8');
  assert(afterWrite.includes('| 2 | UI | src/ui | 1 | failed | 1 | build | codex/fleet-ui | UI validator failed |'));
  assert(afterWrite.includes('Repairs #2: UI validator failed'));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('fleet session tests passed');
