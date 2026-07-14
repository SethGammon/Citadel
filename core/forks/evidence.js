'use strict';

const crypto = require('crypto');
const operations = require('../operations');
const { EXECUTOR_FORK_SCHEMA_VERSION } = require('./contracts');
const {
  branchIdForProfile,
  branchResultDigest,
  executorProfileDigest,
  executorSetDigest,
  missionControlExecutorState,
  normalizeExecutorFile,
  publicExecutorReplay,
  synthesizeLegacyExecutors,
  verifyForkReceiptWrapper,
} = require('./executor-profiles');
const {
  readExecutorFile, readExecutorTelemetry, readForkReceiptWrapper, readPrivate,
  readReceipt, readSignerPublicKey,
} = require('./store');

const TELEMETRY_FIELDS = [
  'schema_version', 'branch_id', 'runtime', 'model', 'trusted', 'cost', 'duration_ms', 'tokens', 'source',
  'branch_result_digest',
];

/**
 * Load the executor profiles a fork was created with. The stored file is
 * untrusted input: it is only accepted when its set digest matches the fork and
 * every branch's bound profile digest matches the profile it claims.
 */
function loadExecutorProfiles(projectRoot, fork) {
  if (fork.schema_version !== EXECUTOR_FORK_SCHEMA_VERSION) {
    // Schema 1 forks never carried profiles. Their runtimes describe canonical
    // legacy profiles, which report a default model and an unproven identity.
    const profiles = synthesizeLegacyExecutors([...new Set(fork.branches.map((branch) => branch.runtime))]);
    const byBranch = new Map();
    for (const branch of fork.branches) {
      byBranch.set(branch.branch_id, profiles.find((profile) => profile.runtime === branch.runtime));
    }
    return byBranch;
  }
  const stored = readExecutorFile(projectRoot, fork.fork_id);
  if (!stored) {
    throw Object.assign(new Error('Executor file is missing for a schema 2 fork'), { code: 'FORK_EXECUTORS_MISSING' });
  }
  const file = normalizeExecutorFile(stored);
  if (executorSetDigest(file) !== fork.executor_set_digest) {
    throw Object.assign(new Error('Executor file does not match the fork executor set digest'), {
      code: 'FORK_EXECUTOR_SET_MISMATCH',
    });
  }
  const byBranch = new Map();
  for (const profile of file.executors) byBranch.set(branchIdForProfile(profile), profile);
  for (const branch of fork.branches) {
    const profile = byBranch.get(branch.branch_id);
    if (!profile || executorProfileDigest(profile) !== branch.executor_profile_digest) {
      throw Object.assign(new Error(`Executor profile digest does not match branch: ${branch.branch_id}`), {
        code: 'FORK_EXECUTOR_PROFILE_MISMATCH',
      });
    }
  }
  return byBranch;
}

function verification(status, reasonCode) {
  return Object.freeze({ status, reason_code: reasonCode });
}

function trustedPublicKey(projectRoot, fork) {
  try {
    if (fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION) {
      const pem = readSignerPublicKey(projectRoot, fork.fork_id);
      if (!pem) return { key: null, result: verification('unknown', 'FORK_SIGNER_KEY_MISSING') };
      if (operations.sha256Digest({ public_key: pem }) !== fork.shared.signer_public_key_digest) {
        return { key: null, result: verification('invalid', 'FORK_SIGNER_KEY_DIGEST_MISMATCH') };
      }
      return { key: crypto.createPublicKey(pem), result: verification('verified', 'FORK_SIGNER_KEY_VERIFIED') };
    }
    return {
      key: crypto.createPublicKey(readPrivate(projectRoot, fork.fork_id, 'signing-key.pem')),
      result: verification('verified', 'FORK_LEGACY_SIGNER_LOADED'),
    };
  } catch (_error) {
    return { key: null, result: verification('invalid', 'FORK_SIGNER_KEY_INVALID') };
  }
}

function validObservation(value, branchId, profile) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...TELEMETRY_FIELDS].sort())) return null;
  if (value.schema_version !== 1 || value.branch_id !== branchId) return null;
  if (!profile || value.runtime !== profile.runtime) return null;
  if (typeof value.trusted !== 'boolean') return null;
  if (typeof value.branch_result_digest !== 'string'
    || !operations.DIGEST_PATTERN.test(value.branch_result_digest)) return null;
  const expectedSource = profile.runtime === 'claude' ? 'claude-json' : 'codex-jsonl';
  if (value.trusted && value.source !== expectedSource) return null;
  if (!value.trusted && value.source !== 'adapter-silent') return null;
  return value;
}

/**
 * Reload and cryptographically verify every stored binding for one branch.
 * A stored `receipt_verified: true` flag is never consulted here.
 */
