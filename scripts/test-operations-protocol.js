#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const operations = require('../core/operations');
const publicContracts = require('../packages/contracts');

const NOW = '2026-07-13T12:00:00.000Z';
const LATER = '2026-07-13T12:01:00.000Z';
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

const fixtures = {
  operation_spec: {
    protocol_version: '0.1', kind: 'operation_spec', operation_id: 'operation-demo',
    title: 'Verify the release', objective_digest: DIGEST_A,
    step_ids: ['step-test', 'step-package'], policy_digests: [DIGEST_B], created_at: NOW,
  },
  operation_run: {
    protocol_version: '0.1', kind: 'operation_run', run_id: 'run-demo',
    operation_id: 'operation-demo', spec_digest: DIGEST_A, status: 'running',
    started_at: NOW, completed_at: null, intent_ids: ['intent-start'],
    step_attempt_ids: ['attempt-test-1'],
  },
  step_attempt: {
    protocol_version: '0.1', kind: 'step_attempt', attempt_id: 'attempt-test-1',
    run_id: 'run-demo', step_id: 'step-test', attempt_number: 1, status: 'running',
    started_at: NOW, completed_at: null, evidence_ids: [], failure_code: null,
  },
  intent: {
    protocol_version: '0.1', kind: 'intent', intent_id: 'intent-start',
    operation_id: 'operation-demo', action: 'start', actor_id: 'actor-maintainer',
    scope_digest: DIGEST_A, created_at: NOW, expires_at: LATER,
  },
  evidence_envelope: {
    protocol_version: '0.1', kind: 'evidence_envelope', evidence_id: 'evidence-test',
    run_id: 'run-demo', step_attempt_id: 'attempt-test-1', evidence_type: 'test',
    status: 'passed', subject_digest: DIGEST_A, artifact_digest: DIGEST_B,
    recorded_at: LATER, redacted: true,
  },
  execution_receipt: {
    protocol_version: '0.1', kind: 'execution_receipt', receipt_id: 'receipt-demo',
    run_id: 'run-demo', operation_digest: DIGEST_A, run_digest: DIGEST_B,
    status: 'passed', evidence_digests: [DIGEST_B], issued_at: LATER,
    issuer_id: 'issuer-local',
  },
};

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  PASS ${name}\n`);
}

test('all six v0.1 contract fixtures validate', () => {
  for (const value of Object.values(fixtures)) {
    assert.deepEqual(operations.validateOperationContract(value), [], value.kind);
    assert.equal(operations.assertValidOperationContract(value), value);
  }
});

test('public contracts package exports the operations surface', () => {
  assert.equal(publicContracts.operations.PROTOCOL_VERSION, '0.1');
  assert.equal(publicContracts.operations.validateOperationSpec, operations.validateOperationSpec);
});

test('canonical serialization sorts object keys and preserves array order', () => {
  const left = { z: 1, a: { y: 2, x: ['b', 'a'] } };
  const right = { a: { x: ['b', 'a'], y: 2 }, z: 1 };
  assert.equal(operations.canonicalSerialize(left), operations.canonicalSerialize(right));
  assert.equal(operations.sha256Digest(left), operations.sha256Digest(right));
  assert.notEqual(operations.sha256Digest(left), operations.sha256Digest({ a: { x: ['a', 'b'], y: 2 }, z: 1 }));
  assert.match(operations.sha256Digest(left), /^sha256:[a-f0-9]{64}$/);
});

test('canonical serialization rejects values outside plain JSON', () => {
  assert.throws(() => operations.canonicalSerialize({ value: undefined }), /undefined/);
  assert.throws(() => operations.canonicalSerialize({ value: Number.NaN }), /non-finite/);
  assert.throws(() => operations.canonicalSerialize({ value: new Date(NOW) }), /plain JSON objects/);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => operations.canonicalSerialize(cycle), /cycles/);
});

test('privacy allowlists reject extra prompt, path, and content fields', () => {
  for (const forbidden of ['prompt', 'repository_path', 'artifact_content']) {
    const candidate = { ...fixtures.operation_spec, [forbidden]: 'do not export this' };
    assert.match(operations.validateOperationSpec(candidate).join('; '), /privacy-safe allowlist/);
  }
});

test('protocol versions and contract kinds fail closed', () => {
  assert.match(operations.validateOperationSpec({ ...fixtures.operation_spec, protocol_version: '1.0' }).join('; '), /protocol_version/);
  assert.match(operations.validateOperationContract({ ...fixtures.operation_spec, kind: 'future_contract' }).join('; '), /unknown operation contract kind/);
});

test('terminal truth statuses are explicit for evidence and receipts', () => {
  for (const status of ['passed', 'failed', 'blocked', 'unknown']) {
    const evidence = { ...fixtures.evidence_envelope, status, artifact_digest: status === 'passed' ? DIGEST_B : null };
    assert.deepEqual(operations.validateEvidenceEnvelope(evidence), [], status);
    const receipt = { ...fixtures.execution_receipt, status, evidence_digests: status === 'passed' ? [DIGEST_B] : [] };
    assert.deepEqual(operations.validateExecutionReceipt(receipt), [], status);
  }
  assert.match(operations.validateEvidenceEnvelope({ ...fixtures.evidence_envelope, status: 'success' }).join('; '), /status must be/);
});

test('passed evidence and receipts require proof digests', () => {
  assert.match(operations.validateEvidenceEnvelope({ ...fixtures.evidence_envelope, artifact_digest: null }).join('; '), /requires artifact_digest/);
  assert.match(operations.validateExecutionReceipt({ ...fixtures.execution_receipt, evidence_digests: [] }).join('; '), /require evidence_digests/);
});

test('execution timestamps and failure codes preserve honest state', () => {
  const failed = { ...fixtures.step_attempt, status: 'failed', completed_at: LATER, failure_code: 'TEST_FAILED' };
  assert.deepEqual(operations.validateStepAttempt(failed), []);
  assert.match(operations.validateStepAttempt({ ...failed, failure_code: null }).join('; '), /require failure_code/);
  assert.match(operations.validateOperationRun({ ...fixtures.operation_run, status: 'passed' }).join('; '), /require started_at and completed_at/);
  assert.deepEqual(operations.validateOperationRun({ ...fixtures.operation_run, status: 'blocked' }), []);
});

test('status transitions allow recovery from blocked but keep outcomes immutable', () => {
  assert.deepEqual(operations.validateStatusTransition('pending', 'running'), []);
  assert.deepEqual(operations.validateStatusTransition('running', 'blocked'), []);
  assert.deepEqual(operations.validateStatusTransition('blocked', 'running'), []);
  assert.deepEqual(operations.validateStatusTransition('passed', 'passed'), []);
  assert.match(operations.validateStatusTransition('passed', 'running').join('; '), /invalid status transition/);
  assert.match(operations.validateStatusTransition('unknown', 'passed').join('; '), /invalid status transition/);
});

test('record transitions preserve identity and use the status graph', () => {
  const completed = { ...fixtures.operation_run, status: 'passed', completed_at: LATER };
  assert.deepEqual(operations.validateOperationRunTransition(fixtures.operation_run, completed), []);
  assert.match(operations.validateOperationRunTransition(fixtures.operation_run, { ...completed, run_id: 'run-other' }).join('; '), /run_id cannot change/);
  const blocked = { ...fixtures.step_attempt, status: 'blocked' };
  assert.deepEqual(operations.validateStepAttemptTransition(fixtures.step_attempt, blocked), []);
});

test('migration is explicit, validated, and non-mutating', () => {
  const migrated = operations.migrateOperationContract(fixtures.operation_spec);
  assert.deepEqual(migrated, fixtures.operation_spec);
  assert.notEqual(migrated, fixtures.operation_spec);
  assert.throws(() => operations.migrateOperationContract({ ...fixtures.operation_spec, protocol_version: '0.0' }), /Unsupported/);
  assert.throws(() => operations.migrateOperationContract({ ...fixtures.operation_spec, title: '' }), /Invalid/);
});

test('JSON Schema declarations match executable field allowlists', () => {
  const schemaPath = path.join(__dirname, '..', 'packages', 'contracts', 'schemas', 'operations-v0.1.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const definitions = {
    operation_spec: 'OperationSpec', operation_run: 'OperationRun', step_attempt: 'StepAttempt',
    intent: 'Intent', evidence_envelope: 'EvidenceEnvelope', execution_receipt: 'ExecutionReceipt',
  };
  assert.equal(schema.$id, 'urn:citadel:operations:0.1');
  for (const [kind, definition] of Object.entries(definitions)) {
    const declared = schema.$defs[definition];
    assert.equal(declared.additionalProperties, false, definition);
    assert.deepEqual([...declared.required].sort(), [...operations.FIELD_ALLOWLISTS[kind]].sort(), definition);
    assert.deepEqual(Object.keys(declared.properties).sort(), [...operations.FIELD_ALLOWLISTS[kind]].sort(), definition);
  }
});

process.stdout.write(`Operations protocol tests: ${passed} passed.\n`);
