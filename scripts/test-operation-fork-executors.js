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

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fork-executors-'));
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
  id: 'workflow-executor-test',
  steps: [{ id: 'step-execute' }, { id: 'step-verify' }],
  verifier: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
};
const executors = {
  schema_version: 1,
  executors: [
    { profile_id: 'claude-sonnet', runtime: 'claude', model: 'claude-sonnet-4-5', local_provider: null,
      adapter_options: { permission_mode: 'acceptEdits', effort: 'high' } },
    { profile_id: 'codex-hosted', runtime: 'codex', model: 'gpt-5-codex', local_provider: null,
      adapter_options: { sandbox: 'workspace-write' } },
    { profile_id: 'codex-local-qwen', runtime: 'codex', model: 'qwen3-coder:30b', local_provider: 'ollama',
      adapter_options: { sandbox: 'workspace-write' } },
  ],
};

// One profile reports the model it was asked for, one reports a different model,
// and one stays silent. Those are the three honest outcomes.
const OBSERVATIONS = {
  'branch-claude-sonnet': { model: 'claude-sonnet-4-5', trusted: true, source: 'claude-json',
    cost: { amount: 0.42, unit: 'usd', source: 'claude-json' }, duration_ms: 1000, tokens: 900 },
  'branch-codex-hosted': { model: 'gpt-4.1', trusted: true, source: 'codex-jsonl', cost: null,
    duration_ms: null, tokens: null },
  'branch-codex-local-qwen': null,
};

const provider = forks.createGitWorktreeProvider();
function fakeRun(options) {
  fs.writeFileSync(path.join(options.worktree, `${options.profile.profile_id}.txt`), 'work\n');
  const completedAt = new Date(Date.parse(options.startedAt) + 1000).toISOString();
  const diffSummary = provider.diffSummary(options.worktree, options.branch.base_revision);
  const receipt = forks.receiptFor({
    fork: options.fork, branch: options.branch, status: 'passed', startedAt: options.startedAt,
    completedAt, agentOutputDigest: operations.sha256Digest({ agent: options.profile.profile_id }),
    verifierOutputDigest: operations.sha256Digest({ verifier: 'passed' }), diffSummary,
    signingKey: options.signingKey,
  });
  const observation = OBSERVATIONS[options.branch.branch_id];
  return {
    status: 'passed', started_at: options.startedAt, completed_at: completedAt,
    receipt_digest: receipt.envelope.receipt_digest, receipt_envelope: receipt.envelope,
    evidence_summary: { status: 'passed', required: 2, present: 2, receipt_verified: true,
      score: null, score_max: null },
    diff_summary: diffSummary, duration_ms: 1000,
    cost: observation && observation.cost ? observation.cost : null,
    failure_code: null, observation,
  };
}

let tick = 0;
const now = () => new Date(Date.parse('2026-07-13T18:00:00.000Z') + (tick += 1) * 1000).toISOString();

const started = forks.startFork({
  projectRoot: project,
  forkId: 'fork-executors',
  title: 'Executor profile proof',
  objective: 'Prove executor profiles bind identity to evidence',
  workflow,
  executors,
  baseRevision,
  worktreeRoot: worktrees,
  worktreeProvider: provider,
  runBranch: fakeRun,
  createdAt: '2026-07-13T18:00:00.000Z',
  now,
});

// Schema 2 structure: set digest on the fork, profile digest on every branch.
const fork = started.fork;
assert.equal(fork.schema_version, 2);
assert.equal(fork.executor_set_digest, forks.executorSetDigest(executors));
assert.deepEqual(fork.branches.map((branch) => branch.branch_id),
  ['branch-claude-sonnet', 'branch-codex-hosted', 'branch-codex-local-qwen']);
assert.deepEqual(fork.branches.map((branch) => branch.runtime), ['claude', 'codex', 'codex']);
for (const branch of fork.branches) {
  const profile = executors.executors.find((entry) => `branch-${entry.profile_id}` === branch.branch_id);
  assert.equal(branch.executor_profile_digest, forks.executorProfileDigest(profile));
  assert.equal(branch.contract_digest, fork.contract_digest);
  assert.equal(branch.status, 'passed');
}
// Two profiles share the codex runtime and must not share a worktree or ref.
const refs = new Set(fork.branches.map((branch) => branch.branch_ref));
assert.equal(refs.size, 3, 'each executor profile owns its own branch ref');
assert(fs.existsSync(path.join(provider.resolve(project, worktrees, 'fork-executors', 'branch-codex-hosted'), 'codex-hosted.txt')));
assert(!fs.existsSync(path.join(provider.resolve(project, worktrees, 'fork-executors', 'branch-codex-hosted'), 'codex-local-qwen.txt')));

