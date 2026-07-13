'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONTRACT_KINDS,
  PROTOCOL_VERSION,
} = require('./constants');
const { sha256Digest } = require('./canonical');
const {
  ID_PATTERN,
  validateIntent,
  validateOperationRun,
  validateOperationSpec,
} = require('./validation');

const CONTROL_VERSION = '0.1';
const SAFE_FILE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
const CONTROL_ACTIONS = Object.freeze(['pause', 'resume', 'stop', 'retry']);
const CONTROL_OUTCOMES = Object.freeze(['accepted', 'rejected', 'conflict', 'blocked', 'unknown']);
const CONTROL_FIELDS = Object.freeze(['control_version', 'revision', 'capabilities', 'spec', 'run']);
const REQUEST_FIELDS = Object.freeze([
  'operation_id', 'expected_revision', 'idempotency_key', 'actor', 'reason', 'capability', 'action',
]);
const RESULT_FIELDS = Object.freeze([
  'outcome', 'operation_id', 'action', 'intent_id', 'expected_revision', 'current_revision', 'reason_code',
]);
const INTENT_RECORD_FIELDS = Object.freeze([
  'control_version', 'expected_revision', 'idempotency_key', 'actor', 'reason', 'capability',
  'request_digest', 'result', 'protocol_intent',
]);
const DECISION_FIELDS = Object.freeze(['control_version', 'idempotency_key', 'request_digest', 'result']);
const LOCK_OWNER_FIELDS = Object.freeze(['version', 'pid', 'created_at']);
const LOCK_OWNER_FILE = 'owner.json';
const LOCK_STALE_MS = 5 * 60 * 1000;

const ACTION_STATES = Object.freeze({
  pause: Object.freeze(['running']),
  resume: Object.freeze(['blocked']),
  stop: Object.freeze(['pending', 'running', 'blocked']),
  retry: Object.freeze(['failed', 'blocked', 'unknown']),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, fields) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function containsPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function fixedProjectRoot(value) {
  const resolved = path.resolve(value || process.cwd());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new TypeError('Project root must be an existing directory');
  }
  return fs.realpathSync(resolved);
}

function assertRequestRoot(fixedRoot, requestedRoot) {
  if (requestedRoot === undefined) return fixedRoot;
  if (typeof requestedRoot !== 'string' || !requestedRoot) throw new TypeError('project_root must be a path string');
  const resolved = fixedProjectRoot(requestedRoot);
  if (resolved !== fixedRoot) throw new TypeError('project_root does not match the server project root');
  return fixedRoot;
}

function assertContainedExisting(root, target) {
  const resolved = fs.realpathSync(target);
  if (!containsPath(root, resolved)) throw new TypeError('Project state path escapes the project root');
  return resolved;
}

function ensureContainedDirectory(root, relativeParts) {
  let cursor = root;
  for (const part of relativeParts) {
    if (!part || part === '.' || part === '..' || /[\\/]/.test(part)) {
      throw new TypeError('Unsafe project state directory');
    }
    const next = path.join(cursor, part);
    if (fs.existsSync(next)) {
      cursor = assertContainedExisting(root, next);
      if (!fs.statSync(cursor).isDirectory()) throw new TypeError('Project state path is not a directory');
    } else {
      fs.mkdirSync(next);
      cursor = assertContainedExisting(root, next);
    }
  }
  return cursor;
}

function validateControlRecord(value) {
  const errors = [];
  if (!exactFields(value, CONTROL_FIELDS)) return ['control record fields are invalid'];
  if (value.control_version !== CONTROL_VERSION) errors.push(`control_version must be ${CONTROL_VERSION}`);
  if (!Number.isInteger(value.revision) || value.revision < 0) errors.push('revision must be a nonnegative integer');
  if (!Array.isArray(value.capabilities) || value.capabilities.length > CONTROL_ACTIONS.length
    || new Set(value.capabilities).size !== value.capabilities.length
    || value.capabilities.some((entry) => !CONTROL_ACTIONS.includes(entry))) {
    errors.push('capabilities must be a unique control capability list');
  }
  errors.push(...validateOperationSpec(value.spec));
  errors.push(...validateOperationRun(value.run));
  if (value.spec?.operation_id !== value.run?.operation_id) errors.push('spec and run operation IDs must match');
  if (value.run?.spec_digest !== sha256Digest(value.spec)) errors.push('run spec_digest must match spec');
  return errors;
}

