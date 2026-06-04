#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  capabilityMatrix,
  getSandboxProvider,
} = require('../core/sandbox/providers');

async function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-sandbox-'));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempProject(async (projectRoot) => {
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }), 'utf8');
  fs.mkdirSync(path.join(projectRoot, 'node_modules'));

  const matrix = capabilityMatrix({ projectRoot });
  const worktree = matrix.find((entry) => entry.provider === 'worktree');
  assert(worktree.capabilities.attach.supported);
  assert(worktree.capabilities.status.supported);
  assert(worktree.capabilities.snapshot.supported);
  assert.equal(worktree.capabilities.exec.supported, false);
  assert.equal(matrix.find((entry) => entry.provider === 'docker').capabilities.create.supported, false);

  const provider = getSandboxProvider('worktree', { projectRoot });
  const attached = await provider.attach({ worktreePath: projectRoot, branch: 'codex/test' });
  assert.equal(attached.attached, true);
  assert.equal(attached.provider, 'worktree');

  const readiness = await provider.readiness({ worktreePath: projectRoot, branch: 'codex/test', write: true });
  assert.equal(readiness.status, 'ready');
  assert(fs.existsSync(readiness.file));

  const status = await provider.status({ worktreePath: projectRoot, branch: 'codex/test' });
  assert.equal(status.exists, true);
  assert.equal(status.readiness.status, 'ready');

  const cli = execFileSync(process.execPath, [
    path.join(__dirname, 'sandbox-provider.js'),
    'matrix',
    '--project-root',
    projectRoot,
    '--json',
  ], { encoding: 'utf8' });
  assert(JSON.parse(cli).some((entry) => entry.provider === 'remote'));

  let failed = false;
  try {
    await getSandboxProvider('docker', { projectRoot }).attach({});
  } catch (error) {
    failed = true;
    assert.equal(error.code, 'UNSUPPORTED_SANDBOX_OPERATION');
  }
  assert.equal(failed, true, 'docker placeholder should fail clearly');
}).then(() => {
  console.log('sandbox provider tests passed');
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
