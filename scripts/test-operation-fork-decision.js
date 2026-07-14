#!/usr/bin/env node

'use strict';

const assert = require('assert');
const forks = require('../core/forks');
const operations = require('../core/operations');

const NOW = '2026-07-13T14:00:00.000Z';
const BASE = 'a'.repeat(40);
const operation = {
  protocol_version: operations.PROTOCOL_VERSION,
  kind: operations.CONTRACT_KINDS.OPERATION_SPEC,
  operation_id: 'operation-decision', title: 'Private objective that must not enter replay',
  objective_digest: operations.sha256Digest({ objective: 'private objective' }),
  step_ids: ['step-execute'], policy_digests: [], created_at: NOW,
};
const shared = {
  objective_digest: operation.objective_digest,
  scope_digest: operations.sha256Digest({ scope: 'repository' }),
  policy_digests: [], budget_digest: operations.sha256Digest({ budget: 10 }),
  workflow_digest: operations.sha256Digest({ workflow: 1 }),
  verifier_digest: operations.sha256Digest({ verifier: 1 }), base_revision: BASE,
};
let fork = forks.createOperationFork({ forkId: 'fork-decision', operation, shared, createdAt: NOW });
const completed = (branch, score) => ({
  status: 'passed', started_at: NOW, completed_at: '2026-07-13T14:00:01.000Z',
  worktree_ref: `fork-decision/${branch}`, branch_ref: `citadel/fork-decision/${branch}`,
  receipt_digest: operations.sha256Digest({ receipt: branch }),
  evidence_summary: { status: 'passed', required: 1, present: 1, receipt_verified: true,
    score, score_max: score === null ? null : 100 },
  diff_summary: { files_changed: 1, insertions: 4, deletions: 1,
    digest: operations.sha256Digest({ diff: branch }) },
  duration_ms: branch === 'branch-claude' ? 1200 : 900, cost: null, failure_code: null,
});
fork = forks.updateBranch(fork, 'branch-claude', completed('branch-claude', 91), '2026-07-13T14:00:02.000Z');
fork = forks.updateBranch(fork, 'branch-codex', completed('branch-codex', 84), '2026-07-13T14:00:03.000Z');
const comparison = forks.compareFork(fork);
assert.equal(comparison.outcome, 'recommended');
assert.equal(comparison.recommendation, 'branch-claude');

const selected = forks.selectBranch(fork, { branchId: 'branch-claude', expectedRevision: fork.revision,
  actorId: 'actor-maintainer', idempotencyKey: 'selection-key-001', reason: 'best verified result',
  selectedAt: '2026-07-13T14:00:04.000Z' });
assert.equal(selected.status, 'selected');
assert.strictEqual(forks.selectBranch(selected, { branchId: 'branch-claude', expectedRevision: 0,
  actorId: 'actor-maintainer', idempotencyKey: 'selection-key-001' }), selected);
const token = forks.landingConfirmation(selected, BASE);
assert.match(token, /^land-fork-decision-/);
assert.throws(() => forks.prepareLanding(selected, { expectedRevision: selected.revision, targetRevision: BASE,
  confirmation: 'wrong', idempotencyKey: 'landing-key-001' }), /confirmation/i);
let landing = forks.prepareLanding(selected, { expectedRevision: selected.revision, targetRevision: BASE,
  confirmation: token, idempotencyKey: 'landing-key-001', confirmedAt: '2026-07-13T14:00:05.000Z' });
landing = forks.markLandingInProgress(landing, '2026-07-13T14:00:06.000Z');
landing = forks.completeLanding(landing, { status: 'landed', resultRevision: 'b'.repeat(40),
  completedAt: '2026-07-13T14:00:07.000Z' });
assert.equal(landing.status, 'landed');

const replayA = forks.publicReplay(landing);
const replayB = forks.publicReplay(landing);
assert.equal(replayA.digest, replayB.digest);
assert.equal(replayA.serialized, replayB.serialized);
assert(!replayA.serialized.includes(operation.title));
assert(!replayA.serialized.includes(BASE), 'raw repository revision must not enter public replay');
assert(!/worktree|branch_ref|reason":"/.test(replayA.serialized));

let insufficient = forks.createOperationFork({ forkId: 'fork-unknown', operation: { ...operation,
  operation_id: 'operation-unknown' }, shared, createdAt: NOW });
insufficient = forks.updateBranch(insufficient, 'branch-claude', completed('branch-claude', null), '2026-07-13T14:00:02.000Z');
assert.equal(forks.compareFork(insufficient).outcome, 'insufficient-evidence');
assert.throws(() => forks.selectBranch(insufficient, { branchId: 'branch-codex', expectedRevision: insufficient.revision,
  actorId: 'actor-maintainer', idempotencyKey: 'selection-key-002', reason: '', selectedAt: NOW }), /evidence/i);

let tied = forks.createOperationFork({ forkId: 'fork-tie', operation: { ...operation,
  operation_id: 'operation-tie' }, shared, createdAt: NOW });
tied = forks.updateBranch(tied, 'branch-claude', completed('branch-claude', null), '2026-07-13T14:00:02.000Z');
tied = forks.updateBranch(tied, 'branch-codex', completed('branch-codex', null), '2026-07-13T14:00:03.000Z');
assert.equal(forks.compareFork(tied).outcome, 'tie');
assert.equal(forks.compareFork(tied).recommendation, null);

process.stdout.write('Operation Fork decisions passed: honest comparison, revision-bound selection, confirmed landing, and redacted deterministic replay.\n');
