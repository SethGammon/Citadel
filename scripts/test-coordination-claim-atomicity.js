#!/usr/bin/env node
'use strict';

// Deterministic native two-process replay: the read snapshot is paused after
// readdirSync so an unguarded implementation can expose its check/write race.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { claimScope, getClaimStatus, releaseClaim } = require('../core/coordination/claims');
const { registerInstance, unregisterInstance } = require('../core/coordination/instances');
const { sweepStaleInstances } = require('../core/coordination/sweep');

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

if (process.argv[2] === '--worker') {
  const [projectRoot, id, scope] = process.argv.slice(3);
  const readyDir = path.join(projectRoot, 'ready');
  fs.mkdirSync(readyDir, { recursive: true });
  fs.writeFileSync(path.join(readyDir, id), 'ready');
  const deadline = Date.now() + 4000;
  while (fs.readdirSync(readyDir).length < 2 && Date.now() < deadline) sleep(10);
  if (fs.readdirSync(readyDir).length < 2) process.exit(3);

  const originalReaddir = fs.readdirSync;
  fs.readdirSync = function(dir, ...rest) {
    const result = originalReaddir.call(this, dir, ...rest);
    if (String(dir).endsWith(path.join('coordination', 'claims'))) sleep(180);
    return result;
  };
  try {
    claimScope(id, [scope], 'build', 'native replay', { projectRoot });
    console.log('CLAIMED');
  } catch (error) {
    console.log(error.code || 'ERROR');
    if (!['SCOPE_OVERLAP', 'CLAIM_BUSY'].includes(error.code)) {
      console.error(error.stack);
      process.exitCode = 4;
    }
  }
} else {
  const runWorker = (root, id, scope) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--worker', root, id, scope],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) return reject(new Error(`worker ${id} exit ${code}: ${stdout} ${stderr}`));
      resolve(stdout.trim());
    });
  });

  const withRoot = async callback => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-s2-atomic-'));
    try { return await callback(projectRoot); }
    finally { fs.rmSync(projectRoot, { recursive: true, force: true }); }
  };

  (async () => {
    await withRoot(async root => {
      const outcome = await Promise.all([runWorker(root, 'one', 'src/a'), runWorker(root, 'two', 'src/a')]);
      assert.deepStrictEqual(outcome.sort(), ['CLAIMED', 'SCOPE_OVERLAP'],
        `competing writers cannot both acquire ownership: ${outcome.join(',')}`);
      assert.equal(getClaimStatus({ projectRoot: root }).claims.length, 1);
    });
    console.log('PASS: conflicting claims exclude the second process');

    await withRoot(async root => {
      const outcome = await Promise.all([runWorker(root, 'one', 'src/a'), runWorker(root, 'two', 'docs/b')]);
      assert.deepStrictEqual(outcome.sort(), ['CLAIMED', 'CLAIMED'],
        'disjoint scopes must both be admitted');
      assert.equal(getClaimStatus({ projectRoot: root }).claims.length, 2);
    });
    console.log('PASS: disjoint claims remain admissible');

    await withRoot(async root => {
      const one = claimScope('first', ['src/app'], 'build', '', { projectRoot: root });
      assert.equal(one.instanceId, 'first');
      assert.equal(releaseClaim('first', { projectRoot: root }).instanceId, 'first');
      assert.equal(claimScope('second', ['src/app'], 'build', '', { projectRoot: root }).instanceId, 'second');
    });
    console.log('PASS: released scope can be reclaimed');

    await withRoot(async root => {
      const dir = path.join(root, '.planning', 'coordination', 'claims');
      fs.mkdirSync(path.join(dir, '.transaction.lock'), { recursive: true });
      assert.throws(() => claimScope('first', ['src'], 'build', '', { projectRoot: root }),
        error => error.code === 'CLAIM_BUSY', 'abandoned lock must fail closed');
      assert.equal(getClaimStatus({ projectRoot: root }).claims.length, 0);
    });
    console.log('PASS: abandoned lock fails closed without publishing claims');

    await withRoot(async root => {
      claimScope('first', ['src'], 'build', '', { projectRoot: root });
      assert.throws(() => claimScope('second', ['src/index.js'], 'build', '', { projectRoot: root }),
        error => error.code === 'SCOPE_OVERLAP');
    });
    console.log('PASS: same-process overlap enforcement preserved');

    await withRoot(async root => {
      const opts = { projectRoot: root };
      const now = new Date().toISOString();
      registerInstance('stale-worker', { ...opts, now, pid: 99999999 });
      claimScope('stale-worker', ['src/stale'], 'build', '', opts);
      const lock = path.join(root, '.planning', 'coordination', 'claims', '.transaction.lock');
      fs.mkdirSync(lock);
      assert.throws(() => sweepStaleInstances(opts),
        error => error.code === 'CLAIM_BUSY', 'contended sweep must report the busy registry');
      const record = path.join(root, '.planning', 'coordination', 'instances', 'stale-worker.json');
      assert(fs.existsSync(record), 'failed claim release must preserve stale instance for retry');
      fs.rmdirSync(lock);
      const outcome = sweepStaleInstances(opts);
      assert.equal(outcome.cleaned, 1, 'retry should sweep preserved instance');
      assert.equal(getClaimStatus(opts).claims.length, 0);
      assert(!fs.existsSync(record));
    });
    console.log('PASS: failed sweep retains instance until claim release succeeds');

    await withRoot(async root => {
      const opts = { projectRoot: root };
      registerInstance('exiting-worker', { ...opts, pid: process.pid });
      claimScope('exiting-worker', ['src/exiting'], 'build', '', opts);
      const lock = path.join(root, '.planning', 'coordination', 'claims', '.transaction.lock');
      fs.mkdirSync(lock);
      assert.throws(() => unregisterInstance('exiting-worker', opts),
        error => error.code === 'CLAIM_BUSY', 'unregister must not bypass held claim lock');
      assert.equal(getClaimStatus(opts).claims.length, 1);
      fs.rmdirSync(lock);
      unregisterInstance('exiting-worker', opts);
      assert.equal(getClaimStatus(opts).claims.length, 0);
    });
    console.log('PASS: instance unregister uses atomic claim release');

  })().catch(error => { console.error(error); process.exitCode = 1; });
}
