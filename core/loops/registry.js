#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { createLoopContract, validateLoopContract } = require('./contract');
const { LOOP_STATUSES, isTerminalStatus, normalizeStatus } = require('./status');
const { recoveryPlan, assertRecoveryBinding } = require('./recovery');
const {
  atomicWriteState, persistenceError, readStateFile, registryDirectory,
  registryPath, validateLoopId, withStateLock,
} = require('./persistence');

function nowIso(options = {}) {
  return options.now || new Date().toISOString();
}

function planningDir(projectRoot, ...parts) {
  return path.join(projectRoot || process.cwd(), '.planning', ...parts);
}

function loopsDir(projectRoot) {
  return registryDirectory(projectRoot);
}

function loopPath(projectRoot, id) {
  return registryPath(projectRoot, id);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateStoredLoop(loop, id) {
  const validation = validateLoopContract(loop);
  if (!validation.pass || Array.isArray(loop) || loop.id !== id || loop.version !== 1
    || !LOOP_STATUSES.includes(loop.status) || !Array.isArray(loop.runs)
    || loop.runs.some((run) => !run || typeof run !== 'object' || Array.isArray(run))
    || (loop.revision !== undefined && (!Number.isSafeInteger(loop.revision) || loop.revision < 0))) {
    throw persistenceError('LOOP_INVALID_STATE', `Invalid loop record ${id}; preserve and inspect its state file`);
  }
  return { ...loop, revision: loop.revision ?? 0 };
}

function checkRevision(current, options) {
  if (options.expectedRevision === undefined) return;
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw persistenceError('LOOP_INVALID_OPTIONS', 'expectedRevision must be a non-negative safe integer');
  }
  const actualRevision = current?.revision ?? 0;
  if (options.expectedRevision !== actualRevision) {
    throw persistenceError('LOOP_REVISION_CONFLICT',
      `Loop revision conflict: expected ${options.expectedRevision}, found ${actualRevision}`,
      { expectedRevision: options.expectedRevision, actualRevision });
  }
}

function mutateLoop(projectRoot, id, options, mutate) {
  return withStateLock(projectRoot, id, options, (target) => {
    const value = readStateFile(target);
    const current = value === null ? null : validateStoredLoop(value, id);
    checkRevision(current, options);
    const updated = mutate(current);
    if ((current?.revision ?? 0) >= Number.MAX_SAFE_INTEGER) {
      throw persistenceError('LOOP_INVALID_STATE', `Loop revision exhausted: ${id}`);
    }
    updated.revision = (current?.revision ?? 0) + 1;
    updated.updatedAt = nowIso(options);
    // Validate the serialized form too; JSON must not silently discard state.
    const stored = validateStoredLoop(JSON.parse(JSON.stringify(updated)), id);
    atomicWriteState(projectRoot, target, stored);
    return stored;
  });
}

function registerLoop(projectRoot, contractOrOptions = {}, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const contract = contractOrOptions.version
    ? { ...contractOrOptions }
    : createLoopContract(contractOrOptions);
  const validation = validateLoopContract(contract);
  if (!validation.pass) throw new Error(`Invalid loop contract: ${validation.errors.join('; ')}`);
  validateLoopId(contract.id);
  return mutateLoop(root, contract.id, options, (current) => {
    if (current) throw persistenceError('LOOP_ALREADY_EXISTS', `Loop already exists: ${contract.id}`);
    return contract;
  });
}

function readLoop(projectRoot, id) {
  const root = path.resolve(projectRoot || process.cwd());
  const loop = readStateFile(loopPath(root, id));
  return loop === null ? null : validateStoredLoop(loop, id);
}

// Source CAS admission and child creation share the existing source lock. The
// source is never rewritten. This is not a transaction spanning two files.
function registerRecovery(projectRoot, id, expectedRevision, options = {}) {
  return withStateLock(projectRoot, id, options, () => {
    const source = readLoop(projectRoot, id);
    if (!source) throw persistenceError('LOOP_NOT_FOUND', `Loop not found: ${id}`);
    const plan = recoveryPlan(source, expectedRevision);
    return registerLoop(projectRoot, plan.child, options);
  });
}

