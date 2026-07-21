#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const {
  AGENT_INSTANCE_STATUSES,
  APP_CONTRACT_KINDS,
  APP_CONTRACT_VERSION,
  FIELD_ALLOWLISTS,
  HANDOFF_STATUSES,
  SUPERVISOR_EVENT_TYPES,
} = require('../packages/contracts/app');

const output = path.join(__dirname, '..', 'packages', 'contracts', 'schemas', 'app-contracts-v1.json');

const ref = (name) => ({ $ref: `#/$defs/${name}` });
const nullable = (schema) => ({ oneOf: [schema, { type: 'null' }] });
const unique = (schema, maximum = 256, minimum = 0) => ({
  type: 'array',
  minItems: minimum,
  maxItems: maximum,
  uniqueItems: true,
  items: schema,
});

const common = {
  app_contract_version: { const: APP_CONTRACT_VERSION },
};

const definitions = {
  AgentProfile: {
    kind: APP_CONTRACT_KINDS.AGENT_PROFILE,
    properties: {
      ...common,
      kind: { const: APP_CONTRACT_KINDS.AGENT_PROFILE },
      revision: ref('revision'),
      profile_id: ref('identifier'),
      name: ref('label120'),
      role: ref('label160'),
      runtime_id: ref('identifier'),
      model: nullable(ref('label160')),
      instructions_digest: ref('digest'),
      skill_ids: unique(ref('identifier'), 128),
      memory_policy_id: ref('identifier'),
      permission_policy_id: ref('identifier'),
      resource_policy_id: ref('identifier'),
      created_at: ref('timestamp'),
      updated_at: ref('timestamp'),
    },
  },
  AgentInstance: {
    kind: APP_CONTRACT_KINDS.AGENT_INSTANCE,
    properties: {
      ...common,
      kind: { const: APP_CONTRACT_KINDS.AGENT_INSTANCE },
      revision: ref('revision'),
      instance_id: ref('identifier'),
      profile_id: ref('identifier'),
      profile_revision: ref('revision'),
      profile_snapshot_digest: ref('digest'),
      operation_id: ref('identifier'),
      workspace_id: ref('identifier'),
      supervisor_id: ref('identifier'),
      status: { enum: AGENT_INSTANCE_STATUSES },
      process_ref: nullable(ref('opaqueRef')),
      terminal_ref: nullable(ref('opaqueRef')),
      branch_ref: nullable(ref('opaqueRef')),
      worktree_ref: nullable(ref('opaqueRef')),
      budget_digest: ref('digest'),
      started_at: nullable(ref('timestamp')),
      updated_at: ref('timestamp'),
      completed_at: nullable(ref('timestamp')),
      exit_code: nullable({ type: 'integer', minimum: -2147483648, maximum: 2147483647 }),
      failure_code: nullable(ref('failureCode')),
    },
  },
  Team: {
    kind: APP_CONTRACT_KINDS.TEAM,
    properties: {
      ...common,
      kind: { const: APP_CONTRACT_KINDS.TEAM },
      revision: ref('revision'),
      team_id: ref('identifier'),
      name: ref('label120'),
      member_profile_ids: unique(ref('identifier'), 128, 1),
      coordination_policy_id: ref('identifier'),
      handoff_policy_id: ref('identifier'),
      resource_policy_id: ref('identifier'),
      created_at: ref('timestamp'),
      updated_at: ref('timestamp'),
    },
  },
  WorkspaceRef: {
    kind: APP_CONTRACT_KINDS.WORKSPACE_REF,
    properties: {
      ...common,
      kind: { const: APP_CONTRACT_KINDS.WORKSPACE_REF },
      revision: ref('revision'),
      workspace_id: ref('identifier'),
      name: ref('label160'),
      root_digest: ref('digest'),
      instruction_digests: unique(ref('digest'), 128),
      runtime_ids: unique(ref('identifier'), 32),
      editable: { type: 'boolean' },
      last_opened_at: ref('timestamp'),
    },
  },
  Handoff: {
    kind: APP_CONTRACT_KINDS.HANDOFF,
    properties: {
      ...common,
      kind: { const: APP_CONTRACT_KINDS.HANDOFF },
      revision: ref('revision'),
      handoff_id: ref('identifier'),
      operation_id: ref('identifier'),
      from_instance_id: ref('identifier'),
      to_profile_id: ref('identifier'),
      to_instance_id: nullable(ref('identifier')),
      status: { enum: HANDOFF_STATUSES },
      outcome_digest: ref('digest'),
      decision_digests: unique(ref('digest'), 256),
      blocker_codes: unique(ref('failureCode'), 128),
      artifact_digests: unique(ref('digest'), 1024),
      verification_digests: unique(ref('digest'), 1024),
      next_action_digest: ref('digest'),
      created_at: ref('timestamp'),
      resolved_at: nullable(ref('timestamp')),
    },
  },
  SupervisorEvent: {
    kind: APP_CONTRACT_KINDS.SUPERVISOR_EVENT,
    properties: {
      ...common,
      kind: { const: APP_CONTRACT_KINDS.SUPERVISOR_EVENT },
      event_id: ref('identifier'),
      supervisor_id: ref('identifier'),
      operation_id: nullable(ref('identifier')),
      instance_id: nullable(ref('identifier')),
      sequence: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      subject_revision: ref('revision'),
      event_type: { enum: SUPERVISOR_EVENT_TYPES },
      status: { enum: [...new Set([...AGENT_INSTANCE_STATUSES, ...HANDOFF_STATUSES, 'unknown'])] },
      payload_digest: nullable(ref('digest')),
      recorded_at: ref('timestamp'),
    },
  },
  OperationDefinition: {
    kind: APP_CONTRACT_KINDS.OPERATION_DEFINITION,
    properties: {
      ...common,
      kind: { const: APP_CONTRACT_KINDS.OPERATION_DEFINITION },
      revision: ref('revision'),
      operation_id: ref('identifier'),
      workspace_id: ref('identifier'),
      team_id: nullable(ref('identifier')),
      lead_profile_id: ref('identifier'),
      title: ref('label160'),
      objective_digest: ref('digest'),
      step_ids: unique(ref('identifier'), 256, 1),
      policy_digests: unique(ref('digest'), 256),
      created_at: ref('timestamp'),
      updated_at: ref('timestamp'),
    },
  },
};

