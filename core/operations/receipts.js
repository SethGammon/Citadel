'use strict';

const crypto = require('crypto');
const { PROTOCOL_VERSION } = require('./constants');
const { canonicalSerialize, sha256Digest } = require('./canonical');
const {
  ID_PATTERN,
  validateEvidenceEnvelope,
  validateExecutionReceipt,
  validateOperationRun,
  validateOperationSpec,
} = require('./validation');

const ENVELOPE_FIELDS = Object.freeze([
  'protocol_version', 'kind', 'receipt', 'receipt_digest', 'signature',
]);
const SIGNATURE_FIELDS = Object.freeze([
  'algorithm', 'key_id', 'public_key_spki_base64', 'signature_base64',
]);

function sameFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function requiredStepSubject(operation, stepId) {
  return sha256Digest({ operation_id: operation.operation_id, step_id: stepId });
}

function hasCompletePassedCoverage(operation, run, evidence) {
  const requiredBySubject = new Map(operation.step_ids.map((stepId) => [requiredStepSubject(operation, stepId), stepId]));
  const coveredSteps = new Set();
  const attemptBindings = new Map();
  for (const item of evidence) {
    const stepId = requiredBySubject.get(item.subject_digest);
    if (!stepId) return false;
    const existing = attemptBindings.get(item.step_attempt_id);
    if (existing && existing !== stepId) return false;
    attemptBindings.set(item.step_attempt_id, stepId);
    if (item.status === 'passed') coveredSteps.add(stepId);
  }
  return operation.step_ids.every((stepId) => coveredSteps.has(stepId));
}

function receiptStatus(run, evidence, operation = null) {
  if (run.status === 'failed') return 'failed';
  if (run.status === 'blocked') return 'blocked';
  if (run.status !== 'passed') return 'unknown';
  if (evidence.length === 0 || evidence.some((item) => item.status !== 'passed')) return 'unknown';
  if (!operation || !hasCompletePassedCoverage(operation, run, evidence)) return 'unknown';
  return 'passed';
}

function createExecutionReceipt(options) {
  const specErrors = validateOperationSpec(options.operation);
  const runErrors = validateOperationRun(options.run);
  if (specErrors.length || runErrors.length) {
    throw new TypeError(`Invalid receipt input: ${[...specErrors, ...runErrors].join('; ')}`);
  }
  if (!canonicalTimestamp(options.issuedAt)) throw new TypeError('issuedAt must be a canonical ISO timestamp');
  if (typeof options.issuerId !== 'string' || options.issuerId.length > 128 || !ID_PATTERN.test(options.issuerId)) {
    throw new TypeError('issuerId must be an opaque lowercase identifier');
  }
  const operationDigest = sha256Digest(options.operation);
  if (options.run.operation_id !== options.operation.operation_id) {
    throw new TypeError('run operation_id does not identify the operation');
  }
  if (options.run.spec_digest !== operationDigest) throw new TypeError('run spec_digest does not identify the operation');
  const evidence = options.evidence || [];
  const evidenceDigests = [];
  const evidenceIds = new Set();
  const attemptIds = new Set(options.run.step_attempt_ids);
  for (const envelope of evidence) {
    const errors = validateEvidenceEnvelope(envelope);
    if (errors.length) throw new TypeError(`Invalid evidence envelope: ${errors.join('; ')}`);
    if (envelope.run_id !== options.run.run_id) throw new TypeError('evidence run_id does not match receipt run');
    if (!attemptIds.has(envelope.step_attempt_id)) {
      throw new TypeError('evidence step_attempt_id is not a member of the receipt run');
    }
    if (evidenceIds.has(envelope.evidence_id)) throw new TypeError(`duplicate evidence_id: ${envelope.evidence_id}`);
    evidenceIds.add(envelope.evidence_id);
    evidenceDigests.push(sha256Digest(envelope));
  }
  const base = {
    protocol_version: PROTOCOL_VERSION,
    kind: 'execution_receipt',
    run_id: options.run.run_id,
    operation_digest: operationDigest,
    run_digest: sha256Digest(options.run),
    status: receiptStatus(options.run, evidence, options.operation),
    evidence_digests: [...new Set(evidenceDigests)].sort(),
    issued_at: options.issuedAt,
    issuer_id: options.issuerId,
  };
  const receipt = {
    ...base,
    receipt_id: `receipt-${sha256Digest(base).slice('sha256:'.length, 'sha256:'.length + 24)}`,
  };
  const errors = validateExecutionReceipt(receipt);
  if (errors.length) throw new TypeError(`Invalid generated receipt: ${errors.join('; ')}`);
  return Object.freeze(receipt);
}

function unsignedReceiptEnvelope(receipt) {
  const errors = validateExecutionReceipt(receipt);
  if (errors.length) throw new TypeError(`Invalid receipt: ${errors.join('; ')}`);
  return Object.freeze({
    protocol_version: PROTOCOL_VERSION,
    kind: 'execution_receipt_envelope',
    receipt,
    receipt_digest: sha256Digest(receipt),
    signature: null,
  });
}

