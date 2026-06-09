#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { createLoopContract, validateLoopContract } = require('./contract');
const { isTerminalStatus, normalizeStatus } = require('./status');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso(options = {}) {
  return options.now || new Date().toISOString();
}

function planningDir(projectRoot, ...parts) {
  return path.join(projectRoot || process.cwd(), '.planning', ...parts);
}

function loopsDir(projectRoot) {
  return planningDir(projectRoot, 'loops');
}

function loopPath(projectRoot, id) {
  return path.join(loopsDir(projectRoot), `${id}.json`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function registerLoop(projectRoot, contractOrOptions = {}, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const contract = contractOrOptions.version
    ? { ...contractOrOptions }
    : createLoopContract(contractOrOptions);
  const validation = validateLoopContract(contract);
  if (!validation.pass) throw new Error(`Invalid loop contract: ${validation.errors.join('; ')}`);
  contract.updatedAt = nowIso(options);
  writeJson(loopPath(root, contract.id), contract);
  return contract;
}

function readLoop(projectRoot, id) {
  const root = path.resolve(projectRoot || process.cwd());
  return readJsonIfExists(loopPath(root, id));
}

function updateLoop(projectRoot, id, patch = {}, options = {}) {
  const current = readLoop(projectRoot, id);
  if (!current) throw new Error(`Loop not found: ${id}`);
  const updated = {
    ...current,
    ...patch,
    status: patch.status ? normalizeStatus(patch.status) : current.status,
    updatedAt: nowIso(options),
  };
  writeJson(loopPath(projectRoot, id), updated);
  return updated;
}

function appendLoopRun(projectRoot, id, run = {}, options = {}) {
  const current = readLoop(projectRoot, id);
  if (!current) throw new Error(`Loop not found: ${id}`);
  const entry = {
    attempt: Number(run.attempt || (current.runs || []).length + 1),
    status: normalizeStatus(run.status || 'running'),
    summary: run.summary || '',
    command: run.command || null,
    verifier: run.verifier || null,
    exitCode: Number.isInteger(run.exitCode) ? run.exitCode : null,
    startedAt: run.startedAt || nowIso(options),
    completedAt: run.completedAt || nowIso(options),
    evidence: run.evidence || [],
  };
  current.runs = [...(current.runs || []), entry];
  current.status = entry.status;
  current.updatedAt = nowIso(options);
  writeJson(loopPath(projectRoot, id), current);
  return current;
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
    .map((name) => readJsonIfExists(path.join(dir, name)))
    .filter(Boolean)
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
  listLoops,
  loopPath,
  loopsDir,
  readLoop,
  registerLoop,
  stopLoop,
  updateLoop,
});
