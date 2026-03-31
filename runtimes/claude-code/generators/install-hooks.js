'use strict';

const fs = require('fs');
const path = require('path');

const {
  countGeneratedEntries,
  countPreservedHooks,
  ensureDir,
  mergeHookMaps,
  quoteNodeCommand,
  readJson,
  writeJson,
} = require('../../../core/hooks/install');
const { selectSupportedClaudeHookEvents } = require('./hook-support');

function resolveClaudeHooks(citadelRoot, hooksTemplatePath) {
  const raw = fs.readFileSync(hooksTemplatePath, 'utf8');
  const citadelPath = citadelRoot.replace(/\\/g, '/');
  const resolved = raw.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, citadelPath);
  const cleaned = resolved.replace(/node\s+'([^']+)'/g, 'node "$1"');
  const hooks = JSON.parse(cleaned);

  for (const entries of Object.values(hooks.hooks || {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) {
        if (hook.command) hook.command = quoteNodeCommand(hook.command);
      }
    }
  }

  return hooks;
}

function installClaudeHooks(options = {}) {
  const citadelRoot = options.citadelRoot || path.resolve(__dirname, '../../..', '..');
  const hooksTemplatePath = options.hooksTemplatePath || path.join(citadelRoot, 'hooks', 'hooks-template.json');
  const projectRoot = options.projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');

  if (!fs.existsSync(hooksTemplatePath)) {
    throw new Error(`hooks.json not found at ${hooksTemplatePath}`);
  }

  ensureDir(path.join(projectRoot, '.claude'));

  const resolved = resolveClaudeHooks(citadelRoot, hooksTemplatePath);
  const compatibility = selectSupportedClaudeHookEvents({
    templateEvents: Object.keys(resolved.hooks || {}),
    hookProfile: options.hookProfile,
    claudeVersion: options.claudeVersion,
    claudeBin: options.claudeBin,
  });
  const generated = {
    ...resolved,
    hooks: Object.fromEntries(
      Object.entries(resolved.hooks || {}).filter(([event]) => compatibility.supportedEvents.includes(event))
    ),
  };
  const existing = readJson(settingsPath, {});
  const mergedHooks = mergeHookMaps({
    existingHooks: existing.hooks || {},
    generatedHooks: generated.hooks || {},
    preserveMarker: 'hooks_src/',
  });

  const merged = {
    ...existing,
    hooks: mergedHooks,
    env: { ...(existing.env || {}) },
  };

  if (!('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB' in merged.env)) {
    merged.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
  }

  writeJson(settingsPath, merged);

  return {
    settingsPath,
    hookCount: countGeneratedEntries(generated.hooks || {}),
    preservedCount: countPreservedHooks(mergedHooks, 'hooks_src/'),
    citadelRoot,
    compatibility,
  };
}

module.exports = {
  installClaudeHooks,
  resolveClaudeHooks,
};