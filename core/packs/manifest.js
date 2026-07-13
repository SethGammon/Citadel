'use strict';

const fs = require('fs');
const path = require('path');
const { resolveExistingFile } = require('../distribution/fs-safety');

const PACK_SCHEMA_VERSION = 1;
const PACK_FILE = 'citadel.pack.json';
const MANIFEST_FIELDS = Object.freeze([
  'schema_version', 'id', 'name', 'version', 'description', 'publisher', 'skills',
  'dependencies', 'permissions', 'capabilities', 'runtimes', 'entry_workflow',
  'artifacts', 'verification', 'stopping_conditions',
]);
const PUBLISHER_FIELDS = Object.freeze(['id', 'name']);
const PERMISSION_FIELDS = Object.freeze(['filesystem', 'network', 'external_actions']);
const VERIFICATION_FIELDS = Object.freeze(['id', 'command', 'required']);
const WORKFLOW_FIELDS = Object.freeze(['schema_version', 'id', 'description', 'steps']);
const STEP_FIELDS = Object.freeze(['id', 'skill', 'purpose', 'depends_on']);
const PERMISSIONS = Object.freeze({
  filesystem: ['read-only', 'workspace-write'],
  network: ['none', 'restricted'],
  external_actions: ['none', 'approval-required'],
});
const CAPABILITIES = Object.freeze([
  'workspace', 'git', 'worktrees', 'verification', 'github-read', 'github-write',
  'campaign-state', 'parallel-agents', 'deployment',
]);
const RUNTIMES = Object.freeze(['claude-code', 'codex']);
const STOPPING_CONDITIONS = Object.freeze([
  'verified', 'failed', 'blocked', 'unknown', 'needs-human-review',
  'budget-exhausted', 'attempt-limit', 'unsafe-to-continue',
]);
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, allowed, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label} has unknown field: ${key}`);
  }
}

function nonEmptyString(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${label} must be a non-empty string`);
}

function stringArray(value, label, errors, options = {}) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    errors.push(`${label} must be ${options.nonEmpty ? 'a non-empty' : 'an'} array`);
    return;
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) errors.push(`${label} entries must be non-empty strings`);
    else if (seen.has(item)) errors.push(`${label} contains duplicate: ${item}`);
    else seen.add(item);
  }
}

function safeRelative(value, label, errors) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    errors.push(`${label} must be a non-empty relative path`);
    return;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) errors.push(`${label} must not contain traversal segments`);
}

function validateManifest(manifest) {
  const errors = [];
  exactFields(manifest, MANIFEST_FIELDS, 'manifest', errors);
  if (!isPlainObject(manifest)) return errors;

  if (manifest.schema_version !== PACK_SCHEMA_VERSION) errors.push(`schema_version must be ${PACK_SCHEMA_VERSION}`);
  if (!ID_PATTERN.test(manifest.id || '')) errors.push('id must be publisher/name in lowercase kebab-case');
  if (!NAME_PATTERN.test(manifest.name || '')) errors.push('name must be lowercase kebab-case');
  if (typeof manifest.id === 'string' && typeof manifest.name === 'string' &&
      manifest.id.split('/')[1] !== manifest.name) errors.push('id suffix must match name');
  if (!VERSION_PATTERN.test(manifest.version || '')) errors.push('version must be semantic version syntax');
  nonEmptyString(manifest.description, 'description', errors);

  exactFields(manifest.publisher, PUBLISHER_FIELDS, 'publisher', errors);
  if (isPlainObject(manifest.publisher)) {
    if (!NAME_PATTERN.test(manifest.publisher.id || '')) errors.push('publisher.id must be lowercase kebab-case');
    nonEmptyString(manifest.publisher.name, 'publisher.name', errors);
    if (typeof manifest.id === 'string' && manifest.id.split('/')[0] !== manifest.publisher.id) {
      errors.push('id prefix must match publisher.id');
    }
  }

  stringArray(manifest.skills, 'skills', errors, { nonEmpty: true });
  if (Array.isArray(manifest.skills)) {
    for (const skill of manifest.skills) if (!NAME_PATTERN.test(skill)) errors.push(`invalid skill name: ${skill}`);
  }
  stringArray(manifest.dependencies, 'dependencies', errors);
  if (Array.isArray(manifest.dependencies)) {
    for (const dependency of manifest.dependencies) if (!ID_PATTERN.test(dependency)) errors.push(`invalid dependency id: ${dependency}`);
    if (manifest.dependencies.includes(manifest.id)) errors.push('pack must not depend on itself');
  }

  exactFields(manifest.permissions, PERMISSION_FIELDS, 'permissions', errors);
  if (isPlainObject(manifest.permissions)) {
    for (const field of PERMISSION_FIELDS) {
      if (!PERMISSIONS[field].includes(manifest.permissions[field])) {
        errors.push(`permissions.${field} must be one of: ${PERMISSIONS[field].join(', ')}`);
      }
    }
  }

  stringArray(manifest.capabilities, 'capabilities', errors, { nonEmpty: true });
  if (Array.isArray(manifest.capabilities)) {
    for (const capability of manifest.capabilities) {
      if (!CAPABILITIES.includes(capability)) errors.push(`unsupported capability: ${capability}`);
    }
  }
  stringArray(manifest.runtimes, 'runtimes', errors, { nonEmpty: true });
  if (Array.isArray(manifest.runtimes)) {
    for (const runtime of manifest.runtimes) if (!RUNTIMES.includes(runtime)) errors.push(`unsupported runtime: ${runtime}`);
  }

  safeRelative(manifest.entry_workflow, 'entry_workflow', errors);
  stringArray(manifest.artifacts, 'artifacts', errors, { nonEmpty: true });
  if (Array.isArray(manifest.artifacts)) {
    for (const artifact of manifest.artifacts) safeRelative(artifact, 'artifact', errors);
  }

  if (!Array.isArray(manifest.verification) || manifest.verification.length === 0) {
    errors.push('verification must be a non-empty array');
  } else {
    const ids = new Set();
    for (const [index, check] of manifest.verification.entries()) {
      exactFields(check, VERIFICATION_FIELDS, `verification[${index}]`, errors);
      if (!isPlainObject(check)) continue;
      if (!NAME_PATTERN.test(check.id || '')) errors.push(`verification[${index}].id must be lowercase kebab-case`);
      else if (ids.has(check.id)) errors.push(`duplicate verification id: ${check.id}`);
      else ids.add(check.id);
      nonEmptyString(check.command, `verification[${index}].command`, errors);
      if (typeof check.required !== 'boolean') errors.push(`verification[${index}].required must be boolean`);
    }
  }

  stringArray(manifest.stopping_conditions, 'stopping_conditions', errors, { nonEmpty: true });
  if (Array.isArray(manifest.stopping_conditions)) {
    for (const condition of manifest.stopping_conditions) {
      if (!STOPPING_CONDITIONS.includes(condition)) errors.push(`unsupported stopping condition: ${condition}`);
    }
  }
  return errors;
}

