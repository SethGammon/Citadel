'use strict';

const {
  detectRuntime,
  normalizeRuntimeId,
} = require('../runtime/detect-runtime');

const UNKNOWN_LOCAL_RUNTIME = Object.freeze({
  id: 'local-unknown',
  displayName: 'Local runtime (not selected)',
  capabilities: Object.freeze({
    workspace: Object.freeze({
      support: 'full',
      notes: 'The local filesystem is available, but no agent runtime was selected.',
    }),
  }),
  degradations: Object.freeze(['runtime-not-selected']),
});

function runtimeContract(runtimeId) {
  const id = normalizeRuntimeId(runtimeId);
  if (id === 'codex') return require('../../runtimes/codex/runtime');
  if (id === 'claude-code') return require('../../runtimes/claude-code/runtime');
  if (id === 'openai') return require('../../runtimes/openai/runtime');
  if (id === 'opencode') return require('../../runtimes/opencode/runtime');
  return UNKNOWN_LOCAL_RUNTIME;
}

function detectRuntimeContract(projectRoot, options = {}) {
  if (options.runtime && typeof options.runtime === 'object') return options.runtime;
  if (options.runtimeId) return runtimeContract(options.runtimeId);
  const detected = detectRuntime(projectRoot, options);
  return runtimeContract(detected.runtime);
}

module.exports = Object.freeze({
  UNKNOWN_LOCAL_RUNTIME,
  detectRuntimeContract,
  normalizeRuntimeId,
  runtimeContract,
});
