#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BOUNDARY,
  buildEvidence,
  verify,
  verifyEvidence,
  verifyEventChain,
  writeEvidence,
} = require('./experiment-deploy-steward');

let passed = 0;
function test(name, action) {
  try {
    action();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

const evidence = buildEvidence();

test('runs three matched batches of fifteen initially valid PRs per arm', () => {
  assert.equal(evidence.raw.batches.length, 3);
  for (const batch of evidence.raw.batches) {
    assert.equal(batch.control_initial_state_sha256, batch.initial_state_sha256);
    assert.equal(batch.treatment_initial_state_sha256, batch.initial_state_sha256);
    assert.equal(batch.control.summary.initial_valid_prs, 15);
    assert.equal(batch.treatment.summary.initial_valid_prs, 15);
    verifyEventChain(batch.control);
    verifyEventChain(batch.treatment);
  }
});

test('independent loops expose deterministic stale-head races', () => {
  const metrics = evidence.result.metrics.control;
  assert.equal(metrics.landed_prs, 45);
  assert.equal(metrics.deploys, 45);
  assert.equal(metrics.race_failures, 315);
  assert.equal(metrics.stale_head_attempts, 315);
  assert.equal(metrics.stale_head_merges, 0);
  assert.equal(metrics.interventions, 315);
});

test('real leased steward treatment lands and deploys all PRs without repairs or races', () => {
  const metrics = evidence.result.metrics.treatment;
  assert.equal(metrics.landed_prs, 45);
  assert.equal(metrics.deploys, 45);
  assert.equal(metrics.deploys_per_merge, 1);
  assert.equal(metrics.branch_updates, 42);
  assert.equal(metrics.waiting_for_checks, 42);
  assert.equal(metrics.race_failures, 0);
  assert.equal(metrics.stale_head_attempts, 0);
  assert.equal(metrics.stale_head_merges, 0);
  assert.equal(metrics.repair_tasks, 0);
  for (const batch of evidence.raw.batches) {
    assert.equal(batch.treatment.summary.landed_prs, 15);
    assert.equal(batch.treatment.summary.competing_lease_attempts_blocked, 1);
    const actions = batch.treatment.events.map((entry) => entry.event.action);
    assert(actions.includes('lease-active-at-refresh'));
    assert(actions.includes('competing-lease-blocked'));
    assert(actions.includes('lease-released'));
  }
});

test('claim boundary is fake-provider only and public readiness stays blocked', () => {
  assert.deepStrictEqual(evidence.raw.boundary, BOUNDARY);
  assert.equal(evidence.result.public_arm.status, 'blocked');
  assert.equal(evidence.result.public_arm.ready, false);
  assert.deepStrictEqual(evidence.result.public_arm.gates.map((gate) => gate.id), [
    'explicit_mutation_approval',
    'authenticated_github',
    'disposable_protected_repositories',
    'github_actions',
  ]);
  assert(evidence.result.public_arm.gates.every((gate) => gate.status === 'blocked' && gate.observed === false));
  assert.match(evidence.result.claim_boundary, /not GitHub branch protection/);
  assert.match(evidence.result.claim_boundary, /real deployment evidence/);
});

test('persisted evidence is idempotent and verify replays it deterministically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-deploy-evidence-test-'));
  try {
    const paths = {
      rawPath: path.join(root, 'raw.json'),
      resultPath: path.join(root, 'result.json'),
      reportPath: path.join(root, 'report.md'),
    };
    assert.deepStrictEqual(writeEvidence(evidence, paths), {
      raw: 'created', result: 'created', report: 'created', paths,
    });
    const mtimes = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, fs.statSync(file).mtimeMs]));
    const second = writeEvidence(evidence, paths);
    assert.deepStrictEqual({ raw: second.raw, result: second.result, report: second.report }, {
      raw: 'unchanged', result: 'unchanged', report: 'unchanged',
    });
    for (const [key, file] of Object.entries(paths)) assert.equal(fs.statSync(file).mtimeMs, mtimes[key]);
    const verified = verify(paths);
    assert.equal(verified.outcome, 'verified');
    assert.equal(verified.public_arm, 'blocked');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('raw event or hash tampering is rejected', () => {
  const changed = structuredClone(evidence.raw);
  changed.batches[0].control.events[0].event.loop_count = 999;
  assert.throws(() => verifyEvidence(changed, evidence.result, ''), /event hash changed|raw evidence digest mismatch/);
});

test('aggregate result and blocked-gate tampering is rejected', () => {
  const changed = structuredClone(evidence.result);
  changed.metrics.treatment.repair_tasks = 1;
  assert.throws(() => verifyEvidence(evidence.raw, changed, ''), /results differ from deterministic replay/);
  const promoted = structuredClone(evidence.result);
  promoted.public_arm.status = 'ready';
  assert.throws(() => verifyEvidence(evidence.raw, promoted, ''), /results differ from deterministic replay/);
});

if (!process.exitCode) process.stdout.write(`\n${passed}/7 deploy-steward experiment tests passed.\n`);
