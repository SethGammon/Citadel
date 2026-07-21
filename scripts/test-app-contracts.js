#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../packages/contracts/app');
const coreCompatibility = require('../core/app-contracts');

const now = '2026-07-14T18:30:00.000Z';
const later = '2026-07-14T18:31:00.000Z';
const digest = (character) => `sha256:${character.repeat(64)}`;

const fixtures = [
  {
    app_contract_version: 1, kind: 'agent_profile', revision: 1, profile_id: 'profile-scout', name: 'Scout',
    role: 'Repository investigator', runtime_id: 'claude-code', model: null,
    instructions_digest: digest('a'), skill_ids: ['research'], memory_policy_id: 'memory-workspace',
    permission_policy_id: 'permission-read-only', resource_policy_id: 'resource-standard',
    created_at: now, updated_at: now,
  },
  {
    app_contract_version: 1, kind: 'agent_instance', revision: 1, instance_id: 'instance-scout-1',
    profile_id: 'profile-scout', profile_revision: 1, profile_snapshot_digest: digest('4'),
    operation_id: 'operation-alpha', workspace_id: 'workspace-citadel',
    supervisor_id: 'supervisor-local', status: 'queued', process_ref: null, terminal_ref: null,
    branch_ref: null, worktree_ref: null, budget_digest: digest('b'), started_at: null,
    updated_at: now, completed_at: null, exit_code: null, failure_code: null,
  },
  {
    app_contract_version: 1, kind: 'team', revision: 1, team_id: 'team-foundry', name: 'Foundry Team',
    member_profile_ids: ['profile-scout'], coordination_policy_id: 'coordination-sequential',
    handoff_policy_id: 'handoff-explicit', resource_policy_id: 'resource-standard',
    created_at: now, updated_at: now,
  },
  {
    app_contract_version: 1, kind: 'workspace_ref', revision: 1, workspace_id: 'workspace-citadel', name: 'Citadel',
    root_digest: digest('c'), instruction_digests: [digest('d')], runtime_ids: ['claude-code', 'codex'],
    editable: true, last_opened_at: now,
  },
  {
    app_contract_version: 1, kind: 'handoff', revision: 1, handoff_id: 'handoff-scout-mason',
    operation_id: 'operation-alpha', from_instance_id: 'instance-scout-1',
    to_profile_id: 'profile-mason', to_instance_id: null, status: 'pending',
    outcome_digest: digest('e'), decision_digests: [digest('f')], blocker_codes: [],
    artifact_digests: [digest('1')], verification_digests: [digest('2')],
    next_action_digest: digest('3'), created_at: now, resolved_at: null,
  },
  {
    app_contract_version: 1, kind: 'supervisor_event', event_id: 'event-1',
    supervisor_id: 'supervisor-local', operation_id: 'operation-alpha', instance_id: 'instance-scout-1',
    sequence: 1, subject_revision: 1, event_type: 'instance-queued', status: 'queued', payload_digest: null,
    recorded_at: now,
  },
  {
    app_contract_version: 1, kind: 'operation_definition', revision: 1,
    operation_id: 'operation-alpha', workspace_id: 'workspace-citadel', team_id: 'team-foundry',
    lead_profile_id: 'profile-scout', title: 'Build the Citadel App', objective_digest: digest('5'),
    step_ids: ['step-contract', 'step-supervisor'], policy_digests: [digest('6')],
    created_at: now, updated_at: now,
  },
];

for (const fixture of fixtures) {
  assert.deepEqual(app.validateAppContract(fixture), [], `${fixture.kind} fixture should validate`);
}

assert.strictEqual(coreCompatibility.APP_CONTRACT_VERSION, app.APP_CONTRACT_VERSION);
assert.match(app.validateAppContract({ ...fixtures[0], prompt: 'private prompt' }).join('; '), /allowlist/);
assert.match(app.validateAppContract({ ...fixtures[0], app_contract_version: 2 }).join('; '), /must be 1/);
assert.match(app.validateAppContract({ ...fixtures[0], kind: 'future_kind' }).join('; '), /unknown app contract kind/);

const queued = fixtures[1];
const starting = app.transitionAgentInstance(queued, 'starting', {
  process_ref: 'process:100', started_at: now, updated_at: later,
});
assert.equal(starting.status, 'starting');
assert.equal(starting.revision, 2);
assert.equal(queued.status, 'queued', 'transitions must not mutate their input');
assert.throws(() => app.transitionAgentInstance(starting, 'completed', {
  completed_at: later, exit_code: 0,
}), /Invalid agent instance transition/);

const pending = fixtures[4];
const accepted = app.transitionHandoff(pending, 'accepted', { resolved_at: later });
assert.equal(accepted.status, 'accepted');
assert.equal(accepted.revision, 2);
assert.equal(pending.status, 'pending', 'handoff transitions must not mutate their input');
assert.throws(() => app.transitionHandoff(accepted, 'rejected', { resolved_at: later }), /Invalid handoff transition/);

const projectedOperation = app.projectOperationDefinition(fixtures[6]);
assert.deepEqual(require('../core/operations').validateOperationSpec(projectedOperation), []);
assert.equal(projectedOperation.protocol_version, '0.1');
assert.equal(projectedOperation.operation_id, fixtures[6].operation_id);
assert.notStrictEqual(projectedOperation.step_ids, fixtures[6].step_ids, 'projection must copy arrays');

const schemaPath = path.join(__dirname, '..', 'packages', 'contracts', 'schemas', 'app-contracts-v1.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const names = ['AgentProfile', 'AgentInstance', 'Team', 'WorkspaceRef', 'Handoff', 'SupervisorEvent', 'OperationDefinition'];
for (const name of names) {
  const definition = schema.$defs[name];
  const kind = definition.properties.kind.const;
  assert.deepEqual([...definition.required].sort(), [...app.FIELD_ALLOWLISTS[kind]].sort(), `${name} schema allowlist drift`);
}

const appSource = fs.readdirSync(path.join(__dirname, '..', 'packages', 'contracts', 'app'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(__dirname, '..', 'packages', 'contracts', 'app', file), 'utf8'))
  .join('\n');
assert.doesNotMatch(appSource, /require\(['"](?:fs|path|child_process|node:|\.\.\/\.\.\/core)/, 'browser-safe app subpath cannot import Node or core');

console.log('app contract tests passed');
