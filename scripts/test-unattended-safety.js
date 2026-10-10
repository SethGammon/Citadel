'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const repo = path.resolve(__dirname, '..');

function load(file, root, platform, child, boundary) {
  const source = fs.readFileSync(path.join(repo, file), 'utf8').split(boundary)[0];
  const context = {
    require(name) {
      if (name === 'child_process') return child;
      if (name === '../core/forks/launcher') return { platformInvocation: value => value };
      return require(name);
    },
    __filename: path.join(repo, file), Buffer, console: { log() {}, error() {} },
    setTimeout, Date,
    process: { argv: ['node', file, '--cooldown', '0'], env: { CLAUDE_PROJECT_DIR: root },
      cwd: () => root, platform, execPath: process.execPath, on() {}, exit(code) { throw Error('exit ' + code); } },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: file });
  return context;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-unattended-'));
  try {
    for (const platform of ['win32', 'linux']) {
      let cron = '# unrelated task\n', failInstall = false;
      const calls = [];
      const child = {
        execFileSync(command, args, opts) {
          calls.push({ command, args, opts });
          if (failInstall) throw Error('scheduler unavailable');
          return '';
        },
        spawnSync(command, args, opts) {
          calls.push({ command, args, opts });
          if (command === 'crontab') {
            if (args[0] === '-l') return { status: 0, stdout: cron };
            if (failInstall) return { status: 1, stderr: 'unavailable' };
            cron = opts.input;
          }
          return { status: 0, stdout: '' };
        },
      };
      const ctx = load('scripts/local-schedule.js', root, platform, child, '// --- Dispatch');
      const prompt = '/do inspect "quoted" text; $(touch NEVER) & echo %PATH%\nnext line';
      (platform === 'win32' ? ctx.winAdd : ctx.unixAdd)('0 9 * * *', prompt);
      const dir = path.join(root, '.citadel', 'schedules');
      const files = fs.readdirSync(dir);
      assert.equal(files.length, 1);
      const record = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
      const installed = platform === 'win32' ? calls[0].args[calls[0].args.indexOf('/TR') + 1] : cron;
      assert(!installed.includes(prompt));
      assert(!installed.includes('dangerously'));
      assert(!installed.includes('cmd /c'));
      const payload = Buffer.from(JSON.stringify({ id: record.id, root })).toString('base64url');
      ctx.runJob(payload);
      const launched = calls.at(-1);
      assert.equal(launched.command, 'claude');
      assert.deepEqual(Array.from(launched.args), ['--permission-mode', 'default', '-p', '--', prompt]);
      assert.equal(launched.opts.shell, false);
      assert.equal(launched.opts.cwd, root);
      fs.writeFileSync(path.join(dir, files[0]), JSON.stringify({ ...record, command: '--dangerously-skip-permissions' }));
      ctx.runJob(payload);
      assert.deepEqual(Array.from(calls.at(-1).args), ['--permission-mode', 'default', '-p', '--', '--dangerously-skip-permissions']);
      (platform === 'win32' ? ctx.winRemove : ctx.unixRemove)(record.id);
      assert(!fs.existsSync(path.join(dir, files[0])));
      const before = calls.length;
      ctx.runJob(payload);
      assert.equal(calls.length, before, 'revoked jobs must not launch');
      assert.throws(() => ctx.validateId('unrelated-task'));
      assert.throws(() => ctx.toCron('* * * * *\n@reboot echo malicious'));
      if (platform === 'linux') assert(cron.includes('# unrelated task'));
      failInstall = true;
      assert.throws(() => (platform === 'win32' ? ctx.winAdd : ctx.unixAdd)('0 9 * * *', '/do status'));
      assert.equal(fs.readdirSync(dir).length, 0, 'failed creation must not leave a live record');
    }

    fs.mkdirSync(path.join(root, '.planning', 'campaigns'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'campaigns', 'test.md'), '---\nstatus: active\n---\n');
    const base = { status: 'running', localRunnerEnabled: true, campaignSlug: 'test', budget: 100, costPerSession: 1, estimatedSpend: 0 };
    for (const state of [{ ...base, localRunnerEnabled: false }, { ...base, budget: 0 },
      { ...base, estimatedSpend: 100 }, { ...base, budget: 'unlimited' },
      { ...base, campaignSlug: '../escape' }, { ...base, lastTickStatus: 'running' },
      { ...base, status: 'stopped' }, { ...base, budget: 0.5 }, { ...base, localEstimatedSpend: 100 }]) {
      fs.writeFileSync(path.join(root, '.planning', 'daemon.json'), JSON.stringify(state));
      let spawns = 0;
      const ctx = load('scripts/local-daemon.js', root, 'win32', { spawn() { spawns++; throw Error('unexpected'); } }, 'main().catch');
      await ctx.main();
      assert.equal(spawns, 0, JSON.stringify(state));
    }
    fs.writeFileSync(path.join(root, '.planning', 'daemon.json'), JSON.stringify(base));
    let spawns = 0;
    const ctx = load('scripts/local-daemon.js', root, 'win32', { spawn(command, args, opts) {
      spawns++;
      assert.deepEqual(Array.from(args), ['--permission-mode', 'default', '-p', '/do continue']);
      assert.equal(opts.shell, false);
      const child = new EventEmitter();
      setImmediate(() => child.emit('close', 0));
      return child;
    } }, 'main().catch');
    await ctx.main();
    assert.equal(spawns, 10, 'default session cap must bound a state file that never updates');

    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.planning', 'daemon.json'))).localEstimatedSpend, 10);
    fs.writeFileSync(path.join(root, '.planning', 'daemon.json'), JSON.stringify({ ...base, budget: 2 }));
    spawns = 0;
    await ctx.main();
    assert.equal(spawns, 2, 'reservations stop repeated launches even when the agent never updates estimatedSpend');
    const initSource = fs.readFileSync(path.join(repo, 'hooks_src/init-project.js'), 'utf8');
    let output = '';
    const bridge = { fs, path, PROJECT_ROOT: root, process: { env: { CLAUDE_NON_INTERACTIVE: '1' }, stdout: { write: text => { output += text; } } } };
    vm.createContext(bridge);
    vm.runInContext(initSource.slice(initSource.indexOf('function checkDaemonState()'), initSource.lastIndexOf('main();')), bridge);
    fs.writeFileSync(path.join(root, '.planning', 'daemon.json'), JSON.stringify({ ...base, localRunnerEnabled: false }));
    bridge.checkDaemonState();
    assert(!output.includes('Run: /do continue'), 'environment alone must not authorize continuation');
    output = '';
    fs.writeFileSync(path.join(root, '.planning', 'daemon.json'), JSON.stringify(base));
    bridge.checkDaemonState();
    assert(output.includes('Run: /do continue'));

    const source = fs.readFileSync(path.join(repo, 'hooks_src/worktree-setup.js'), 'utf8').split("let data = '';")[0];
    let reports = 0;
    const hook = { require(name) {
      if (name === 'path') return path;
      if (name === './harness-health-util') return { PROJECT_ROOT: root, validatePath: () => ({ safe: true }), logTiming() {}, writeAuditLog() {} };
      if (name === '../core/worktree/readiness') return { checkWorktreeReadiness: async () => { reports++; return { status: 'warning' }; } };
      if (name === '../core/worktree/create') return { createWorktree() { throw Error('creation not expected when path is given'); } };
      throw Error('Unexpected access: ' + name);
    }, process: { stderr: { write() {} } } };
    vm.createContext(hook);
    vm.runInContext(source, hook);
    await hook.main({ path: path.join(root, 'worktree') });
    assert.equal(reports, 1, 'hook must still record readiness without secret or child-process APIs');
    const actualWorktree = path.join(root, 'actual-worktree');
    fs.mkdirSync(actualWorktree);
    fs.writeFileSync(path.join(root, '.env'), 'SYNTHETIC_SECRET=source');
    fs.writeFileSync(path.join(root, '.env.local'), 'SYNTHETIC_LOCAL=source');
    fs.writeFileSync(path.join(actualWorktree, '.env'), 'SYNTHETIC_SECRET=existing-target');
    fs.writeFileSync(path.join(actualWorktree, 'package.json'), JSON.stringify({ name: 'synthetic', version: '1.0.0', scripts: { postinstall: 'node -e "process.exit(91)"' } }));
    fs.writeFileSync(path.join(actualWorktree, 'package-lock.json'), JSON.stringify({ name: 'synthetic', lockfileVersion: 3, packages: {} }));
    fs.writeFileSync(path.join(actualWorktree, 'requirements.txt'), 'synthetic-package-never-install');
    require('child_process').execFileSync(process.execPath, [path.join(repo, 'hooks_src/worktree-setup.js')], {
      cwd: root, input: JSON.stringify({ path: actualWorktree }), encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CITADEL_ALLOW_UNTRACKED_PIP: 'true' },
    });
    assert.equal(fs.readFileSync(path.join(actualWorktree, '.env'), 'utf8'), 'SYNTHETIC_SECRET=existing-target');
    assert(!fs.existsSync(path.join(actualWorktree, '.env.local')));
    assert(!fs.existsSync(path.join(actualWorktree, 'node_modules')));
    assert(!fs.existsSync(path.join(actualWorktree, '.venv')));
    const unconfirmed = require('child_process').spawnSync(process.execPath,
      [path.join(repo, 'scripts/local-schedule.js'), 'add', 'daily', '/do status'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    assert.equal(unconfirmed.status, 1);
    assert(unconfirmed.stderr.includes('--confirm'));
    console.log('Unattended safety tests passed (Windows/Unix schedules, daemon gates and cap, readiness-only hook).');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
