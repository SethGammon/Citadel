#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const forks = require('../core/forks');
const operations = require('../core/operations');

const NOW = '2026-07-13T15:00:00.000Z';
const BASE = 'a'.repeat(40);

function readyFork(id) {
  const operation = {
    protocol_version: operations.PROTOCOL_VERSION, kind: operations.CONTRACT_KINDS.OPERATION_SPEC,
    operation_id: `operation-${id}`, title: 'Security fixture',
    objective_digest: operations.sha256Digest({ objective: id }), step_ids: ['step-verify'],
    policy_digests: [], created_at: NOW,
  };
  const shared = { objective_digest: operation.objective_digest,
    scope_digest: operations.sha256Digest({ scope: 'repo' }), policy_digests: [],
    budget_digest: operations.sha256Digest({ budget: 1 }), workflow_digest: operations.sha256Digest({ workflow: 1 }),
    verifier_digest: operations.sha256Digest({ verifier: 1 }), base_revision: BASE };
  let fork = forks.createOperationFork({ forkId: id, operation, shared, createdAt: NOW });
  const complete = (name) => ({ status: 'passed', worktree_ref: `${id}/${name}`,
    branch_ref: `citadel/${id}/${name}`, started_at: '2026-07-13T15:00:01.000Z',
    completed_at: '2026-07-13T15:00:02.000Z', receipt_digest: operations.sha256Digest({ receipt: name }),
    evidence_summary: { status: 'passed', required: 1, present: 1, receipt_verified: true, score: null, score_max: null },
    diff_summary: { files_changed: 1, insertions: 1, deletions: 0, digest: operations.sha256Digest({ diff: name }) },
    duration_ms: 1000, cost: null, failure_code: null });
  fork = forks.updateBranch(fork, 'branch-claude', complete('branch-claude'), '2026-07-13T15:00:03.000Z');
  fork = forks.updateBranch(fork, 'branch-codex', complete('branch-codex'), '2026-07-13T15:00:04.000Z');
  return forks.selectBranch(fork, { branchId: 'branch-claude', expectedRevision: fork.revision,
    actorId: 'actor-security', idempotencyKey: `select-${id}-001`, reason: 'verified',
    selectedAt: '2026-07-13T15:00:05.000Z' });
}

const strict = readyFork('fork-strict');
assert.throws(() => forks.assertValidFork({ ...strict, prompt: 'private' }), /fields are invalid/);
assert.throws(() => forks.assertValidFork({ ...strict, branches: strict.branches.map((branch, index) => index
  ? branch : { ...branch, worktree_ref: '../escape' }) }), /worktree_ref/);
assert.throws(() => forks.createForkRecord(process.cwd(), { ...strict, fork_id: '../escape' }), /fork_id|Invalid/);
const containmentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fork-containment-'));
const containmentProject = path.join(containmentRoot, 'project');
fs.mkdirSync(containmentProject);
const unsafeWorktreeRoot = path.join(containmentProject, 'nested-worktrees');
assert.throws(() => forks.prepareWorktreeRoot(containmentProject, unsafeWorktreeRoot), /outside/);
assert.equal(fs.existsSync(unsafeWorktreeRoot), false, 'unsafe worktree root must be rejected before creation');
assert.deepEqual(forks.listForks(containmentProject), []);
assert.equal(fs.existsSync(path.join(containmentProject, '.planning')), false,
  'listing forks must not create planning state');
fs.rmSync(containmentRoot, { recursive: true, force: true });

let spawnOptions;
const spawned = forks.safeSpawn('verifier', ['literal;whoami', '$(touch nope)'], {
  cwd: process.cwd(), input: 'private objective', spawn: (_command, _args, options) => {
    spawnOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  },
});
assert.equal(spawned.status, 0);
assert.equal(spawnOptions.shell, false);
assert.equal(spawnOptions.input, 'private objective');

assert.throws(() => forks.publicReplay(strict, [{ event_id: 'event-secret', fork_revision: 1,
  type: 'password=supersecret', branch_id: null, status: 'unknown', recorded_at: NOW,
  detail_digest: operations.sha256Digest({ detail: 1 }) }]), /secret-like/);
const replay = forks.publicReplay(strict);
for (const forbidden of ['Security fixture', 'branch_ref', 'worktree_ref', BASE, 'reason":"verified']) {
  assert(!replay.serialized.includes(forbidden), `replay leaked ${forbidden}`);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fork-security-'));
let landingFork = readyFork('fork-landing-safe');
forks.createForkRecord(sandbox, landingFork);
const token = forks.landingConfirmation(landingFork, BASE);
let mergeCalls = 0;
const provider = {
  merge(_root, branchRef, expected) {
    mergeCalls += 1;
    assert.equal(branchRef, 'citadel/fork-landing-safe/branch-claude');
    assert.equal(expected, BASE);
    return 'b'.repeat(40);
  },
};
const landed = forks.applyLanding({ projectRoot: sandbox, forkId: landingFork.fork_id,
  expectedRevision: landingFork.revision, targetRevision: BASE, confirmation: token,
  idempotencyKey: 'landing-safe-001', worktreeProvider: provider,
  now: (() => { let tick = 6; return () => `2026-07-13T15:00:${String(tick++).padStart(2, '0')}.000Z`; })() });
assert.equal(landed.status, 'landed');
const repeated = forks.applyLanding({ projectRoot: sandbox, forkId: landingFork.fork_id,
  expectedRevision: landingFork.revision, targetRevision: BASE, confirmation: token,
  idempotencyKey: 'landing-safe-001', worktreeProvider: provider });
assert.equal(repeated.status, 'landed');
assert.equal(mergeCalls, 1, 'idempotent replay must not repeat merge');

let ambiguous = readyFork('fork-landing-ambiguous');
forks.createForkRecord(sandbox, ambiguous);
const ambiguousToken = forks.landingConfirmation(ambiguous, BASE);
let prepared = forks.prepareLanding(ambiguous, { expectedRevision: ambiguous.revision,
  targetRevision: BASE, confirmation: ambiguousToken, idempotencyKey: 'landing-ambiguous-001',
  confirmedAt: '2026-07-13T15:00:06.000Z' });
forks.saveFork(sandbox, prepared, ambiguous.revision);
let inProgress = forks.markLandingInProgress(prepared, '2026-07-13T15:00:07.000Z');
forks.saveFork(sandbox, inProgress, prepared.revision);
assert.throws(() => forks.applyLanding({ projectRoot: sandbox, forkId: ambiguous.fork_id,
  expectedRevision: inProgress.revision, targetRevision: BASE, confirmation: ambiguousToken,
  idempotencyKey: 'landing-ambiguous-001', worktreeProvider: provider }), /ambiguous/i);
assert.equal(mergeCalls, 1, 'ambiguous landing recovery must not invoke merge');

fs.rmSync(sandbox, { recursive: true, force: true });
process.stdout.write('Operation Fork security passed: strict schemas, literal spawning, path containment, replay redaction, and exactly-once landing boundaries.\n');
