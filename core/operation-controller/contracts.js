'use strict';

const crypto = require('crypto');

const REQUEST_SCHEMA = 2;
const CATALOG_SCHEMA = 1;
const ADAPTER_PROTOCOL = 'citadel-operation-adapter-v1';
const COST_LENSES = Object.freeze(['actual_cash', 'marginal', 'market_equivalent']);
const PRIVACY_LEVELS = Object.freeze(['local-only', 'allow-remote']);
const TOPOLOGIES = Object.freeze(['direct', 'tool', 'shallow-roma', 'deep-roma', 'custom']);
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const RUNTIME_SETTING_FIELDS = Object.freeze(['reasoning_effort', 'service_tier']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function exact(value, fields, name) {
  object(value, name);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${name} fields must exactly match: ${expected.join(', ')}`);
  }
  return value;
}

function exactOptional(value, fields, optional, name) {
  object(value, name);
  return exact(value, [...fields, ...optional.filter((field) => Object.prototype.hasOwnProperty.call(value, field))], name);
}

// Validate transport syntax, not model availability. The selected runtime must
// support each requested value; a runtime rejection must remain a failed attempt.
function runtimeSettings(value, name = 'settings') {
  const settings = {};
  for (const field of RUNTIME_SETTING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field) || value[field] === null) continue;
    if (typeof value[field] !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value[field])) {
      throw new TypeError(`${name}.${field} must be a bounded non-empty identifier or null`);
    }
    settings[field] = value[field];
  }
  return settings;
}

function id(value, name) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function stringArray(value, name, max = 64) {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || !ID_PATTERN.test(item))) {
    throw new TypeError(`${name} must be an array of identifiers`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${name} must not contain duplicates`);
  return value;
}

