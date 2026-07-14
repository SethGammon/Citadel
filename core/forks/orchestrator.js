'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const operations = require('../operations');
const {
  appendEvent, createForkRecord, loadFork, readPrivate, saveFork, writeExecutorFile,
  writeExecutorTelemetry, writeForkReceiptWrapper, writeReceipt,
} = require('./store');
const {
  completeLanding, createOperationFork, markLandingInProgress, nextFork, prepareLanding, selectBranch, updateBranch,
} = require('./lifecycle');
const { compareFork } = require('./compare');
const { EXECUTOR_FORK_SCHEMA_VERSION } = require('./contracts');
const { createForkReceiptWrapper, executorProfileDigest, resolveExecutorSelection } = require('./executor-profiles');
const { forkEvidence, loadExecutorProfiles, verifyBranchEvidence } = require('./evidence');
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
  // Selection is resolved before any planning state or worktree exists, so a
  // conflicting --executors/--runtimes pair fails with nothing created.
  const selection = resolveExecutorSelection({
    executors: options.executors,
    runtimes: options.runtimes || (options.executors ? undefined : null),
  });
  const baseRevision = options.baseRevision || provider.currentRevision(projectRoot);
  const createdAt = options.createdAt || new Date().toISOString();
  const operation = operationFrom(options, createdAt);
  const signingKey = options.signingKey || generateSigningKey();
  const signingPublicKey = crypto.createPublicKey(signingKey)
    .export({ type: 'spki', format: 'pem' }).toString();
  const issuerId = `issuer-${options.forkId}`;
  const shared = {
    objective_digest: operation.objective_digest,
    scope_digest: operations.sha256Digest(options.scope || { repository: 'current' }),
    policy_digests: operation.policy_digests,
    budget_digest: operations.sha256Digest(options.budget || { runtime_timeout_ms: 1800000 }),
    workflow_digest: operations.sha256Digest(options.workflow),
    verifier_digest: operations.sha256Digest(options.workflow.verifier),
    base_revision: baseRevision,
  };
  if (selection.source === 'executors') {
    shared.signer_public_key_digest = operations.sha256Digest({ public_key: signingPublicKey });
    shared.issuer_id = issuerId;
  }
  let fork = createOperationFork({
    forkId: options.forkId,
    operation,
    shared,
    createdAt,
    executors: selection.source === 'executors' ? selection.executor_file : undefined,
    runtimes: selection.source === 'executors' ? undefined : selection.profiles.map((profile) => profile.runtime),
  });
  createForkRecord(projectRoot, fork, {
    objective: options.objective,
    signingKey,
    signingPublicKey: selection.source === 'executors' ? signingPublicKey : undefined,
    workflow: options.workflow,
  });
  if (selection.source === 'executors') writeExecutorFile(projectRoot, fork.fork_id, selection.executor_file);
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

  if (options.execute === false) {
    return { fork, comparison: compareFork(fork, { evidence: forkEvidence(projectRoot, fork) }) };
  }
  return resumeFork({ ...options, projectRoot, forkId: fork.fork_id, worktreeProvider: provider,
    signingKey, executors: undefined });
}

/** Bind one completed branch to its executor profile with a signed fork receipt. */
function recordBranchEvidence(projectRoot, fork, branch, profile, result, signingKey) {
  writeReceipt(projectRoot, fork.fork_id, branch.branch_id, result.receipt_envelope);
  const observation = result.observation || null;
  const telemetry = {
    schema_version: 1,
    branch_id: branch.branch_id,
    runtime: profile.runtime,
    model: observation && typeof observation.model === 'string' ? observation.model : null,
    trusted: Boolean(observation && observation.trusted),
    cost: observation && observation.cost ? observation.cost : null,
    duration_ms: observation && observation.duration_ms !== undefined ? observation.duration_ms : null,
    tokens: observation && observation.tokens !== undefined ? observation.tokens : null,
    source: observation && observation.source ? observation.source : 'adapter-silent',
  };
  writeExecutorTelemetry(projectRoot, fork.fork_id, branch.branch_id, telemetry);
  const wrapper = createForkReceiptWrapper({
    fork_id: fork.fork_id,
    branch_id: branch.branch_id,
    contract_digest: fork.contract_digest,
    executor_profile_digest: fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION
      ? branch.executor_profile_digest : executorProfileDigest(profile),
    execution_receipt_digest: result.receipt_digest,
    observation_digest: operations.sha256Digest(telemetry),
    issued_at: result.completed_at,
    issuer_id: fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION
      ? fork.shared.issuer_id : `issuer-${fork.fork_id}`,
    signingKey,
  });
  writeForkReceiptWrapper(projectRoot, fork.fork_id, branch.branch_id, wrapper);
  return wrapper;
}

