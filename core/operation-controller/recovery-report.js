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
  const valid = report.schema === 1 && claimed === digest(unsigned) && report.status === 'passed'
    && report.recovery?.kind === 'workspace-postconditions' && report.recovery.adapter_reexecuted === false
    && report.recovery.original_execution === 'unknown' && Array.isArray(report.recovery.files) && report.recovery.files.length > 0
    && Array.isArray(report.attempts) && report.attempts.length === 0
    && report.verification?.kind === 'command' && report.verification.exit_code === 0 && report.verification.artifact_coverage === 'passed'
    && COST_LENSES.every(lens => report.costs?.[lens]?.status === 'unknown' && report.costs[lens].amount_usd === null);
  return { status: valid ? 'verified' : 'invalid', reason_code: valid ? 'RECOVERY_REPORT_DIGEST_VERIFIED' : 'RECOVERY_REPORT_INVALID', signer_trust: 'unknown' };
}

module.exports = { recoveryReport, verifyRecoveryReport };
