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
// Junctions exercise Windows directory-link traversal without requiring the
// symlink privilege. Unix continues to exercise ordinary directory symlinks.
const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir';

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
    fs.symlinkSync(outside, path.join(project, '.planning', 'link'), directoryLinkType);
    writeConfig(project, [{ path: '.planning/link', scope: 'session', cleanup }]);
    fire(project);
    assert(fs.existsSync(path.join(outside, 'precious.txt')), `${cleanup} followed a symlink out of the project`);
  });
}

test('empty-on-expire: symlinked item inside a contained directory is unlinked, not followed', ({ project, outside }) => {
  fs.symlinkSync(outside, path.join(project, '.planning', 'scratch', 'escape'), directoryLinkType);
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

for (const depth of [1, 2, 3]) {
  test(`archive-then-delete: destination link at depth ${depth} cannot overwrite outside files`, ({ project, outside }) => {
    const date = new Date().toISOString().slice(0, 10);
    const segments = ['archive', date, 'scratch'];
    const link = path.join(project, '.planning', ...segments.slice(0, depth));
    const escapedArchive = path.join(outside, ...segments.slice(depth));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.mkdirSync(escapedArchive, { recursive: true });
    fs.writeFileSync(path.join(escapedArchive, 'precious.txt'), 'outside file must survive');
    fs.writeFileSync(path.join(project, '.planning', 'scratch', 'precious.txt'), 'repository-controlled replacement');
    fs.symlinkSync(outside, link, directoryLinkType);
    writeConfig(project, [{ path: '.planning/scratch', scope: 'session', cleanup: 'archive-then-delete' }]);

    const result = fire(project);

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(path.join(escapedArchive, 'precious.txt'), 'utf8'), 'outside file must survive');
    assert(fs.existsSync(path.join(project, '.planning', 'scratch', 'precious.txt')), 'unsafe archive must leave the source untouched');
  });
}

test('archive-then-delete: a redirected destination cannot create directories outside the project', ({ project, outside }) => {
  fs.symlinkSync(outside, path.join(project, '.planning', 'archive'), directoryLinkType);
  writeConfig(project, [{ path: '.planning/scratch', scope: 'session', cleanup: 'archive-then-delete' }]);

  const result = fire(project);

  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(fs.readdirSync(outside), ['precious.txt'], 'archive must validate containment before mkdir');
  assert(fs.existsSync(path.join(project, '.planning', 'scratch', 'tmp.txt')), 'unsafe archive must leave the source untouched');
});

test('archive-then-delete: a contained destination can be created and receives the source files', ({ project, outside }) => {
  writeConfig(project, [{ path: '.planning/scratch', scope: 'session', cleanup: 'archive-then-delete' }]);

  const result = fire(project);

  assert.strictEqual(result.status, 0, result.stderr);
  const archived = path.join(project, '.planning', 'archive', new Date().toISOString().slice(0, 10), 'scratch', 'tmp.txt');
  assert.strictEqual(fs.readFileSync(archived, 'utf8'), 'session scratch');
  assert(!fs.existsSync(path.join(project, '.planning', 'scratch', 'tmp.txt')));
  assert.strictEqual(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep me');
});

console.log(`session-end cleanup tests passed (${passed})`);