for (const definition of Object.values(definitions)) {
  definition.type = 'object';
  definition.additionalProperties = false;
  definition.required = [...FIELD_ALLOWLISTS[definition.kind]];
  delete definition.kind;
}

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:citadel:app-contracts:1',
  title: 'Citadel App Contracts v1',
  oneOf: Object.keys(definitions).map((name) => ref(name)),
  $defs: {
    identifier: { type: 'string', maxLength: 128, pattern: '^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$' },
    digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    timestamp: { type: 'string', format: 'date-time' },
    revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    opaqueRef: { type: 'string', maxLength: 256, pattern: '^[a-z][a-z0-9]*(?:[-_.:/][a-z0-9]+)*$' },
    failureCode: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' },
    label120: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[^\\r\\n]+$' },
    label160: { type: 'string', minLength: 1, maxLength: 160, pattern: '^[^\\r\\n]+$' },
    ...definitions,
  },
};

const rendered = `${JSON.stringify(schema, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  if (current !== rendered) {
    process.stderr.write('app contract schema is stale; run generate-app-contract-schema.js --write\n');
    process.exit(1);
  }
  process.stdout.write('app contract schema is current\n');
  process.exit(0);
}

if (!process.argv.includes('--write')) {
  process.stdout.write(rendered);
  process.exit(0);
}

fs.writeFileSync(output, rendered, 'utf8');
process.stdout.write(`wrote ${path.relative(process.cwd(), output)}\n`);
