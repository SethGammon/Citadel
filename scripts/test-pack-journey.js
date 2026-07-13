#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const operations = require('../core/operations');
const { completePackJourney, createPackJourney } = require('../core/packs/journey');

const sourceRoot = path.resolve(__dirname, '..');
const createdAt = '2026-07-13T18:00:00.000Z';
const completedAt = '2026-07-13T18:05:00.000Z';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-pack-journey-'));

try {
  const started = createPackJourney({ sourceProjectRoot: sourceRoot,
    packRoot: path.join(sourceRoot, 'packs', 'ci-recovery'), projectRoot: root,
    runtime: 'codex', runId: 'run-ci-recovery-test', createdAt });
  assert.equal(started.run.status, 'running');
  assert.equal(started.operation.step_ids.length, 4);
  assert(fs.existsSync(started.paths.spec));
  assert.throws(() => createPackJourney({ sourceProjectRoot: sourceRoot,
    packRoot: path.join(sourceRoot, 'packs', 'ci-recovery'), projectRoot: root,
    runtime: 'unsupported', runId: 'run-invalid', createdAt }), /does not support runtime/);

  const digest = `sha256:${'a'.repeat(64)}`;
  const evidence = started.operation.step_ids.map((stepId) => ({
    step_id: stepId, status: 'passed', evidence_type: 'test', artifact_digest: digest,
  }));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const completed = completePackJourney({ projectRoot: root, runId: started.run.run_id,
    evidence, completedAt, privateKey });
  assert.equal(completed.run.status, 'passed');
  assert.equal(completed.receipt.status, 'passed');
  assert.equal(operations.verifyExecutionReceipt(completed.envelope, { publicKey }).status, 'verified');
  assert(fs.existsSync(completed.receiptPath));
  assert(fs.readFileSync(completed.handoffPath, 'utf8').includes('Status: passed'));
  assert.throws(() => completePackJourney({ projectRoot: root, runId: started.run.run_id,
    evidence, completedAt }), /not running/);

  const unknown = createPackJourney({ sourceProjectRoot: sourceRoot,
    packRoot: path.join(sourceRoot, 'packs', 'migration-campaign'), projectRoot: root,
    runtime: 'claude-code', runId: 'run-migration-unknown', createdAt });
  const partial = completePackJourney({ projectRoot: root, runId: unknown.run.run_id,
    evidence: [], completedAt });
  assert.equal(partial.run.status, 'unknown');
  assert.equal(partial.receipt.status, 'unknown');
  assert(partial.evidence.every((item) => item.status === 'unknown'));

  const invalid = createPackJourney({ sourceProjectRoot: sourceRoot,
    packRoot: path.join(sourceRoot, 'packs', 'release-steward'), projectRoot: root,
    runtime: 'codex', runId: 'run-release-invalid', createdAt });
  assert.throws(() => completePackJourney({ projectRoot: root, runId: invalid.run.run_id,
    evidence: [{ step_id: invalid.operation.step_ids[0], status: 'passed', evidence_type: 'test' }],
    completedAt }), /requires artifact_digest/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Pack journey and receipt integration tests passed');
