'use strict';

const PROTOCOL_VERSION = '0.1';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_VERSION]);

const CONTRACT_KINDS = Object.freeze({
  OPERATION_SPEC: 'operation_spec',
  OPERATION_RUN: 'operation_run',
  STEP_ATTEMPT: 'step_attempt',
  INTENT: 'intent',
  EVIDENCE_ENVELOPE: 'evidence_envelope',
  EXECUTION_RECEIPT: 'execution_receipt',
});

const TERMINAL_STATUSES = Object.freeze(['passed', 'failed', 'blocked', 'unknown']);
const ACTIVE_STATUSES = Object.freeze(['pending', 'running']);
const EXECUTION_STATUSES = Object.freeze([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);

const INTENT_ACTIONS = Object.freeze([
  'start', 'pause', 'resume', 'cancel', 'approve', 'reject', 'retry',
]);

const EVIDENCE_TYPES = Object.freeze([
  'artifact', 'command', 'deployment', 'diff', 'policy', 'review', 'test', 'other',
]);

const FIELD_ALLOWLISTS = Object.freeze({
  [CONTRACT_KINDS.OPERATION_SPEC]: Object.freeze([
    'protocol_version', 'kind', 'operation_id', 'title', 'objective_digest',
    'step_ids', 'policy_digests', 'created_at',
  ]),
  [CONTRACT_KINDS.OPERATION_RUN]: Object.freeze([
    'protocol_version', 'kind', 'run_id', 'operation_id', 'spec_digest', 'status',
    'started_at', 'completed_at', 'intent_ids', 'step_attempt_ids',
  ]),
  [CONTRACT_KINDS.STEP_ATTEMPT]: Object.freeze([
    'protocol_version', 'kind', 'attempt_id', 'run_id', 'step_id', 'attempt_number',
    'status', 'started_at', 'completed_at', 'evidence_ids', 'failure_code',
  ]),
  [CONTRACT_KINDS.INTENT]: Object.freeze([
    'protocol_version', 'kind', 'intent_id', 'operation_id', 'action', 'actor_id',
    'scope_digest', 'created_at', 'expires_at',
  ]),
  [CONTRACT_KINDS.EVIDENCE_ENVELOPE]: Object.freeze([
    'protocol_version', 'kind', 'evidence_id', 'run_id', 'step_attempt_id',
    'evidence_type', 'status', 'subject_digest', 'artifact_digest', 'recorded_at',
    'redacted',
  ]),
  [CONTRACT_KINDS.EXECUTION_RECEIPT]: Object.freeze([
    'protocol_version', 'kind', 'receipt_id', 'run_id', 'operation_digest',
    'run_digest', 'status', 'evidence_digests', 'issued_at', 'issuer_id',
  ]),
});

module.exports = Object.freeze({
  ACTIVE_STATUSES,
  CONTRACT_KINDS,
  EVIDENCE_TYPES,
  EXECUTION_STATUSES,
  FIELD_ALLOWLISTS,
  INTENT_ACTIONS,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  TERMINAL_STATUSES,
});