function codeArray(value, name, max = 64) {
  if (!Array.isArray(value) || value.length > max
    || value.some((item) => typeof item !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(item))) {
    throw new TypeError(`${name} must be an array of reason codes`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${name} must not contain duplicates`);
  return value;
}

function probability(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${name} must be between 0 and 1`);
  return value;
}

function positive(value, name, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new TypeError(`${name} must be ${allowZero ? 'non-negative' : 'positive'}`);
  return value;
}

function validateCostLens(value, name) {
  exact(value, ['status', 'amount_usd', 'basis', 'source'], name);
  if (!['known', 'unknown'].includes(value.status)) throw new TypeError(`${name}.status is invalid`);
  if (value.status === 'known') positive(value.amount_usd, `${name}.amount_usd`, true);
  if (value.status === 'unknown' && value.amount_usd !== null) throw new TypeError(`${name}.amount_usd must be null when unknown`);
  if (!['estimate', 'observed', 'subscription', 'list-price', 'not-applicable'].includes(value.basis)) throw new TypeError(`${name}.basis is invalid`);
  if (typeof value.source !== 'string' || !value.source.trim() || value.source.length > 256) throw new TypeError(`${name}.source is invalid`);
  return value;
}

function validateCosts(value, name = 'costs') {
  exact(value, COST_LENSES, name);
  for (const lens of COST_LENSES) validateCostLens(value[lens], `${name}.${lens}`);
  return value;
}

function validateVerifier(value) {
  object(value, 'request.verifier');
  if (value.kind === 'command') {
    exact(value, ['kind', 'executable', 'args', 'cwd', 'timeout_ms', 'required_changed_paths'], 'request.verifier');
    if (typeof value.executable !== 'string' || !value.executable.trim()) throw new TypeError('request.verifier.executable is required');
    if (!Array.isArray(value.args) || value.args.some((item) => typeof item !== 'string')) throw new TypeError('request.verifier.args must be strings');
    if (typeof value.cwd !== 'string' || !value.cwd.trim()) throw new TypeError('request.verifier.cwd is required');
    positive(value.timeout_ms, 'request.verifier.timeout_ms');
    if (!Array.isArray(value.required_changed_paths) || value.required_changed_paths.length > 64
      || value.required_changed_paths.some((item) => typeof item !== 'string'
        || !item.trim() || pathIsUnsafe(item))) {
      throw new TypeError('request.verifier.required_changed_paths must contain safe relative paths');
    }
    return value;
  }
  if (value.kind === 'adapter-result') {
    exact(value, ['kind'], 'request.verifier');
    return value;
  }
  throw new TypeError('request.verifier.kind is invalid');
}

function pathIsUnsafe(value) {
  const normalized = String(value).replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some((segment) => segment === '..' || segment === '');
}

function validateRequest(value) {
  exact(value, ['schema', 'operation_id', 'objective', 'feature_key', 'quality_target', 'constraints', 'verifier'], 'request');
  if (value.schema !== REQUEST_SCHEMA) throw new TypeError(`request.schema must be ${REQUEST_SCHEMA}`);
  id(value.operation_id, 'request.operation_id');
  if (typeof value.objective !== 'string' || !value.objective.trim() || value.objective.length > 8000) throw new TypeError('request.objective is invalid');
  id(value.feature_key, 'request.feature_key');
  probability(value.quality_target, 'request.quality_target');
  exact(value.constraints, ['privacy', 'allowed_tools', 'required_tools', 'max_duration_ms', 'budgets', 'unknown_cost_policy'], 'request.constraints');
  if (!PRIVACY_LEVELS.includes(value.constraints.privacy)) throw new TypeError('request.constraints.privacy is invalid');
  stringArray(value.constraints.allowed_tools, 'request.constraints.allowed_tools');
  stringArray(value.constraints.required_tools, 'request.constraints.required_tools');
  if (value.constraints.required_tools.some((tool) => !value.constraints.allowed_tools.includes(tool))) throw new TypeError('required tools must also be allowed');
  positive(value.constraints.max_duration_ms, 'request.constraints.max_duration_ms');
  exact(value.constraints.budgets, COST_LENSES, 'request.constraints.budgets');
  for (const lens of COST_LENSES) {
    const amount = value.constraints.budgets[lens];
    if (amount !== null) positive(amount, `request.constraints.budgets.${lens}`, true);
  }
  if (!['deny', 'allow'].includes(value.constraints.unknown_cost_policy)) throw new TypeError('request.constraints.unknown_cost_policy is invalid');
  validateVerifier(value.verifier);
  return value;
}

function validateAdapter(value, name) {
  exact(value, ['protocol', 'executable', 'args', 'timeout_ms', 'environment_allowlist'], name);
  if (value.protocol !== ADAPTER_PROTOCOL) throw new TypeError(`${name}.protocol must be ${ADAPTER_PROTOCOL}`);
  if (typeof value.executable !== 'string' || !value.executable.trim()) throw new TypeError(`${name}.executable is required`);
  if (!Array.isArray(value.args) || value.args.some((item) => typeof item !== 'string')) throw new TypeError(`${name}.args must be strings`);
  positive(value.timeout_ms, `${name}.timeout_ms`);
  if (!Array.isArray(value.environment_allowlist)
    || value.environment_allowlist.length > 64
    || value.environment_allowlist.some((item) => typeof item !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item))) {
    throw new TypeError(`${name}.environment_allowlist must contain environment variable names`);
  }
  if (new Set(value.environment_allowlist).size !== value.environment_allowlist.length) {
    throw new TypeError(`${name}.environment_allowlist must not contain duplicates`);
  }
  return value;
}

