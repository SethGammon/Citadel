'use strict';

const operations = require('../operations');

const FORK_SCHEMA_VERSION = 1;
const RUNTIMES = Object.freeze(['claude', 'codex']);
const FORK_STATUSES = Object.freeze([
  'pending', 'running', 'ready', 'selected', 'landed', 'blocked', 'failed', 'unknown',
]);
const BRANCH_STATUSES = Object.freeze([
  'pending', 'running', 'passed', 'failed', 'blocked', 'unknown',
]);
const SAFE_REF_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,159}$/;

const FORK_FIELDS = Object.freeze([
  'schema_version', 'fork_id', 'revision', 'operation', 'shared', 'contract_digest',
  'status', 'created_at', 'updated_at', 'branches', 'selection', 'landing',
]);
const SHARED_FIELDS = Object.freeze([
  'objective_digest', 'scope_digest', 'policy_digests', 'budget_digest',
  'workflow_digest', 'verifier_digest', 'base_revision',
]);
const BRANCH_FIELDS = Object.freeze([
  'branch_id', 'runtime', 'run_id', 'status', 'base_revision', 'worktree_ref',
  'branch_ref', 'contract_digest', 'started_at', 'completed_at', 'receipt_digest',
  'evidence_summary', 'diff_summary', 'duration_ms', 'cost', 'failure_code',
]);
const EVIDENCE_FIELDS = Object.freeze([
  'status', 'required', 'present', 'receipt_verified', 'score', 'score_max',
]);
const DIFF_FIELDS = Object.freeze(['files_changed', 'insertions', 'deletions', 'digest']);
const COST_FIELDS = Object.freeze(['amount', 'unit', 'source']);
const SELECTION_FIELDS = Object.freeze([
  'selection_id', 'branch_id', 'actor_id', 'expected_revision', 'idempotency_key',
  'reason_digest', 'selected_at',
]);
const LANDING_FIELDS = Object.freeze([
  'landing_id', 'branch_id', 'status', 'expected_target_revision',
  'result_revision', 'idempotency_key', 'confirmed_at', 'completed_at', 'reason_code',
]);

function exactFields(value, fields) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function canonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isDigest(value) {
  return typeof value === 'string' && operations.DIGEST_PATTERN.test(value);
}

function safeId(value) {
  return typeof value === 'string' && operations.ID_PATTERN.test(value);
}

function validateShared(shared) {
  const errors = [];
  if (!exactFields(shared, SHARED_FIELDS)) return ['shared contract fields are invalid'];
  for (const field of ['objective_digest', 'scope_digest', 'budget_digest', 'workflow_digest', 'verifier_digest']) {
    if (!isDigest(shared[field])) errors.push(`shared ${field} is invalid`);
  }
  if (!Array.isArray(shared.policy_digests) || shared.policy_digests.some((item) => !isDigest(item))) {
    errors.push('shared policy_digests are invalid');
  }
  if (typeof shared.base_revision !== 'string' || !/^[0-9a-f]{40,64}$/.test(shared.base_revision)) {
    errors.push('shared base_revision is invalid');
  }
  return errors;
}

function validateEvidenceSummary(value) {
  const errors = [];
  if (!exactFields(value, EVIDENCE_FIELDS)) return ['branch evidence_summary fields are invalid'];
  if (!BRANCH_STATUSES.includes(value.status)) errors.push('branch evidence status is invalid');
  for (const field of ['required', 'present']) {
    if (!Number.isInteger(value[field]) || value[field] < 0) errors.push(`branch evidence ${field} is invalid`);
  }
  if (typeof value.receipt_verified !== 'boolean') errors.push('branch receipt_verified is invalid');
  const bothScoresNull = value.score === null && value.score_max === null;
  const bothScoresValid = Number.isFinite(value.score) && Number.isFinite(value.score_max)
    && value.score >= 0 && value.score_max > 0 && value.score <= value.score_max;
  if (!bothScoresNull && !bothScoresValid) errors.push('branch evidence score is invalid');
  return errors;
}

function validateDiffSummary(value) {
  const errors = [];
  if (!exactFields(value, DIFF_FIELDS)) return ['branch diff_summary fields are invalid'];
  for (const field of ['files_changed', 'insertions', 'deletions']) {
    if (!Number.isInteger(value[field]) || value[field] < 0) errors.push(`branch diff ${field} is invalid`);
  }
  if (!isDigest(value.digest)) errors.push('branch diff digest is invalid');
  return errors;
}

function validateCost(value) {
  if (value === null) return [];
  const errors = [];
  if (!exactFields(value, COST_FIELDS)) return ['branch cost fields are invalid'];
  if (!Number.isFinite(value.amount) || value.amount < 0) errors.push('branch cost amount is invalid');
  if (typeof value.unit !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.unit)) errors.push('branch cost unit is invalid');
  if (typeof value.source !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.source)) errors.push('branch cost source is invalid');
  return errors;
}