function validateControlRequest(value) {
  const errors = [];
  if (!exactFields(value, REQUEST_FIELDS)) return ['control request fields are invalid'];
  if (typeof value.operation_id !== 'string' || !SAFE_FILE_ID_PATTERN.test(value.operation_id) || value.operation_id.length > 128) {
    errors.push('operation_id must be an opaque lowercase identifier');
  }
  if (!Number.isInteger(value.expected_revision) || value.expected_revision < 0) {
    errors.push('expected_revision must be a nonnegative integer');
  }
  for (const field of ['idempotency_key', 'actor']) {
    if (typeof value[field] !== 'string' || !ID_PATTERN.test(value[field]) || value[field].length > 128) {
      errors.push(`${field} must be an opaque lowercase identifier`);
    }
  }
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 240 || /[\r\n]/.test(value.reason)) {
    errors.push('reason must be a single-line value of 1 to 240 characters');
  }
  if (!CONTROL_ACTIONS.includes(value.action)) errors.push(`action must be one of ${CONTROL_ACTIONS.join(', ')}`);
  if (!CONTROL_ACTIONS.includes(value.capability)) errors.push(`capability must be one of ${CONTROL_ACTIONS.join(', ')}`);
  if (value.action !== value.capability) errors.push('capability must match the requested action');
  return errors;
}

function validateControlResult(value) {
  const errors = [];
  if (!exactFields(value, RESULT_FIELDS)) return ['control result fields are invalid'];
  if (!CONTROL_OUTCOMES.includes(value.outcome)) errors.push('control result outcome is invalid');
  if (typeof value.operation_id !== 'string' || !ID_PATTERN.test(value.operation_id)) errors.push('result operation_id is invalid');
  if (!CONTROL_ACTIONS.includes(value.action)) errors.push('result action is invalid');
  if (value.intent_id !== null && (typeof value.intent_id !== 'string' || !ID_PATTERN.test(value.intent_id))) {
    errors.push('result intent_id is invalid');
  }
  for (const field of ['expected_revision', 'current_revision']) {
    if (value[field] !== null && (!Number.isInteger(value[field]) || value[field] < 0)) errors.push(`result ${field} is invalid`);
  }
  if (typeof value.reason_code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reason_code)) {
    errors.push('result reason_code is invalid');
  }
  return errors;
}

function operationDirectory(root) {
  const candidate = path.join(root, '.planning', 'operations', 'control');
  if (!fs.existsSync(candidate)) return null;
  return assertContainedExisting(root, candidate);
}

function operationFile(root, operationId) {
  if (typeof operationId !== 'string' || !SAFE_FILE_ID_PATTERN.test(operationId)) throw new TypeError('Invalid operation_id');
  const directory = operationDirectory(root);
  if (!directory) return null;
  const candidate = path.join(directory, `${operationId}.json`);
  if (!containsPath(directory, candidate)) throw new TypeError('Operation path escapes control directory');
  return candidate;
}

function readOperation(root, operationId) {
  const file = operationFile(root, operationId);
  if (!file || !fs.existsSync(file)) return { outcome: 'unknown', reason_code: 'OPERATION_NOT_FOUND', operation: null };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const errors = validateControlRecord(value);
    if (errors.length) return { outcome: 'unknown', reason_code: 'OPERATION_STATE_INVALID', operation: null };
    return { outcome: 'accepted', reason_code: 'OPERATION_FOUND', operation: value };
  } catch (_error) {
    return { outcome: 'unknown', reason_code: 'OPERATION_STATE_UNREADABLE', operation: null };
  }
}

function listOperations(root) {
  const directory = operationDirectory(root);
  if (!directory) return { outcome: 'accepted', operations: [] };
  const operations = fs.readdirSync(directory)
    .filter((name) => /^[a-z][a-z0-9_.-]*\.json$/.test(name))
    .sort()
    .map((name) => readOperation(root, name.slice(0, -5)))
    .map((entry, index) => entry.operation ? ({
      operation_id: entry.operation.spec.operation_id,
      revision: entry.operation.revision,
      status: entry.operation.run.status,
      capabilities: [...entry.operation.capabilities],
    }) : ({
      operation_id: `unknown-${index + 1}`,
      revision: null,
      status: 'unknown',
      capabilities: [],
    }));
  return { outcome: 'accepted', operations };
}

