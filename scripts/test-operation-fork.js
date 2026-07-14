#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const forks = require('../core/forks');
const operations = require('../core/operations');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return String(result.stdout || '').trim();
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fork-'));
const project = path.join(sandbox, 'project');
const worktrees = path.join(sandbox, 'worktrees');
fs.mkdirSync(project);
git(project, ['init', '--initial-branch=main']);
git(project, ['config', 'user.name', 'Citadel Test']);
git(project, ['config', 'user.email', 'citadel@example.invalid']);
fs.writeFileSync(path.join(project, 'README.md'), '# fixture\n');
git(project, ['add', 'README.md']);
git(project, ['commit', '-m', 'fixture']);
const baseRevision = git(project, ['rev-parse', 'HEAD']);
const workflow = {
  id: 'workflow-fork-test',
  steps: [{ id: 'step-execute' }, { id: 'step-verify' }],
  verifier: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
};
const nowValues = [
  '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:01.000Z', '2026-07-13T12:00:02.000Z',
  '2026-07-13T12:00:03.000Z', '2026-07-13T12:00:04.000Z', '2026-07-13T12:00:05.000Z',
  '2026-07-13T12:00:06.000Z', '2026-07-13T12:00:07.000Z', '2026-07-13T12:00:08.000Z',
  '2026-07-13T12:00:09.000Z', '2026-07-13T12:00:10.000Z', '2026-07-13T12:00:11.000Z',
];
let nowIndex = 0;
const provider = forks.createGitWorktreeProvider();
function fakeRun(options) {
  fs.writeFileSync(path.join(options.worktree, `${options.branch.runtime}.txt`), `${options.branch.runtime}\n`);
  const completedAt = new Date(Date.parse(options.startedAt) + 1000).toISOString();
  const diffSummary = provider.diffSummary(options.worktree, options.branch.base_revision);
  const receipt = forks.receiptFor({
    fork: options.fork, branch: options.branch, status: 'passed', startedAt: options.startedAt,
    completedAt, agentOutputDigest: operations.sha256Digest({ agent: options.branch.runtime }),
    verifierOutputDigest: operations.sha256Digest({ verifier: 'passed' }), diffSummary,
    signingKey: options.signingKey,
  });
  return {
    status: 'passed', started_at: options.startedAt, completed_at: completedAt,
    receipt_digest: receipt.envelope.receipt_digest, receipt_envelope: receipt.envelope,
    evidence_summary: { status: 'passed', required: 2, present: 2, receipt_verified: true,
      score: null, score_max: null },
    diff_summary: diffSummary, duration_ms: 1000, cost: null, failure_code: null,
  };
}

const result = forks.startFork({
  projectRoot: project,
  forkId: 'fork-auth-race',
  title: 'Fix the authentication race',
  objective: 'Find and eliminate the authentication race',
  workflow,
  policies: [{ external_writes: false }],
  baseRevision,
  worktreeRoot: worktrees,
  worktreeProvider: provider,
  runBranch: fakeRun,
  createdAt: '2026-07-13T12:00:00.000Z',
  now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)],
});

assert.equal(result.fork.branches.length, 2);
assert.deepEqual(result.fork.branches.map((branch) => branch.runtime), ['claude', 'codex']);
assert(result.fork.branches.every((branch) => branch.contract_digest === result.fork.contract_digest));
assert(result.fork.branches.every((branch) => branch.base_revision === baseRevision));
assert(result.fork.branches.every((branch) => branch.status === 'passed'));
assert(result.fork.branches.every((branch) => branch.evidence_summary.receipt_verified));
assert.equal(result.comparison.outcome, 'tie');
assert.equal(result.comparison.comparable_count, 2);
const claudeTree = provider.resolve(project, worktrees, 'fork-auth-race', 'branch-claude');
const codexTree = provider.resolve(project, worktrees, 'fork-auth-race', 'branch-codex');
assert(fs.existsSync(path.join(claudeTree, 'claude.txt')));
assert(!fs.existsSync(path.join(claudeTree, 'codex.txt')));
assert(fs.existsSync(path.join(codexTree, 'codex.txt')));
assert(!fs.existsSync(path.join(codexTree, 'claude.txt')));
assert.equal(forks.loadFork(project, 'fork-auth-race').revision, result.fork.revision);
assert.equal(forks.listForks(project)[0].branches.length, 2);

const recovery = forks.startFork({
  projectRoot: project,
  forkId: 'fork-recovery',
  title: 'Recovery proof',
  objective: 'Prove recovery does not repeat ambiguous runtime effects',
  workflow,
  baseRevision,
  worktreeRoot: worktrees,
  worktreeProvider: provider,
  execute: false,
  createdAt: '2026-07-13T13:00:00.000Z',
  now: () => '2026-07-13T13:00:01.000Z',
}).fork;
let ambiguous = forks.updateBranch(recovery, 'branch-claude', {
  status: 'running', started_at: '2026-07-13T13:00:02.000Z',
}, '2026-07-13T13:00:02.000Z');
forks.saveFork(project, ambiguous, recovery.revision);
const calls = [];
const resumed = forks.resumeFork({ projectRoot: project, forkId: 'fork-recovery', workflow,
  worktreeRoot: worktrees, worktreeProvider: provider,
  runBranch: (options) => { calls.push(options.branch.runtime); return fakeRun(options); },
  now: (() => { let tick = 3; return () => `2026-07-13T13:00:${String(tick++).padStart(2, '0')}.000Z`; })(),
});
assert.equal(resumed.fork.branches.find((branch) => branch.runtime === 'claude').status, 'blocked');
assert.equal(resumed.fork.branches.find((branch) => branch.runtime === 'claude').failure_code, 'RUNTIME_EFFECT_AMBIGUOUS');
assert.deepEqual(calls, ['codex'], 'ambiguous Claude effect must not run again');

for (const branch of [...result.fork.branches, ...recovery.branches]) {
  const target = provider.resolve(project, worktrees, branch.run_id.includes('recovery') ? 'fork-recovery' : 'fork-auth-race', branch.branch_id);
  if (fs.existsSync(target)) git(project, ['worktree', 'remove', '--force', target]);
}
fs.rmSync(sandbox, { recursive: true, force: true });
process.stdout.write('Operation Fork execution passed: shared contract parity, isolated worktrees, signed receipts, and ambiguity-safe recovery.\n');
