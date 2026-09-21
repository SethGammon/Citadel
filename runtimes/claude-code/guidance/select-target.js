#!/usr/bin/env node

'use strict';

const MINIMUM_AGENTS_MD_VERSION = Object.freeze([2, 1, 277]);

function parseClaudeVersion(value) {
  const match = String(value || '').match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(actual, minimum = MINIMUM_AGENTS_MD_VERSION) {
  if (!actual) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function selectClaudeGuidanceTarget(options = {}) {
  const version = parseClaudeVersion(options.claudeVersion);
  const capabilityConfirmed = options.agentsMdCapability === true;
  const native = capabilityConfirmed && versionAtLeast(version) && options.claudeGuidancePresent !== true;
  return Object.freeze({
    filePath: native ? 'AGENTS.md' : 'CLAUDE.md',
    nativeAgentsMd: native,
    version: version ? version.join('.') : null,
    reason: native
      ? 'confirmed Claude Code AGENTS.md capability'
      : options.claudeGuidancePresent === true
        ? 'CLAUDE.md guidance takes precedence on the project path'
        : !versionAtLeast(version)
        ? 'Claude Code version is older than 2.1.277 or unknown'
        : 'AGENTS.md capability was not confirmed for this session',
  });
}

module.exports = Object.freeze({
  MINIMUM_AGENTS_MD_VERSION,
  parseClaudeVersion,
  selectClaudeGuidanceTarget,
  versionAtLeast,
});
