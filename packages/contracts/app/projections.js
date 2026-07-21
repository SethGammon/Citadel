'use strict';

const { APP_CONTRACT_KINDS } = require('./constants');
const { assertValidAppContract } = require('./validation');

function projectOperationDefinition(definition) {
  assertValidAppContract(definition);
  if (definition.kind !== APP_CONTRACT_KINDS.OPERATION_DEFINITION) {
    throw new TypeError('projectOperationDefinition requires an operation_definition');
  }
  return Object.freeze({
    protocol_version: '0.1',
    kind: 'operation_spec',
    operation_id: definition.operation_id,
    title: definition.title,
    objective_digest: definition.objective_digest,
    step_ids: Object.freeze([...definition.step_ids]),
    policy_digests: Object.freeze([...definition.policy_digests]),
    created_at: definition.created_at,
  });
}

module.exports = Object.freeze({ projectOperationDefinition });
