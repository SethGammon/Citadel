'use strict';

const {
  AGENT_INSTANCE_STATUSES,
  APP_CONTRACT_KINDS,
  APP_CONTRACT_VERSION,
  FIELD_ALLOWLISTS,
  HANDOFF_STATUSES,
  SUPERVISOR_EVENT_TYPES,
  TERMINAL_AGENT_INSTANCE_STATUSES,
} = require('./constants');

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const REF_PATTERN = /^[a-z][a-z0-9]*(?:[-_.:/][a-z0-9]+)*$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, kind, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${kind} must be a plain object`);
    return false;
  }
  const expected = FIELD_ALLOWLISTS[kind];
  const actual = Object.keys(value).sort();
  if (!expected || JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    errors.push(`${kind} fields must exactly match the app contract allowlist`);
  }
  return true;
}

function baseErrors(value, kind) {
  const errors = [];
  if (!exactFields(value, kind, errors)) return errors;
  if (value.app_contract_version !== APP_CONTRACT_VERSION) {
    errors.push(`app_contract_version must be ${APP_CONTRACT_VERSION}`);
  }
  if (value.kind !== kind) errors.push(`kind must be ${kind}`);
  return errors;
}

function checkId(value, label, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 128 || !ID_PATTERN.test(value)) {
    errors.push(`${label} must be an opaque lowercase identifier`);
  }
}

function checkRef(value, label, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 256 || !REF_PATTERN.test(value)) {
    errors.push(`${label} must be an opaque reference`);
  }
}

function checkDigest(value, label, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    errors.push(`${label} must be a sha256 digest`);
  }
}

function checkTimestamp(value, label, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    errors.push(`${label} must be an ISO timestamp`);
    return;
  }
  if (new Date(value).toISOString() !== value) errors.push(`${label} must be a canonical ISO timestamp`);
}

function checkRevision(value, label, errors) {
  if (!Number.isSafeInteger(value) || value < 0) errors.push(`${label} must be a non-negative safe integer`);
}

function checkLabel(value, label, errors, maximum = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n]/.test(value)) {
    errors.push(`${label} must be a bounded single-line label`);
  }
}

function checkUniqueArray(value, label, errors, checkEntry, options = {}) {
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 256;
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    errors.push(`${label} must contain ${minimum} to ${maximum} entries`);
    return;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    checkEntry(entry, `${label}[${index}]`, errors);
    const key = JSON.stringify(entry);
    if (seen.has(key)) errors.push(`${label} cannot contain duplicates`);
    seen.add(key);
  });
}

function checkOrderedTimestamps(value, start, update, complete, errors) {
  checkTimestamp(value[start], start, errors, true);
  checkTimestamp(value[update], update, errors);
  checkTimestamp(value[complete], complete, errors, true);
  if (value[start] && Date.parse(value[update]) < Date.parse(value[start])) {
    errors.push(`${update} cannot precede ${start}`);
  }
  if (value[complete] && Date.parse(value[complete]) < Date.parse(value[update])) {
    errors.push(`${complete} cannot precede ${update}`);
  }
}

function validateAgentProfile(value) {
  const errors = baseErrors(value, APP_CONTRACT_KINDS.AGENT_PROFILE);
  if (!isPlainObject(value)) return errors;
  checkRevision(value.revision, 'revision', errors);
  checkId(value.profile_id, 'profile_id', errors);
  checkLabel(value.name, 'name', errors, 120);
  checkLabel(value.role, 'role', errors, 160);
  checkId(value.runtime_id, 'runtime_id', errors);
  if (value.model !== null) checkLabel(value.model, 'model', errors, 160);
  checkDigest(value.instructions_digest, 'instructions_digest', errors);
  checkUniqueArray(value.skill_ids, 'skill_ids', errors, checkId, { maximum: 128 });
  checkId(value.memory_policy_id, 'memory_policy_id', errors);
  checkId(value.permission_policy_id, 'permission_policy_id', errors);
  checkId(value.resource_policy_id, 'resource_policy_id', errors);
  checkTimestamp(value.created_at, 'created_at', errors);
  checkTimestamp(value.updated_at, 'updated_at', errors);
  if (value.created_at && value.updated_at && Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    errors.push('updated_at cannot precede created_at');
  }
  return errors;
}

function validateAgentInstance(value) {
  const errors = baseErrors(value, APP_CONTRACT_KINDS.AGENT_INSTANCE);
  if (!isPlainObject(value)) return errors;
  checkRevision(value.revision, 'revision', errors);
  checkId(value.instance_id, 'instance_id', errors);
  checkId(value.profile_id, 'profile_id', errors);
  checkRevision(value.profile_revision, 'profile_revision', errors);
  checkDigest(value.profile_snapshot_digest, 'profile_snapshot_digest', errors);
  checkId(value.operation_id, 'operation_id', errors);
  checkId(value.workspace_id, 'workspace_id', errors);
  checkId(value.supervisor_id, 'supervisor_id', errors);
  if (!AGENT_INSTANCE_STATUSES.includes(value.status)) {
    errors.push(`status must be one of ${AGENT_INSTANCE_STATUSES.join(', ')}`);
  }
  checkRef(value.process_ref, 'process_ref', errors, true);
  checkRef(value.terminal_ref, 'terminal_ref', errors, true);
  checkRef(value.branch_ref, 'branch_ref', errors, true);
  checkRef(value.worktree_ref, 'worktree_ref', errors, true);
  checkDigest(value.budget_digest, 'budget_digest', errors);
  checkOrderedTimestamps(value, 'started_at', 'updated_at', 'completed_at', errors);
  if (value.exit_code !== null && (!Number.isInteger(value.exit_code) || value.exit_code < -2147483648 || value.exit_code > 2147483647)) {
    errors.push('exit_code must be null or a signed 32-bit integer');
  }
  if (value.failure_code !== null && (typeof value.failure_code !== 'string' || !CODE_PATTERN.test(value.failure_code))) {
    errors.push('failure_code must be null or a bounded uppercase code');
  }
  const terminal = TERMINAL_AGENT_INSTANCE_STATUSES.includes(value.status);
  if (terminal && value.completed_at === null) errors.push('terminal instances require completed_at');
  if (!terminal && value.completed_at !== null) errors.push('non-terminal instances prohibit completed_at');
  if (value.status === 'failed' && value.failure_code === null) errors.push('failed instances require failure_code');
  if (value.status !== 'failed' && value.failure_code !== null) errors.push('failure_code is only valid for failed instances');
  return errors;
}

function validateTeam(value) {
  const errors = baseErrors(value, APP_CONTRACT_KINDS.TEAM);
  if (!isPlainObject(value)) return errors;
  checkRevision(value.revision, 'revision', errors);
  checkId(value.team_id, 'team_id', errors);
  checkLabel(value.name, 'name', errors, 120);
  checkUniqueArray(value.member_profile_ids, 'member_profile_ids', errors, checkId, { minimum: 1, maximum: 128 });
  checkId(value.coordination_policy_id, 'coordination_policy_id', errors);
  checkId(value.handoff_policy_id, 'handoff_policy_id', errors);
  checkId(value.resource_policy_id, 'resource_policy_id', errors);
  checkTimestamp(value.created_at, 'created_at', errors);
  checkTimestamp(value.updated_at, 'updated_at', errors);
  return errors;
}

function validateWorkspaceRef(value) {
  const errors = baseErrors(value, APP_CONTRACT_KINDS.WORKSPACE_REF);
  if (!isPlainObject(value)) return errors;
  checkRevision(value.revision, 'revision', errors);
  checkId(value.workspace_id, 'workspace_id', errors);
  checkLabel(value.name, 'name', errors, 160);
  checkDigest(value.root_digest, 'root_digest', errors);
  checkUniqueArray(value.instruction_digests, 'instruction_digests', errors, checkDigest, { maximum: 128 });
  checkUniqueArray(value.runtime_ids, 'runtime_ids', errors, checkId, { maximum: 32 });
  if (typeof value.editable !== 'boolean') errors.push('editable must be boolean');
  checkTimestamp(value.last_opened_at, 'last_opened_at', errors);
  return errors;
}

function validateHandoff(value) {
  const errors = baseErrors(value, APP_CONTRACT_KINDS.HANDOFF);
  if (!isPlainObject(value)) return errors;
  checkRevision(value.revision, 'revision', errors);
  checkId(value.handoff_id, 'handoff_id', errors);
  checkId(value.operation_id, 'operation_id', errors);
  checkId(value.from_instance_id, 'from_instance_id', errors);
  checkId(value.to_profile_id, 'to_profile_id', errors);
  checkId(value.to_instance_id, 'to_instance_id', errors, true);
  if (!HANDOFF_STATUSES.includes(value.status)) errors.push(`status must be one of ${HANDOFF_STATUSES.join(', ')}`);
  checkDigest(value.outcome_digest, 'outcome_digest', errors);
  checkUniqueArray(value.decision_digests, 'decision_digests', errors, checkDigest, { maximum: 256 });
  checkUniqueArray(value.blocker_codes, 'blocker_codes', errors, (entry, label, list) => {
    if (typeof entry !== 'string' || !CODE_PATTERN.test(entry)) list.push(`${label} must be a bounded uppercase code`);
  }, { maximum: 128 });
  checkUniqueArray(value.artifact_digests, 'artifact_digests', errors, checkDigest, { maximum: 1024 });
  checkUniqueArray(value.verification_digests, 'verification_digests', errors, checkDigest, { maximum: 1024 });
  checkDigest(value.next_action_digest, 'next_action_digest', errors);
  checkTimestamp(value.created_at, 'created_at', errors);
  checkTimestamp(value.resolved_at, 'resolved_at', errors, true);
  if (value.status === 'pending' && value.resolved_at !== null) errors.push('pending handoffs prohibit resolved_at');
  if (value.status !== 'pending' && value.resolved_at === null) errors.push('resolved handoffs require resolved_at');
  return errors;
}

function validateSupervisorEvent(value) {
  const errors = baseErrors(value, APP_CONTRACT_KINDS.SUPERVISOR_EVENT);
  if (!isPlainObject(value)) return errors;
  checkId(value.event_id, 'event_id', errors);
  checkId(value.supervisor_id, 'supervisor_id', errors);
  checkId(value.operation_id, 'operation_id', errors, true);
  checkId(value.instance_id, 'instance_id', errors, true);
  if (!Number.isInteger(value.sequence) || value.sequence < 0 || value.sequence > Number.MAX_SAFE_INTEGER) {
    errors.push('sequence must be a non-negative safe integer');
  }
  checkRevision(value.subject_revision, 'subject_revision', errors);
  if (!SUPERVISOR_EVENT_TYPES.includes(value.event_type)) {
    errors.push(`event_type must be one of ${SUPERVISOR_EVENT_TYPES.join(', ')}`);
  }
  if (![...AGENT_INSTANCE_STATUSES, ...HANDOFF_STATUSES, 'unknown'].includes(value.status)) {
    errors.push('status must be an agent, handoff, or unknown status');
  }
  checkDigest(value.payload_digest, 'payload_digest', errors, true);
  checkTimestamp(value.recorded_at, 'recorded_at', errors);
  return errors;
}

function validateOperationDefinition(value) {
  const errors = baseErrors(value, APP_CONTRACT_KINDS.OPERATION_DEFINITION);
  if (!isPlainObject(value)) return errors;
  checkRevision(value.revision, 'revision', errors);
  checkId(value.operation_id, 'operation_id', errors);
  checkId(value.workspace_id, 'workspace_id', errors);
  checkId(value.team_id, 'team_id', errors, true);
  checkId(value.lead_profile_id, 'lead_profile_id', errors);
  checkLabel(value.title, 'title', errors, 160);
  checkDigest(value.objective_digest, 'objective_digest', errors);
  checkUniqueArray(value.step_ids, 'step_ids', errors, checkId, { minimum: 1, maximum: 256 });
  checkUniqueArray(value.policy_digests, 'policy_digests', errors, checkDigest, { maximum: 256 });
  checkTimestamp(value.created_at, 'created_at', errors);
  checkTimestamp(value.updated_at, 'updated_at', errors);
  if (value.created_at && value.updated_at && Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    errors.push('updated_at cannot precede created_at');
  }
  return errors;
}

const VALIDATORS = Object.freeze({
  [APP_CONTRACT_KINDS.AGENT_PROFILE]: validateAgentProfile,
  [APP_CONTRACT_KINDS.AGENT_INSTANCE]: validateAgentInstance,
  [APP_CONTRACT_KINDS.OPERATION_DEFINITION]: validateOperationDefinition,
  [APP_CONTRACT_KINDS.TEAM]: validateTeam,
  [APP_CONTRACT_KINDS.WORKSPACE_REF]: validateWorkspaceRef,
  [APP_CONTRACT_KINDS.HANDOFF]: validateHandoff,
  [APP_CONTRACT_KINDS.SUPERVISOR_EVENT]: validateSupervisorEvent,
});

function validateAppContract(value) {
  if (!isPlainObject(value)) return ['app contract must be a plain object'];
  const validator = VALIDATORS[value.kind];
  if (!validator) return [`unknown app contract kind: ${value.kind || '(missing)'}`];
  return validator(value);
}

function assertValidAppContract(value) {
  const errors = validateAppContract(value);
  if (errors.length) throw new TypeError(`Invalid ${value?.kind || 'app contract'}: ${errors.join('; ')}`);
  return value;
}

module.exports = Object.freeze({
  CODE_PATTERN,
  DIGEST_PATTERN,
  ID_PATTERN,
  REF_PATTERN,
  assertValidAppContract,
  validateAgentInstance,
  validateAgentProfile,
  validateAppContract,
  validateHandoff,
  validateOperationDefinition,
  validateSupervisorEvent,
  validateTeam,
  validateWorkspaceRef,
});
