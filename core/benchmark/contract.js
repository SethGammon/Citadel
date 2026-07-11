'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCENARIO_FIELDS = Object.freeze([
  'schema', 'id', 'category', 'repository', 'pinned_ref', 'task', 'setup_command',
  'verification_command', 'expected_artifacts', 'timeout_minutes', 'context_reset_at',
  'cleanup_assertions', 'runtime', 'model',
]);
const CATEGORIES = Object.freeze([
  'short_control', 'long_task', 'context_reset', 'parallel_work', 'safety_boundary', 'cleanup',
]);
const MODES = Object.freeze(['bare', 'harnessed']);
const METRIC_IDENTITIES = Object.freeze([
  'verified_completion_rate', 'completion_recovery_rate', 'human_interventions',
  'regressions', 'duration_ms', 'estimated_cost', 'cleanup_rate',
]);
const FREEZE_FIELDS = Object.freeze([
  'schema', 'frozen_at', 'scenario_count', 'scenario_set_id', 'metric_set_id',
  'policy', 'external_scenario', 'attestation_public_key',
]);
const EXTERNAL_SCENARIO_FIELDS = Object.freeze([
  'scenario_id', 'selected_by', 'selected_at', 'selection_source',
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error(`${label} must be a relative path`);
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`${label} escapes the workspace`);
  return value;
}

function command(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((part) => typeof part !== 'string' || !part)) {
    throw new Error(`${label} must be a non-empty argv array`);
  }
}

function validateScenario(value, source = 'scenario') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const keys = Object.keys(value).sort();
  const expected = [...SCENARIO_FIELDS].sort();
  if (canonical(keys) !== canonical(expected)) throw new Error(`${source} fields must exactly match schema 1`);
  if (value.schema !== 1) throw new Error(`${source}.schema must be 1`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) throw new Error(`${source}.id is invalid`);
  if (!CATEGORIES.includes(value.category)) throw new Error(`${source}.category is invalid`);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(value.repository)) {
    throw new Error(`${source}.repository must be an HTTPS GitHub repository`);
  }
  if (!/^[0-9a-f]{40}$/.test(value.pinned_ref)) throw new Error(`${source}.pinned_ref must be a full commit SHA`);
  if (typeof value.task !== 'string' || value.task.trim().length < 20) throw new Error(`${source}.task is too short`);
  command(value.setup_command, `${source}.setup_command`);
  command(value.verification_command, `${source}.verification_command`);
  if (!Array.isArray(value.expected_artifacts)) throw new Error(`${source}.expected_artifacts must be an array`);
  value.expected_artifacts.forEach((item, index) => safeRelative(item, `${source}.expected_artifacts[${index}]`));
  if (!Number.isInteger(value.timeout_minutes) || value.timeout_minutes < 1 || value.timeout_minutes > 120) {
    throw new Error(`${source}.timeout_minutes must be an integer from 1 to 120`);
  }
  if (value.context_reset_at !== null && (!Number.isInteger(value.context_reset_at) || value.context_reset_at < 1)) {
    throw new Error(`${source}.context_reset_at must be null or a positive integer`);
  }
  if (!Array.isArray(value.cleanup_assertions) || value.cleanup_assertions.length === 0
    || value.cleanup_assertions.some((item) => !['git_clean', 'workspace_removed'].includes(item))) {
    throw new Error(`${source}.cleanup_assertions contains an unsupported assertion`);
  }
  if (!['claude', 'codex'].includes(value.runtime)) throw new Error(`${source}.runtime is invalid`);
  if (typeof value.model !== 'string' || !value.model.trim()) throw new Error(`${source}.model is required`);
  return value;
}

function loadScenarios(directory) {
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  const scenarios = files.map((name) => validateScenario(
    JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')),
    name,
  ));
  const ids = new Set();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
  }
  if (scenarios.length < 8 || scenarios.length > 12) throw new Error('Scenario set must contain 8-12 manifests');
  for (const category of CATEGORIES) {
    if (!scenarios.some((scenario) => scenario.category === category)) throw new Error(`Scenario set is missing ${category}`);
  }
  return scenarios;
}

function scenarioSetIdentity(scenarios) {
  return `scenario-set-sha256:${digest(scenarios)}`;
}

function metricSetIdentity() {
  return `metric-set-sha256:${digest(METRIC_IDENTITIES)}`;
}

function validateFreeze(value, scenarios, source = 'freeze') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${source} must be an object`);
  if (canonical(Object.keys(value).sort()) !== canonical([...FREEZE_FIELDS].sort())) {
    throw new Error(`${source} fields must exactly match schema 1`);
  }
  if (value.schema !== 1) throw new Error(`${source}.schema must be 1`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.frozen_at)) throw new Error(`${source}.frozen_at is invalid`);
  if (value.scenario_count !== scenarios.length) throw new Error(`${source}.scenario_count mismatch`);
  if (value.scenario_set_id !== scenarioSetIdentity(scenarios)) throw new Error(`${source}.scenario_set_id mismatch`);
  if (value.metric_set_id !== metricSetIdentity()) throw new Error(`${source}.metric_set_id mismatch`);
  if (typeof value.policy !== 'string' || !value.policy.trim()) throw new Error(`${source}.policy is required`);
  if (value.external_scenario !== null) {
    const selected = value.external_scenario;
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)
      || canonical(Object.keys(selected).sort()) !== canonical([...EXTERNAL_SCENARIO_FIELDS].sort())) {
      throw new Error(`${source}.external_scenario fields are invalid`);
    }
    if (!scenarios.some((scenario) => scenario.id === selected.scenario_id)) {
      throw new Error(`${source}.external_scenario is not in the frozen scenario set`);
    }
    if (typeof selected.selected_by !== 'string' || !selected.selected_by.trim()) throw new Error(`${source}.external_scenario.selected_by is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selected.selected_at)) throw new Error(`${source}.external_scenario.selected_at is invalid`);
    if (!/^https:\/\//.test(selected.selection_source)) throw new Error(`${source}.external_scenario.selection_source must be HTTPS`);
  }
  if (value.attestation_public_key !== null
    && (typeof value.attestation_public_key !== 'string'
      || !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\n?$/.test(value.attestation_public_key))) {
    throw new Error(`${source}.attestation_public_key must be a PEM public key or null`);
  }
  if (value.attestation_public_key !== null) {
    try {
      if (crypto.createPublicKey(value.attestation_public_key).asymmetricKeyType !== 'ed25519') {
        throw new Error('wrong key type');
      }
    } catch {
      throw new Error(`${source}.attestation_public_key must be Ed25519`);
    }
  }
  if ((value.external_scenario === null) !== (value.attestation_public_key === null)) {
    throw new Error(`${source} must freeze external selection and attestation key together`);
  }
  return value;
}

function loadFreeze(file, scenarios) {
  return validateFreeze(JSON.parse(fs.readFileSync(file, 'utf8')), scenarios, path.basename(file));
}

function assertSymmetricPair(a, b) {
  for (const field of ['scenario_id', 'category', 'task_hash', 'runtime_version', 'model', 'timeout_minutes', 'verification_command']) {
    if (canonical(a[field]) !== canonical(b[field])) throw new Error(`Asymmetric run input: ${field}`);
  }
}

module.exports = {
  CATEGORIES,
  METRIC_IDENTITIES,
  MODES,
  SCENARIO_FIELDS,
  assertSymmetricPair,
  canonical,
  digest,
  loadFreeze,
  loadScenarios,
  metricSetIdentity,
  safeRelative,
  scenarioSetIdentity,
  validateScenario,
  validateFreeze,
};
