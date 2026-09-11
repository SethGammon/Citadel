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
const { filterHookTemplate } = require('../../../core/hooks/bundles');
const {
  classifyOutputs,
  ensureMachineLocalExcludes,
  inspectInstallInventory,
} = require('../../../core/runtime/install-contract');
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
  const projectRoot = path.resolve(options.projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  const inventory = inspectInstallInventory(projectRoot, { runtime: 'claude-code' });
  const machineLocalExcludes = ensureMachineLocalExcludes(projectRoot, {
    dryRun: options.dryRun === true,
  });

  if (!fs.existsSync(hooksTemplatePath)) {
    throw new Error(`hooks.json not found at ${hooksTemplatePath}`);
  }

  ensureDir(path.join(projectRoot, '.claude'));

  const resolved = resolveClaudeHooks(citadelRoot, hooksTemplatePath);
  const bundleFilter = filterHookTemplate(resolved, options.effectiveBundles);
  const selected = bundleFilter.template;
  const compatibility = selectSupportedClaudeHookEvents({
    templateEvents: Object.keys(selected.hooks || {}),
    hookProfile: options.hookProfile,
    claudeVersion: options.claudeVersion,
    claudeBin: options.claudeBin,
  });
  const generated = {
    ...selected,
    hooks: Object.fromEntries(
      Object.entries(selected.hooks || {}).filter(([event]) => compatibility.supportedEvents.includes(event))
    ),
  };
  const existing = readJson(settingsPath, {}, { strict: true });
  const mergedHooks = mergeHookMaps({
    existingHooks: existing.hooks || {},
    generatedHooks: generated.hooks || {},
    preserveMarker: 'hooks_src/',
  });

  const merged = {
    ...existing,
    hooks: mergedHooks,
    env: { ...(existing.env || {}), CITADEL_RUNTIME: 'claude-code' },
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
    bundleFilter,
    inventory,
    diagnostics: inventory.diagnostics,
    machineLocalExcludes,
    outputs: classifyOutputs([{
      path: '.claude/settings.json',
      runtime: 'claude-code',
      ownership: 'machine-local',
      reason: 'Resolved compatibility hooks contain checkout-local commands and runtime state.',
    }]),
  };
}

module.exports = {
  installClaudeHooks,
  resolveClaudeHooks,
};