function resultFor(request, outcome, reasonCode, currentRevision = null, intentId = null) {
  const result = {
    outcome,
    operation_id: request.operation_id,
    action: request.action,
    intent_id: intentId,
    expected_revision: request.expected_revision,
    current_revision: currentRevision,
    reason_code: reasonCode,
  };
  const errors = validateControlResult(result);
  if (errors.length) throw new TypeError(errors.join('; '));
  return result;
}

function atomicCreateJson(directory, filename, value) {
  const finalPath = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(value)}\n`;
  let linked = false;
  try {
    const handle = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(handle, payload, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.linkSync(temporary, finalPath);
    linked = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { created: linked, path: finalPath };
}

function validateDecision(value) {
  return exactFields(value, DECISION_FIELDS)
    && value.control_version === CONTROL_VERSION
    && typeof value.idempotency_key === 'string'
    && typeof value.request_digest === 'string'
    && validateControlResult(value.result).length === 0;
}

function loadDecision(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validateDecision(value) ? value : false;
  } catch (_error) {
    return false;
  }
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function readLockOwner(lockPath) {
  try {
    const lockStat = fs.lstatSync(lockPath);
    if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) return { safe: false, owner: null, ageSource: null };
    const ownerPath = path.join(lockPath, LOCK_OWNER_FILE);
    if (!fs.existsSync(ownerPath)) return { safe: true, owner: null, ageSource: lockStat.mtimeMs };
    const ownerStat = fs.lstatSync(ownerPath);
    if (ownerStat.isSymbolicLink() || !ownerStat.isFile()) return { safe: false, owner: null, ageSource: null };
    const raw = fs.readFileSync(ownerPath, 'utf8');
    const owner = JSON.parse(raw);
    if (!exactFields(owner, LOCK_OWNER_FIELDS) || owner.version !== 1
      || !Number.isInteger(owner.pid) || owner.pid < 1 || !canonicalTimestamp(owner.created_at)) {
      return { safe: true, owner: null, ageSource: lockStat.mtimeMs };
    }
    return { safe: true, owner, raw, ageSource: Date.parse(owner.created_at) };
  } catch (_error) {
    return { safe: false, owner: null, ageSource: null };
  }
}

function processIsAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function createSubmitLock(lockPath, nowMs) {
  fs.mkdirSync(lockPath);
  const owner = { version: 1, pid: process.pid, created_at: new Date(nowMs).toISOString() };
  const ownerText = JSON.stringify(owner);
  try {
    fs.writeFileSync(path.join(lockPath, LOCK_OWNER_FILE), ownerText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    try { fs.rmdirSync(lockPath); } catch (_cleanupError) { /* Preserve the original lock creation error. */ }
    throw error;
  }
  return { lockPath, ownerText };
}

function acquireSubmitLock(intentsRoot, nowMs = Date.now()) {
  const lockPath = path.join(intentsRoot, '.submit.lock');
  try {
    return createSubmitLock(lockPath, nowMs);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const observed = readLockOwner(lockPath);
  const oldEnough = observed.ageSource !== null && nowMs - observed.ageSource >= LOCK_STALE_MS;
  if (!observed.safe || !oldEnough || (observed.owner && processIsAlive(observed.owner.pid))) return null;

  const quarantine = path.join(intentsRoot, `.submit.lock.stale-${process.pid}-${nowMs}`);
  try {
    fs.renameSync(lockPath, quarantine);
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'EPERM', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
  const quarantineReal = fs.realpathSync(quarantine);
  if (!containsPath(intentsRoot, quarantineReal)) throw new Error('Stale intent lock escaped the intent store');
  let acquired = null;
  try {
    acquired = createSubmitLock(lockPath, nowMs);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    fs.rmSync(quarantine, { recursive: true, force: true });
  }
  return acquired;
}

function releaseSubmitLock(acquired) {
  if (!acquired) return;
  const ownerPath = path.join(acquired.lockPath, LOCK_OWNER_FILE);
  try {
    if (fs.readFileSync(ownerPath, 'utf8') !== acquired.ownerText) return;
    fs.unlinkSync(ownerPath);
    fs.rmdirSync(acquired.lockPath);
  } catch (_error) {
    // A replaced or externally modified lock must not be removed by this process.
  }
}

function submitIntent(root, request, now = () => new Date().toISOString()) {
  const requestErrors = validateControlRequest(request);
  if (requestErrors.length) return resultFor({
    operation_id: typeof request?.operation_id === 'string' && ID_PATTERN.test(request.operation_id) ? request.operation_id : 'invalid-operation',
    action: CONTROL_ACTIONS.includes(request?.action) ? request.action : 'pause',
    expected_revision: Number.isInteger(request?.expected_revision) && request.expected_revision >= 0 ? request.expected_revision : 0,
  }, 'rejected', 'INVALID_ARGUMENTS');

  const intentsRoot = ensureContainedDirectory(root, ['.planning', 'intents']);
  const pendingDir = ensureContainedDirectory(root, ['.planning', 'intents', 'pending']);
  const decisionsDir = ensureContainedDirectory(root, ['.planning', 'intents', 'decisions']);
  const requestDigest = sha256Digest(request);
  const keyDigest = sha256Digest({ idempotency_key: request.idempotency_key }).slice(7);
  const decisionFile = path.join(decisionsDir, `${keyDigest}.json`);
  const lock = acquireSubmitLock(intentsRoot);
  if (!lock) return resultFor(request, 'unknown', 'INTENT_STORE_BUSY');

  try {
    const previous = loadDecision(decisionFile);
    if (previous === false) return resultFor(request, 'unknown', 'IDEMPOTENCY_STATE_INVALID');
    if (previous) {
      return previous.request_digest === requestDigest
        ? previous.result
        : resultFor(request, 'conflict', 'IDEMPOTENCY_KEY_REUSED');
    }

    const state = readOperation(root, request.operation_id);
    let result;
    let intentRecord = null;
    if (!state.operation) {
      result = resultFor(request, 'unknown', state.reason_code);
    } else if (state.operation.revision !== request.expected_revision) {
      result = resultFor(request, 'conflict', 'STALE_REVISION', state.operation.revision);
    } else if (!state.operation.capabilities.includes(request.capability)) {
      result = resultFor(request, 'blocked', 'CAPABILITY_NOT_GRANTED', state.operation.revision);
    } else if (!ACTION_STATES[request.action].includes(state.operation.run.status)) {
      result = resultFor(request, 'rejected', 'INVALID_TRANSITION', state.operation.revision);
    } else {
      const intentId = `intent-${keyDigest.slice(0, 32)}`;
      result = resultFor(request, 'accepted', 'INTENT_QUEUED', state.operation.revision, intentId);
      const protocolIntent = {
        protocol_version: PROTOCOL_VERSION,
        kind: CONTRACT_KINDS.INTENT,
        intent_id: intentId,
        operation_id: request.operation_id,
        action: request.action === 'stop' ? 'cancel' : request.action,
        actor_id: request.actor,
        scope_digest: sha256Digest({
          operation_id: request.operation_id,
          expected_revision: request.expected_revision,
          capability: request.capability,
        }),
        created_at: now(),
        expires_at: null,
      };
      const protocolErrors = validateIntent(protocolIntent);
      if (protocolErrors.length) throw new TypeError(protocolErrors.join('; '));
      intentRecord = {
        control_version: CONTROL_VERSION,
        expected_revision: request.expected_revision,
        idempotency_key: request.idempotency_key,
        actor: request.actor,
        reason: request.reason,
        capability: request.capability,
        request_digest: requestDigest,
        result,
        protocol_intent: protocolIntent,
      };
      if (!exactFields(intentRecord, INTENT_RECORD_FIELDS)) throw new TypeError('Invalid intent record');
      const write = atomicCreateJson(pendingDir, `${intentId}.json`, intentRecord);
      if (!write.created) {
        const existing = JSON.parse(fs.readFileSync(write.path, 'utf8'));
        if (sha256Digest(existing) !== sha256Digest(intentRecord)) {
          return resultFor(request, 'conflict', 'INTENT_ID_COLLISION', state.operation.revision);
        }
      }
    }

    atomicCreateJson(decisionsDir, `${keyDigest}.json`, {
      control_version: CONTROL_VERSION,
      idempotency_key: request.idempotency_key,
      request_digest: requestDigest,
      result,
    });
    return result;
  } finally {
    releaseSubmitLock(lock);
  }
}

module.exports = Object.freeze({
  CONTROL_ACTIONS,
  CONTROL_OUTCOMES,
  CONTROL_VERSION,
  LOCK_STALE_MS,
  acquireSubmitLock,
  assertRequestRoot,
  fixedProjectRoot,
  listOperations,
  readOperation,
  submitIntent,
  validateControlRecord,
  validateControlRequest,
  validateControlResult,
  releaseSubmitLock,
});
