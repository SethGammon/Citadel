'use strict';

const { sha256Digest } = require('../operations');

const POLICY_VERSION = 1;
const SCOPES = Object.freeze(['organization', 'repository-class', 'repository', 'campaign', 'task']);
const FIELDS = Object.freeze([
  'schema_version', 'policy_id', 'scope', 'parent_digest', 'allowed_runtimes',
  'required_capabilities', 'approval_actions', 'max_parallel_agents',
  'max_budget_units', 'allow_source_upload', 'telemetry_mode',
]);
const ACTIONS = Object.freeze(['approve', 'pause', 'resume', 'retry', 'stop', 'external-write']);
const REQUEST_FIELDS = Object.freeze([
  'runtime', 'capabilities', 'action', 'parallel_agents', 'budget_units', 'source_upload', 'approved',
]);
const TELEMETRY_RANK = Object.freeze({ off: 0, local: 1, 'opt-in-export': 2 });

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function stringList(value, label, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    errors.push(`${label} must be an array of non-empty strings`);
  } else if (new Set(value).size !== value.length) errors.push(`${label} must be unique`);
}

function validatePolicy(value) {
  const errors = [];
  if (!plain(value)) return ['policy must be a plain object'];
  const unknown = Object.keys(value).filter((field) => !FIELDS.includes(field));
  const missing = FIELDS.filter((field) => !(field in value));
  if (unknown.length) errors.push(`unknown policy fields: ${unknown.join(', ')}`);
  if (missing.length) errors.push(`missing policy fields: ${missing.join(', ')}`);
  if (value.schema_version !== POLICY_VERSION) errors.push(`schema_version must be ${POLICY_VERSION}`);
  if (typeof value.policy_id !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/.test(value.policy_id)) errors.push('policy_id is invalid');
  if (!SCOPES.includes(value.scope)) errors.push('scope is invalid');
  if (value.parent_digest !== null && !/^sha256:[a-f0-9]{64}$/.test(value.parent_digest || '')) errors.push('parent_digest is invalid');
  stringList(value.allowed_runtimes, 'allowed_runtimes', errors);
  stringList(value.required_capabilities, 'required_capabilities', errors);
  stringList(value.approval_actions, 'approval_actions', errors);
  if (Array.isArray(value.approval_actions)) for (const action of value.approval_actions) {
    if (!ACTIONS.includes(action)) errors.push(`unsupported approval action: ${action}`);
  }
  for (const field of ['max_parallel_agents', 'max_budget_units']) {
    if (!Number.isInteger(value[field]) || value[field] < 0) errors.push(`${field} must be a nonnegative integer`);
  }
  if (typeof value.allow_source_upload !== 'boolean') errors.push('allow_source_upload must be boolean');
  if (!['off', 'local', 'opt-in-export'].includes(value.telemetry_mode)) errors.push('telemetry_mode is invalid');
  return errors;
}

function assertPolicy(value) {
  const errors = validatePolicy(value);
  if (errors.length) throw new TypeError(`Invalid team policy: ${errors.join('; ')}`);
  return value;
}

function validatePolicyRequest(value) {
  const errors = [];
  if (!plain(value)) return ['request must be a plain object'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...REQUEST_FIELDS].sort())) {
    errors.push('request fields must exactly match the policy request schema');
  }
  if (typeof value.runtime !== 'string' || !value.runtime) errors.push('runtime must be a non-empty string');
  stringList(value.capabilities, 'capabilities', errors);
  if (!ACTIONS.includes(value.action)) errors.push('action is unsupported');
  for (const field of ['parallel_agents', 'budget_units']) {
    if (!Number.isInteger(value[field]) || value[field] < 0) errors.push(`${field} must be a nonnegative integer`);
  }
  if (typeof value.source_upload !== 'boolean') errors.push('source_upload must be boolean');
  if (typeof value.approved !== 'boolean') errors.push('approved must be boolean');
  return errors;
}

function resolvePolicy(chain) {
  if (!Array.isArray(chain) || chain.length === 0) throw new TypeError('policy chain is required');
  let resolved = null;
  chain.forEach((policy, index) => {
    assertPolicy(policy);
    if (index > 0 && policy.parent_digest !== sha256Digest(chain[index - 1])) {
      throw new Error(`policy ${policy.policy_id} parent_digest mismatch`);
    }
    resolved = resolved ? {
      ...policy,
      allowed_runtimes: resolved.allowed_runtimes.filter((runtime) => policy.allowed_runtimes.includes(runtime)),
      required_capabilities: [...new Set([...resolved.required_capabilities, ...policy.required_capabilities])].sort(),
      approval_actions: [...new Set([...resolved.approval_actions, ...policy.approval_actions])].sort(),
      max_parallel_agents: Math.min(resolved.max_parallel_agents, policy.max_parallel_agents),
      max_budget_units: Math.min(resolved.max_budget_units, policy.max_budget_units),
      allow_source_upload: resolved.allow_source_upload && policy.allow_source_upload,
      telemetry_mode: TELEMETRY_RANK[resolved.telemetry_mode] <= TELEMETRY_RANK[policy.telemetry_mode]
        ? resolved.telemetry_mode : policy.telemetry_mode,
    } : { ...policy };
  });
  return Object.freeze({ ...resolved, policy_digest: sha256Digest(resolved) });
}

function evaluatePolicy(policy, request) {
  const requestErrors = validatePolicyRequest(request);
  if (requestErrors.length) return Object.freeze({
    status: 'blocked',
    policy_digest: policy.policy_digest || sha256Digest(policy),
    approval_required: false,
    violations: Object.freeze(['INVALID_REQUEST']),
  });
  const violations = [];
  if (!policy.allowed_runtimes.includes(request.runtime)) violations.push('RUNTIME_NOT_ALLOWED');
  for (const capability of policy.required_capabilities) {
    if (!(request.capabilities || []).includes(capability)) violations.push(`CAPABILITY_REQUIRED:${capability}`);
  }
  if (request.parallel_agents > policy.max_parallel_agents) violations.push('PARALLEL_LIMIT_EXCEEDED');
  if (request.budget_units > policy.max_budget_units) violations.push('BUDGET_LIMIT_EXCEEDED');
  if (request.source_upload && !policy.allow_source_upload) violations.push('SOURCE_UPLOAD_BLOCKED');
  const approvalRequired = policy.approval_actions.includes(request.action);
  if (approvalRequired && !request.approved) violations.push('APPROVAL_REQUIRED');
  return Object.freeze({ status: violations.length ? 'blocked' : 'passed',
    policy_digest: policy.policy_digest || sha256Digest(policy), approval_required: approvalRequired,
    violations: Object.freeze(violations) });
}

module.exports = Object.freeze({ ACTIONS, FIELDS, POLICY_VERSION, SCOPES,
  REQUEST_FIELDS, assertPolicy, evaluatePolicy, resolvePolicy, validatePolicy, validatePolicyRequest });
