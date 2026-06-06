#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assessReadiness,
  splitCommand,
} = require('./pr-ready');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-pr-ready-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function initGit(projectRoot) {
  childProcess.execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['checkout', '-b', 'codex/test-ready'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: projectRoot, stdio: 'ignore' });
}

function initPlanning(projectRoot) {
  fs.mkdirSync(path.join(projectRoot, '.planning', 'telemetry'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'campaigns'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'intake'), { recursive: true });
}

assert.deepEqual(splitCommand('npm run test'), ['npm', 'run', 'test']);
assert.deepEqual(splitCommand('node "scripts/test file.js"'), ['node', 'scripts/test file.js']);

withTempProject((projectRoot) => {
  initGit(projectRoot);
  initPlanning(projectRoot);
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'test.js'), 'process.exit(0);\n');
  childProcess.execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, stdio: 'ignore' });

  const readiness = assessReadiness(projectRoot, {
    pr: 'https://github.com/acme/repo/pull/12',
    runVerification: true,
    verification: 'npm run test',
    changedFiles: ['hooks_src/protect-files.js'],
    now: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.verificationProfile.id, 'hook-runtime');
  assert(readiness.verificationProfile.commands.includes('node scripts/verify-hooks.js'));
  assert.equal(readiness.gates.prUrl.pass, true);
  assert.equal(readiness.gates.git.pass, true);
  assert.equal(readiness.gates.dashboard.pass, true);
  assert.equal(readiness.gates.verification.pass, true);
  assert.equal(readiness.reportPath, '.planning/pr-readiness/codex-test-ready.md');
  const report = fs.readFileSync(path.join(projectRoot, readiness.reportPath), 'utf8');
  assert(report.includes('Status: ready'));
  assert(report.includes('## Verification Plan'));
  assert(report.includes('Profile: hook-runtime'));
  assert(report.includes('| node scripts/verify-hooks.js | recommended |'));
  assert(report.includes('---HANDOFF---'));
});

withTempProject((projectRoot) => {
  initGit(projectRoot);
  initPlanning(projectRoot);
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'test.js'), 'process.exit(0);\n');
  childProcess.execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, stdio: 'ignore' });

  const readiness = assessReadiness(projectRoot, {
    pr: 'https://github.com/acme/repo/pull/12',
    runVerification: true,
    verification: 'npm run test',
    branch: 'codex/explicit-pr-branch',
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.branch, 'codex/explicit-pr-branch');
  assert.equal(readiness.reportPath, '.planning/pr-readiness/codex-explicit-pr-branch.md');
  assert(fs.existsSync(path.join(projectRoot, readiness.reportPath)));
});

withTempProject((projectRoot) => {
  initGit(projectRoot);
  initPlanning(projectRoot);
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'test.js'), 'process.exit(0);\n');
  childProcess.execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, stdio: 'ignore' });

  const readiness = assessReadiness(projectRoot, {
    pr: 'https://github.com/acme/repo/pull/12',
    runVerification: false,
    verification: 'npm run test',
    now: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.gates.verification.pass, false);
  assert(readiness.blockers.some((blocker) => blocker.includes('verification was not run')));
});

withTempProject((projectRoot) => {
  initGit(projectRoot);
  initPlanning(projectRoot);
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'test.js'), 'process.exit(1);\n');
  childProcess.execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, stdio: 'ignore' });

  const output = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'pr-ready.js'),
    '--project-root',
    projectRoot,
    '--pr',
    'not-a-pr',
    '--run-verification',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(output.status, 1);
  const readiness = JSON.parse(output.stdout);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.gates.prUrl.pass, false);
  assert.equal(readiness.gates.verification.pass, false);
});

withTempProject((projectRoot) => {
  initGit(projectRoot);
  initPlanning(projectRoot);
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'test.js'), 'process.exit(0);\n');
  childProcess.execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, stdio: 'ignore' });

  const output = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'pr-ready.js'),
    '--project-root',
    projectRoot,
    '--pr',
    'https://github.com/acme/repo/pull/12',
    '--branch',
    'codex/cli-pr-branch',
    '--run-verification',
    '--verification',
    'npm run test',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(output.status, 0);
  const readiness = JSON.parse(output.stdout);
  assert.equal(readiness.branch, 'codex/cli-pr-branch');
  assert.equal(readiness.reportPath, '.planning/pr-readiness/codex-cli-pr-branch.md');
});

withTempProject((projectRoot) => {
  initGit(projectRoot);
  initPlanning(projectRoot);
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'test.js'), 'process.exit(0);\n');
  childProcess.execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, stdio: 'ignore' });
  write(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'), `${JSON.stringify({ status: 'pending' })}\n`);

  const readiness = assessReadiness(projectRoot, {
    pr: 'https://github.com/acme/repo/pull/12',
    runVerification: true,
    verification: 'npm run test',
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.gates.dashboard.pass, false);
  assert(readiness.blockers.some((blocker) => blocker.includes('doc-sync')));
});

withTempProject((projectRoot) => {
  initGit(projectRoot);
  initPlanning(projectRoot);
  write(path.join(projectRoot, 'verify.js'), [
    "const fs = require('fs');",
    "const path = require('path');",
    "const queue = path.join(process.cwd(), '.planning', 'telemetry', 'doc-sync-queue.jsonl');",
    "fs.appendFileSync(queue, `${JSON.stringify({ status: 'pending' })}\\n`, 'utf8');",
  ].join('\n'));
  childProcess.execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, stdio: 'ignore' });

  const readiness = assessReadiness(projectRoot, {
    pr: 'https://github.com/acme/repo/pull/12',
    runVerification: true,
    verification: 'node verify.js',
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.gates.verification.pass, true);
  assert.equal(readiness.gates.dashboard.pass, false);
  assert(readiness.blockers.some((blocker) => blocker.includes('doc-sync')));
});

console.log('pr readiness tests passed');
