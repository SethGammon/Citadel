'use strict';

const {
  CONTRACT_KINDS,
  EVIDENCE_TYPES,
  EXECUTION_STATUSES,
  FIELD_ALLOWLISTS,
  INTENT_ACTIONS,
  PROTOCOL_VERSION,
  TERMINAL_STATUSES,
} = require('./constants');

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, kind, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${kind} must be a plain object`);
    return false;
  }
  const expected = FIELD_ALLOWLISTS[kind];
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    errors.push(`${kind} fields must exactly match the privacy-safe allowlist`);
  }
  return true;
}

function baseErrors(value, kind) {
  const errors = [];
  if (!exactFields(value, kind, errors)) return errors;
  if (value.protocol_version !== PROTOCOL_VERSION) errors.push(`protocol_version must be ${PROTOCOL_VERSION}`);
  if (value.kind !== kind) errors.push(`kind must be ${kind}`);
  return errors;
}

function checkId(value, label, errors) {
  if (typeof value !== 'string' || value.length > 128 || !ID_PATTERN.test(value)) {
    errors.push(`${label} must be an opaque lowercase identifier`);
  }
}

function checkDigest(value, label, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) errors.push(`${label} must be a sha256 digest`);
}

function checkTimestamp(value, label, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    errors.push(`${label} must be an ISO timestamp`);
    return;
  }
  if (new Date(value).toISOString() !== value) errors.push(`${label} must be a canonical ISO timestamp`);
}

function checkUniqueArray(value, label, errors, checkEntry, options = {}) {
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 256;
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    errors.push(`${label} must contain ${minimum} to ${maximum} entries`);
    return;
  }
  const unique = new Set();
  value.forEach((entry, index) => {
    checkEntry(entry, `${label}[${index}]`, errors);
    if (unique.has(entry)) errors.push(`${label} cannot contain duplicates`);
    unique.add(entry);
  });
}

function checkExecutionTiming(value, errors) {
  if (!EXECUTION_STATUSES.includes(value.status)) {
    errors.push(`status must be one of ${EXECUTION_STATUSES.join(', ')}`);
    return;
  }
  checkTimestamp(value.started_at, 'started_at', errors, true);
  checkTimestamp(value.completed_at, 'completed_at', errors, true);
  if (value.status === 'pending' && (value.started_at !== null || value.completed_at !== null)) {
    errors.push('pending records cannot have execution timestamps');
  }
  if (value.status === 'running' && (value.started_at === null || value.completed_at !== null)) {
    errors.push('running records require started_at and prohibit completed_at');
  }
  if (['passed', 'failed', 'unknown'].includes(value.status)
    && (value.started_at === null || value.completed_at === null)) {
    errors.push(`${value.status} records require started_at and completed_at`);
  }
  if (value.status === 'blocked' && value.started_at === null) errors.push('blocked records require started_at');
  if (value.started_at && value.completed_at && Date.parse(value.completed_at) < Date.parse(value.started_at)) {
    errors.push('completed_at cannot precede started_at');
  }
}

function validateOperationSpec(value) {
  const errors = baseErrors(value, CONTRACT_KINDS.OPERATION_SPEC);
  if (!isPlainObject(value)) return errors;
  checkId(value.operation_id, 'operation_id', errors);
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 || /[\r\n]/.test(value.title)) {
    errors.push('title must be a single-line safe label of 1 to 160 characters');
  }
  checkDigest(value.objective_digest, 'objective_digest', errors);
  checkUniqueArray(value.step_ids, 'step_ids', errors, checkId, { minimum: 1 });
  checkUniqueArray(value.policy_digests, 'policy_digests', errors, checkDigest, { maximum: 64 });
  checkTimestamp(value.created_at, 'created_at', errors);
  return errors;
}

function validateOperationRun(value) {
  const errors = baseErrors(value, CONTRACT_KINDS.OPERATION_RUN);
  if (!isPlainObject(value)) return errors;
  checkId(value.run_id, 'run_id', errors);
  checkId(value.operation_id, 'operation_id', errors);
  checkDigest(value.spec_digest, 'spec_digest', errors);
  checkExecutionTiming(value, errors);
  checkUniqueArray(value.intent_ids, 'intent_ids', errors, checkId, { maximum: 256 });
  checkUniqueArray(value.step_attempt_ids, 'step_attempt_ids', errors, checkId, { maximum: 1024 });
  return errors;
}

function validateStepAttempt(value) {
  const errors = baseErrors(value, CONTRACT_KINDS.STEP_ATTEMPT);
  if (!isPlainObject(value)) return errors;
  checkId(value.attempt_id, 'attempt_id', errors);
  checkId(value.run_id, 'run_id', errors);
  checkId(value.step_id, 'step_id', errors);
  if (!Number.isInteger(value.attempt_number) || value.attempt_number < 1 || value.attempt_number > 10000) {
    errors.push('attempt_number must be an integer from 1 to 10000');
  }
  checkExecutionTiming(value, errors);
  checkUniqueArray(value.evidence_ids, 'evidence_ids', errors, checkId, { maximum: 1024 });
  if (value.failure_code !== null && (typeof value.failure_code !== 'string' || !CODE_PATTERN.test(value.failure_code))) {
    errors.push('failure_code must be null or a bounded uppercase code');
  }
  if (value.status === 'failed' && value.failure_code === null) errors.push('failed attempts require failure_code');
  if (value.status !== 'failed' && value.failure_code !== null) errors.push('failure_code is only valid for failed attempts');
  return errors;
}

function validateIntent(value) {
  const errors = baseErrors(value, CONTRACT_KINDS.INTENT);
  if (!isPlainObject(value)) return errors;
  checkId(value.intent_id, 'intent_id', errors);
  checkId(value.operation_id, 'operation_id', errors);
  if (!INTENT_ACTIONS.includes(value.action)) errors.push(`action must be one of ${INTENT_ACTIONS.join(', ')}`);
  checkId(value.actor_id, 'actor_id', errors);
  checkDigest(value.scope_digest, 'scope_digest', errors);
  checkTimestamp(value.created_at, 'created_at', errors);
  checkTimestamp(value.expires_at, 'expires_at', errors, true);
  if (value.expires_at && value.created_at && Date.parse(value.expires_at) <= Date.parse(value.created_at)) {
    errors.push('expires_at must be later than created_at');
  }
  return errors;
}

function validateEvidenceEnvelope(value) {
  const errors = baseErrors(value, CONTRACT_KINDS.EVIDENCE_ENVELOPE);
  if (!isPlainObject(value)) return errors;
  checkId(value.evidence_id, 'evidence_id', errors);
  checkId(value.run_id, 'run_id', errors);
  if (value.step_attempt_id !== null) checkId(value.step_attempt_id, 'step_attempt_id', errors);
  if (!EVIDENCE_TYPES.includes(value.evidence_type)) errors.push(`evidence_type must be one of ${EVIDENCE_TYPES.join(', ')}`);
  if (!TERMINAL_STATUSES.includes(value.status)) errors.push(`status must be one of ${TERMINAL_STATUSES.join(', ')}`);
  checkDigest(value.subject_digest, 'subject_digest', errors);
  checkDigest(value.artifact_digest, 'artifact_digest', errors, true);
  if (value.status === 'passed' && value.artifact_digest === null) errors.push('passed evidence requires artifact_digest');
  checkTimestamp(value.recorded_at, 'recorded_at', errors);
  if (typeof value.redacted !== 'boolean') errors.push('redacted must be boolean');
  return errors;
}

function validateExecutionReceipt(value) {
  const errors = baseErrors(value, CONTRACT_KINDS.EXECUTION_RECEIPT);
  if (!isPlainObject(value)) return errors;
  checkId(value.receipt_id, 'receipt_id', errors);
  checkId(value.run_id, 'run_id', errors);
  checkDigest(value.operation_digest, 'operation_digest', errors);
  checkDigest(value.run_digest, 'run_digest', errors);
  if (!TERMINAL_STATUSES.includes(value.status)) errors.push(`status must be one of ${TERMINAL_STATUSES.join(', ')}`);
  checkUniqueArray(value.evidence_digests, 'evidence_digests', errors, checkDigest, { maximum: 2048 });
  if (value.status === 'passed' && Array.isArray(value.evidence_digests) && value.evidence_digests.length === 0) {
    errors.push('passed receipts require evidence_digests');
  }
  checkTimestamp(value.issued_at, 'issued_at', errors);
  checkId(value.issuer_id, 'issuer_id', errors);
  return errors;
}

const VALIDATORS = Object.freeze({
  [CONTRACT_KINDS.OPERATION_SPEC]: validateOperationSpec,
  [CONTRACT_KINDS.OPERATION_RUN]: validateOperationRun,
  [CONTRACT_KINDS.STEP_ATTEMPT]: validateStepAttempt,
  [CONTRACT_KINDS.INTENT]: validateIntent,
  [CONTRACT_KINDS.EVIDENCE_ENVELOPE]: validateEvidenceEnvelope,
  [CONTRACT_KINDS.EXECUTION_RECEIPT]: validateExecutionReceipt,
});

function validateOperationContract(value) {
  if (!isPlainObject(value)) return ['operation contract must be a plain object'];
  const validator = VALIDATORS[value.kind];
  if (!validator) return [`unknown operation contract kind: ${value.kind || '(missing)'}`];
  return validator(value);
}

function assertValidOperationContract(value) {
  const errors = validateOperationContract(value);
  if (errors.length) throw new TypeError(`Invalid ${value?.kind || 'operation contract'}: ${errors.join('; ')}`);
  return value;
}

module.exports = Object.freeze({
  DIGEST_PATTERN,
  ID_PATTERN,
  assertValidOperationContract,
  validateEvidenceEnvelope,
  validateExecutionReceipt,
  validateIntent,
  validateOperationContract,
  validateOperationRun,
  validateOperationSpec,
  validateStepAttempt,
});
