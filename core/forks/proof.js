'use strict';

const operations = require('../operations');
const { assertRedacted } = require('./redaction');
const { publicReplay } = require('./replay');

const MODEL_PROOF_STATUSES = Object.freeze(['passed', 'failed', 'unknown']);

function modelProofCounts(branches) {
  const counts = { passed: 0, failed: 0, unknown: 0 };
  for (const branch of branches) {
    const status = branch.executor && MODEL_PROOF_STATUSES.includes(branch.executor.model_status)
      ? branch.executor.model_status : 'unknown';
    counts[status] += 1;
  }
  return counts;
}

/**
 * Build a deterministic public proof artifact from the same freshly verified
 * evidence used by replay and comparison. The report adds only bounded counts
 * and embeds the already redacted replay. It never accepts stored trust flags
 * or private receipt material as a separate input.
 */
function buildProofReport(fork, events = [], options = {}) {
  const built = publicReplay(fork, events, options);
  const replay = built.replay;
  const report = {
    schema_version: 1,
    kind: 'operation_fork_proof_report',
    fork_id: replay.fork_id,
    fork_revision: replay.fork_revision,
    replay_digest: built.digest,
    summary: {
      branch_count: replay.branches.length,
      comparable_count: replay.comparison.comparable_count,
      verified_receipt_count: replay.branches.filter((branch) => (
        branch.executor && branch.executor.receipt_status === 'verified'
      )).length,
      model_proof_counts: modelProofCounts(replay.branches),
      comparison_outcome: replay.comparison.outcome,
      recommendation: replay.comparison.recommendation,
    },
    replay,
  };
  const serialized = assertRedacted(report, 'FORK_PROOF_REDACTION_FAILED');
  return Object.freeze({
    report: Object.freeze(report),
    digest: operations.sha256Digest(report),
    serialized,
  });
}

module.exports = Object.freeze({ buildProofReport });
