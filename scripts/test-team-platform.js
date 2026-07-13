#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { evaluatePolicy, pilotReport, resolvePolicy, simulatedPilot, validatePolicy } = require('../core/team');
const { sha256Digest } = require('../core/operations');

const organization = {
  schema_version: 1, policy_id: 'organization-default', scope: 'organization', parent_digest: null,
  allowed_runtimes: ['claude-code', 'codex'], required_capabilities: ['verification'],
  approval_actions: ['external-write', 'retry'], max_parallel_agents: 5, max_budget_units: 100,
  allow_source_upload: false, telemetry_mode: 'local',
};
const repository = { ...organization, policy_id: 'repository-production', scope: 'repository',
  parent_digest: sha256Digest(organization), allowed_runtimes: ['codex'], required_capabilities: ['verification', 'git'],
  max_parallel_agents: 3, max_budget_units: 40, approval_actions: ['external-write', 'retry', 'stop'] };

assert.deepEqual(validatePolicy(organization), []);
assert(validatePolicy({ ...organization, prompt: 'secret' }).some((error) => error.includes('unknown')));
const resolved = resolvePolicy([organization, repository]);
assert.deepEqual(resolved.allowed_runtimes, ['codex']);
assert.equal(resolved.max_parallel_agents, 3);
assert.equal(resolved.allow_source_upload, false);
assert.throws(() => resolvePolicy([organization, { ...repository, parent_digest: `sha256:${'0'.repeat(64)}` }]), /mismatch/);
const exportChild = { ...repository, telemetry_mode: 'opt-in-export' };
assert.equal(resolvePolicy([organization, exportChild]).telemetry_mode, 'local',
  'a child policy must not broaden local telemetry into export');
const exportParent = { ...organization, telemetry_mode: 'opt-in-export' };
const localChild = { ...repository, parent_digest: sha256Digest(exportParent), telemetry_mode: 'local' };
assert.equal(resolvePolicy([exportParent, localChild]).telemetry_mode, 'local');

const allowed = evaluatePolicy(resolved, { runtime: 'codex', capabilities: ['verification', 'git'],
  action: 'pause', parallel_agents: 3, budget_units: 40, source_upload: false, approved: false });
assert.equal(allowed.status, 'passed');
for (const malformed of [
  { ...allowed, budget_units: undefined },
  { runtime: 'codex', capabilities: ['verification', 'git'], action: 'pause', parallel_agents: null,
    budget_units: 40, source_upload: false, approved: false },
  { runtime: 'codex', capabilities: ['verification', 'git'], action: 'pause', parallel_agents: 1,
    budget_units: Number.NaN, source_upload: false, approved: false },
  { runtime: 'codex', capabilities: ['verification', 'git'], action: 'external-write', parallel_agents: 1,
    budget_units: 1, source_upload: false, approved: 'false' },
  { runtime: 'codex', capabilities: ['verification', 'git'], action: 'pause', parallel_agents: 1,
    budget_units: 1, source_upload: false, approved: false, extra: true },
]) assert.equal(evaluatePolicy(resolved, malformed).status, 'blocked', 'malformed policy requests must fail closed');
const blocked = evaluatePolicy(resolved, { runtime: 'claude-code', capabilities: ['verification'],
  action: 'external-write', parallel_agents: 4, budget_units: 41, source_upload: true, approved: false });
assert.equal(blocked.status, 'blocked');
for (const code of ['RUNTIME_NOT_ALLOWED', 'CAPABILITY_REQUIRED:git', 'PARALLEL_LIMIT_EXCEEDED',
  'BUDGET_LIMIT_EXCEEDED', 'SOURCE_UPLOAD_BLOCKED', 'APPROVAL_REQUIRED']) assert(blocked.violations.includes(code));

const simulation = simulatedPilot();
assert.equal(simulation.report.evidence_class, 'simulation');
assert.equal(simulation.report.operators, 5);
assert.equal(simulation.report.repositories, 10);
assert.equal(simulation.report.discovery_loss_bps, 0);
assert.equal(simulation.report.merge_conflict_bps, 0);
assert.throws(() => pilotReport([...simulation.events, simulation.events[0]]), /duplicate event_id/);
assert.throws(() => pilotReport([{ ...simulation.events[0], source_code: 'forbidden' }]), /unknown event fields/);

console.log('team policy and pilot tests passed');