function publicKeyDer(key) {
  const publicKey = key && key.type === 'public' ? key : crypto.createPublicKey(key);
  return publicKey.export({ type: 'spki', format: 'der' });
}

function keyIdFor(publicDer) {
  return `key-${crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 24)}`;
}

function signExecutionReceipt(receipt, privateKey, options = {}) {
  const envelope = unsignedReceiptEnvelope(receipt);
  const key = privateKey && privateKey.type === 'private' ? privateKey : crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Receipt signing requires an Ed25519 private key');
  const publicDer = publicKeyDer(key);
  const keyId = options.keyId || keyIdFor(publicDer);
  if (typeof keyId !== 'string' || keyId.length > 128 || !ID_PATTERN.test(keyId)) throw new TypeError('keyId is invalid');
  const signature = crypto.sign(null, Buffer.from(canonicalSerialize(receipt), 'utf8'), key).toString('base64');
  return Object.freeze({
    ...envelope,
    signature: Object.freeze({
      algorithm: 'ed25519',
      key_id: keyId,
      public_key_spki_base64: publicDer.toString('base64'),
      signature_base64: signature,
    }),
  });
}

function validateReceiptEnvelope(envelope) {
  const errors = [];
  if (!sameFields(envelope, ENVELOPE_FIELDS)) return ['receipt envelope fields must exactly match the privacy allowlist'];
  if (envelope.protocol_version !== PROTOCOL_VERSION) errors.push(`protocol_version must be ${PROTOCOL_VERSION}`);
  if (envelope.kind !== 'execution_receipt_envelope') errors.push('kind must be execution_receipt_envelope');
  errors.push(...validateExecutionReceipt(envelope.receipt));
  if (envelope.receipt_digest !== sha256Digest(envelope.receipt)) errors.push('receipt_digest does not match receipt');
  if (envelope.signature === null) return errors;
  if (!sameFields(envelope.signature, SIGNATURE_FIELDS)) {
    errors.push('signature fields must exactly match the privacy allowlist');
    return errors;
  }
  if (envelope.signature.algorithm !== 'ed25519') errors.push('signature algorithm must be ed25519');
  if (typeof envelope.signature.key_id !== 'string' || !ID_PATTERN.test(envelope.signature.key_id)) errors.push('signature key_id is invalid');
  for (const field of ['public_key_spki_base64', 'signature_base64']) {
    if (typeof envelope.signature[field] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature[field])) {
      errors.push(`${field} must be canonical base64`);
    }
  }
  return errors;
}

function result(status, envelope, reasonCode, extra = {}) {
  return Object.freeze({
    status,
    receipt_status: envelope?.receipt?.status || 'unknown',
    reason_code: reasonCode,
    key_id: envelope?.signature?.key_id || null,
    ...extra,
  });
}

function verifyExecutionReceipt(envelope, options = {}) {
  try {
    const errors = validateReceiptEnvelope(envelope);
    if (errors.length) return result('invalid', envelope, 'INVALID_ENVELOPE');
    if (envelope.signature === null) return result('unsigned', envelope, 'SIGNATURE_MISSING');
    const embeddedDer = Buffer.from(envelope.signature.public_key_spki_base64, 'base64');
    const embeddedKey = crypto.createPublicKey({ key: embeddedDer, type: 'spki', format: 'der' });
    if (embeddedKey.asymmetricKeyType !== 'ed25519') return result('invalid', envelope, 'INVALID_KEY_TYPE');
    const bytes = Buffer.from(canonicalSerialize(envelope.receipt), 'utf8');
    const signature = Buffer.from(envelope.signature.signature_base64, 'base64');
    if (!crypto.verify(null, bytes, embeddedKey, signature)) return result('invalid', envelope, 'SIGNATURE_INVALID');
    if (!options.publicKey) {
      return result('unknown', envelope, 'SIGNER_NOT_TRUSTED', { cryptographically_valid: true });
    }
    const trustedKey = options.publicKey && options.publicKey.type === 'public'
      ? options.publicKey : crypto.createPublicKey(options.publicKey);
    if (trustedKey.asymmetricKeyType !== 'ed25519') return result('invalid', envelope, 'INVALID_TRUSTED_KEY_TYPE');
    const trustedDer = trustedKey.export({ type: 'spki', format: 'der' });
    if (!crypto.timingSafeEqual(Buffer.from(trustedDer), embeddedDer)) return result('invalid', envelope, 'UNEXPECTED_SIGNER');
    if (!crypto.verify(null, bytes, trustedKey, signature)) return result('invalid', envelope, 'SIGNATURE_INVALID');
    return result('verified', envelope, 'SIGNATURE_VERIFIED', { cryptographically_valid: true });
  } catch (_error) {
    return result('invalid', envelope, 'VERIFICATION_ERROR');
  }
}

module.exports = Object.freeze({
  ENVELOPE_FIELDS,
  SIGNATURE_FIELDS,
  createExecutionReceipt,
  hasCompletePassedCoverage,
  keyIdFor,
  requiredStepSubject,
  receiptStatus,
  signExecutionReceipt,
  unsignedReceiptEnvelope,
  validateReceiptEnvelope,
  verifyExecutionReceipt,
});
