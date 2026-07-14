'use strict';

const crypto = require('crypto');
const operations = require('../operations');
const { assertRedacted } = require('./redaction');

const EXECUTOR_SCHEMA_VERSION = 1;
const FORK_RECEIPT_KIND = 'operation_fork_execution_receipt';
const FORK_RECEIPT_SCHEMA_VERSION = 1;

const EXECUTOR_FILE_FIELDS = Object.freeze(['schema_version', 'executors']);
const PROFILE_FIELDS = Object.freeze(['profile_id', 'runtime', 'model', 'local_provider', 'adapter_options']);
const WRAPPER_FIELDS = Object.freeze(['receipt', 'receipt_digest', 'algorithm', 'signature']);
const RECEIPT_FIELDS = Object.freeze([
  'schema_version', 'kind', 'fork_id', 'branch_id', 'contract_digest',
  'executor_profile_digest', 'execution_receipt_digest', 'observation_digest',
  'issued_at', 'issuer_id',
]);
const BINDING_FIELDS = Object.freeze([
  'fork_id', 'branch_id', 'contract_digest', 'executor_profile_digest',
  'execution_receipt_digest', 'observation_digest', 'issued_at', 'issuer_id',
]);

const EXECUTOR_RUNTIMES = Object.freeze(['claude', 'codex']);
const LOCAL_PROVIDERS = Object.freeze(['ollama', 'lmstudio']);
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
// Model IDs may be any control-character-free string per the contract. Observed
// telemetry is held to a stricter shape so replay can never carry a path.
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const OBSERVED_MODEL_PATTERN = MODEL_ID_PATTERN;

const CLAUDE_PERMISSION_MODES = Object.freeze(['acceptEdits', 'auto', 'manual', 'dontAsk', 'plan']);
const CLAUDE_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const CODEX_SANDBOXES = Object.freeze(['read-only', 'workspace-write']);
const DEFAULT_PERMISSION_MODE = 'acceptEdits';
const DEFAULT_SANDBOX = 'workspace-write';
const CLAUDE_ALLOWED_TOOLS = 'Read,Edit,Write,Glob,Grep,Bash(node *),Bash(npm *),Bash(npx *),Bash(git diff *),Bash(git status *),Bash(git rev-parse *)';
const ADAPTER_OPTION_KEYS = Object.freeze({
  claude: Object.freeze(['permission_mode', 'effort']),
  codex: Object.freeze(['sandbox']),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, fields) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function canonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isDigest(value) {
  return typeof value === 'string' && operations.DIGEST_PATTERN.test(value);
}

function validateAdapterOptions(runtime, options, errors) {
  if (!isPlainObject(options)) {
    errors.push('executor adapter_options must be a plain object');
    return;
  }
  const allowed = ADAPTER_OPTION_KEYS[runtime] || [];
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      errors.push(`executor adapter_options key is not an allowed ${runtime} option: ${key}`);
    }
  }
  if (runtime === 'claude') {
    if ('permission_mode' in options && !CLAUDE_PERMISSION_MODES.includes(options.permission_mode)) {
      errors.push(`executor adapter_options permission_mode is not allowed: ${String(options.permission_mode)}`);
    }
    if ('effort' in options && !CLAUDE_EFFORTS.includes(options.effort)) {
      errors.push(`executor adapter_options effort is not allowed: ${String(options.effort)}`);
    }
  }
  if (runtime === 'codex' && 'sandbox' in options && !CODEX_SANDBOXES.includes(options.sandbox)) {
    errors.push(`executor adapter_options sandbox is not allowed: ${String(options.sandbox)}`);
  }
}

function validateExecutorProfile(profile) {
  const errors = [];
  if (!exactFields(profile, PROFILE_FIELDS)) return ['executor profile fields are invalid or contain an unknown field'];
  if (typeof profile.profile_id !== 'string' || !PROFILE_ID_PATTERN.test(profile.profile_id)
    || !operations.ID_PATTERN.test(`branch-${profile.profile_id}`)) {
    errors.push(`executor profile_id is invalid: ${String(profile.profile_id)}`);
  }
  if (!EXECUTOR_RUNTIMES.includes(profile.runtime)) {
    errors.push(`executor runtime is not registered: ${String(profile.runtime)}`);
  }
  if (profile.model !== null && (typeof profile.model !== 'string' || !MODEL_ID_PATTERN.test(profile.model))) {
    errors.push('executor model must be null or a public-safe model ID');
  }
  if (profile.local_provider !== null && !LOCAL_PROVIDERS.includes(profile.local_provider)) {
    errors.push(`executor local_provider must be null or an allowed provider (${LOCAL_PROVIDERS.join(', ')})`);
  }
  if (profile.local_provider !== null && LOCAL_PROVIDERS.includes(profile.local_provider)) {
    if (profile.runtime !== 'codex') {
      errors.push(`executor local_provider ${profile.local_provider} requires the codex runtime`);
    }
    if (profile.model === null) {
      errors.push('executor local_provider requires an explicit model');
    }
  }
  if (EXECUTOR_RUNTIMES.includes(profile.runtime)) validateAdapterOptions(profile.runtime, profile.adapter_options, errors);
  return errors;
}

