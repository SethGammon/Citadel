#!/usr/bin/env node

'use strict';

const PROVIDER_IDS = Object.freeze([
  'anthropic',
  'openai',
  'google',
  'ollama',
  'custom-openai-compatible',
  'unknown',
]);

const ACCESS_MODES = Object.freeze([
  'subscription',
  'api_key',
  'local',
  'hosted',
  'unknown',
]);

const PROVIDER_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'anthropic',
    displayName: 'Anthropic',
    kind: 'managed-api',
    accessModes: Object.freeze(['subscription', 'api_key']),
    runtimeIds: Object.freeze(['claude-code']),
    notes: 'Supports Claude Code subscription login and Anthropic API keys.',
  }),
  Object.freeze({
    id: 'openai',
    displayName: 'OpenAI',
    kind: 'managed-api',
    accessModes: Object.freeze(['api_key', 'hosted']),
    runtimeIds: Object.freeze(['codex']),
    notes: 'Primary API lane for Codex and OpenAI-compatible integrations.',
  }),
  Object.freeze({
    id: 'google',
    displayName: 'Google',
    kind: 'managed-api',
    accessModes: Object.freeze(['api_key']),
    runtimeIds: Object.freeze(['unknown']),
    notes: 'Gemini API lane for provider diversification.',
  }),
  Object.freeze({
    id: 'ollama',
    displayName: 'Ollama',
    kind: 'local',
    accessModes: Object.freeze(['local']),
    runtimeIds: Object.freeze(['unknown']),
    notes: 'Local-model lane through OpenAI-compatible endpoints.',
  }),
  Object.freeze({
    id: 'custom-openai-compatible',
    displayName: 'Custom OpenAI-Compatible',
    kind: 'bring-your-own-endpoint',
    accessModes: Object.freeze(['api_key', 'local', 'hosted']),
    runtimeIds: Object.freeze(['unknown']),
    notes: 'Covers self-hosted or third-party OpenAI-compatible endpoints.',
  }),
]);

function isProviderId(value) {
  return PROVIDER_IDS.includes(value);
}

function isAccessMode(value) {
  return ACCESS_MODES.includes(value);
}

function getProvider(providerId) {
  return PROVIDER_REGISTRY.find((provider) => provider.id === providerId) ?? null;
}

function isRuntimeProviderCompatible(runtimeId, providerId, accessMode) {
  const provider = getProvider(providerId);

  if (!provider) {
    return false;
  }

  const runtimeAllowed = provider.runtimeIds.includes(runtimeId) || provider.runtimeIds.includes('unknown');
  const accessAllowed = provider.accessModes.includes(accessMode);

  return runtimeAllowed && accessAllowed;
}

function explainRuntimeProviderCompatibility(runtimeId, providerId, accessMode) {
  const provider = getProvider(providerId);

  if (!provider) {
    return {
      compatible: false,
      reason: `Unknown provider: ${providerId}`,
    };
  }

  if (!provider.runtimeIds.includes(runtimeId) && !provider.runtimeIds.includes('unknown')) {
    return {
      compatible: false,
      reason: `${provider.displayName} is not yet registered for runtime ${runtimeId}.`,
    };
  }

  if (!provider.accessModes.includes(accessMode)) {
    return {
      compatible: false,
      reason: `${provider.displayName} does not support access mode ${accessMode}.`,
    };
  }

  return {
    compatible: true,
    reason: `${provider.displayName} supports ${runtimeId} via ${accessMode}.`,
  };
}

module.exports = Object.freeze({
  PROVIDER_IDS,
  ACCESS_MODES,
  PROVIDER_REGISTRY,
  isProviderId,
  isAccessMode,
  getProvider,
  isRuntimeProviderCompatible,
  explainRuntimeProviderCompatibility,
});