function validatePlan(value, name) {
  exactOptional(value, [
    'plan_id', 'label', 'adapter_id', 'topology', 'model', 'tools', 'privacy', 'feature_keys',
    'prior', 'expected_duration_ms', 'costs', 'retry_on', 'max_retries', 'fallback_plan_ids',
  ], RUNTIME_SETTING_FIELDS, name);
  runtimeSettings(value, name);
  id(value.plan_id, `${name}.plan_id`);
  if (typeof value.label !== 'string' || !value.label.trim()) throw new TypeError(`${name}.label is required`);
  id(value.adapter_id, `${name}.adapter_id`);
  if (!TOPOLOGIES.includes(value.topology)) throw new TypeError(`${name}.topology is invalid`);
  if (value.model !== null && (typeof value.model !== 'string' || !value.model.trim())) throw new TypeError(`${name}.model is invalid`);
  stringArray(value.tools, `${name}.tools`);
  if (!PRIVACY_LEVELS.includes(value.privacy)) throw new TypeError(`${name}.privacy is invalid`);
  stringArray(value.feature_keys, `${name}.feature_keys`);
  exact(value.prior, ['success_probability', 'strength', 'source'], `${name}.prior`);
  probability(value.prior.success_probability, `${name}.prior.success_probability`);
  positive(value.prior.strength, `${name}.prior.strength`);
  if (typeof value.prior.source !== 'string' || !value.prior.source.trim()) throw new TypeError(`${name}.prior.source is invalid`);
  positive(value.expected_duration_ms, `${name}.expected_duration_ms`);
  validateCosts(value.costs, `${name}.costs`);
  codeArray(value.retry_on, `${name}.retry_on`);
  if (!Number.isInteger(value.max_retries) || value.max_retries < 0 || value.max_retries > 3) throw new TypeError(`${name}.max_retries is invalid`);
  stringArray(value.fallback_plan_ids, `${name}.fallback_plan_ids`, 1);
  return value;
}

function validateCatalog(value) {
  exact(value, ['schema', 'catalog_id', 'adapters', 'plans'], 'catalog');
  if (value.schema !== CATALOG_SCHEMA) throw new TypeError(`catalog.schema must be ${CATALOG_SCHEMA}`);
  id(value.catalog_id, 'catalog.catalog_id');
  object(value.adapters, 'catalog.adapters');
  for (const [adapterId, adapter] of Object.entries(value.adapters)) {
    id(adapterId, 'catalog adapter id');
    validateAdapter(adapter, `catalog.adapters.${adapterId}`);
  }
  if (!Array.isArray(value.plans) || !value.plans.length || value.plans.length > 64) throw new TypeError('catalog.plans must contain 1-64 plans');
  const ids = new Set();
  for (let index = 0; index < value.plans.length; index += 1) {
    const plan = validatePlan(value.plans[index], `catalog.plans[${index}]`);
    if (ids.has(plan.plan_id)) throw new TypeError(`duplicate plan_id: ${plan.plan_id}`);
    if (!value.adapters[plan.adapter_id]) throw new TypeError(`unknown adapter_id: ${plan.adapter_id}`);
    ids.add(plan.plan_id);
  }
  for (const plan of value.plans) {
    for (const fallback of plan.fallback_plan_ids) if (!ids.has(fallback)) throw new TypeError(`unknown fallback plan: ${fallback}`);
  }
  return value;
}

function validateHistoryRecord(value, index = 0) {
  exactOptional(value, ['schema', 'feature_key', 'plan_id', 'verification_status', 'duration_ms', 'costs', 'observed_tools'], RUNTIME_SETTING_FIELDS, `history[${index}]`);
  runtimeSettings(value, `history[${index}]`);
  if (value.schema !== 1) throw new TypeError(`history[${index}].schema must be 1`);
  id(value.feature_key, `history[${index}].feature_key`);
  id(value.plan_id, `history[${index}].plan_id`);
  if (!['passed', 'failed', 'unknown'].includes(value.verification_status)) throw new TypeError(`history[${index}].verification_status is invalid`);
  positive(value.duration_ms, `history[${index}].duration_ms`, true);
  validateCosts(value.costs, `history[${index}].costs`);
  stringArray(value.observed_tools, `history[${index}].observed_tools`);
  return value;
}

function validateHistory(value) {
  if (!Array.isArray(value)) throw new TypeError('history must be an array');
  value.forEach(validateHistoryRecord);
  return value;
}

module.exports = Object.freeze({
  ADAPTER_PROTOCOL,
  CATALOG_SCHEMA,
  COST_LENSES,
  ID_PATTERN,
  PRIVACY_LEVELS,
  REQUEST_SCHEMA,
  RUNTIME_SETTING_FIELDS,
  TOPOLOGIES,
  canonical,
  codeArray,
  digest,
  exactOptional,
  runtimeSettings,
  validateAdapter,
  validateCatalog,
  validateCostLens,
  validateCosts,
  validateHistory,
  validateHistoryRecord,
  validatePlan,
  validateRequest,
});