// Stored bindings verify cryptographically, and the model proof is honest.
const states = forks.executorStates(project, forks.loadFork(project, 'fork-executors'));
const byId = new Map(states.map((state) => [state.branch_id, state]));
assert.equal(byId.get('branch-claude-sonnet').model_status, 'passed');
assert.equal(byId.get('branch-claude-sonnet').observed_model, 'claude-sonnet-4-5');
assert.equal(byId.get('branch-claude-sonnet').receipt_status, 'verified');
assert.equal(byId.get('branch-claude-sonnet').cost.amount, 0.42);
assert.equal(byId.get('branch-codex-hosted').model_status, 'failed');
assert.equal(byId.get('branch-codex-hosted').cost, null);
assert.equal(byId.get('branch-codex-hosted').cost_status, 'unknown');
assert.equal(byId.get('branch-codex-local-qwen').model_status, 'unknown');
assert.equal(byId.get('branch-codex-local-qwen').observed_model, null);
assert.equal(byId.get('branch-codex-local-qwen').requested_model, 'qwen3-coder:30b');
const unverifiedComparison = forks.compareFork(fork);
assert.equal(unverifiedComparison.comparable_count, 0);
assert(unverifiedComparison.branches.every((branch) => branch.reasons.includes('fork-receipt-unverified')));

// Public replay carries the executor facts and none of the private material.
const replay = forks.publicReplay(forks.loadFork(project, 'fork-executors'),
  forks.readEvents(project, 'fork-executors'),
  { evidence: forks.forkEvidence(project, forks.loadFork(project, 'fork-executors')) });
for (const forbidden of ['signature', 'signing', 'raw_output', 'command', 'args', baseRevision]) {
  assert(!replay.serialized.includes(forbidden), `replay leaked ${forbidden}`);
}
assert(replay.serialized.includes('qwen3-coder:30b'), 'replay must state the requested model');

// A tampered stored wrapper can never be selected, however the record looks.
const wrapperFile = path.join(project, '.planning', 'operation-forks', 'fork-executors', 'receipts',
  'branch-claude-sonnet.fork.json');
const original = fs.readFileSync(wrapperFile, 'utf8');
const tampered = JSON.parse(original);
tampered.receipt.execution_receipt_digest = `sha256:${'c'.repeat(64)}`;
fs.writeFileSync(wrapperFile, `${JSON.stringify(tampered, null, 2)}\n`);
const tamperedFork = forks.loadFork(project, 'fork-executors');
const tamperedComparison = forks.compareFork(tamperedFork,
  { evidence: forks.forkEvidence(project, tamperedFork) });
const tamperedBranch = tamperedComparison.branches.find((branch) => branch.branch_id === 'branch-claude-sonnet');
assert.equal(tamperedBranch.comparable, false);
assert(tamperedBranch.reasons.includes('fork-receipt-unverified'));
assert.throws(() => forks.applySelection({ projectRoot: project, forkId: 'fork-executors',
  branchId: 'branch-claude-sonnet', expectedRevision: tamperedFork.revision, actorId: 'actor-test',
  idempotencyKey: 'select-tampered-001', reason: 'tampered' }), /verified/i);
fs.writeFileSync(wrapperFile, original);

// The signer key is bound into the immutable shared contract. Replacing the
// public key cannot make a newly signed wrapper trusted.
const signerFile = path.join(project, '.planning', 'operation-forks', 'fork-executors', 'signer-public-key.pem');
const signerOriginal = fs.readFileSync(signerFile, 'utf8');
const replacementKey = crypto.generateKeyPairSync('ed25519').publicKey
  .export({ type: 'spki', format: 'pem' }).toString();
fs.writeFileSync(signerFile, replacementKey);
const signerTampered = forks.forkEvidence(project, forks.loadFork(project, 'fork-executors'))
  .get('branch-claude-sonnet');
assert.notEqual(signerTampered.verification.status, 'verified');
assert.equal(signerTampered.verification.reason_code, 'FORK_SIGNER_KEY_DIGEST_MISMATCH');
fs.writeFileSync(signerFile, signerOriginal);