function verifyBranchEvidence(projectRoot, fork, branch, options = {}) {
  const profile = options.profile || loadExecutorProfiles(projectRoot, fork).get(branch.branch_id);
  const wrapper = readForkReceiptWrapper(projectRoot, fork.fork_id, branch.branch_id);
  const anchor = options.anchor || trustedPublicKey(projectRoot, fork);
  const executionEnvelope = readReceipt(projectRoot, fork.fork_id, branch.branch_id);
  let executionVerification = verification('invalid', 'EXECUTION_RECEIPT_MISSING');
  if (anchor.key && executionEnvelope) {
    executionVerification = operations.verifyExecutionReceipt(executionEnvelope, { publicKey: anchor.key });
    if (executionVerification.status === 'verified'
      && executionEnvelope.receipt_digest !== branch.receipt_digest) {
      executionVerification = verification('invalid', 'EXECUTION_RECEIPT_DIGEST_MISMATCH');
    }
    if (executionVerification.status === 'verified' && fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION
      && (executionEnvelope.receipt.issuer_id !== fork.shared.issuer_id
        || executionEnvelope.receipt.issued_at !== branch.completed_at)) {
      executionVerification = verification('invalid', 'EXECUTION_RECEIPT_BINDING_MISMATCH');
    }
    if (executionVerification.status === 'verified'
      && (executionEnvelope.receipt.operation_digest !== operations.sha256Digest(fork.operation)
        || executionEnvelope.receipt.run_id !== branch.run_id
        || executionEnvelope.receipt.status !== branch.status)) {
      executionVerification = verification('invalid', 'EXECUTION_RECEIPT_BRANCH_MISMATCH');
    }
  }
  const storedObservation = validObservation(
    readExecutorTelemetry(projectRoot, fork.fork_id, branch.branch_id), branch.branch_id, profile,
  );
  const branchResultVerification = storedObservation
    && storedObservation.branch_result_digest === branchResultDigest(branch)
    ? verification('verified', 'FORK_BRANCH_RESULT_VERIFIED')
    : verification('invalid', 'FORK_BRANCH_RESULT_DIGEST_MISMATCH');
  let wrapperVerification = verification('invalid', 'FORK_RECEIPT_MISSING');
  if (wrapper && anchor.key) {
    wrapperVerification = verifyForkReceiptWrapper(wrapper, {
      publicKey: anchor.key,
      expected: {
        fork_id: fork.fork_id,
        branch_id: branch.branch_id,
        contract_digest: fork.contract_digest,
        executor_profile_digest: fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION
          ? branch.executor_profile_digest : executorProfileDigest(profile),
        execution_receipt_digest: branch.receipt_digest,
        observation_digest: operations.sha256Digest(storedObservation),
        issued_at: branch.completed_at,
        issuer_id: fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION
          ? fork.shared.issuer_id : `issuer-${fork.fork_id}`,
      },
    });
  }
  let combined = wrapperVerification;
  if (anchor.result.status !== 'verified') combined = anchor.result;
  else if (executionVerification.status !== 'verified') combined = executionVerification;
  else if (branchResultVerification.status !== 'verified') combined = branchResultVerification;
  const observation = storedObservation
    ? { ...storedObservation, trusted: storedObservation.trusted && combined.status === 'verified' }
    : null;
  return {
    branch_id: branch.branch_id,
    profile,
    wrapper,
    execution_envelope: executionEnvelope,
    execution_verification: executionVerification,
    branch_result_verification: branchResultVerification,
    verification: combined,
    observation,
  };
}

function forkEvidence(projectRoot, fork) {
  const profiles = loadExecutorProfiles(projectRoot, fork);
  const anchor = trustedPublicKey(projectRoot, fork);
  const byBranch = new Map();
  for (const branch of fork.branches) {
    byBranch.set(branch.branch_id, verifyBranchEvidence(projectRoot, fork, branch, {
      profile: profiles.get(branch.branch_id), anchor,
    }));
  }
  return byBranch;
}

function executorStates(projectRoot, fork) {
  const evidence = forkEvidence(projectRoot, fork);
  return fork.branches.map((branch) => {
    const entry = evidence.get(branch.branch_id);
    return missionControlExecutorState({
      profile: entry.profile,
      observation: entry.observation,
      wrapper: entry.wrapper,
      verification: entry.verification,
    });
  });
}

function executorReplay(projectRoot, fork) {
  const evidence = forkEvidence(projectRoot, fork);
  return fork.branches.map((branch) => {
    const entry = evidence.get(branch.branch_id);
    return publicExecutorReplay({
      profile: entry.profile,
      observation: entry.observation,
      wrapper: entry.wrapper,
      verification: entry.verification,
    });
  });
}

module.exports = Object.freeze({
  executorReplay,
  executorStates,
  forkEvidence,
  loadExecutorProfiles,
  verifyBranchEvidence,
});
