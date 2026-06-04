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

const ADAPTER_LEVELS = Object.freeze({
  NATIVE_FILES: 'native-files',
  CLI_SESSION: 'cli-session',
  HOOK_ENABLED: 'hook-enabled',
  MANAGED_SUBAGENT: 'managed-subagent',
  REMOTE_CLOUD_TASK: 'remote-cloud-task',
});

const RUNTIME_ADAPTER_MATRIX = Object.freeze({
  'claude-code': {
    level: ADAPTER_LEVELS.HOOK_ENABLED,
    guarantees: ['project guidance', 'skills', 'agents', 'hooks', 'workspace shell', 'worktrees'],
    missing: ['runtime-native MCP server mode'],
    tradeoffs: 'Highest Citadel hook parity; Citadel still owns campaign files, telemetry, and policy state.',
  },
  codex: {
    level: ADAPTER_LEVELS.MANAGED_SUBAGENT,
    guarantees: ['project guidance', 'skills', 'agents', 'workspace shell', 'MCP', 'app artifacts'],
    missing: ['full Citadel hook parity', 'uniform CLI worktree handoff'],
    tradeoffs: 'Use Codex-native execution surfaces where available; Citadel keeps evidence, campaign memory, and adapter warnings explicit.',
  },
  openai: {
    level: ADAPTER_LEVELS.REMOTE_CLOUD_TASK,
    guarantees: ['agent loop', 'tool calling', 'workspace container when provided'],
    missing: ['local hook lifecycle', 'native Citadel skill runtime', 'local worktree lifecycle'],
    tradeoffs: 'Prefer normalized metadata and explicit evidence artifacts over trying to mirror local hook semantics.',
  },
  unknown: {
    level: ADAPTER_LEVELS.NATIVE_FILES,
    guarantees: ['project guidance files'],
    missing: ['hooks', 'agents', 'worktrees', 'runtime history', 'approvals'],
    tradeoffs: 'Safe fallback for documentation and generated files only.',
  },
});

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

function isAdapterLevel(value) {
  return Object.values(ADAPTER_LEVELS).includes(value);
}

function getRuntimeAdapterMatrix(runtimeId = null) {
  if (runtimeId) {
    return RUNTIME_ADAPTER_MATRIX[runtimeId] || RUNTIME_ADAPTER_MATRIX.unknown;
  }
  return RUNTIME_ADAPTER_MATRIX;
}

module.exports = Object.freeze({
  ADAPTER_LEVELS,
  RUNTIME_IDS,
  RUNTIME_ADAPTER_MATRIX,
  createRuntimeContractSkeleton,
  getRuntimeAdapterMatrix,
  isAdapterLevel,
  validateRuntimeContract,
});
