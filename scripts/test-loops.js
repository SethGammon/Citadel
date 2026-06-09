#!/usr/bin/env node

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createLoopContract,
  validateLoopContract,
} = require('../core/loops/contract');
const {
  appendLoopRun,
  listLoops,
  readLoop,
  registerLoop,
  stopLoop,
} = require('../core/loops/registry');
const {
  instantiateLoopTemplate,
  listLoopTemplates,
} = require('../core/loops/templates');
const { isTerminalStatus, normalizeStatus } = require('../core/loops/status');

const CITADEL_ROOT = path.resolve(__dirname, '..');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-loops-'));
}

{
  const contract = createLoopContract({
    id: 'lint-loop',
    type: 'foreground-loop',
    title: 'Lint loop',
    command: 'npm run lint -- --fix',
    verifierCommand: 'npm run lint',
    maxAttempts: 3,
    now: '2026-06-09T12:00:00.000Z',
  });
  assert.equal(contract.id, 'lint-loop');
  assert.equal(contract.budget.maxAttempts, 3);
  assert.equal(contract.verifier.command, 'npm run lint');
  assert.equal(contract.statePath, '.planning/loops/lint-loop.json');
  assert(validateLoopContract(contract).pass);
}

{
  assert.equal(normalizeStatus('VERIFIER-PASSED'), 'verifier-passed');
  assert(isTerminalStatus('attempt-limit'));
  assert(!isTerminalStatus('running'));
}

{
  const templates = listLoopTemplates();
  assert(templates.some((item) => item.id === 'docs-drift-check'));
  const contract = instantiateLoopTemplate('docs-drift-check', {
    id: 'docs-drift',
    now: '2026-06-09T12:00:00.000Z',
  });
  assert.equal(contract.template, 'docs-drift-check');
  assert.equal(contract.verifier.command, 'npm run docs:check');
  assert(contract.stopConditions.includes('needs-human-review'));
}

{
  const root = tmpRoot();
  try {
    const contract = registerLoop(root, createLoopContract({
      id: 'demo-loop',
      type: 'foreground-loop',
      verifierCommand: 'node --version',
      maxAttempts: 2,
      now: '2026-06-09T12:00:00.000Z',
    }));
    assert(fs.existsSync(path.join(root, '.planning', 'loops', 'demo-loop.json')));
    appendLoopRun(root, contract.id, {
      status: 'running',
      summary: 'first pass',
      verifier: 'node --version',
      exitCode: 1,
    }, { now: '2026-06-09T12:01:00.000Z' });
    stopLoop(root, contract.id, 'attempt-limit', 'test done', { now: '2026-06-09T12:02:00.000Z' });
    const loop = readLoop(root, contract.id);
    assert.equal(loop.status, 'attempt-limit');
    assert.equal(loop.runs.length, 1);
    assert.equal(listLoops(root).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tmpRoot();
  try {
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'daemon.json'), JSON.stringify({
      status: 'running',
      campaignSlug: 'ship-feature',
      budget: 20,
      costPerSession: 2,
      interval: '30m',
      log: [],
      startedAt: '2026-06-09T12:00:00.000Z',
    }, null, 2), 'utf8');
    const loops = listLoops(root);
    assert(loops.some((loop) => loop.id === 'daemon-ship-feature'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tmpRoot();
  try {
    const output = childProcess.execFileSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'loops.js'),
      'plan',
      '--template',
      'demo-proof-refresh',
      '--write',
      '--json',
      '--project-root',
      root,
    ], { encoding: 'utf8' });
    const parsed = JSON.parse(output);
    assert.equal(parsed.template, 'demo-proof-refresh');
    assert(fs.existsSync(path.join(root, '.planning', 'loops', `${parsed.id}.json`)));

    const list = childProcess.execFileSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'loops.js'),
      'list',
      '--project-root',
      root,
    ], { encoding: 'utf8' });
    assert(list.includes('Citadel loops'));
    assert(list.includes(parsed.id));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tmpRoot();
  try {
    const result = childProcess.spawnSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'loop-runner.js'),
      '--verify',
      `"${process.execPath}" --version`,
      '--max-attempts',
      '1',
      '--write',
      '--project-root',
      root,
    ], { encoding: 'utf8', shell: false });
    assert.equal(result.status, 0, result.stderr);
    const loops = listLoops(root);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].status, 'verifier-passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('loop core tests passed');