function resumeFork(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const provider = options.worktreeProvider || createGitWorktreeProvider({ spawn: options.spawn });
  let fork = loadFork(projectRoot, options.forkId);
  const objective = options.objective || readPrivate(projectRoot, fork.fork_id, 'objective.txt').trim();
  const signingKey = options.signingKey || readPrivate(projectRoot, fork.fork_id, 'signing-key.pem');
  const workflow = options.workflow || JSON.parse(readPrivate(projectRoot, fork.fork_id, 'workflow.json'));
  const profiles = loadExecutorProfiles(projectRoot, fork);

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
    const profile = profiles.get(branch.branch_id);
    const result = (options.runBranch || runRuntimeBranch)({
      fork, branch, profile, objective, signingKey, worktree, worktreeProvider: provider,
      projectRoot, worktreeRoot: options.worktreeRoot,
      verifier: workflow.verifier, spawn: options.spawn, env: options.env,
      timeoutMs: options.timeoutMs, startedAt,
      completedAt: options.now ? options.now() : undefined,
    });
    recordBranchEvidence(projectRoot, fork, branch, profile, result, signingKey);
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
  let evidence = forkEvidence(projectRoot, fork);
  let comparison = compareFork(fork, { evidence });
  if (fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION && !fork.selection
    && comparison.comparable_count >= 2 && fork.status !== 'ready') {
    const previousRevision = fork.revision;
    fork = nextFork(fork, { status: 'ready' }, options.now ? options.now() : new Date().toISOString());
    saveFork(projectRoot, fork, previousRevision);
    evidence = forkEvidence(projectRoot, fork);
    comparison = compareFork(fork, { evidence });
  }
  return { fork, comparison };
}

/**
 * Record a selection after reloading and verifying the branch's stored bindings.
 * Selection remains intent only: no merge, no worktree effect.
 */
function applySelection(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const current = loadFork(projectRoot, options.forkId);
  const branch = current.branches.find((entry) => entry.branch_id === options.branchId);
  if (!branch) throw Object.assign(new Error(`Branch not found: ${options.branchId}`), { code: 'FORK_BRANCH_NOT_FOUND' });
  const evidence = verifyBranchEvidence(projectRoot, current, branch);
  const selected = selectBranch(current, {
    branchId: options.branchId,
    expectedRevision: options.expectedRevision,
    actorId: options.actorId,
    idempotencyKey: options.idempotencyKey,
    reason: options.reason || '',
    receiptVerification: evidence.verification,
    selectedAt: options.now ? options.now() : new Date().toISOString(),
  });
  if (selected === current) return selected;
  saveFork(projectRoot, selected, current.revision);
  appendEvent(projectRoot, selected.fork_id, eventFor(selected, 'branch-selected', {
    branchId: options.branchId, status: 'selected', detail: { selection_id: selected.selection.selection_id },
  }));
  return selected;
}

function applyLanding(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const provider = options.worktreeProvider || createGitWorktreeProvider({ spawn: options.spawn });
  let fork = loadFork(projectRoot, options.forkId);
  if (fork.landing?.status === 'landed' && fork.landing.idempotency_key === options.idempotencyKey) return fork;
  if (fork.landing?.status === 'unknown') throw Object.assign(new Error('Previous landing effect is ambiguous and will not be repeated'), { code: 'FORK_LANDING_AMBIGUOUS' });
  // The stored wrapper is reloaded and verified here, not trusted from the record.
  const selectedBranch = fork.selection
    ? fork.branches.find((branch) => branch.branch_id === fork.selection.branch_id) : null;
  const receiptVerification = selectedBranch
    ? verifyBranchEvidence(projectRoot, fork, selectedBranch).verification : null;
  let previousRevision = fork.revision;
  fork = prepareLanding(fork, {
    expectedRevision: options.expectedRevision,
    targetRevision: options.targetRevision,
    confirmation: options.confirmation,
    idempotencyKey: options.idempotencyKey,
    receiptVerification,
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

module.exports = Object.freeze({
  applyLanding, applySelection, eventFor, operationFrom, recordBranchEvidence, resumeFork, startFork,
});
