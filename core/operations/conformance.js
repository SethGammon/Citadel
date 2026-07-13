'use strict';

const { canonicalSerialize, sha256Digest } = require('./canonical');
const { PROTOCOL_VERSION } = require('./constants');
const { validateOperationContract } = require('./validation');

function runConformance(records, options = {}) {
  if (!Array.isArray(records)) throw new TypeError('Conformance records must be an array');
  const adapterId = options.adapterId || 'adapter-local';
  if (!/^[a-z][a-z0-9-]+$/.test(adapterId)) throw new TypeError('adapterId is invalid');
  const results = records.map((record, index) => {
    const errors = validateOperationContract(record);
    return Object.freeze({
      index,
      kind: record && typeof record.kind === 'string' ? record.kind : 'unknown',
      digest: record && typeof record === 'object' ? safeDigest(record) : null,
      status: errors.length === 0 ? 'passed' : 'failed',
      errors: Object.freeze([...errors]),
    });
  });
  const kinds = new Set(results.filter((result) => result.status === 'passed').map((result) => result.kind));
  const requiredKinds = ['operation_spec', 'operation_run', 'step_attempt', 'intent', 'evidence_envelope', 'execution_receipt'];
  const missingKinds = requiredKinds.filter((kind) => !kinds.has(kind));
  const passed = results.every((result) => result.status === 'passed') && missingKinds.length === 0;
  const report = {
    protocol_version: PROTOCOL_VERSION,
    adapter_id: adapterId,
    status: passed ? 'passed' : 'failed',
    record_count: records.length,
    passed_count: results.filter((result) => result.status === 'passed').length,
    failed_count: results.filter((result) => result.status === 'failed').length,
    required_kinds: requiredKinds,
    missing_kinds: missingKinds,
    results,
  };
  return Object.freeze({ ...report, report_digest: sha256Digest(report) });
}

function safeDigest(value) {
  try {
    canonicalSerialize(value);
    return sha256Digest(value);
  } catch (_error) {
    return null;
  }
}

module.exports = Object.freeze({ runConformance });
