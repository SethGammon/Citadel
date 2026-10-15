#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { createLoopContract } = require('../core/loops/contract');
const { appendLoopRun, listLoops, loopPath, readLoop, registerLoop, stopLoop, updateLoop } = require('../core/loops/registry');
const { atomicWriteState } = require('../core/loops/persistence');

const ownedChildren = new Set();
const roots = [];
let passed = 0;
let skipped = 0;

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-loop-persistence-'));
  roots.push(value);
  return value;
}

function throwsCode(fn, code) {
  return assert.throws(fn, (error) => error.code === code, `Expected ${code}`);
}

function bytes(project, id = 'test') {
  return fs.readFileSync(loopPath(project, id), 'utf8');
}

function child(mode, project, id = 'test', argument = '') {
  const processChild = fork(path.join(__dirname, 'fixtures', 'loop-persistence-child.js'), [mode, project, id, String(argument)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  ownedChildren.add(processChild);
  let stderr = '';
  processChild.stderr.on('data', (data) => { stderr += data; });
  const ready = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    processChild.on('message', (message) => { if (message.ready) resolve(); });
    processChild.once('exit', (code) => { if (code) reject(new Error(stderr || `Child exited ${code}`)); });
  });
  const result = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    let response;
    processChild.on('message', (message) => { if (!message.ready) response = message; });
    processChild.once('exit', (code) => {
      ownedChildren.delete(processChild);
      if (code && code !== null) reject(new Error(stderr || `Child exited ${code}`));
      else resolve(response);
    });
  });
  // Interruption tests kill this exact handle; avoid unhandled result rejections.
  result.catch(() => {});
  return { processChild, ready, result, start: () => processChild.send({ start: true }) };
}

async function compete(children) {
  await Promise.all(children.map((item) => item.ready));
  children.forEach((item) => item.start());
  return Promise.all(children.map((item) => item.result));
}

async function waitFor(predicate) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 10000) throw new Error('Timed out waiting for test child');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function test(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}