function checkRecoverySource(projectRoot, child) {
  const source = readLoop(projectRoot, child.recoveryOf.sourceLoopId);
  if (!source) throw persistenceError('LOOP_NOT_FOUND', 'Recovery source no longer exists');
  return assertRecoveryBinding(source, child);
}

// Claim is durable before the supervisor may start. A crash consumes the claim;
// neither direct supervisor re-entry nor recover retries can run it twice.
function claimRecoveryExecution(projectRoot, child, options = {}) {
  return withStateLock(projectRoot, child.recoveryOf.sourceLoopId, options, () => {
    checkRecoverySource(projectRoot, child);
    return mutateLoop(projectRoot, child.id, { ...options, expectedRevision: child.revision }, (current) => {
      if (!current || current.status !== 'planned' || current.runs.length || current.recoveryExecution) {
        throw persistenceError('LOOP_RECOVERY_CONSUMED', 'Recovery was already claimed; inspect its existing child, do not retry');
      }
      checkRecoverySource(projectRoot, current);
      return { ...current, recoveryExecution: { claimedAt: nowIso(options), pid: process.pid } };
    });
  });
}

function updateLoop(projectRoot, id, patch = {}, options = {}) {
  return mutateLoop(projectRoot, id, options, (current) => {
    if (!current) throw persistenceError('LOOP_NOT_FOUND', `Loop not found: ${id}`);
    const updated = {
      ...current,
      ...patch,
      status: patch.status ? normalizeStatus(patch.status) : current.status,
    };
    if (updated.id !== id || updated.version !== current.version || updated.statePath !== current.statePath) {
      throw persistenceError('LOOP_INVALID_STATE', 'Loop id, version and statePath cannot be changed');
    }
    if (current.recoveryOf && (JSON.stringify(current.recoveryOf) !== JSON.stringify(updated.recoveryOf)
      || JSON.stringify(current.recoveryExecution) !== JSON.stringify(updated.recoveryExecution)
      || JSON.stringify(current.trigger) !== JSON.stringify(updated.trigger)
      || JSON.stringify(current.verifier) !== JSON.stringify(updated.verifier)
      || JSON.stringify(current.budget) !== JSON.stringify(updated.budget)
      || JSON.stringify(current.retry) !== JSON.stringify(updated.retry)
      || JSON.stringify(current.stopConditions) !== JSON.stringify(updated.stopConditions))) {
      throw persistenceError('LOOP_RECOVERY_CONFLICT', 'Recovery linkage, execution claim and authorized commands/budgets cannot change');
    }
    if (isTerminalStatus(current.status)) {
      const changedStop = ['stoppedAt', 'stopReason'].some((key) => current[key] !== undefined && updated[key] !== current[key]);
      const changedHistory = !Array.isArray(updated.runs) || updated.runs.length !== current.runs.length
        || current.runs.some((run, index) => run.completedAt != null && JSON.stringify(run) !== JSON.stringify(updated.runs[index]));
      if (updated.status !== current.status || changedStop || changedHistory) {
        throw persistenceError('LOOP_TERMINAL', `Terminal loop ${id} cannot be restarted or have its stop/history overwritten`);
      }
    }
    return updated;
  });
}

function appendLoopRun(projectRoot, id, run = {}, options = {}) {
  return mutateLoop(projectRoot, id, options, (current) => {
    if (!current) throw persistenceError('LOOP_NOT_FOUND', `Loop not found: ${id}`);
    if (isTerminalStatus(current.status)) throw persistenceError('LOOP_TERMINAL', `Cannot append a run to terminal loop ${id}`);
    const entry = {
      ...run,
      attempt: Number(run.attempt || current.runs.length + 1),
      status: normalizeStatus(run.status || 'running'),
      summary: run.summary || '',
      command: run.command || null,
      verifier: run.verifier || null,
      exitCode: Number.isInteger(run.exitCode) ? run.exitCode : null,
      startedAt: run.startedAt || nowIso(options),
      completedAt: run.completedAt === null ? null : (run.completedAt || nowIso(options)),
      evidence: run.evidence || [],
    };
    return { ...current, runs: [...current.runs, entry], status: entry.status };
  });
}

