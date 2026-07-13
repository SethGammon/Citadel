#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const operations = require('../core/operations');

const NOW = '2026-07-13T12:00:00.000Z';
const LATER = '2026-07-13T12:02:00.000Z';
const ARTIFACT = operations.sha256Digest({ tests: 'passed' });

function fixture() {
  const operation = {
    protocol_version: '0.1', kind: 'operation_spec', operation_id: 'operation-release',
    title: 'Verify release', objective_digest: operations.sha256Digest({ objective: 'release' }),
    step_ids: ['step-test'], policy_digests: [], created_at: NOW,
  };
  const run = {
    protocol_version: '0.1', kind: 'operation_run', run_id: 'run-release',
    operation_id: operation.operation_id, spec_digest: operations.sha256Digest(operation),
    status: 'passed', started_at: NOW, completed_at: LATER,
    intent_ids: ['intent-release'], step_attempt_ids: ['attempt-release-1'],
  };
  const evidence = {
    protocol_version: '0.1', kind: 'evidence_envelope', evidence_id: 'evidence-release',
    run_id: run.run_id, step_attempt_id: 'attempt-release-1', evidence_type: 'test',
    status: 'passed', subject_digest: operations.requiredStepSubject(operation, 'step-test'), artifact_digest: ARTIFACT,
    recorded_at: LATER, redacted: true,
  };
  return { operation, run, evidence };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  PASS ${name}\n`);
}

test('receipt generation is deterministic and evidence-order independent', () => {
  const { operation, run, evidence } = fixture();
  const second = { ...evidence, evidence_id: 'evidence-review', evidence_type: 'review', artifact_digest: operations.sha256Digest({ review: 'passed' }) };
  const options = { operation, run, evidence: [evidence, second], issuedAt: LATER, issuerId: 'issuer-local' };
  const firstReceipt = operations.createExecutionReceipt(options);
  const secondReceipt = operations.createExecutionReceipt({ ...options, evidence: [second, evidence] });
  assert.deepEqual(firstReceipt, secondReceipt);
  assert.equal(firstReceipt.status, 'passed');
  assert.match(firstReceipt.receipt_id, /^receipt-[a-f0-9]{24}$/);
});

test('missing or nonpassing evidence makes a claimed pass unknown', () => {
  const { operation, run, evidence } = fixture();
  const missing = operations.createExecutionReceipt({ operation, run, evidence: [], issuedAt: LATER, issuerId: 'issuer-local' });
  assert.equal(missing.status, 'unknown');
  const blockedEvidence = { ...evidence, status: 'blocked', artifact_digest: null };
  const blocked = operations.createExecutionReceipt({ operation, run, evidence: [blockedEvidence], issuedAt: LATER, issuerId: 'issuer-local' });
  assert.equal(blocked.status, 'unknown');
});

test('passed receipts require every operation step and a distinct bound attempt', () => {
  const { operation: baseOperation, run: baseRun, evidence } = fixture();
  const operation = { ...baseOperation, step_ids: ['step-test', 'step-review'] };
  const run = { ...baseRun, spec_digest: operations.sha256Digest(operation),
    step_attempt_ids: ['attempt-release-1', 'attempt-review-1'] };
  const first = { ...evidence, subject_digest: operations.requiredStepSubject(operation, 'step-test') };
  const missing = operations.createExecutionReceipt({ operation, run, evidence: [first], issuedAt: LATER, issuerId: 'issuer-local' });
  assert.equal(missing.status, 'unknown');
  const second = { ...first, evidence_id: 'evidence-review', step_attempt_id: 'attempt-review-1',
    evidence_type: 'review', subject_digest: operations.requiredStepSubject(operation, 'step-review'),
    artifact_digest: operations.sha256Digest({ review: 'passed' }) };
  const complete = operations.createExecutionReceipt({ operation, run, evidence: [first, second], issuedAt: LATER, issuerId: 'issuer-local' });
  assert.equal(complete.status, 'passed');
  const reusedAttempt = { ...second, step_attempt_id: first.step_attempt_id };
  const reused = operations.createExecutionReceipt({ operation, run, evidence: [first, reusedAttempt], issuedAt: LATER, issuerId: 'issuer-local' });
  assert.equal(reused.status, 'unknown');
});

test('absent, null, wrong, and duplicate evidence cannot manufacture a pass', () => {
  const { operation, run, evidence } = fixture();
  const common = { operation, run, issuedAt: LATER, issuerId: 'issuer-local' };
  assert.equal(operations.createExecutionReceipt(common).status, 'unknown');
  assert.equal(operations.createExecutionReceipt({ ...common, evidence: null }).status, 'unknown');
  const wrongSubject = { ...evidence, subject_digest: operations.sha256Digest({ operation_id: operation.operation_id, step_id: 'step-wrong' }) };
  assert.equal(operations.createExecutionReceipt({ ...common, evidence: [wrongSubject] }).status, 'unknown');
  assert.throws(() => operations.createExecutionReceipt({ ...common,
    evidence: [{ ...evidence, step_attempt_id: 'attempt-not-in-run' }] }), /not a member/);
  assert.throws(() => operations.createExecutionReceipt({ ...common, evidence: [evidence, { ...evidence }] }), /duplicate evidence_id/);
  assert.throws(() => operations.createExecutionReceipt({ ...common,
    run: { ...run, operation_id: 'operation-other' }, evidence: [evidence] }), /operation_id/);
});

test('Ed25519 signatures verify only against an explicit trusted key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { operation, run, evidence } = fixture();
  const receipt = operations.createExecutionReceipt({ operation, run, evidence: [evidence], issuedAt: LATER, issuerId: 'issuer-local' });
  const signed = operations.signExecutionReceipt(receipt, privateKey);
  assert.equal(operations.verifyExecutionReceipt(signed, { publicKey }).status, 'verified');
  const untrusted = operations.verifyExecutionReceipt(signed);
  assert.equal(untrusted.status, 'unknown');
  assert.equal(untrusted.cryptographically_valid, true);
  const unsigned = operations.verifyExecutionReceipt(operations.unsignedReceiptEnvelope(receipt), { publicKey });
  assert.equal(unsigned.status, 'unsigned');
});

test('tampering and privacy-field expansion are invalid', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { operation, run, evidence } = fixture();
  const receipt = operations.createExecutionReceipt({ operation, run, evidence: [evidence], issuedAt: LATER, issuerId: 'issuer-local' });
  const signed = operations.signExecutionReceipt(receipt, privateKey);
  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.receipt.status = 'failed';
  assert.equal(operations.verifyExecutionReceipt(tampered, { publicKey }).status, 'invalid');
  const expanded = { ...signed, prompt: 'private prompt' };
  assert.equal(operations.verifyExecutionReceipt(expanded, { publicKey }).status, 'invalid');
  assert.match(operations.validateReceiptEnvelope(expanded).join('; '), /privacy allowlist/);
});

test('offline CLI verification returns a trusted verified result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-receipt-cli-'));
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const { operation, run, evidence } = fixture();
    const receipt = operations.createExecutionReceipt({ operation, run, evidence: [evidence], issuedAt: LATER, issuerId: 'issuer-local' });
    const signed = operations.signExecutionReceipt(receipt, privateKey);
    const receiptPath = path.join(root, 'receipt.json');
    const keyPath = path.join(root, 'public.pem');
    fs.writeFileSync(receiptPath, JSON.stringify(signed));
    fs.writeFileSync(keyPath, publicKey.export({ type: 'spki', format: 'pem' }));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'receipt.js'), 'verify', '--input', receiptPath, '--public-key', keyPath], {
      encoding: 'utf8', env: { PATH: '' },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

process.stdout.write(`Operation receipt tests: ${passed} passed.\n`);