// The underlying execution receipt and signed telemetry binding are both
// reloaded. Altering either one invalidates comparison.
const receiptFile = path.join(project, '.planning', 'operation-forks', 'fork-executors', 'receipts',
  'branch-claude-sonnet.json');
const receiptOriginal = fs.readFileSync(receiptFile, 'utf8');
const receiptTampered = JSON.parse(receiptOriginal);
receiptTampered.receipt_digest = `sha256:${'e'.repeat(64)}`;
fs.writeFileSync(receiptFile, `${JSON.stringify(receiptTampered, null, 2)}\n`);
assert.notEqual(forks.forkEvidence(project, forks.loadFork(project, 'fork-executors'))
  .get('branch-claude-sonnet').verification.status, 'verified');
fs.writeFileSync(receiptFile, receiptOriginal);

const telemetryFile = path.join(project, '.planning', 'operation-forks', 'fork-executors', 'telemetry',
  'branch-claude-sonnet.json');
const telemetryOriginal = fs.readFileSync(telemetryFile, 'utf8');
const telemetryTampered = JSON.parse(telemetryOriginal);
telemetryTampered.model = 'tampered-model';
fs.writeFileSync(telemetryFile, `${JSON.stringify(telemetryTampered, null, 2)}\n`);
assert.notEqual(forks.forkEvidence(project, forks.loadFork(project, 'fork-executors'))
  .get('branch-claude-sonnet').verification.status, 'verified');
fs.writeFileSync(telemetryFile, telemetryOriginal);

// A verified branch selects, and landing still refuses to run without a fresh
// verification of that same binding.
const restored = forks.loadFork(project, 'fork-executors');
const selected = forks.applySelection({ projectRoot: project, forkId: 'fork-executors',
  branchId: 'branch-claude-sonnet', expectedRevision: restored.revision, actorId: 'actor-test',
  idempotencyKey: 'select-executors-001', reason: 'verified identity', now });
assert.equal(selected.status, 'selected');
assert.equal(selected.selection.branch_id, 'branch-claude-sonnet');
const token = forks.landingConfirmation(selected, baseRevision);
assert.throws(() => forks.prepareLanding(selected, { expectedRevision: selected.revision,
  targetRevision: baseRevision, confirmation: token, idempotencyKey: 'landing-executors-001',
  receiptVerification: null, confirmedAt: now() }), /verified/i);

// Legacy --runtimes input still produces an unchanged schema 1 record.
const legacy = forks.startFork({
  projectRoot: project,
  forkId: 'fork-legacy',
  title: 'Legacy runtimes',
  objective: 'Prove legacy runtime selection is unchanged',
  workflow,
  runtimes: ['claude', 'codex'],
  baseRevision,
  worktreeRoot: worktrees,
  worktreeProvider: provider,
  runBranch: fakeRun,
  createdAt: '2026-07-13T19:00:00.000Z',
  now,
}).fork;
assert.equal(legacy.schema_version, 1);
assert.equal(legacy.executor_set_digest, undefined);
assert.deepEqual(legacy.branches.map((branch) => branch.branch_id), ['branch-claude', 'branch-codex']);
assert.deepEqual(legacy.branches.map((branch) => branch.branch_ref),
  ['citadel/fork-legacy/claude', 'citadel/fork-legacy/codex']);
assert(legacy.branches.every((branch) => branch.executor_profile_digest === undefined));
assert.equal(fs.existsSync(path.join(project, '.planning', 'operation-forks', 'fork-legacy', 'executors.json')), false);
const legacyStates = forks.executorStates(project, forks.loadFork(project, 'fork-legacy'));
assert.deepEqual(legacyStates.map((state) => state.requested_model), ['default', 'default']);
assert.deepEqual(legacyStates.map((state) => state.model_status), ['unknown', 'unknown']);

// The two selection forms cannot be combined, and the conflict is rejected
// before any planning state exists.
assert.throws(() => forks.startFork({ projectRoot: project, forkId: 'fork-conflict',
  title: 'Conflict', objective: 'Conflict', workflow, executors, runtimes: ['claude', 'codex'],
  baseRevision, worktreeRoot: worktrees, worktreeProvider: provider, execute: false }),
/mutually exclusive/i);
assert.equal(fs.existsSync(path.join(project, '.planning', 'operation-forks', 'fork-conflict')), false);

