#!/usr/bin/env node

'use strict';

const { CAPABILITY_IDS, REQUIRED_CAPABILITY_FIELDS, isSupportLevel } = require('./capabilities');
const { CIT_EVENT_ORDER } = require('./events');

const RUNTIME_IDS = Object.freeze([
  'claude-code',
  'codex',
  'openai',
  'unknown',
]);

function createRuntimeContractSkeleton(runtimeId) {
  return {
    id: runtimeId || 'unknown',
    displayName: '',
    guidance: {
      canonical: '.citadel/project.md',
      projections: [],
    },
    events: CIT_EVENT_ORDER.map((eventId) => ({
      event_id: eventId,
      nativeEvent: null,
      support: 'none',
      notes: '',
    })),
    capabilities: Object.fromEntries(
      Object.values(CAPABILITY_IDS).map((capabilityId) => [
        capabilityId,
        { support: 'none', notes: '' },
      ])
    ),
  };
}

function validateRuntimeContract(contract) {
  const errors = [];

  if (!contract || typeof contract !== 'object') {
    return ['Runtime contract must be an object'];
  }

  if (!RUNTIME_IDS.includes(contract.id)) {
    errors.push(`Unknown runtime id: ${contract.id}`);
  }

  if (!contract.guidance || typeof contract.guidance !== 'object') {
    errors.push('Runtime contract is missing guidance metadata');
  }

  if (!Array.isArray(contract.events)) {
    errors.push('Runtime contract events must be an array');
  }

  if (!contract.capabilities || typeof contract.capabilities !== 'object') {
    errors.push('Runtime contract capabilities must be an object');
  }

  if (Array.isArray(contract.events)) {
    for (const eventEntry of contract.events) {
      if (!eventEntry || typeof eventEntry !== 'object') {
        errors.push('Runtime event entry must be an object');
        continue;
      }
      if (!eventEntry.event_id) {
        errors.push('Runtime event entry missing event_id');
      }
      if (!isSupportLevel(eventEntry.support)) {
        errors.push(`Runtime event entry has invalid support level: ${eventEntry.support}`);
      }
    }
  }

  if (contract.capabilities && typeof contract.capabilities === 'object') {
    for (const capabilityId of Object.values(CAPABILITY_IDS)) {
      const capability = contract.capabilities[capabilityId];
      if (!capability || typeof capability !== 'object') {
        errors.push(`Runtime contract missing capability: ${capabilityId}`);
        continue;
      }
      for (const field of REQUIRED_CAPABILITY_FIELDS) {
        if (!(field in capability)) {
          errors.push(`Capability ${capabilityId} missing field: ${field}`);
        }
      }
      if (!isSupportLevel(capability.support)) {
        errors.push(`Capability ${capabilityId} has invalid support level: ${capability.support}`);
      }
    }
  }

  return errors;
}

module.exports = Object.freeze({
  RUNTIME_IDS,
  createRuntimeContractSkeleton,
  validateRuntimeContract,
});