function stopLoop(projectRoot, id, status = 'stopped', reason = '', options = {}) {
  return updateLoop(projectRoot, id, {
    status: normalizeStatus(status, 'stopped'),
    stoppedAt: nowIso(options),
    stopReason: reason || status,
  }, options);
}

function listRegisteredLoops(projectRoot) {
  const dir = loopsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readLoop(projectRoot, name.slice(0, -5)))
    .map((loop) => ({ ...loop, source: 'loop-registry' }));
}

function daemonLoop(projectRoot) {
  const daemon = readJsonIfExists(planningDir(projectRoot, 'daemon.json'));
  if (!daemon) return null;
  return {
    version: 1,
    id: `daemon-${daemon.campaignSlug || 'active'}`,
    type: 'daemon',
    title: `Daemon: ${daemon.campaignSlug || 'active campaign'}`,
    status: daemon.status === 'running' ? 'running' : normalizeStatus(daemon.status, 'stopped'),
    trigger: { kind: 'daemon', cadence: daemon.interval || null, command: '/daemon tick' },
    budget: { maxAttempts: null, maxSpend: daemon.budget ?? null, costPerRun: daemon.costPerSession ?? null },
    verifier: { command: null, profile: 'campaign-end-conditions', required: true },
    stopConditions: ['done', 'budget-exhausted', 'no-active-work', 'needs-human-review'],
    statePath: '.planning/daemon.json',
    runs: daemon.log || [],
    updatedAt: daemon.lastTickAt || daemon.startedAt || null,
    source: 'daemon',
  };
}

function codexAutomationLoops(projectRoot) {
  const dir = planningDir(projectRoot, 'codex-automations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonIfExists(path.join(dir, name)))
    .filter(Boolean)
    .map((automation) => ({
      version: 1,
      id: automation.loopId || automation.id,
      type: automation.loopType || automation.type || 'codex-automation',
      title: automation.loopTitle || `Codex automation: ${automation.type || automation.id}`,
      status: normalizeStatus(automation.loopStatus || automation.status || 'planned'),
      trigger: { kind: 'codex-automation', cadence: automation.cadence || null, command: automation.command || null },
      budget: automation.loopBudget || { maxAttempts: null, maxSpend: null, costPerRun: null },
      verifier: automation.loopVerifier || { command: null, profile: automation.type || null, required: false },
      stopConditions: automation.loopStopConditions || ['done', 'blocked', 'needs-human-review'],
      statePath: path.join('.planning', 'codex-automations', `${automation.id}.json`).replace(/\\/g, '/'),
      runs: automation.runs || [],
      updatedAt: automation.runs?.at(-1)?.recordedAt || automation.createdAt || null,
      source: 'codex-automation',
    }));
}

function listLoops(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const loops = [
    ...listRegisteredLoops(root),
    daemonLoop(root),
    ...codexAutomationLoops(root),
  ].filter(Boolean);
  const deduped = new Map();
  for (const loop of loops) {
    if (!deduped.has(loop.id) || loop.source === 'loop-registry') deduped.set(loop.id, loop);
  }
  const all = [...deduped.values()].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  if (options.activeOnly) return all.filter((loop) => !isTerminalStatus(loop.status));
  return all;
}

module.exports = Object.freeze({
  appendLoopRun,
  checkRecoverySource,
  claimRecoveryExecution,
  listLoops,
  loopPath,
  loopsDir,
  readLoop,
  registerLoop,
  registerRecovery,
  stopLoop,
  updateLoop,
});