// Runtime containment detects branch ownership changes, missing parent or
// sibling registrations, and blocks the verifier on any violation.
const containmentSnapshot = provider.captureContainment({
  projectRoot: project,
  worktreeRoot: worktrees,
  fork,
  branch: fork.branches[0],
});
assert.equal(provider.assertContainment(containmentSnapshot), true);
const containedTree = provider.resolve(project, worktrees, 'fork-executors', 'branch-codex-hosted');
const containedBranch = git(containedTree, ['rev-parse', '--abbrev-ref', 'HEAD']);
git(containedTree, ['switch', '-c', 'rogue-containment']);
assert.throws(() => provider.assertContainment(containmentSnapshot), /ownership changed/i);
git(containedTree, ['switch', containedBranch]);
git(project, ['branch', '-D', 'rogue-containment']);
const missingParent = {
  expected: containmentSnapshot.expected.map((entry, index) => (index === 0
    ? { ...entry, path: `${entry.path}-missing` } : entry)),
};
assert.throws(() => provider.assertContainment(missingParent), /removed|ownership/i);

let verifierCalls = 0;
const containmentResult = forks.runRuntimeBranch({
  fork,
  branch: fork.branches[0],
  profile: executors.executors[0],
  objective: 'Prove executor profiles bind identity to evidence',
  signingKey: crypto.generateKeyPairSync('ed25519').privateKey,
  worktree: project,
  worktreeProvider: {
    captureContainment: () => ({ expected: [] }),
    assertContainment: () => { throw Object.assign(new Error('ownership changed'), { code: 'FORK_WORKTREE_CONTAINMENT_VIOLATION' }); },
    diffSummary: () => ({ files_changed: 0, insertions: 0, deletions: 0, digest: operations.sha256Digest([]) }),
  },
  verifier: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
  spawn: () => { verifierCalls += 1; return { status: 0, stdout: '{}', stderr: '' }; },
  startedAt: '2026-07-13T20:00:00.000Z',
  completedAt: '2026-07-13T20:00:01.000Z',
});
assert.equal(containmentResult.failure_code, 'WORKTREE_CONTAINMENT_VIOLATION');
assert.equal(verifierCalls, 1, 'containment violation must skip verifier spawn');

// Windows launches a known npm shim through its JavaScript entrypoint without
// a command interpreter.
const invocation = forks.runtimeInvocationForProfile(executors.executors[2]);
const shim = forks.platformInvocation(invocation, {
  platform: 'win32',
  env: {},
  resolve: () => 'C:\\Program Files\\nodejs\\codex.cmd',
  resolveEntrypoint: () => 'C:\\Program Files\\nodejs\\node_modules\\@openai\\codex\\bin\\codex.js',
  exists: () => true,
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
});
assert.equal(shim.command, 'C:\\Program Files\\nodejs\\node.exe');
assert.equal(shim.windowsVerbatimArguments, false);
assert.deepEqual(shim.args, [
  'C:\\Program Files\\nodejs\\node_modules\\@openai\\codex\\bin\\codex.js',
  ...invocation.args,
]);
const direct = forks.platformInvocation(invocation, {
  platform: 'win32', env: {}, resolve: () => 'C:\\tools\\codex.exe',
});
assert.equal(direct.command, 'C:\\tools\\codex.exe');
assert.equal(direct.windowsVerbatimArguments, false);
assert.throws(() => forks.platformInvocation({ command: 'unknown', args: ['exec'] }, {
  platform: 'win32', env: {}, resolve: () => 'C:\\tools\\unknown.cmd',
  resolveEntrypoint: () => null,
}), /trusted direct entrypoint/i);
let spawnOptions = null;
forks.spawnInvocation(invocation, { platform: 'linux', spawn: (_command, _args, spawned) => {
  spawnOptions = spawned;
  return { status: 0, stdout: '', stderr: '' };
} });
assert.equal(spawnOptions.shell, false);

for (const forkId of ['fork-executors', 'fork-legacy']) {
  for (const branch of forks.loadFork(project, forkId).branches) {
    const target = provider.resolve(project, worktrees, forkId, branch.branch_id);
    if (fs.existsSync(target)) git(project, ['worktree', 'remove', '--force', target]);
  }
}
fs.rmSync(sandbox, { recursive: true, force: true });
process.stdout.write('Operation Fork executors passed: schema 2 bindings, same-runtime isolation, honest model proof, tamper rejection, legacy compatibility, and shell-free Windows launch.\n');