function validateBranch(branch) {
  const errors = [];
  if (!exactFields(branch, BRANCH_FIELDS)) return ['branch fields are invalid'];
  if (!safeId(branch.branch_id)) errors.push('branch branch_id is invalid');
  if (!RUNTIMES.includes(branch.runtime)) errors.push('branch runtime is invalid');
  if (!safeId(branch.run_id)) errors.push('branch run_id is invalid');
  if (!BRANCH_STATUSES.includes(branch.status)) errors.push('branch status is invalid');
  if (typeof branch.base_revision !== 'string' || !/^[0-9a-f]{40,64}$/.test(branch.base_revision)) errors.push('branch base_revision is invalid');
  for (const field of ['worktree_ref', 'branch_ref']) {
    if (branch[field] !== null && (typeof branch[field] !== 'string' || !SAFE_REF_PATTERN.test(branch[field]) || branch[field].includes('..'))) {
      errors.push(`branch ${field} is invalid`);
    }
  }
  if (!isDigest(branch.contract_digest)) errors.push('branch contract_digest is invalid');
  for (const field of ['started_at', 'completed_at']) {
    if (branch[field] !== null && !canonicalTime(branch[field])) errors.push(`branch ${field} is invalid`);
  }
  if (branch.receipt_digest !== null && !isDigest(branch.receipt_digest)) errors.push('branch receipt_digest is invalid');
  if (branch.evidence_summary !== null) errors.push(...validateEvidenceSummary(branch.evidence_summary));
  if (branch.diff_summary !== null) errors.push(...validateDiffSummary(branch.diff_summary));
  if (branch.duration_ms !== null && (!Number.isInteger(branch.duration_ms) || branch.duration_ms < 0)) errors.push('branch duration_ms is invalid');
  errors.push(...validateCost(branch.cost));
  if (branch.failure_code !== null && (typeof branch.failure_code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(branch.failure_code))) {
    errors.push('branch failure_code is invalid');
  }
  return errors;
}

function validateSelection(value) {
  const errors = [];
  if (!exactFields(value, SELECTION_FIELDS)) return ['selection fields are invalid'];
  if (!safeId(value.selection_id) || !safeId(value.branch_id) || !safeId(value.actor_id)) errors.push('selection identifiers are invalid');
  if (!Number.isInteger(value.expected_revision) || value.expected_revision < 0) errors.push('selection expected_revision is invalid');
  if (typeof value.idempotency_key !== 'string' || value.idempotency_key.length < 8 || value.idempotency_key.length > 128) errors.push('selection idempotency_key is invalid');
  if (!isDigest(value.reason_digest)) errors.push('selection reason_digest is invalid');
  if (!canonicalTime(value.selected_at)) errors.push('selection selected_at is invalid');
  return errors;
}

function validateLanding(value) {
  const errors = [];
  if (!exactFields(value, LANDING_FIELDS)) return ['landing fields are invalid'];
  if (!safeId(value.landing_id) || !safeId(value.branch_id)) errors.push('landing identifiers are invalid');
  if (!['prepared', 'landed', 'blocked', 'failed', 'unknown'].includes(value.status)) errors.push('landing status is invalid');
  for (const field of ['expected_target_revision', 'result_revision']) {
    if (value[field] !== null && (typeof value[field] !== 'string' || !/^[0-9a-f]{40,64}$/.test(value[field]))) errors.push(`landing ${field} is invalid`);
  }
  if (typeof value.idempotency_key !== 'string' || value.idempotency_key.length < 8 || value.idempotency_key.length > 128) errors.push('landing idempotency_key is invalid');
  for (const field of ['confirmed_at', 'completed_at']) {
    if (value[field] !== null && !canonicalTime(value[field])) errors.push(`landing ${field} is invalid`);
  }
  if (value.reason_code !== null && (typeof value.reason_code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reason_code))) errors.push('landing reason_code is invalid');
  return errors;
}

function validateFork(fork) {
  const errors = [];
  if (!exactFields(fork, FORK_FIELDS)) return ['fork fields are invalid'];
  if (fork.schema_version !== FORK_SCHEMA_VERSION) errors.push('fork schema_version is invalid');
  if (!safeId(fork.fork_id)) errors.push('fork fork_id is invalid');
  if (!Number.isInteger(fork.revision) || fork.revision < 0) errors.push('fork revision is invalid');
  try { operations.assertValidOperationContract(fork.operation); } catch (error) { errors.push(`fork operation is invalid: ${error.message}`); }
  errors.push(...validateShared(fork.shared));
  if (!isDigest(fork.contract_digest)) errors.push('fork contract_digest is invalid');
  if (fork.shared && isDigest(fork.contract_digest) && fork.contract_digest !== operations.sha256Digest(fork.shared)) {
    errors.push('fork contract_digest does not match shared contract');
  }
  if (!FORK_STATUSES.includes(fork.status)) errors.push('fork status is invalid');
  for (const field of ['created_at', 'updated_at']) if (!canonicalTime(fork[field])) errors.push(`fork ${field} is invalid`);
  if (!Array.isArray(fork.branches) || fork.branches.length < 2) errors.push('fork requires at least two branches');
  else {
    const ids = new Set();
    const runtimes = new Set();
    for (const branch of fork.branches) {
      errors.push(...validateBranch(branch));
      if (ids.has(branch.branch_id)) errors.push('fork branch_id values must be unique');
      if (runtimes.has(branch.runtime)) errors.push('fork runtime values must be unique');
      ids.add(branch.branch_id);
      runtimes.add(branch.runtime);
      if (branch.contract_digest !== fork.contract_digest) errors.push('branch contract_digest does not match fork');
      if (branch.base_revision !== fork.shared.base_revision) errors.push('branch base_revision does not match fork');
    }
  }
  if (fork.selection !== null) errors.push(...validateSelection(fork.selection));
  if (fork.landing !== null) errors.push(...validateLanding(fork.landing));
  return errors;
}

function assertValidFork(fork) {
  const errors = validateFork(fork);
  if (errors.length) throw new TypeError(errors.join('; '));
  return fork;
}

module.exports = Object.freeze({
  BRANCH_STATUSES,
  FORK_SCHEMA_VERSION,
  FORK_STATUSES,
  RUNTIMES,
  SAFE_REF_PATTERN,
  assertValidFork,
  validateBranch,
  validateFork,
});
