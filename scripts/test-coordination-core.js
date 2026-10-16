#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { getCoordinationPaths, readJson, STALE_INSTANCE_MS } = require('../core/coordination/io');
const { registerInstance, heartbeatInstance, unregisterInstance, getCoordinationStatus } = require('../core/coordination/instances');
const { claimScope, findOverlap, getClaimStatus, releaseClaim, scopesOverlap } = require('../core/coordination/claims');
const { sweepStaleInstances } = require('../core/coordination/sweep');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-coordination-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempProject((projectRoot) => {
  const nowMs = Date.now();
  const freshStart = new Date(nowMs - 5 * 60 * 1000).toISOString();
  const freshHeartbeat = new Date(nowMs - 60 * 1000).toISOString();
  const staleSeen = new Date(nowMs - STALE_INSTANCE_MS - 60 * 1000).toISOString();

  assert.equal(scopesOverlap(['src/app'], ['src']), true, 'parent-child scopes should overlap');
  assert.equal(scopesOverlap(['src(read-only)'], ['src']), false, 'read-only scope should not block');
  const scopeCases = [
    ['same path', 'src/core', 'src/core', true],
    ['Windows separator', 'src/core', 'src\\core', true],
    ['dot prefix', 'src/core', './src/core', true],
    ['dot segments', 'src/core', 'src/other/../core', true],
    ['case aliases on every host', 'src/API', 'src/api', true],
    ['trailing separator', 'src/core/', 'src/core', true],
    ['nested glob directory', 'src/api/**', 'src/api/auth', true],
    ['partial glob segment', 'src/api*', 'src/api-client', true],
    ['directory siblings', 'src/api', 'src/api-client', false],
    ['file siblings', 'src/api.js', 'src/api.json', false],
    ['glob directory sibling', 'src/api/**', 'src/api-client', false],
    ['root path', '.', 'src/api', true],
    ['universal glob', '**/*.js', 'src/api', true],
    ['read-only trailing space', 'src (read-only) ', 'src/api', false],
  ];
  for (const [label, left, right, expected] of scopeCases) {
    assert.equal(scopesOverlap([left], [right]), expected, label);
    assert.equal(scopesOverlap([right], [left]), expected, `${label} reversed`);
  }

  const instance = registerInstance('agent-a', { projectRoot, now: freshStart, pid: process.pid });
  assert.equal(instance.instanceId, 'agent-a');

  const afterHeartbeat = heartbeatInstance('agent-a', { projectRoot, now: freshHeartbeat });
  assert.equal(afterHeartbeat.lastSeen, freshHeartbeat);

  const claim = claimScope('agent-a', ['src/core'], 'build', 'Implement core extraction', {
    projectRoot,
    now: freshHeartbeat,
  });
  assert.equal(claim.type, 'build');
  assert(findOverlap(['src'], { projectRoot }), 'broader scope should overlap with existing claim');
  const cli = (command, scope) => spawnSync(process.execPath, [
    path.join(__dirname, 'coordination.js'), command, '--id', 'alias-worker', '--scope', scope,
  ], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot } });
  assert.equal(cli('check-overlap', 'src\\core').status, 1, 'CLI should detect alias overlap');
  assert.equal(cli('check-overlap', 'src/core-utils').status, 0, 'CLI should allow sibling paths');
  assert.equal(cli('claim', './src/core').status, 1, 'CLI should refuse a second owner for the same path');
  assert.equal(getClaimStatus({ projectRoot }).claims.length, 1, 'refused alias claim must not be persisted');

  registerInstance('agent-b', { projectRoot, now: staleSeen, pid: 999999 });
  let overlapError = null;
  try {
    claimScope('agent-b', ['src'], 'review', 'Try conflicting scope', { projectRoot });
  } catch (error) {
    overlapError = error;
  }
  assert(overlapError, 'overlapping claim should throw');
  assert.equal(overlapError.code, 'SCOPE_OVERLAP');

  claimScope('agent-b', ['docs'], 'review', 'Non-conflicting scope', { projectRoot });
  const status = {
    ...getCoordinationStatus({ projectRoot }),
    ...getClaimStatus({ projectRoot }),
  };
  assert.equal(status.instances.length, 2, 'two instances should be registered');
  assert.equal(status.claims.length, 2, 'two claims should be present');

  const paths = getCoordinationPaths(projectRoot);
  const staleRecord = readJson(path.join(paths.instancesDir, 'agent-b.json'));
  staleRecord.lastSeen = staleSeen;
  fs.writeFileSync(path.join(paths.instancesDir, 'agent-b.json'), JSON.stringify(staleRecord, null, 2));

  const sweep = sweepStaleInstances({ projectRoot, nowMs });
  assert.equal(sweep.cleaned, 1, 'one stale instance should be swept');
  assert.equal(sweep.swept[0].instanceId, 'agent-b');

  const released = releaseClaim('agent-a', { projectRoot });
  assert.equal(released.instanceId, 'agent-a', 'release should return the removed claim');
  unregisterInstance('agent-a', { projectRoot });

  const finalStatus = {
    ...getCoordinationStatus({ projectRoot }),
    ...getClaimStatus({ projectRoot }),
  };
  assert.equal(finalStatus.instances.length, 0, 'all instances should be removed by the end');
  assert.equal(finalStatus.claims.length, 0, 'all claims should be removed by the end');
});

console.log('coordination core tests passed');