async function main() {
  await test('revision increments, CAS conflicts leave exact bytes unchanged', () => {
    const project = root();
    assert.equal(registerLoop(project, { id: 'test' }, { expectedRevision: 0 }).revision, 1);
    assert.equal(updateLoop(project, 'test', { title: 'next', revision: 999 }, { expectedRevision: 1 }).revision, 2);
    const before = bytes(project);
    throwsCode(() => updateLoop(project, 'test', { title: 'stale' }, { expectedRevision: 1 }), 'LOOP_REVISION_CONFLICT');
    throwsCode(() => appendLoopRun(project, 'test', {}, { expectedRevision: 1 }), 'LOOP_REVISION_CONFLICT');
    throwsCode(() => stopLoop(project, 'test', 'stopped', '', { expectedRevision: 1 }), 'LOOP_REVISION_CONFLICT');
    assert.equal(bytes(project), before);
  });

  await test('legacy revision zero is readable without an implicit write', () => {
    const project = root();
    const target = loopPath(project, 'test');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const legacy = createLoopContract({ id: 'test' });
    fs.writeFileSync(target, JSON.stringify(legacy));
    const before = bytes(project);
    assert.equal(readLoop(project, 'test').revision, 0);
    assert.equal(bytes(project), before);
    assert.equal(appendLoopRun(project, 'test', {}, { expectedRevision: 0 }).revision, 1);
  });

  await test('registration collisions preserve existing and terminal records', () => {
    const project = root();
    registerLoop(project, { id: 'test', title: 'original' });
    stopLoop(project, 'test');
    const before = bytes(project);
    throwsCode(() => registerLoop(project, { id: 'test', title: 'replacement' }), 'LOOP_ALREADY_EXISTS');
    assert.equal(bytes(project), before);
  });

  await test('fresh-process simultaneous registration has one winner', async () => {
    const project = root();
    const results = await compete(Array.from({ length: 4 }, () => child('register', project)));
    assert.equal(results.filter((item) => item.result).length, 1);
    assert.equal(results.filter((item) => item.error?.code === 'LOOP_ALREADY_EXISTS').length, 3);
    assert.equal(readLoop(project, 'test').revision, 1);
  });

  await test('fresh-process competing append writers lose no runs; readers see valid JSON', async () => {
    const project = root();
    registerLoop(project, { id: 'test' });
    const children = Array.from({ length: 6 }, () => child('append', project, 'test', 12));
    let finished = false;
    const writers = compete(children).finally(() => { finished = true; });
    let reads = 0;
    while (!finished) {
      const current = readLoop(project, 'test');
      assert.equal(current.revision, current.runs.length + 1);
      reads++;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const results = await writers;
    results.forEach((item) => assert.equal(item.result?.appended, 12, JSON.stringify(item)));
    const saved = readLoop(project, 'test');
    assert.equal(saved.runs.length, 72);
    assert.equal(saved.revision, 73);
    assert.equal(new Set(saved.runs.map((run) => run.summary)).size, 72);
    assert.deepEqual(saved.runs.map((run) => run.attempt), Array.from({ length: 72 }, (_, index) => index + 1));
    assert(reads > 1);
  });

  await test('fresh-process stale CAS permits exactly one winner', async () => {
    const project = root();
    registerLoop(project, { id: 'test' });
    const results = await compete(Array.from({ length: 4 }, () => child('cas', project, 'test', 1)));
    assert.equal(results.filter((item) => item.result).length, 1);
    assert.equal(results.filter((item) => item.error?.code === 'LOOP_REVISION_CONFLICT').length, 3);
    assert.equal(readLoop(project, 'test').revision, 2);
  });

  await test('stop competes with appends without resurrecting state', async () => {
    const project = root();
    registerLoop(project, { id: 'test' });
    const results = await compete([child('append', project, 'test', 40), child('append', project, 'test', 40), child('stop', project)]);
    results.forEach((item) => assert(!item.error, JSON.stringify(item)));
    const saved = readLoop(project, 'test');
    assert.equal(saved.status, 'stopped');
    assert.equal(saved.runs.length, results[0].result.appended + results[1].result.appended);
    assert.equal(saved.revision, saved.runs.length + 2);
    const before = bytes(project);
    throwsCode(() => appendLoopRun(project, 'test', { status: 'running' }), 'LOOP_TERMINAL');
    throwsCode(() => updateLoop(project, 'test', { status: 'running' }), 'LOOP_TERMINAL');
    throwsCode(() => updateLoop(project, 'test', { status: 'done' }), 'LOOP_TERMINAL');
    throwsCode(() => updateLoop(project, 'test', { stopReason: 'overwrite' }), 'LOOP_TERMINAL');
    assert.equal(bytes(project), before);
  });

  await test('pending receipt fields survive; terminal completion evidence cannot erase history', () => {
    const project = root();
    registerLoop(project, { id: 'test' });
    const pending = appendLoopRun(project, 'test', { completedAt: null, phase: 'action', actionResult: { started: true } });
    assert.equal(pending.runs[0].completedAt, null);
    assert.equal(pending.runs[0].phase, 'action');
    assert.deepEqual(pending.runs[0].actionResult, { started: true });
    const stopped = stopLoop(project, 'test');
    const completed = { ...stopped.runs[0], completedAt: new Date().toISOString(), outcome: 'interrupted' };
    const saved = updateLoop(project, 'test', { runs: [completed] }, { expectedRevision: stopped.revision });
    assert.equal(saved.status, 'stopped');
    throwsCode(() => updateLoop(project, 'test', { runs: [] }), 'LOOP_TERMINAL');
    throwsCode(() => updateLoop(project, 'test', { runs: [{ ...completed, outcome: 'passed' }] }), 'LOOP_TERMINAL');
  });

  await test('malformed and invalid existing records fail closed', () => {
    const invalid = ['{', 'null', '[]', '42', '{}'];
    const contract = createLoopContract({ id: 'test' });
    invalid.push(...[
      { ...contract, revision: -1 }, { ...contract, revision: 0.5 },
      { ...contract, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...contract, runs: {} },
      { ...contract, runs: [null] }, { ...contract, id: 'other' }, { ...contract, status: 'unknown' },
    ].map((value) => JSON.stringify(value)));
    for (const content of invalid) {
      const project = root();
      const target = loopPath(project, 'test');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      throwsCode(() => readLoop(project, 'test'), 'LOOP_INVALID_STATE');
      throwsCode(() => listLoops(project), 'LOOP_INVALID_STATE');
      throwsCode(() => registerLoop(project, { id: 'test' }), 'LOOP_INVALID_STATE');
      throwsCode(() => updateLoop(project, 'test', { title: 'discard' }), 'LOOP_INVALID_STATE');
      assert.equal(fs.readFileSync(target, 'utf8'), content);
    }
  });

  await test('invalid revisions and identity changes fail without state mutation', () => {
    const project = root();
    registerLoop(project, { id: 'test' });
    const before = bytes(project);
    for (const expectedRevision of [-1, 0.2, null, '1', Infinity]) {
      throwsCode(() => updateLoop(project, 'test', {}, { expectedRevision }), 'LOOP_INVALID_OPTIONS');
    }
    for (const patch of [{ id: 'other' }, { version: 2 }, { statePath: '../elsewhere' }, { runs: null }]) {
      throwsCode(() => updateLoop(project, 'test', patch), 'LOOP_INVALID_STATE');
    }
    assert.equal(bytes(project), before);
  });

  await test('unsafe portable IDs cannot create paths', () => {
    const project = root();
    for (const id of ['../escape', '..', '.', 'a/b', 'a\\b', '/absolute', 'C:\\test', 'x:stream', 'nul', 'CON.txt', 'COM1', 'lpt9', 'trailing.', 'space ', 'x'.repeat(201)]) {
      throwsCode(() => readLoop(project, id), 'LOOP_UNSAFE_PATH');
      throwsCode(() => registerLoop(project, { id }), 'LOOP_UNSAFE_PATH');
    }
    assert(!fs.existsSync(path.join(project, '.planning')));
  });

  await test('registry directory symlinks and Windows junctions are rejected', () => {
    for (const component of ['.planning', 'loops']) {
      const project = root();
      const outside = root();
      const link = component === '.planning' ? path.join(project, '.planning') : path.join(project, '.planning', 'loops');
      if (component === 'loops') fs.mkdirSync(path.dirname(link));
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      throwsCode(() => registerLoop(project, { id: 'test' }), 'LOOP_UNSAFE_PATH');
      throwsCode(() => readLoop(project, 'test'), 'LOOP_UNSAFE_PATH');
      assert.deepEqual(fs.readdirSync(outside), []);
    }
  });

  await test('hard-linked state is rejected; leaf symlinks rejected where supported', () => {
    const project = root();
    const outside = root();
    const external = path.join(outside, 'external.json');
    fs.writeFileSync(external, JSON.stringify(createLoopContract({ id: 'test' })));
    const target = loopPath(project, 'test');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.linkSync(external, target);
    throwsCode(() => readLoop(project, 'test'), 'LOOP_UNSAFE_PATH');
    throwsCode(() => updateLoop(project, 'test', {}), 'LOOP_UNSAFE_PATH');
    fs.unlinkSync(target);
    try { fs.symlinkSync(external, target, 'file'); } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
      skipped++;
      console.log('SKIP leaf symlink creation requires OS privilege; junction and hard-link checks ran');
      return;
    }
    throwsCode(() => readLoop(project, 'test'), 'LOOP_UNSAFE_PATH');
    throwsCode(() => registerLoop(project, { id: 'test' }), 'LOOP_UNSAFE_PATH');
  });

  if (process.platform === 'win32') {
    await test('Windows replacement waits for a real reader beyond the former 250ms window', async () => {
      const project = root();
      registerLoop(project, { id: 'test' });
      const owned = child('hold-reader', project, 'test', 700);
      await owned.ready;
      owned.start();
      await waitFor(() => fs.existsSync(path.join(project, 'reader-open')));
      assert.equal(Number(fs.readFileSync(path.join(project, 'reader-open'), 'utf8')), owned.processChild.pid);
      const updated = updateLoop(project, 'test', { title: 'after reader' }, { expectedRevision: 1 });
      assert.equal(updated.revision, 2);
      assert.equal(updated.title, 'after reader');
      assert(fs.existsSync(path.join(project, 'reader-releasing')), 'replacement must wait for the real reader');
      assert.equal((await owned.result).result.closed, true);
      assert.equal(readLoop(project, 'test').revision, 2);
      assert.deepEqual(fs.readdirSync(path.dirname(loopPath(project, 'test'))), ['test.json']);
    });
  }

  await test('failed rename retains old bytes and cleans its own temporary file', () => {
    const project = root();
    registerLoop(project, { id: 'test' });
    const before = bytes(project);
    const original = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('test sharing violation'), { code: 'EACCES' }); };
    const started = performance.now();
    try { throwsCode(() => updateLoop(project, 'test', { title: 'not published' }), 'EACCES'); }
    finally { fs.renameSync = original; }
    assert(performance.now() - started < 10000, 'permanent denial must remain bounded');
    assert.equal(bytes(project), before);
    assert.deepEqual(fs.readdirSync(path.dirname(loopPath(project, 'test'))), ['test.json']);
    assert.equal(updateLoop(project, 'test', { title: 'retry' }).revision, 2);
  });

  await test('atomic writer refuses a target outside the registry', () => {
    const project = root();
    registerLoop(project, { id: 'test' });
    throwsCode(() => atomicWriteState(project, path.join(project, 'outside.json'), {}), 'LOOP_UNSAFE_PATH');
    assert(!fs.existsSync(path.join(project, 'outside.json')));
  });

  for (const stage of ['partial', 'before-rename', 'after-rename']) {
    await test(`process interruption ${stage} preserves a valid committed record and reports abandoned lock`, async () => {
      const project = root();
      registerLoop(project, { id: 'test', title: 'original' });
      const before = bytes(project);
      const owned = child('interrupt', project, 'test', stage);
      await owned.ready;
      owned.start();
      await waitFor(() => fs.existsSync(path.join(project, `stage-${stage}`)));
      assert.equal(Number(fs.readFileSync(path.join(project, `stage-${stage}`), 'utf8')), owned.processChild.pid);
      owned.processChild.kill('SIGKILL');
      await owned.result;
      const current = readLoop(project, 'test');
      assert.equal(current.revision, stage === 'after-rename' ? 2 : 1);
      assert.equal(current.title, stage === 'after-rename' ? 'replacement' : 'original');
      if (stage !== 'after-rename') assert.equal(bytes(project), before);
      const committed = bytes(project);
      const started = performance.now();
      assert.throws(() => updateLoop(project, 'test', { title: 'steal' }, { lockTimeoutMs: 60 }), (error) => {
        assert.equal(error.code, 'LOOP_LOCK_TIMEOUT');
        assert.equal(error.owner.pid, owned.processChild.pid);
        assert.equal(error.lockPath, `${loopPath(project, 'test')}.lock`);
        assert(error.message.includes('no lock was stolen'));
        assert(error.message.includes('manually removing this exact lock'));
        return true;
      });
      assert(performance.now() - started < 2000);
      assert.equal(bytes(project), committed);
      assert(fs.existsSync(`${loopPath(project, 'test')}.lock`));
      // Exact owned child has exited. Simulate documented manual lock cleanup;
      // production never guesses that a PID or age makes takeover safe.
      fs.unlinkSync(`${loopPath(project, 'test')}.lock`);
      const recovered = updateLoop(project, 'test', { title: 'explicit recovery' }, { expectedRevision: current.revision });
      assert.equal(recovered.revision, current.revision + 1);
    });
  }

  console.log(`loop persistence tests passed: ${passed} cases (${skipped} optional checks skipped)`);
}

main().catch((error) => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await Promise.all([...ownedChildren].map((processChild) => new Promise((resolve) => {
    processChild.once('exit', resolve);
    processChild.kill('SIGKILL');
  })));
  for (const project of roots) {
    const resolved = path.resolve(project);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('citadel-loop-persistence-')) {
      throw new Error(`Refusing test cleanup outside owned temporary roots: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
