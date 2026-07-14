'use strict';

const fs = require('fs');
const path = require('path');
const operations = require('../operations');
const {
  appendEvent, createForkRecord, loadFork, readPrivate, saveFork, writeReceipt,
} = require('./store');
const {
  completeLanding, createOperationFork, markLandingInProgress, prepareLanding, updateBranch,
} = require('./lifecycle');
const { compareFork } = require('./compare');
const { generateSigningKey, runRuntimeBranch } = require('./runtime');
const { createGitWorktreeProvider } = require('./worktrees');

function eventFor(fork, type, options = {}) {
  const recordedAt = options.recordedAt || fork.updated_at;
  return {
    schema_version: 1,
    event_id: `event-${operations.sha256Digest({ fork: fork.fork_id, revision: fork.revision, type,
      branch: options.branchId || null, time: recordedAt }).slice(7, 31)}`,
    fork_id: fork.fork_id,
    fork_revision: fork.revision,
    type,
    branch_id: options.branchId || null,
    status: options.status || fork.status,
    recorded_at: recordedAt,
    detail_digest: operations.sha256Digest(options.detail || {}),
  };
}

function operationFrom(options, createdAt) {
  const stepIds = Array.isArray(options.workflow.steps)
    ? options.workflow.steps.map((step) => step.id) : ['step-execute', 'step-verify'];
  const operation = {
    protocol_version: operations.PROTOCOL_VERSION,
    kind: operations.CONTRACT_KINDS.OPERATION_SPEC,
    operation_id: `operation-${options.forkId}`,
    title: options.title || `Operation Fork ${options.forkId}`,
    objective_digest: operations.sha256Digest({ objective: options.objective }),
    step_ids: stepIds,
    policy_digests: (options.policies || []).map((policy) => operations.sha256Digest(policy)),
    created_at: createdAt,
  };
  operations.assertValidOperationContract(operation);
  return operation;
}

function startFork(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const provider = options.worktreeProvider || createGitWorktreeProvider({ spawn: options.spawn });
  const baseRevision = options.baseRevision || provider.currentRevision(projectRoot);
  const createdAt = options.createdAt || new Date().toISOString();
  const operation = operationFrom(options, createdAt);
  const shared = {
    objective_digest: operation.objective_digest,
    scope_digest: operations.sha256Digest(options.scope || { repository: 'current' }),
    policy_digests: operation.policy_digests,
    budget_digest: operations.sha256Digest(options.budget || { runtime_timeout_ms: 1800000 }),
    workflow_digest: operations.sha256Digest(options.workflow),
    verifier_digest: operations.sha256Digest(options.workflow.verifier),
    base_revision: baseRevision,
  };
  let fork = createOperationFork({ forkId: options.forkId, operation, shared,
    runtimes: options.runtimes, createdAt });
  const signingKey = options.signingKey || generateSigningKey();
  createForkRecord(projectRoot, fork, { objective: options.objective, signingKey, workflow: options.workflow });
  appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'fork-created', { detail: { contract_digest: fork.contract_digest } }));

  for (const pendingBranch of fork.branches) {
    const provisioned = provider.ensure({ projectRoot, worktreeRoot: options.worktreeRoot,
      forkId: fork.fork_id, branch: pendingBranch, baseRevision });
    const previousRevision = fork.revision;
    fork = updateBranch(fork, pendingBranch.branch_id, {
      worktree_ref: provisioned.worktreeRef,
      branch_ref: provisioned.branchRef,
    }, options.now ? options.now() : new Date().toISOString());
    saveFork(projectRoot, fork, previousRevision);
    appendEvent(projectRoot, fork.fork_id, eventFor(fork, provisioned.recovered ? 'worktree-recovered' : 'worktree-created', {
      branchId: pendingBranch.branch_id, status: 'pending', detail: { branch_ref: provisioned.branchRef },
    }));
  }

  if (options.execute === false) return { fork, comparison: compareFork(fork) };
  return resumeFork({ ...options, projectRoot, forkId: fork.fork_id, worktreeProvider: provider });
}

