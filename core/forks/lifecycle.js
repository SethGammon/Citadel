'use strict';

const operations = require('../operations');
const { assertValidFork, RUNTIMES } = require('./contracts');
const { compareFork, comparableBranch } = require('./compare');

function canonicalTime(value) {
  const time = value || new Date().toISOString();
  if (!Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time) throw new TypeError('Timestamp must be canonical ISO');
  return time;
}

function createOperationFork(options) {
  const runtimes = options.runtimes || RUNTIMES;
  if (!Array.isArray(runtimes) || runtimes.length < 2 || new Set(runtimes).size !== runtimes.length
    || runtimes.some((runtime) => !RUNTIMES.includes(runtime))) {
    throw new TypeError('Operation Fork requires at least two unique supported runtimes');
  }
  operations.assertValidOperationContract(options.operation);
  const createdAt = canonicalTime(options.createdAt);
  const contractDigest = operations.sha256Digest(options.shared);
  const fork = {
    schema_version: 1,
    fork_id: options.forkId,
    revision: 0,
    operation: options.operation,
    shared: options.shared,
    contract_digest: contractDigest,
    status: 'pending',
    created_at: createdAt,
    updated_at: createdAt,
    branches: runtimes.map((runtime) => ({
      branch_id: `branch-${runtime}`,
      runtime,
      run_id: `run-${options.forkId}-${runtime}`,
      status: 'pending',
      base_revision: options.shared.base_revision,
      worktree_ref: null,
      branch_ref: null,
      contract_digest: contractDigest,
      started_at: null,
      completed_at: null,
      receipt_digest: null,
      evidence_summary: null,
      diff_summary: null,
      duration_ms: null,
      cost: null,
      failure_code: null,
    })),
    selection: null,
    landing: null,
  };
  return assertValidFork(fork);
}

function nextFork(fork, changes, now) {
  const updated = { ...fork, ...changes, revision: fork.revision + 1, updated_at: canonicalTime(now) };
  return assertValidFork(updated);
}

function updateBranch(fork, branchId, changes, now) {
  assertValidFork(fork);
  let found = false;
  const branches = fork.branches.map((branch) => {
    if (branch.branch_id !== branchId) return branch;
    found = true;
    return { ...branch, ...changes };
  });
  if (!found) throw Object.assign(new Error(`Branch not found: ${branchId}`), { code: 'FORK_BRANCH_NOT_FOUND' });
  let status = fork.status;
  if (branches.some((branch) => branch.status === 'running')) status = 'running';
  else if (fork.selection) status = 'selected';
  else {
    const preview = assertValidFork({ ...fork, branches });
    status = compareFork(preview).comparable_count >= 2 ? 'ready'
      : branches.every((branch) => ['passed', 'failed', 'blocked', 'unknown'].includes(branch.status)) ? 'unknown' : status;
  }
  return nextFork(fork, { branches, status }, now);
}

function selectBranch(fork, options) {
  assertValidFork(fork);
  if (fork.selection && fork.selection.idempotency_key === options.idempotencyKey) {
    if (fork.selection.branch_id !== options.branchId) throw Object.assign(new Error('Idempotency key was already used for another branch'), { code: 'FORK_IDEMPOTENCY_CONFLICT' });
    return fork;
  }
  if (fork.revision !== options.expectedRevision) throw Object.assign(new Error('Fork revision changed before selection'), { code: 'FORK_REVISION_CONFLICT' });
  const branch = fork.branches.find((entry) => entry.branch_id === options.branchId);
  if (!branch) throw Object.assign(new Error(`Branch not found: ${options.branchId}`), { code: 'FORK_BRANCH_NOT_FOUND' });
  if (!comparableBranch(branch, fork).comparable) throw Object.assign(new Error('Branch cannot be selected without complete verified evidence'), { code: 'FORK_BRANCH_INCOMPARABLE' });
  const selectedAt = canonicalTime(options.selectedAt);
  const selection = {
    selection_id: `selection-${operations.sha256Digest({ fork: fork.fork_id, branch: branch.branch_id,
      key: options.idempotencyKey }).slice(7, 31)}`,
    branch_id: branch.branch_id,
    actor_id: options.actorId,
    expected_revision: options.expectedRevision,
    idempotency_key: options.idempotencyKey,
    reason_digest: operations.sha256Digest({ reason: options.reason || '' }),
    selected_at: selectedAt,
  };
  return nextFork(fork, { selection, landing: null, status: 'selected' }, selectedAt);
}