function validateExecutorFile(file) {
  if (!exactFields(file, EXECUTOR_FILE_FIELDS)) return ['executor file fields are invalid or contain an unknown field'];
  const errors = [];
  if (file.schema_version !== EXECUTOR_SCHEMA_VERSION) errors.push('executor file schema_version is invalid');
  if (!Array.isArray(file.executors) || file.executors.length < 2) {
    errors.push('executor file requires at least two executor profiles');
    return errors;
  }
  const seen = new Set();
  for (const profile of file.executors) {
    errors.push(...validateExecutorProfile(profile));
    const id = isPlainObject(profile) ? profile.profile_id : null;
    if (typeof id === 'string') {
      if (seen.has(id)) errors.push(`executor profile_id values must be unique: duplicate ${id}`);
      seen.add(id);
    }
  }
  return errors;
}

function assertValidExecutorProfile(profile) {
  const errors = validateExecutorProfile(profile);
  if (errors.length) throw new TypeError(errors.join('; '));
  return profile;
}

function assertValidExecutorFile(file) {
  const errors = validateExecutorFile(file);
  if (errors.length) throw new TypeError(errors.join('; '));
  return file;
}

function canonicalProfile(profile) {
  assertValidExecutorProfile(profile);
  const options = {};
  for (const key of Object.keys(profile.adapter_options).sort()) options[key] = profile.adapter_options[key];
  return {
    profile_id: profile.profile_id,
    runtime: profile.runtime,
    model: profile.model,
    local_provider: profile.local_provider,
    adapter_options: options,
  };
}

function normalizeExecutorFile(file) {
  assertValidExecutorFile(file);
  // Code-unit ordering, not locale ordering: the executor set digest depends on
  // this sequence and must be identical on every machine.
  const executors = file.executors
    .map(canonicalProfile)
    .sort((a, b) => (a.profile_id < b.profile_id ? -1 : a.profile_id > b.profile_id ? 1 : 0));
  return { schema_version: EXECUTOR_SCHEMA_VERSION, executors };
}

function executorProfileDigest(profile) {
  return operations.sha256Digest(canonicalProfile(profile));
}

function executorSetDigest(file) {
  const normalized = normalizeExecutorFile(file);
  return operations.sha256Digest(normalized.executors.map(executorProfileDigest));
}

function branchResultDigest(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('Branch result is required for digest binding');
  }
  return operations.sha256Digest({
    status: result.status,
    evidence_summary: result.evidence_summary,
    diff_summary: result.diff_summary,
    duration_ms: result.duration_ms,
    cost: result.cost,
    failure_code: result.failure_code,
  });
}

function synthesizeLegacyExecutors(runtimes) {
  if (!Array.isArray(runtimes) || !runtimes.length || new Set(runtimes).size !== runtimes.length
    || runtimes.some((runtime) => !EXECUTOR_RUNTIMES.includes(runtime))) {
    throw new TypeError('Legacy --runtimes requires unique registered runtimes');
  }
  return runtimes.map((runtime) => assertValidExecutorProfile({
    profile_id: runtime,
    runtime,
    model: null,
    local_provider: null,
    adapter_options: {},
  }));
}

function branchIdForProfile(profile) {
  const id = typeof profile === 'string' ? profile : profile && profile.profile_id;
  if (typeof id !== 'string' || !PROFILE_ID_PATTERN.test(id)) throw new TypeError('Executor profile_id is invalid');
  return `branch-${id}`;
}

function profileIdForBranchId(branchId) {
  if (typeof branchId !== 'string' || !branchId.startsWith('branch-')) throw new TypeError('Branch ID is invalid');
  return branchId.slice('branch-'.length);
}

