#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planRecovery, readJournal, sha256Digest } = require('../core/operations');
const { FAULT_BOUNDARIES, executeStepAttempt, recoverStepAttempt } = require('./operation-runner');

const NOW = '2026-07-13T12:00:00.000Z';
const EVIDENCE = sha256Digest({ external_receipt: 'recorded' });
const PAYLOAD = sha256Digest({ external_action: 'publish' });

function attempt() {
  return {
    protocol_version: '0.1', kind: 'step_attempt', attempt_id: 'attempt-publish-1',
    run_id: 'run-publish', step_id: 'step-publish', attempt_number: 1, status: 'running',
    started_at: NOW, completed_at: null, evidence_ids: [], failure_code: null,
  };
}

function options(journalDir, effect, faultAt = null) {
  return {
    journalDir, attempt: attempt(), idempotencyKey: 'publish-release',
    effectClass: 'external-nonrepeatable', payloadDigest: PAYLOAD,
    effect, faultAt, now: NOW,
  };
}

let passed = 0;
for (const boundary of FAULT_BOUNDARIES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `citadel-chaos-${boundary}-`));
  try {
    let effectCount = 0;
    assert.throws(() => executeStepAttempt(options(root, () => {
      effectCount++;
      return { evidence_digest: EVIDENCE };
    }, boundary)), /Injected fault/);

    const entries = readJournal(root).entries;
    const recovery = planRecovery(root);
    const recovered = recoverStepAttempt(options(root, () => {
      effectCount++;
      return { evidence_digest: EVIDENCE };
    }));

    if (boundary === 'before_pending_write') {
      assert.equal(entries.length, 0);
      assert.equal(recovered.execution, 'executed');
      assert.equal(effectCount, 1);
    } else if (boundary === 'after_completed_write') {
      assert.deepEqual(entries.map((entry) => entry.state), ['pending', 'completed']);
      assert.equal(recovery.status, 'complete');
      assert.equal(recovered.execution, 'skipped');
      assert.equal(effectCount, 1);
    } else {
      assert.deepEqual(entries.map((entry) => entry.state), ['pending']);
      assert.equal(recovery.status, 'blocked');
      assert.equal(recovered.execution, 'blocked');
      assert(effectCount === 0 || effectCount === 1);
    }
    assert(effectCount <= 1, `${boundary} repeated a nonrepeatable effect`);
    passed++;
    process.stdout.write(`  PASS ${boundary} recovery does not duplicate nonrepeatable work\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-chaos-missing-evidence-'));
try {
  let effects = 0;
  const outcome = executeStepAttempt(options(missingRoot, () => { effects++; return {}; }));
  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.reason_code, 'MISSING_EVIDENCE');
  assert.equal(planRecovery(missingRoot).status, 'blocked');
  assert.equal(recoverStepAttempt(options(missingRoot, () => { effects++; return { evidence_digest: EVIDENCE }; })).execution, 'blocked');
  assert.equal(effects, 1);
  passed++;
  process.stdout.write('  PASS missing evidence remains unknown and nonrepeatable\n');
} finally {
  fs.rmSync(missingRoot, { recursive: true, force: true });
}

process.stdout.write(`Operation chaos tests: ${passed} passed.\n`);