function validateWorkflow(workflow, manifest) {
  const errors = [];
  exactFields(workflow, WORKFLOW_FIELDS, 'workflow', errors);
  if (!isPlainObject(workflow)) return errors;
  if (workflow.schema_version !== 1) errors.push('workflow.schema_version must be 1');
  if (!NAME_PATTERN.test(workflow.id || '')) errors.push('workflow.id must be lowercase kebab-case');
  nonEmptyString(workflow.description, 'workflow.description', errors);
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('workflow.steps must be a non-empty array');
    return errors;
  }
  const steps = new Map();
  for (const [index, step] of workflow.steps.entries()) {
    exactFields(step, STEP_FIELDS, `workflow.steps[${index}]`, errors);
    if (!isPlainObject(step)) continue;
    if (!NAME_PATTERN.test(step.id || '')) errors.push(`workflow.steps[${index}].id must be lowercase kebab-case`);
    else if (steps.has(step.id)) errors.push(`duplicate workflow step id: ${step.id}`);
    else steps.set(step.id, step);
    if (!manifest.skills.includes(step.skill)) errors.push(`workflow step ${step.id || index} uses undeclared skill: ${step.skill}`);
    nonEmptyString(step.purpose, `workflow.steps[${index}].purpose`, errors);
    stringArray(step.depends_on, `workflow.steps[${index}].depends_on`, errors);
  }
  for (const step of steps.values()) {
    for (const dependency of step.depends_on || []) {
      if (!steps.has(dependency)) errors.push(`workflow step ${step.id} has missing dependency: ${dependency}`);
      if (dependency === step.id) errors.push(`workflow step ${step.id} depends on itself`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`workflow dependency cycle includes: ${id}`); return; }
    if (visited.has(id) || !steps.has(id)) return;
    visiting.add(id);
    for (const dependency of steps.get(id).depends_on || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of steps.keys()) visit(id);
  return [...new Set(errors)];
}

function loadPack(packRoot, options = {}) {
  const requestedRoot = path.resolve(packRoot);
  if (fs.lstatSync(requestedRoot).isSymbolicLink()) throw new Error(`Pack root must not be a symlink: ${requestedRoot}`);
  const root = fs.realpathSync(requestedRoot);
  const manifestPath = resolveExistingFile(root, PACK_FILE, 'Pack manifest');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { throw new Error(`Invalid Pack manifest JSON: ${error.message}`); }
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Invalid Pack manifest: ${errors.join('; ')}`);

  const workflowPath = resolveExistingFile(root, manifest.entry_workflow, 'Pack entry workflow');
  let workflow;
  try { workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8')); }
  catch (error) { throw new Error(`Invalid Pack workflow JSON: ${error.message}`); }
  const workflowErrors = validateWorkflow(workflow, manifest);
  if (workflowErrors.length) throw new Error(`Invalid Pack workflow: ${workflowErrors.join('; ')}`);

  const projectRoot = path.resolve(options.projectRoot || path.join(root, '..', '..'));
  for (const skill of manifest.skills) {
    const skillPath = path.join(projectRoot, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) throw new Error(`Pack skill not found: ${skill}`);
  }
  return { root, manifestPath, workflowPath, manifest, workflow, projectRoot };
}

module.exports = Object.freeze({
  CAPABILITIES,
  MANIFEST_FIELDS,
  PACK_FILE,
  PACK_SCHEMA_VERSION,
  PERMISSIONS,
  RUNTIMES,
  STOPPING_CONDITIONS,
  loadPack,
  validateManifest,
  validateWorkflow,
});
