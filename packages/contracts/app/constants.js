'use strict';

const APP_CONTRACT_VERSION = 1;
const SUPPORTED_APP_CONTRACT_VERSIONS = Object.freeze([APP_CONTRACT_VERSION]);

const APP_CONTRACT_KINDS = Object.freeze({
  AGENT_PROFILE: 'agent_profile',
  AGENT_INSTANCE: 'agent_instance',
  OPERATION_DEFINITION: 'operation_definition',
  TEAM: 'team',
  WORKSPACE_REF: 'workspace_ref',
  HANDOFF: 'handoff',
  SUPERVISOR_EVENT: 'supervisor_event',
});

const AGENT_INSTANCE_STATUSES = Object.freeze([
  'queued',
  'starting',
  'running',
  'pause-requested',
  'paused',
  'blocked',
  'completed',
  'failed',
  'cancelled',
  'lost',
]);

const TERMINAL_AGENT_INSTANCE_STATUSES = Object.freeze([
  'completed',
  'failed',
  'cancelled',
  'lost',
]);

const HANDOFF_STATUSES = Object.freeze([
  'pending',
  'accepted',
  'rejected',
  'blocked',
]);

const SUPERVISOR_EVENT_TYPES = Object.freeze([
  'instance-queued',
  'instance-started',
  'instance-output',
  'instance-paused',
  'instance-resumed',
  'instance-blocked',
  'instance-completed',
  'instance-failed',
  'instance-cancelled',
  'instance-lost',
  'handoff-created',
  'handoff-accepted',
  'handoff-rejected',
  'approval-required',
  'approval-resolved',
  'artifact-recorded',
  'recovery-started',
  'recovery-completed',
]);

const FIELD_ALLOWLISTS = Object.freeze({
  [APP_CONTRACT_KINDS.AGENT_PROFILE]: Object.freeze([
    'app_contract_version', 'kind', 'revision', 'profile_id', 'name', 'role', 'runtime_id',
    'model', 'instructions_digest', 'skill_ids', 'memory_policy_id',
    'permission_policy_id', 'resource_policy_id', 'created_at', 'updated_at',
  ]),
  [APP_CONTRACT_KINDS.AGENT_INSTANCE]: Object.freeze([
    'app_contract_version', 'kind', 'revision', 'instance_id', 'profile_id',
    'profile_revision', 'profile_snapshot_digest', 'operation_id',
    'workspace_id', 'supervisor_id', 'status', 'process_ref', 'terminal_ref',
    'branch_ref', 'worktree_ref', 'budget_digest', 'started_at', 'updated_at',
    'completed_at', 'exit_code', 'failure_code',
  ]),
  [APP_CONTRACT_KINDS.TEAM]: Object.freeze([
    'app_contract_version', 'kind', 'revision', 'team_id', 'name', 'member_profile_ids',
    'coordination_policy_id', 'handoff_policy_id', 'resource_policy_id',
    'created_at', 'updated_at',
  ]),
  [APP_CONTRACT_KINDS.WORKSPACE_REF]: Object.freeze([
    'app_contract_version', 'kind', 'revision', 'workspace_id', 'name', 'root_digest',
    'instruction_digests', 'runtime_ids', 'editable', 'last_opened_at',
  ]),
  [APP_CONTRACT_KINDS.HANDOFF]: Object.freeze([
    'app_contract_version', 'kind', 'revision', 'handoff_id', 'operation_id',
    'from_instance_id', 'to_profile_id', 'to_instance_id', 'status',
    'outcome_digest', 'decision_digests', 'blocker_codes', 'artifact_digests',
    'verification_digests', 'next_action_digest', 'created_at', 'resolved_at',
  ]),
  [APP_CONTRACT_KINDS.SUPERVISOR_EVENT]: Object.freeze([
    'app_contract_version', 'kind', 'event_id', 'supervisor_id', 'operation_id',
    'instance_id', 'sequence', 'subject_revision', 'event_type', 'status', 'payload_digest',
    'recorded_at',
  ]),
  [APP_CONTRACT_KINDS.OPERATION_DEFINITION]: Object.freeze([
    'app_contract_version', 'kind', 'revision', 'operation_id', 'workspace_id',
    'team_id', 'lead_profile_id', 'title', 'objective_digest', 'step_ids',
    'policy_digests', 'created_at', 'updated_at',
  ]),
});

module.exports = Object.freeze({
  AGENT_INSTANCE_STATUSES,
  APP_CONTRACT_KINDS,
  APP_CONTRACT_VERSION,
  FIELD_ALLOWLISTS,
  HANDOFF_STATUSES,
  SUPERVISOR_EVENT_TYPES,
  SUPPORTED_APP_CONTRACT_VERSIONS,
  TERMINAL_AGENT_INSTANCE_STATUSES,
});
