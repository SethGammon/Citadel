'use strict';

const crypto = require('crypto');
const { EXECUTOR_FORK_SCHEMA_VERSION } = require('./contracts');
const {
  branchIdForProfile,
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
} = require('./store');

const TELEMETRY_FIELDS = [
  'schema_version', 'branch_id', 'runtime', 'model', 'trusted', 'cost', 'duration_ms', 'tokens', 'source',
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

function trustedPublicKey(projectRoot, forkId) {
  try {
    return crypto.createPublicKey(readPrivate(projectRoot, forkId, 'signing-key.pem'));
  } catch (_error) {
    // Without the fork's own signer the wrapper can never reach `verified`.
    return null;
  }
}

function validObservation(value, branchId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...TELEMETRY_FIELDS].sort())) return null;
  if (value.schema_version !== 1 || value.branch_id !== branchId) return null;
  if (typeof value.trusted !== 'boolean') return null;
  return value;
}

/**
 * Reload and cryptographically verify every stored binding for one branch.
 * A stored `receipt_verified: true` flag is never consulted here.
 */
function verifyBranchEvidence(projectRoot, fork, branch, options = {}) {
  const profile = options.profile || loadExecutorProfiles(projectRoot, fork).get(branch.branch_id);
  const wrapper = readForkReceiptWrapper(projectRoot, fork.fork_id, branch.branch_id);
  const publicKey = options.publicKey !== undefined ? options.publicKey
    : trustedPublicKey(projectRoot, fork.fork_id);
  let verification = null;
  if (wrapper) {
    verification = verifyForkReceiptWrapper(wrapper, {
      publicKey,
      expected: {
        fork_id: fork.fork_id,
        branch_id: branch.branch_id,
        contract_digest: fork.contract_digest,
        executor_profile_digest: fork.schema_version === EXECUTOR_FORK_SCHEMA_VERSION
          ? branch.executor_profile_digest : executorProfileDigest(profile),
        execution_receipt_digest: branch.receipt_digest,
      },
    });
  }
  const observation = validObservation(
    readExecutorTelemetry(projectRoot, fork.fork_id, branch.branch_id), branch.branch_id,
  );
  return { branch_id: branch.branch_id, profile, wrapper, verification, observation };
}

function forkEvidence(projectRoot, fork) {
  const profiles = loadExecutorProfiles(projectRoot, fork);
  const publicKey = trustedPublicKey(projectRoot, fork.fork_id);
  const byBranch = new Map();
  for (const branch of fork.branches) {
    byBranch.set(branch.branch_id, verifyBranchEvidence(projectRoot, fork, branch, {
      profile: profiles.get(branch.branch_id), publicKey,
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
