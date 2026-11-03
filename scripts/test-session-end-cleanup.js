#!/usr/bin/env node
'use strict';

// Regression tests: SessionEnd dynamic-directory cleanup must never delete
// outside the project, whatever a (repository-controlled) harness.json says.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'hooks_src', 'session-end.js');
let passed = 0;

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-session-end-cleanup-'));
  const project = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(project, '.planning', 'scratch'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep me');
  fs.writeFileSync(path.join(project, '.planning', 'scratch', 'tmp.txt'), 'session scratch');
  return { base, project, outside };
}

function writeConfig(project, dynamic) {
  fs.writeFileSync(path.join(project, '.claude', 'harness.json'), JSON.stringify({
    organization: { cleanupPolicy: 'auto', dynamic },
  }, null, 2));
}

function fire(project) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionEnd', reason: 'exit' }),
    cwd: project,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: path.join(project, '.claude') },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function test(name, fn) {
  const fx = fixture();
  try {
    fn(fx);
    passed++;
    console.log(`PASS ${name}`);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
}

const strategies = ['delete', 'empty-on-expire', 'archive-then-delete'];

for (const cleanup of strategies) {
  test(`${cleanup}: ../ traversal never touches files outside the project`, ({ project, outside }) => {
    writeConfig(project, [{ path: '../outside', scope: 'session', cleanup }]);
    fire(project);
    assert(fs.existsSync(path.join(outside, 'precious.txt')), `${cleanup} deleted or moved a file outside the project`);
  });

  test(`${cleanup}: absolute path is refused`, ({ project, outside }) => {
    writeConfig(project, [{ path: outside, scope: 'session', cleanup }]);
    fire(project);
    assert(fs.existsSync(path.join(outside, 'precious.txt')), `${cleanup} acted on an absolute path`);
  });

  test(`${cleanup}: in-project symlink to an outside directory is refused`, ({ project, outside }) => {
    fs.symlinkSync(outside, path.join(project, '.planning', 'link'), 'dir');
    writeConfig(project, [{ path: '.planning/link', scope: 'session', cleanup }]);
    fire(project);
    assert(fs.existsSync(path.join(outside, 'precious.txt')), `${cleanup} followed a symlink out of the project`);
  });
}

test('empty-on-expire: symlinked item inside a contained directory is unlinked, not followed', ({ project, outside }) => {
  fs.symlinkSync(outside, path.join(project, '.planning', 'scratch', 'escape'), 'dir');
  writeConfig(project, [{ path: '.planning/scratch', scope: 'session', cleanup: 'empty-on-expire' }]);
  fire(project);
  assert(fs.existsSync(path.join(outside, 'precious.txt')), 'empty-on-expire recursed through a symlink');
  assert(!fs.existsSync(path.join(project, '.planning', 'scratch', 'escape')), 'symlink entry should be removed');
});

test('delete: a contained session directory is still cleaned and recreated', ({ project }) => {
  writeConfig(project, [{ path: '.planning/scratch', scope: 'session', cleanup: 'delete' }]);
  fire(project);
  assert(fs.existsSync(path.join(project, '.planning', 'scratch')), 'planning directory should be recreated');
  assert(!fs.existsSync(path.join(project, '.planning', 'scratch', 'tmp.txt')), 'contained cleanup should still run');
});

console.log(`session-end cleanup tests passed (${passed})`);
