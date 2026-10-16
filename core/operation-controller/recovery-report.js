'use strict';

const { digest, COST_LENSES } = require('./contracts');

function recoveryReport(request, files, verification, durationMs) {
  const report = {
    schema: 1, kind: 'citadel_operation_recovery_report', operation_id: request.operation_id,
    request_digest: digest(request), status: 'passed',
    recovery: { kind: 'workspace-postconditions', files, adapter_reexecuted: false, original_execution: 'unknown', duration_ms: durationMs },
    verification, attempts: [],
    costs: Object.fromEntries(COST_LENSES.map(lens => [lens, { status: 'unknown', amount_usd: null, basis: 'observed', source: 'original execution interrupted; costs unavailable' }])),
    trust: { integrity: 'digest-bound', signer: 'unsigned', outcome: 'postconditions-independently-verified' },
  };
  return { ...report, report_digest: digest(report) };
}

function verifyRecoveryReport(report) {
  const { report_digest: claimed, ...unsigned } = report;
  // A recovered postcondition must never masquerade as an observed adapter run:
  // require independent verification, no invented attempts, and unknown costs.
  const isDigest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const files = report.recovery?.files;
  const validFiles = Array.isArray(files) && files.length > 0 && files.length <= 64 && files.every(file =>
    file && typeof file.path === 'string' && file.path.length > 0 && !/[\\:]/.test(file.path)
    && !file.path.split('/').some(part => !part || part === '.' || part === '..')
    && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256))
    && new Set(files.map(file => file.path.toLowerCase())).size === files.length;
  const valid = report.schema === 1 && claimed === digest(unsigned) && report.status === 'passed'
    && typeof report.operation_id === 'string' && /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(report.operation_id)
    && isDigest(report.request_digest) && validFiles
    && report.recovery?.kind === 'workspace-postconditions' && report.recovery.adapter_reexecuted === false
    && report.recovery.original_execution === 'unknown' && Array.isArray(report.recovery.files) && report.recovery.files.length > 0
    && Number.isFinite(report.recovery.duration_ms) && report.recovery.duration_ms >= 0
    && Array.isArray(report.attempts) && report.attempts.length === 0
    && report.verification?.kind === 'command' && report.verification.exit_code === 0 && report.verification.artifact_coverage === 'passed'
    && isDigest(report.verification.output_digest) && isDigest(report.verification.changed_paths_digest)
    && isDigest(report.verification.required_paths_digest)
    && COST_LENSES.every(lens => report.costs?.[lens]?.status === 'unknown' && report.costs[lens].amount_usd === null);
  return { status: valid ? 'verified' : 'invalid', reason_code: valid ? 'RECOVERY_REPORT_DIGEST_VERIFIED' : 'RECOVERY_REPORT_INVALID', signer_trust: 'unknown' };
}

module.exports = { recoveryReport, verifyRecoveryReport };
