#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
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
const { createWorktree, listWorktreeRoots } = require('../core/worktree/create');

function gitIn(projectRoot, args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initRepository(projectRoot) {
  fs.mkdirSync(projectRoot);
  gitIn(projectRoot, ['init', '-q']);
  gitIn(projectRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
}

function fireLifecycleHook(name, projectRoot, input) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks_src', name)], {
    cwd: projectRoot, input: JSON.stringify(input), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, CITADEL_RUNTIME: 'claude-code' },
  });
}

function assertRefusalPreservesState(projectRoot, worktreePath) {
  const claim = path.join(projectRoot, '.planning', 'coordination', 'claims', `${path.basename(worktreePath)}.json`);
  const session = path.join(projectRoot, '.planning', 'fleet', 'session-fixture.md');
  const queue = path.join(projectRoot, '.planning', 'telemetry', 'merge-check-queue.jsonl');
  const audit = path.join(projectRoot, '.planning', 'telemetry', 'audit.jsonl');
  write(claim, '{"status":"active"}\n');
  write(session, '---\nstatus: active\n---\n');
  write(queue, 'existing-entry\n');
  const auditBefore = fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8') : '';
  const result = fireLifecycleHook('worktree-remove.js', projectRoot, { worktree_path: worktreePath });
  assert.notEqual(result.status, 0, `refusal must fail: ${result.stderr}`);
  assert(fs.existsSync(worktreePath), 'refused worktree must stay on disk');
  assert.equal(fs.readFileSync(claim, 'utf8'), '{"status":"active"}\n', 'claims must not be released before removal');
  assert.equal(fs.readFileSync(session, 'utf8'), '---\nstatus: active\n---\n', 'fleet must not be marked complete');
  assert.equal(fs.readFileSync(queue, 'utf8'), 'existing-entry\n', 'failed removal must not queue completed work');
  assert.equal(fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8') : '', auditBefore, 'failed removal must not emit a removed audit event');
  return result;
}

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
  await withTempProject(async (tmpDir) => {
    // '&' is legal in a checkout path and must not trip shell-metacharacter
    // validation of the hook-generated worktree path.
    const projectRoot = path.join(tmpDir, 'R&D');
    fs.mkdirSync(projectRoot);
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
    assert.equal(gitIn(['status', '--porcelain', '--untracked-files=all']).trim(), '',
      'the nested worktree must be excluded from the parent checkout');

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
    assert.notEqual(mainRemove.status, 0, 'refusing the main checkout must not report removal success');
    assert(fs.existsSync(path.join(projectRoot, '.git')), 'worktree-remove must never touch the main checkout');

    const missingRemove = fireLifecycleHook('worktree-remove.js', projectRoot, { worktree_path: created });
    assert.equal(missingRemove.status, 0, 'an already-removed worktree is an idempotent success');
  });

  // Reject redirection at every existing destination component, including
  // dangling links, before excludes, checkout contents, or branches change.
  for (const component of ['.claude', '.claude/worktrees', '.claude/worktrees/redirected', 'dangling', 'inside']) {
    await withTempProject(async (tmpDir) => {
      const projectRoot = path.join(tmpDir, 'repo');
      initRepository(projectRoot);
      const target = component === 'inside' ? path.join(projectRoot, 'redirect-target') : path.join(tmpDir, 'outside');
      if (component !== 'dangling') {
        fs.mkdirSync(target);
        write(path.join(target, 'sentinel.txt'), 'untouched\n');
      }
      const relative = component === 'dangling' || component === 'inside' ? '.claude' : component;
      const link = path.join(projectRoot, relative);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      const exclude = path.join(projectRoot, '.git', 'info', 'exclude');
      const excludeBefore = fs.readFileSync(exclude, 'utf8');
      const result = fireLifecycleHook('worktree-setup.js', projectRoot, { name: 'redirected' });
      assert.notEqual(result.status, 0, `redirected ${component} must fail creation`);
      assert.equal(result.stdout.trim(), '', 'failed creation must not return a path');
      assert.match(result.stderr, /redirected worktree destination/);
      assert.equal(fs.readFileSync(exclude, 'utf8'), excludeBefore, 'rejection must happen before changing excludes');
      assert.equal(gitIn(projectRoot, ['branch', '--list', 'worktree-redirected']), '', 'rejection must not create a branch');
      assert.equal(listWorktreeRoots(projectRoot).length, 1, 'rejection must not register a worktree');
      if (component === 'dangling') assert(!fs.existsSync(target), 'dangling target must not be populated');
      else assert.deepEqual(fs.readdirSync(target), ['sentinel.txt'], 'redirected target must stay untouched');
    });
  }

  // A root-level alias (including macOS /var) is legitimate; only redirection
  // below the actual repository root is forbidden.
  await withTempProject(async (tmpDir) => {
    const projectRoot = path.join(tmpDir, 'R&D');
    initRepository(projectRoot);
    const alias = path.join(tmpDir, 'repo-alias');
    fs.symlinkSync(projectRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const result = createWorktree({ projectRoot: alias, name: 'aliased' });
    assert.equal(result.path, path.join(fs.realpathSync.native(projectRoot), '.claude', 'worktrees', 'aliased'));
    assert(fs.existsSync(path.join(result.path, '.git')), 'root alias must still create a usable checkout');
  });

  for (const lineEnding of ['\n', '\r\n']) {
    await withTempProject(async (tmpDir) => {
      const projectRoot = path.join(tmpDir, 'repo');
      initRepository(projectRoot);
      const worktree = createWorktree({ projectRoot, name: 'persistent' });
      write(path.join(projectRoot, '.planning', 'campaigns', 'persistent.md'),
        `---\nbranch: ${worktree.branch}\nworktree_status: active\n---\n`.replace(/\n/g, lineEnding));
      const result = assertRefusalPreservesState(projectRoot, worktree.path);
      assert.match(result.stderr, /persistent worktree/);
    });
  }

  await withTempProject(async (tmpDir) => {
    const projectRoot = path.join(tmpDir, 'repo');
    initRepository(projectRoot);
    const unregistered = path.join(projectRoot, 'not-a-worktree');
    fs.mkdirSync(unregistered);
    assert.match(assertRefusalPreservesState(projectRoot, unregistered).stderr, /refused removal/);

    const locked = createWorktree({ projectRoot, name: 'locked' });
    gitIn(projectRoot, ['worktree', 'lock', locked.path]);
    assertRefusalPreservesState(projectRoot, locked.path);
  });

  console.log('worktree readiness tests passed');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
