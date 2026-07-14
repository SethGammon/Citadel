#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const forks = require('../core/forks');
const operations = require('../core/operations');

if (typeof forks.buildProofReport !== 'function') {
  process.stderr.write('OPERATION_FORK_PROOF_NOT_IMPLEMENTED\n');
  process.exit(1);
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return String(result.stdout || '').trim();
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fork-proof-'));
const project = path.join(sandbox, 'project');
const worktrees = path.join(sandbox, 'worktrees');
fs.mkdirSync(project);
git(project, ['init', '--initial-branch=main']);
git(project, ['config', 'user.name', 'Citadel Test']);
git(project, ['config', 'user.email', 'citadel@example.invalid']);
fs.writeFileSync(path.join(project, 'README.md'), '# proof fixture\n');
git(project, ['add', 'README.md']);
git(project, ['commit', '-m', 'fixture']);

const workflow = {
  id: 'workflow-proof-test',
  steps: [{ id: 'step-execute' }, { id: 'step-verify' }],
  verifier: { command: 'git', args: ['diff', '--check'] },
};
const executors = {
  schema_version: 1,
  executors: [
    {
      profile_id: 'claude-proof', runtime: 'claude', model: 'opus', local_provider: null,
      adapter_options: { permission_mode: 'acceptEdits', effort: 'high' },
    },
    {
      profile_id: 'codex-proof', runtime: 'codex', model: 'gpt-5.6-sol', local_provider: null,
      adapter_options: { sandbox: 'workspace-write' },
    },
  ],
};

const started = forks.startFork({
  projectRoot: project,
  worktreeRoot: worktrees,
  forkId: 'fork-proof-report',
  objective: 'Build a bounded public proof report',
  title: 'Proof report',
  workflow,
  executors,
  execute: false,
});
const fork = forks.loadFork(project, started.fork.fork_id);
const events = forks.readEvents(project, fork.fork_id);
const evidence = forks.forkEvidence(project, fork);
const built = forks.buildProofReport(fork, events, { evidence });

assert.deepEqual(Object.keys(built).sort(), ['digest', 'report', 'serialized']);
assert.deepEqual(Object.keys(built.report), [
  'schema_version', 'kind', 'fork_id', 'fork_revision', 'replay_digest', 'summary', 'replay',
]);
assert.equal(built.report.schema_version, 1);
assert.equal(built.report.kind, 'operation_fork_proof_report');
assert.equal(built.report.fork_id, 'fork-proof-report');
assert.equal(built.report.fork_revision, fork.revision);
assert.deepEqual(Object.keys(built.report.summary), [
  'branch_count', 'comparable_count', 'verified_receipt_count', 'model_proof_counts',
  'comparison_outcome', 'recommendation',
]);
assert.equal(built.report.summary.branch_count, 2);
assert.equal(built.report.summary.comparable_count, 0);
assert.equal(built.report.summary.verified_receipt_count, 0);
assert.deepEqual(built.report.summary.model_proof_counts, { passed: 0, failed: 0, unknown: 2 });
assert.equal(built.report.summary.comparison_outcome, 'insufficient-evidence');
assert.equal(built.report.summary.recommendation, null);
assert.equal(built.report.replay_digest, operations.sha256Digest(built.report.replay));
assert.equal(built.serialized, operations.canonicalSerialize(built.report));
assert.equal(built.digest, operations.sha256Digest(built.report));
assert(!built.serialized.includes(project));
assert(!built.serialized.includes(worktrees));
assert(!/[A-Za-z]:[\\/]/.test(built.serialized));

const output = path.join(sandbox, 'proof.json');
const cli = spawnSync(process.execPath, [
  path.join(__dirname, 'operation-fork.js'), 'proof', fork.fork_id,
  '--project-root', project, '--output', output,
], { cwd: project, encoding: 'utf8', shell: false });
assert.equal(cli.status, 0, cli.stderr);
const response = JSON.parse(cli.stdout);
assert.equal(response.ok, true);
assert.equal(response.command, 'fork proof');
assert.equal(response.digest, built.digest);
assert.equal(fs.existsSync(output), true);
const written = JSON.parse(fs.readFileSync(output, 'utf8'));
assert.deepEqual(written, built.report);
assert(!JSON.stringify(written).includes(project));
assert(!JSON.stringify(written).includes(worktrees));

console.log('Operation Fork proof report passed: deterministic summary, verified evidence counts, CLI export, and public redaction.');
