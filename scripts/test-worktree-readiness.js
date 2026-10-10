#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const {
  checkWorktreeReadiness,
  listReadinessReports,
  matchReadiness,
  normalizeProfile,
} = require('../core/worktree/readiness');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-readiness-'));
  return Promise.resolve()
    .then(() => run(dir))
    .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function listen(port = 0) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const profile = normalizeProfile({
    worktreeReadiness: {
      dependencyMode: 'optional',
      env: { policy: 'required', files: '.env.local' },
      ports: { required: ['3000'], preferred: [5173] },
      healthChecks: ['npm run dev'],
    },
  });
  assert.equal(profile.dependencyMode, 'optional');
  assert.deepEqual(profile.env.files, ['.env.local']);
  assert.deepEqual(profile.ports.required, [3000]);
  assert.equal(profile.healthChecks.length, 1);

  await withTempProject(async (projectRoot) => {
    const worktreePath = path.join(projectRoot, 'agent-worktree');
    write(path.join(projectRoot, '.env.local'), 'TOKEN=test\n');
    write(path.join(worktreePath, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }));

    const server = await listen();
    const occupiedPort = server.address().port;
    try {
      const report = await checkWorktreeReadiness({
        projectRoot,
        worktreePath,
        branch: 'codex/readiness',
        write: true,
        profile: {
          worktreeReadiness: {
            dependencyMode: 'auto',
            env: { policy: 'copy-if-present', files: ['.env.local'] },
            ports: { required: [occupiedPort] },
            healthChecks: ['npm run dev'],
          },
        },
        now: '2026-06-04T12:00:00.000Z',
      });

      assert.equal(report.status, 'blocked', 'missing deps/env and occupied port should block');
      assert.equal(report.blockFleet, true, 'blocked readiness should block Fleet by default');
      assert(report.checks.some((check) => check.name === 'dependencies:node' && check.status === 'fail'));
      assert(report.checks.some((check) => check.name === 'env:.env.local' && check.status === 'fail'));
      assert(report.checks.some((check) => check.name === `port:${occupiedPort}` && check.status === 'fail'));
      assert(report.checks.some((check) => check.name === 'health:1' && check.status === 'warn'));
      assert(fs.existsSync(report.file), 'write mode should persist readiness report');

      const reports = listReadinessReports(projectRoot);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].branch, 'codex/readiness');
      assert.equal(matchReadiness({ branch: 'codex/readiness' }, reports).status, 'blocked');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await withTempProject(async (projectRoot) => {
    const worktreePath = path.join(projectRoot, 'ready-worktree');
    write(path.join(worktreePath, 'package.json'), '{}');
    fs.mkdirSync(path.join(worktreePath, 'node_modules'), { recursive: true });

    const report = await checkWorktreeReadiness({
      projectRoot,
      worktreePath,
      profile: { worktreeReadiness: { env: { policy: 'optional', files: ['.env.local'] } } },
    });
    assert.equal(report.status, 'ready', 'present dependencies and optional env should be ready');

    const cli = execFileSync(process.execPath, [
      path.join(__dirname, 'worktree-readiness.js'),
      '--project-root',
      projectRoot,
      '--worktree',
      worktreePath,
      '--write',
    ], { encoding: 'utf8' });
    assert(cli.includes('Worktree Readiness'));
    assert(cli.includes('Status:   ready'));

    const list = execFileSync(process.execPath, [
      path.join(__dirname, 'worktree-readiness.js'),
      '--project-root',
      projectRoot,
      '--list',
    ], { encoding: 'utf8' });
    assert(list.includes('Worktree Readiness Reports'));
    assert(list.includes('ready - ready-worktree'));
  });

  await withTempProject(async (projectRoot) => {
    const worktreePath = path.join(projectRoot, 'hook-worktree');
    fs.mkdirSync(worktreePath, { recursive: true });

    const output = execFileSync(process.execPath, [
      path.join(__dirname, '..', 'hooks_src', 'worktree-setup.js'),
    ], {
      cwd: projectRoot,
      input: JSON.stringify({ path: worktreePath, branch: 'codex/hook-ready' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    });

    assert.equal(output.trim(), worktreePath, 'hook must echo the worktree path it was given');
    const reports = listReadinessReports(projectRoot);
    assert.equal(reports.length, 1, 'worktree-setup hook should write readiness evidence');
    assert.equal(reports[0].branch, 'codex/hook-ready');
    assert.equal(reports[0].status, 'ready');
  });

  // WorktreeCreate replaces Claude Code's native `git worktree add`: given only
  // a name, the hook must create the checkout and print its path last on stdout.
  // WorktreeRemove must then delete it (exit 0 means "removed" to Claude Code).
  await withTempProject(async (projectRoot) => {
    const gitIn = (args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
    gitIn(['init', '-q']);
    gitIn(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    const hookEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectRoot };

    const stdout = execFileSync(process.execPath, [
      path.join(__dirname, '..', 'hooks_src', 'worktree-setup.js'),
    ], { cwd: projectRoot, input: JSON.stringify({ name: 'bold-oak-a3f2' }), encoding: 'utf8', env: hookEnv });
    const lines = stdout.trim().split(/\r?\n/);
    const created = lines[lines.length - 1];
    const expected = path.join(fs.realpathSync.native(projectRoot), '.claude', 'worktrees', 'bold-oak-a3f2');
    assert.equal(path.resolve(created).toLowerCase(), expected.toLowerCase(), 'last stdout line must be the worktree path');
    assert(fs.existsSync(path.join(created, '.git')), 'worktree checkout must exist');
    assert.equal(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: created, encoding: 'utf8' }).trim(), 'worktree-bold-oak-a3f2');

    const again = execFileSync(process.execPath, [
      path.join(__dirname, '..', 'hooks_src', 'worktree-setup.js'),
    ], { cwd: projectRoot, input: JSON.stringify({ name: 'bold-oak-a3f2' }), encoding: 'utf8', env: hookEnv });
    assert.equal(again.trim().split(/\r?\n/).pop(), created, 'existing worktree must be reused');

    const bad = require('child_process').spawnSync(process.execPath, [
      path.join(__dirname, '..', 'hooks_src', 'worktree-setup.js'),
    ], { cwd: projectRoot, input: JSON.stringify({ name: '../escape' }), encoding: 'utf8', env: hookEnv });
    assert.notEqual(bad.status, 0, 'invalid names must fail creation');
    assert.equal(bad.stdout.trim(), '', 'failed creation must not print a path');

    execFileSync(process.execPath, [
      path.join(__dirname, '..', 'hooks_src', 'worktree-remove.js'),
    ], { cwd: projectRoot, input: JSON.stringify({ worktree_path: created }), encoding: 'utf8', env: hookEnv });
    assert(!fs.existsSync(created), 'worktree-remove must delete the worktree directory');
    assert.equal(gitIn(['branch', '--list', 'worktree-bold-oak-a3f2']).trim().replace(/^[*+ ]+/, ''), 'worktree-bold-oak-a3f2',
      'branch is kept for merge review');

    const mainRemove = require('child_process').spawnSync(process.execPath, [
      path.join(__dirname, '..', 'hooks_src', 'worktree-remove.js'),
    ], { cwd: projectRoot, input: JSON.stringify({ worktree_path: projectRoot }), encoding: 'utf8', env: hookEnv });
    assert.equal(mainRemove.status, 0);
    assert(fs.existsSync(path.join(projectRoot, '.git')), 'worktree-remove must never touch the main checkout');
  });

  console.log('worktree readiness tests passed');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