function resolveExecutorSelection(selection = {}) {
  const hasExecutors = selection.executors !== undefined && selection.executors !== null;
  const hasRuntimes = Array.isArray(selection.runtimes) && selection.runtimes.length > 0;
  if (hasExecutors && hasRuntimes) {
    throw Object.assign(new TypeError('--executors and --runtimes are mutually exclusive'), {
      code: 'FORK_EXECUTOR_SELECTION_CONFLICT',
    });
  }
  if (hasExecutors) {
    const file = normalizeExecutorFile(selection.executors);
    return {
      source: 'executors',
      profiles: file.executors,
      executor_file: file,
      executor_set_digest: executorSetDigest(file),
    };
  }
  const runtimes = hasRuntimes ? selection.runtimes : [...EXECUTOR_RUNTIMES];
  return {
    source: 'runtimes',
    profiles: synthesizeLegacyExecutors(runtimes),
    executor_file: null,
    executor_set_digest: null,
  };
}

function runtimeInvocationForProfile(profile) {
  assertValidExecutorProfile(profile);
  const options = profile.adapter_options;
  if (profile.runtime === 'claude') {
    const args = ['--print', '--output-format', 'json',
      '--permission-mode', options.permission_mode || DEFAULT_PERMISSION_MODE,
      '--allowedTools', CLAUDE_ALLOWED_TOOLS];
    if (profile.model !== null) args.push('--model', profile.model);
    if (options.effort) args.push('--effort', options.effort);
    return { command: 'claude', args };
  }
  const args = ['exec', '--json', '--sandbox', options.sandbox || DEFAULT_SANDBOX, '--ignore-user-config'];
  if (profile.local_provider !== null) args.push('--oss', '--local-provider', profile.local_provider);
  if (profile.model !== null) args.push('--model', profile.model);
  args.push('-');
  return { command: 'codex', args };
}

function branchSkeleton(fork, profile, existing) {
  const digest = executorProfileDigest(profile);
  const branchId = branchIdForProfile(profile);
  if (existing) return { ...existing, branch_id: branchId, runtime: profile.runtime, executor_profile_digest: digest };
  return {
    branch_id: branchId,
    runtime: profile.runtime,
    run_id: `run-${fork.fork_id}-${profile.profile_id}`,
    status: 'pending',
    base_revision: fork.shared ? fork.shared.base_revision : null,
    worktree_ref: null,
    branch_ref: null,
    contract_digest: fork.contract_digest,
    executor_profile_digest: digest,
    started_at: null,
    completed_at: null,
    receipt_digest: null,
    evidence_summary: null,
    diff_summary: null,
    duration_ms: null,
    cost: null,
    failure_code: null,
  };
}

function bindExecutorProfiles(fork, executorFile) {
  const file = normalizeExecutorFile(executorFile);
  const existing = new Map((fork.branches || []).map((branch) => [branch.branch_id, branch]));
  return {
    ...fork,
    schema_version: 2,
    executor_set_digest: executorSetDigest(file),
    branches: file.executors.map((profile) => branchSkeleton(
      fork, profile, existing.get(branchIdForProfile(profile)),
    )),
  };
}

function forkReceiptFor(input) {
  const receipt = {
    schema_version: FORK_RECEIPT_SCHEMA_VERSION,
    kind: FORK_RECEIPT_KIND,
    fork_id: input.fork_id,
    branch_id: input.branch_id,
    contract_digest: input.contract_digest,
    executor_profile_digest: input.executor_profile_digest,
    execution_receipt_digest: input.execution_receipt_digest,
    observation_digest: input.observation_digest,
    issued_at: input.issued_at,
    issuer_id: input.issuer_id,
  };
  const errors = validateForkReceipt(receipt);
  if (errors.length) throw new TypeError(`Invalid fork receipt: ${errors.join('; ')}`);
  return receipt;
}

function validateForkReceipt(receipt) {
  if (!exactFields(receipt, RECEIPT_FIELDS)) return ['fork receipt fields are invalid'];
  const errors = [];
  if (receipt.schema_version !== FORK_RECEIPT_SCHEMA_VERSION) errors.push('fork receipt schema_version is invalid');
  if (receipt.kind !== FORK_RECEIPT_KIND) errors.push('fork receipt kind is invalid');
  if (typeof receipt.fork_id !== 'string' || !operations.ID_PATTERN.test(receipt.fork_id)) errors.push('fork receipt fork_id is invalid');
  if (typeof receipt.branch_id !== 'string' || !operations.ID_PATTERN.test(receipt.branch_id)) errors.push('fork receipt branch_id is invalid');
  for (const field of ['contract_digest', 'executor_profile_digest', 'execution_receipt_digest', 'observation_digest']) {
    if (!isDigest(receipt[field])) errors.push(`fork receipt ${field} is invalid`);
  }
  if (!canonicalTime(receipt.issued_at)) errors.push('fork receipt issued_at is invalid');
  if (typeof receipt.issuer_id !== 'string' || !operations.ID_PATTERN.test(receipt.issuer_id)) errors.push('fork receipt issuer_id is invalid');
  return errors;
}