function resumeFork(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const provider = options.worktreeProvider || createGitWorktreeProvider({ spawn: options.spawn });
  let fork = loadFork(projectRoot, options.forkId);
  const objective = options.objective || readPrivate(projectRoot, fork.fork_id, 'objective.txt').trim();
  const signingKey = options.signingKey || readPrivate(projectRoot, fork.fork_id, 'signing-key.pem');
  const workflow = options.workflow || JSON.parse(readPrivate(projectRoot, fork.fork_id, 'workflow.json'));

  for (const branchSnapshot of [...fork.branches]) {
    let branch = fork.branches.find((entry) => entry.branch_id === branchSnapshot.branch_id);
    if (branch.status === 'running') {
      const previousRevision = fork.revision;
      fork = updateBranch(fork, branch.branch_id, { status: 'blocked', completed_at: options.now ? options.now() : new Date().toISOString(),
        failure_code: 'RUNTIME_EFFECT_AMBIGUOUS' }, options.now ? options.now() : new Date().toISOString());
      saveFork(projectRoot, fork, previousRevision);
      appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'runtime-recovery-blocked', { branchId: branch.branch_id,
        status: 'blocked', detail: { reason: 'ambiguous-effect' } }));
      continue;
    }
    if (branch.status !== 'pending') continue;
    const worktree = provider.resolve(projectRoot, options.worktreeRoot, fork.fork_id, branch.branch_id);
    let previousRevision = fork.revision;
    const startedAt = options.now ? options.now() : new Date().toISOString();
    fork = updateBranch(fork, branch.branch_id, { status: 'running', started_at: startedAt }, startedAt);
    saveFork(projectRoot, fork, previousRevision);
    appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'runtime-started', { branchId: branch.branch_id,
      status: 'running', detail: { runtime: branch.runtime } }));
    branch = fork.branches.find((entry) => entry.branch_id === branch.branch_id);
    const result = (options.runBranch || runRuntimeBranch)({
      fork, branch, objective, signingKey, worktree, worktreeProvider: provider,
      verifier: workflow.verifier, spawn: options.spawn, env: options.env,
      timeoutMs: options.timeoutMs, startedAt,
      completedAt: options.now ? options.now() : undefined,
    });
    writeReceipt(projectRoot, fork.fork_id, branch.branch_id, result.receipt_envelope);
    previousRevision = fork.revision;
    fork = updateBranch(fork, branch.branch_id, {
      status: result.status,
      completed_at: result.completed_at,
      receipt_digest: result.receipt_digest,
      evidence_summary: result.evidence_summary,
      diff_summary: result.diff_summary,
      duration_ms: result.duration_ms,
      cost: result.cost,
      failure_code: result.failure_code,
    }, result.completed_at);
    saveFork(projectRoot, fork, previousRevision);
    appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'runtime-completed', { branchId: branch.branch_id,
      status: result.status, detail: { receipt_digest: result.receipt_digest } }));
  }
  return { fork, comparison: compareFork(fork) };
}

function applyLanding(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const provider = options.worktreeProvider || createGitWorktreeProvider({ spawn: options.spawn });
  let fork = loadFork(projectRoot, options.forkId);
  if (fork.landing?.status === 'landed' && fork.landing.idempotency_key === options.idempotencyKey) return fork;
  if (fork.landing?.status === 'unknown') throw Object.assign(new Error('Previous landing effect is ambiguous and will not be repeated'), { code: 'FORK_LANDING_AMBIGUOUS' });
  let previousRevision = fork.revision;
  fork = prepareLanding(fork, {
    expectedRevision: options.expectedRevision,
    targetRevision: options.targetRevision,
    confirmation: options.confirmation,
    idempotencyKey: options.idempotencyKey,
    confirmedAt: options.now ? options.now() : new Date().toISOString(),
  });
  saveFork(projectRoot, fork, previousRevision);
  appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'landing-prepared', { status: 'selected' }));

  previousRevision = fork.revision;
  fork = markLandingInProgress(fork, options.now ? options.now() : new Date().toISOString());
  saveFork(projectRoot, fork, previousRevision);
  appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'landing-effect-started', { status: 'unknown' }));
  try {
    const selected = fork.branches.find((branch) => branch.branch_id === fork.landing.branch_id);
    const resultRevision = provider.merge(projectRoot, selected.branch_ref, fork.landing.expected_target_revision);
    previousRevision = fork.revision;
    fork = completeLanding(fork, { status: 'landed', resultRevision,
      completedAt: options.now ? options.now() : new Date().toISOString() });
    saveFork(projectRoot, fork, previousRevision);
    appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'landing-completed', { status: 'landed', detail: { resultRevision } }));
    return fork;
  } catch (error) {
    previousRevision = fork.revision;
    fork = completeLanding(fork, { status: 'blocked', reasonCode: error.code || 'LANDING_FAILED',
      completedAt: options.now ? options.now() : new Date().toISOString() });
    saveFork(projectRoot, fork, previousRevision);
    appendEvent(projectRoot, fork.fork_id, eventFor(fork, 'landing-blocked', { status: 'blocked', detail: { reason: error.code || 'LANDING_FAILED' } }));
    throw error;
  }
}

module.exports = Object.freeze({ applyLanding, eventFor, operationFrom, resumeFork, startFork });
