'use strict';

const operations = require('../operations');
const { assertValidFork } = require('./contracts');
const { compareFork } = require('./compare');

const SECRET_PATTERN = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[=:]|authorization\s*:|[A-Za-z]:\\|\/Users\/|\/home\/)/i;

function publicReplay(fork, events = []) {
  assertValidFork(fork);
  const comparison = compareFork(fork);
  const replay = {
    schema_version: 1,
    kind: 'operation_fork_replay',
    fork_id: fork.fork_id,
    fork_revision: fork.revision,
    operation_digest: operations.sha256Digest(fork.operation),
    contract_digest: fork.contract_digest,
    shared: {
      objective_digest: fork.shared.objective_digest,
      scope_digest: fork.shared.scope_digest,
      policy_digests: [...fork.shared.policy_digests],
      budget_digest: fork.shared.budget_digest,
      workflow_digest: fork.shared.workflow_digest,
      verifier_digest: fork.shared.verifier_digest,
    },
    status: fork.status,
    created_at: fork.created_at,
    updated_at: fork.updated_at,
    branches: fork.branches.map((branch) => ({
      branch_id: branch.branch_id,
      runtime: branch.runtime,
      status: branch.status,
      receipt_digest: branch.receipt_digest,
      evidence_summary: branch.evidence_summary,
      diff_summary: branch.diff_summary,
      duration_ms: branch.duration_ms,
      cost: branch.cost,
      failure_code: branch.failure_code,
    })),
    comparison: {
      outcome: comparison.outcome,
      recommendation: comparison.recommendation,
      comparable_count: comparison.comparable_count,
    },
    selection: fork.selection ? {
      selection_id: fork.selection.selection_id,
      branch_id: fork.selection.branch_id,
      actor_id: fork.selection.actor_id,
      selected_at: fork.selection.selected_at,
      reason_digest: fork.selection.reason_digest,
    } : null,
    landing: fork.landing ? {
      landing_id: fork.landing.landing_id,
      branch_id: fork.landing.branch_id,
      status: fork.landing.status,
      result_revision_digest: fork.landing.result_revision
        ? operations.sha256Digest({ revision: fork.landing.result_revision }) : null,
      completed_at: fork.landing.completed_at,
      reason_code: fork.landing.reason_code,
    } : null,
    events: events.map((event) => ({
      event_id: event.event_id,
      fork_revision: event.fork_revision,
      type: event.type,
      branch_id: event.branch_id,
      status: event.status,
      recorded_at: event.recorded_at,
      detail_digest: event.detail_digest,
    })),
  };
  const serialized = operations.canonicalSerialize(replay);
  if (SECRET_PATTERN.test(serialized)) throw Object.assign(new Error('Replay contains a secret-like or path-like value'), { code: 'FORK_REPLAY_REDACTION_FAILED' });
  return Object.freeze({ replay: Object.freeze(replay), digest: operations.sha256Digest(replay), serialized });
}

module.exports = Object.freeze({ publicReplay });