function createForkReceiptWrapper(input) {
  const receipt = forkReceiptFor(input);
  const key = input.signingKey && input.signingKey.type === 'private'
    ? input.signingKey : crypto.createPrivateKey(input.signingKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Fork receipt signing requires an Ed25519 private key');
  const bytes = Buffer.from(operations.canonicalSerialize(receipt), 'utf8');
  return Object.freeze({
    receipt: Object.freeze(receipt),
    receipt_digest: operations.sha256Digest(receipt),
    algorithm: 'ed25519',
    signature: crypto.sign(null, bytes, key).toString('base64'),
  });
}

function wrapperResult(status, reasonCode) {
  return Object.freeze({ status, reason_code: reasonCode });
}

function verifyForkReceiptWrapper(wrapper, options = {}) {
  try {
    if (!exactFields(wrapper, WRAPPER_FIELDS)) return wrapperResult('invalid', 'FORK_RECEIPT_FIELDS_INVALID');
    const errors = validateForkReceipt(wrapper.receipt);
    if (errors.length) return wrapperResult('invalid', 'FORK_RECEIPT_INVALID');
    if (wrapper.algorithm !== 'ed25519') return wrapperResult('invalid', 'FORK_RECEIPT_ALGORITHM_INVALID');
    if (typeof wrapper.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(wrapper.signature)) {
      return wrapperResult('invalid', 'FORK_RECEIPT_SIGNATURE_MALFORMED');
    }
    if (wrapper.receipt_digest !== operations.sha256Digest(wrapper.receipt)) {
      return wrapperResult('invalid', 'FORK_RECEIPT_DIGEST_MISMATCH');
    }
    if (!options.publicKey) return wrapperResult('unknown', 'FORK_RECEIPT_SIGNER_NOT_TRUSTED');
    const publicKey = options.publicKey.type === 'public'
      ? options.publicKey : crypto.createPublicKey(options.publicKey);
    if (publicKey.asymmetricKeyType !== 'ed25519') return wrapperResult('invalid', 'FORK_RECEIPT_KEY_TYPE_INVALID');
    const bytes = Buffer.from(operations.canonicalSerialize(wrapper.receipt), 'utf8');
    if (!crypto.verify(null, bytes, publicKey, Buffer.from(wrapper.signature, 'base64'))) {
      return wrapperResult('invalid', 'FORK_RECEIPT_SIGNATURE_INVALID');
    }
    const expected = options.expected;
    if (expected) {
      for (const field of BINDING_FIELDS) {
        if (expected[field] === undefined) continue;
        if (wrapper.receipt[field] !== expected[field]) return wrapperResult('invalid', 'FORK_RECEIPT_BINDING_MISMATCH');
      }
    }
    return wrapperResult('verified', 'FORK_RECEIPT_VERIFIED');
  } catch (_error) {
    return wrapperResult('invalid', 'FORK_RECEIPT_VERIFICATION_ERROR');
  }
}

function requestedModel(profile) {
  return profile && typeof profile.model === 'string' && profile.model.length ? profile.model : 'default';
}

function observedModelOf(observation) {
  if (!observation || typeof observation !== 'object') return null;
  const model = observation.model;
  if (typeof model !== 'string' || !model.length) return null;
  return OBSERVED_MODEL_PATTERN.test(model) && !model.includes('..') ? model : false;
}

function proof(requested, observed, status, reasonCode) {
  return { requested_model: requested, observed_model: observed, status, reason_code: reasonCode };
}

function evaluateModelProof(profile, observation) {
  assertValidExecutorProfile(profile);
  const requested = requestedModel(profile);
  const observed = observedModelOf(observation);
  if (observed === null) return proof(requested, null, 'unknown', 'MODEL_OBSERVATION_MISSING');
  if (observed === false) return proof(requested, null, 'unknown', 'MODEL_OBSERVATION_UNPARSABLE');
  if (observation.trusted !== true) return proof(requested, null, 'unknown', 'MODEL_OBSERVATION_UNTRUSTED');
  if (profile.model === null) return proof(requested, observed, 'passed', 'MODEL_OBSERVATION_RECORDED');
  if (observed !== profile.model) return proof(requested, observed, 'failed', 'MODEL_OBSERVATION_MISMATCH');
  return proof(requested, observed, 'passed', 'MODEL_OBSERVATION_MATCHED');
}

function receiptFacts(wrapper, verification) {
  if (!wrapper) return { status: 'unknown', reason_code: 'FORK_RECEIPT_MISSING' };
  if (!verification) return { status: 'unknown', reason_code: 'FORK_RECEIPT_NOT_VERIFIED' };
  if (verification.status === 'verified') return { status: 'verified', reason_code: verification.reason_code };
  if (verification.status === 'invalid') return { status: 'failed', reason_code: verification.reason_code };
  return { status: 'unknown', reason_code: verification.reason_code || 'FORK_RECEIPT_NOT_VERIFIED' };
}

function trustedNumber(observation, field) {
  if (!observation || observation.trusted !== true) return null;
  const value = observation[field];
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function trustedCost(observation) {
  if (!observation || observation.trusted !== true) return null;
  const cost = observation.cost;
  if (!cost || typeof cost !== 'object' || !Number.isFinite(cost.amount) || cost.amount < 0) return null;
  if (typeof cost.unit !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(cost.unit)) return null;
  if (typeof cost.source !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(cost.source)) return null;
  return { amount: cost.amount, unit: cost.unit, source: cost.source };
}

function missionControlExecutorState(input) {
  const profile = assertValidExecutorProfile(input.profile);
  const model = evaluateModelProof(profile, input.observation);
  const receipt = receiptFacts(input.wrapper || null, input.verification || null);
  const cost = trustedCost(input.observation);
  const duration = trustedNumber(input.observation, 'duration_ms');
  const tokens = trustedNumber(input.observation, 'tokens');
  return {
    profile_id: profile.profile_id,
    branch_id: branchIdForProfile(profile),
    runtime: profile.runtime,
    local_provider: profile.local_provider,
    requested_model: model.requested_model,
    observed_model: model.observed_model,
    model_status: model.status,
    model_reason_code: model.reason_code,
    receipt_status: receipt.status,
    receipt_reason_code: receipt.reason_code,
    cost,
    cost_status: cost ? 'known' : 'unknown',
    duration_ms: duration,
    duration_status: duration === null ? 'unknown' : 'known',
    tokens,
    tokens_status: tokens === null ? 'unknown' : 'known',
  };
}

function publicExecutorReplay(input) {
  const state = missionControlExecutorState(input);
  const receipt = input.wrapper ? input.wrapper.receipt : null;
  const replay = {
    schema_version: 1,
    kind: 'operation_fork_executor_replay',
    profile_id: state.profile_id,
    branch_id: state.branch_id,
    runtime: state.runtime,
    local_provider: state.local_provider,
    requested_model: state.requested_model,
    observed_model: state.observed_model,
    model_status: state.model_status,
    model_reason_code: state.model_reason_code,
    receipt_status: state.receipt_status,
    cost_status: state.cost_status,
    duration_status: state.duration_status,
    tokens_status: state.tokens_status,
    bindings: {
      contract_digest: receipt ? receipt.contract_digest : null,
      executor_profile_digest: receipt ? receipt.executor_profile_digest : executorProfileDigest(input.profile),
      execution_receipt_digest: receipt ? receipt.execution_receipt_digest : null,
      observation_digest: receipt ? receipt.observation_digest : null,
    },
  };
  assertRedacted(replay, 'FORK_EXECUTOR_REPLAY_REDACTION_FAILED');
  return replay;
}

module.exports = Object.freeze({
  ADAPTER_OPTION_KEYS,
  CLAUDE_EFFORTS,
  CLAUDE_ALLOWED_TOOLS,
  CLAUDE_PERMISSION_MODES,
  CODEX_SANDBOXES,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_SANDBOX,
  EXECUTOR_RUNTIMES,
  EXECUTOR_SCHEMA_VERSION,
  FORK_RECEIPT_KIND,
  LOCAL_PROVIDERS,
  MODEL_ID_PATTERN,
  OBSERVED_MODEL_PATTERN,
  PROFILE_ID_PATTERN,
  assertValidExecutorFile,
  assertValidExecutorProfile,
  bindExecutorProfiles,
  branchIdForProfile,
  branchResultDigest,
  createForkReceiptWrapper,
  evaluateModelProof,
  executorProfileDigest,
  executorSetDigest,
  missionControlExecutorState,
  normalizeExecutorFile,
  profileIdForBranchId,
  publicExecutorReplay,
  resolveExecutorSelection,
  runtimeInvocationForProfile,
  synthesizeLegacyExecutors,
  validateExecutorFile,
  validateExecutorProfile,
  verifyForkReceiptWrapper,
});
