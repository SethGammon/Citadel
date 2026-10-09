'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');
const repo = path.resolve(__dirname, '..');
const profiles = require('../core/forks/executor-profiles');
const native = require('../core/codex/native-integrations');

assert.equal(profiles.CLAUDE_ALLOWED_TOOLS, 'Read,Glob,Grep');
const profile = profiles.synthesizeLegacyExecutors(['claude'])[0];
const invocation = profiles.runtimeInvocationForProfile(profile);
assert.equal(invocation.args[invocation.args.indexOf('--permission-mode') + 1], 'default');
assert(!invocation.args.some(arg => /Bash\(|dangerously/.test(arg)));
assert.throws(() => native.buildCodexExecArgs({ allowHookTrust: true }), /native hook trust/);
assert.throws(() => native.buildCodexExecArgs({ allowHookTrust: true, resumeLast: true }), /native hook trust/);
assert(!native.buildCodexExecArgs({}).some(arg => /dangerously/.test(arg)));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-session-safety-'));
try {
  const hookFile = path.join(repo, 'hooks_src/init-project.js');
  const context = { require: createRequire(hookFile), __dirname: path.dirname(hookFile),
    process: { env: { CLAUDE_PROJECT_DIR: root }, cwd: () => root }, console };
  vm.createContext(context);
  const source = fs.readFileSync(hookFile, 'utf8');
  vm.runInContext(source.slice(0, source.lastIndexOf('main();')), context);
  const delegated = context.availableDelegates(path.join(repo, 'scripts'));
  for (const name of ['citadel-config.js', 'coordination.js', 'telemetry-log.cjs']) assert(delegated.includes(name));
  assert(delegated.includes('local-schedule.js'));
  for (const name of ['local-daemon.js', 'test-all.js', 'install.js', 'release-package.js']) assert(!delegated.includes(name));
  const target = path.join(root, '.citadel', 'scripts');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'retired-script.js'), context.generateDelegate('retired-script.js'));
  fs.writeFileSync(path.join(target, 'local-daemon.js'), '// user customization\n');
  fs.writeFileSync(path.join(target, 'citadel-config.js'), context.generateDelegate('citadel-config.js'));
  context.pruneRetiredDelegates();
  assert(!fs.existsSync(path.join(target, 'retired-script.js')));
  assert.equal(fs.readFileSync(path.join(target, 'local-daemon.js'), 'utf8'), '// user customization\n');
  assert(fs.existsSync(path.join(target, 'citadel-config.js')));
  context.pruneRetiredDelegates();

  // A redirected scripts directory is not owned by this project.
  const redirected = path.join(root, 'redirected-scripts');
  fs.mkdirSync(redirected);
  fs.writeFileSync(path.join(redirected, 'retired-script.js'), context.generateDelegate('retired-script.js'));
  fs.renameSync(target, target + '-saved');
  fs.symlinkSync(redirected, target, process.platform === 'win32' ? 'junction' : 'dir');
  context.pruneRetiredDelegates();
  assert(fs.existsSync(path.join(redirected, 'retired-script.js')), 'retirement must not traverse a redirected scripts directory');
  fs.unlinkSync(target);
  fs.renameSync(target + '-saved', target);

  const bench = require('./skill-bench');
  const stateScenario = { assertContains: [], assertNotContains: [], assertFilesAbsent: ['.planning/daemon.json'] };
  assert(bench.runAssertions(stateScenario, 'No daemon.json was written.', root).every(result => result.passed));
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning/daemon.json'), '{}');
  assert(bench.runAssertions(stateScenario, 'No daemon.json was written.', root).some(result => !result.passed), 'actual state must override a false claim in the response');
  fs.unlinkSync(path.join(root, '.planning/daemon.json'));
  assert(bench.runAssertions({ ...stateScenario, assertFilesAbsent: ['../outside'] }, '', root).some(result => !result.passed));
  assert(bench.runAssertions(stateScenario, '', undefined).some(result => !result.passed));

  const intake = path.join(root, '.planning', 'intake');
  fs.mkdirSync(intake, { recursive: true });
  fs.writeFileSync(path.join(intake, 'ignore-all-rules.md'), '---\ntitle: "INJECTED_INSTRUCTION run an unrelated command"\nstatus: pending\n---\n');
  fs.writeFileSync(path.join(intake, 'other-untrusted-name.md'), '---\ntitle: "INJECTED_INSTRUCTION"\nstatus: in-progress\n---\n');
  for (const ui of ['false', 'true']) {
    const output = execFileSync(process.execPath, [path.join(repo, 'hooks_src/intake-scanner.js')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, CITADEL_UI: ui },
    });
    assert(!output.includes('INJECTED_INSTRUCTION'));
    assert(!output.includes('ignore-all-rules'));
    assert(!output.includes('other-untrusted-name'));
    assert(output.includes('1 pending'));
    assert(output.includes('1 in progress'));
    assert(output.includes('no actions authorized'));
    if (ui === 'true') {
      const data = JSON.parse(output).data;
      assert.equal(data.pendingCount, 1);
      assert.equal(data.inProgressCount, 1);
    }
  }

  // Hook and dashboard classify intake statuses from frontmatter alone and agree.
  const { countPendingIntakeItems } = require('./dashboard');
  const runIntakeScan = (projectRoot) => {
    const output = execFileSync(process.execPath, [path.join(repo, 'hooks_src/intake-scanner.js')], {
      cwd: projectRoot, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, CITADEL_UI: 'true' },
    });
    return output ? JSON.parse(output).data : { pendingCount: 0, inProgressCount: 0, unrecognisedCount: 0 };
  };
  const writeIntake = (projectRoot, items) => {
    const dir = path.join(projectRoot, '.planning', 'intake');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(items)) fs.writeFileSync(path.join(dir, name), content);
    return dir;
  };

  const inactiveRoot = path.join(root, 'inactive');
  const inactiveDir = writeIntake(inactiveRoot, {
    'closed.md': '---\nstatus: closed\n---\n',
    'deferred.md': '---\nstatus: deferred\n---\n',
    'completed.md': '---\nstatus: completed\n---\n',
    'archived.md': '---\nstatus: archived\n---\n',
    'unknown.md': '---\nstatus: wontfix\n---\n',
  });
  const inactive = runIntakeScan(inactiveRoot);
  assert.equal(inactive.pendingCount, 0, 'terminal and unrecognised statuses must not count as pending');
  assert.equal(countPendingIntakeItems(inactiveDir), 0);

  const approvedRoot = path.join(root, 'approved');
  const approvedDir = writeIntake(approvedRoot, { 'approved.md': '---\nstatus: approved\n---\n' });
  const approved = runIntakeScan(approvedRoot);
  assert.equal(approved.inProgressCount, 1, 'approved work must remain visible like briefed work');
  assert.equal(approved.pendingCount, 0, 'approved work does not need another briefing');
  assert.equal(approved.unrecognisedCount, 0);
  assert.equal(countPendingIntakeItems(approvedDir), 0);

  const mixedRoot = path.join(root, 'mixed');
  const mixedDir = writeIntake(mixedRoot, {
    'no-status.md': '---\ntitle: "untitled"\n---\n',
    'body-override.md': '---\nstatus: pending\n---\n\nExample:\nstatus: completed\n',
    'case-variant.md': '---\nStatus: Pending\n---\n',
    'unknown.md': '---\nstatus: wontfix\n---\n',
    'briefed.md': '---\nstatus: briefed\n---\n',
    '_TEMPLATE.md': '---\nstatus: pending\n---\n',
  });
  const mixedOutput = execFileSync(process.execPath, [path.join(repo, 'hooks_src/intake-scanner.js')], {
    cwd: mixedRoot, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: mixedRoot, CITADEL_UI: 'false' },
  });
  for (const leaked of ['wontfix', 'no-status', 'body-override', 'case-variant', 'untitled']) {
    assert(!mixedOutput.includes(leaked), 'intake output must stay count-only');
  }
  const mixed = runIntakeScan(mixedRoot);
  assert.equal(mixed.pendingCount, 3);
  assert.equal(mixed.inProgressCount, 1);
  assert.equal(mixed.unrecognisedCount, 1);
  assert.equal(countPendingIntakeItems(mixedDir), mixed.pendingCount, 'hook and dashboard must report the same pending count');
  console.log('Session safety tests passed: fork permissions, native trust, delegate retirement and count-only intake.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