function landingConfirmation(fork, targetRevision) {
  assertValidFork(fork);
  if (!fork.selection) throw Object.assign(new Error('Select a branch before landing'), { code: 'FORK_SELECTION_REQUIRED' });
  if (typeof targetRevision !== 'string' || !/^[0-9a-f]{40,64}$/.test(targetRevision)) throw new TypeError('Target revision is invalid');
  return `land-${fork.fork_id}-${fork.revision}-${operations.sha256Digest({ targetRevision, branch: fork.selection.branch_id }).slice(7, 19)}`;
}

function prepareLanding(fork, options) {
  assertValidFork(fork);
  if (fork.landing && fork.landing.idempotency_key === options.idempotencyKey) return fork;
  if (fork.revision !== options.expectedRevision) throw Object.assign(new Error('Fork revision changed before landing'), { code: 'FORK_REVISION_CONFLICT' });
  if (!fork.selection) throw Object.assign(new Error('Select a branch before landing'), { code: 'FORK_SELECTION_REQUIRED' });
  const selected = fork.branches.find((branch) => branch.branch_id === fork.selection.branch_id);
  if (!selected || !comparableBranch(selected, fork).comparable) throw Object.assign(new Error('Selected branch is no longer comparable'), { code: 'FORK_BRANCH_INCOMPARABLE' });
  const expectedToken = landingConfirmation(fork, options.targetRevision);
  if (options.confirmation !== expectedToken) throw Object.assign(new Error('Landing confirmation is missing or stale'), { code: 'FORK_CONFIRMATION_REQUIRED', confirmation: expectedToken });
  const confirmedAt = canonicalTime(options.confirmedAt);
  const landing = {
    landing_id: `landing-${operations.sha256Digest({ fork: fork.fork_id, selection: fork.selection.selection_id,
      key: options.idempotencyKey }).slice(7, 31)}`,
    branch_id: selected.branch_id,
    status: 'prepared',
    expected_target_revision: options.targetRevision,
    result_revision: null,
    idempotency_key: options.idempotencyKey,
    confirmed_at: confirmedAt,
    completed_at: null,
    reason_code: null,
  };
  return nextFork(fork, { landing, status: 'selected' }, confirmedAt);
}

function markLandingInProgress(fork, now) {
  if (!fork.landing || fork.landing.status !== 'prepared') throw Object.assign(new Error('Landing is not prepared'), { code: 'FORK_LANDING_NOT_PREPARED' });
  return nextFork(fork, { landing: { ...fork.landing, status: 'unknown', reason_code: 'LANDING_EFFECT_IN_PROGRESS' } }, now);
}

function completeLanding(fork, options) {
  if (!fork.landing || fork.landing.status !== 'unknown' || fork.landing.reason_code !== 'LANDING_EFFECT_IN_PROGRESS') {
    throw Object.assign(new Error('Landing effect boundary is invalid'), { code: 'FORK_LANDING_STATE_INVALID' });
  }
  const completedAt = canonicalTime(options.completedAt);
  const successful = options.status === 'landed';
  const landing = { ...fork.landing, status: options.status,
    result_revision: successful ? options.resultRevision : null,
    completed_at: completedAt, reason_code: successful ? null : options.reasonCode };
  return nextFork(fork, { landing, status: successful ? 'landed' : options.status }, completedAt);
}

module.exports = Object.freeze({
  completeLanding,
  createOperationFork,
  landingConfirmation,
  markLandingInProgress,
  nextFork,
  prepareLanding,
  selectBranch,
  updateBranch,
});
