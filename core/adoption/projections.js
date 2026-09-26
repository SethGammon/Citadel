'use strict';

const fs = require('fs');
const path = require('path');
const { digestBytes } = require('./contracts');
const { snapshot } = require('./footprint');
const { mergeHookMaps } = require('../hooks/install');
const { translateCodexHooks } = require('../../runtimes/codex/generators/install-hooks');

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function fileProposal(runtime, surface, target, relativePath, content, ownership = 'shared', removal = 'restore_preimage_if_exact') {
  const bytes = Buffer.from(content);
  return {
    runtime,
    surface,
    path: relativePath,
    action: snapshot(target, relativePath).exists ? 'replace' : 'create',
    ownership,
    before: snapshot(target, relativePath),
    proposed: { digest: digestBytes(bytes), bytes: bytes.length, content_base64: bytes.toString('base64') },
    removal: {
      strategy: removal,
      evidence_status: 'planned',
      required_observation: ownership === 'shared'
        ? 'installed digest unchanged, then pre-image restored exactly'
        : 'installed digest unchanged, then file absent',
    },
  };
}

function unknownProposal(runtime, surface, reason) {
  return {
    runtime,
    surface,
    path: `${runtime}://external/${surface}`,
    action: 'external_registration',
    ownership: 'shared',
    before: null,
    proposed: null,
    removal: {
      strategy: 'runtime_api',
      evidence_status: 'unknown',
      required_observation: reason,
    },
  };
}

function unknownFileProposal(runtime, surface, target, relativePath, reason) {
  return {
    runtime,
    surface,
    path: relativePath,
    action: 'manual_review',
    ownership: 'shared',
    before: snapshot(target, relativePath),
    proposed: null,
    removal: {
      strategy: 'structural_file_edit',
      evidence_status: 'unknown',
      required_observation: reason,
    },
  };
}

function proposeClaudeProjection(options) {
  const target = path.resolve(options.target);
  const source = path.resolve(options.source);
  const templatePath = path.join(source, 'hooks', 'hooks-template.json');
  const settingsRelative = '.claude/settings.json';
  const settingsPath = path.join(target, '.claude', 'settings.json');
  const existing = readJson(settingsPath, {});
  const generated = JSON.parse(fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, ''));
  for (const entries of Object.values(generated.hooks || {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) {
        if (typeof hook.command === 'string') {
          hook.command = hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, source.replace(/\\/g, '/'));
        }
      }
    }
  }
  const hooks = mergeHookMaps({
    existingHooks: existing.hooks || {},
    generatedHooks: generated.hooks || {},
    preserveMarker: 'hooks_src/',
  });
  const proposed = {
    ...existing,
    hooks,
    env: { ...(existing.env || {}) },
  };
  if (!('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB' in proposed.env)) {
    proposed.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
  }
  const content = Buffer.from(`${JSON.stringify(proposed, null, 2)}\n`);
  return {
    runtime: 'claude',
    status: 'planned_with_unknown_external_registration',
    proposed_effects: [
      fileProposal('claude', 'shared-hooks-settings', target, settingsRelative, content),
      unknownProposal('claude', 'plugin-registration', 'Claude exposes no stable project-scoped enumeration and unregister API in this adapter'),
    ],
  };
}

function codexSkillEffects(target, source, mode, ownedPaths) {
  const skillsRoot = path.join(source, 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relative = `.agents/skills/${entry.name}/SKILL.md`;
      const existing = snapshot(target, relative).exists;
      if (mode === 'plugin') return existing && !ownedPaths.has(relative)
        ? [unknownFileProposal('codex', 'legacy-local-skill', target, relative,
          'Project-local skill may duplicate the plugin skill; inspect ownership before removing it')]
        : [];
      if (existing && !ownedPaths.has(relative)) return [unknownFileProposal(
        'codex', 'skill-collision', target, relative,
        'Existing project skill has no verified Citadel adoption ownership; preserve it for manual review',
      )];
      return [fileProposal('codex', 'skill', target, relative,
        fs.readFileSync(path.join(skillsRoot, entry.name, 'SKILL.md')), 'owned', 'delete_if_exact')];
    });
}

function proposeCodexProjection(options) {
  const target = path.resolve(options.target);
  const source = path.resolve(options.source);
  const mode = options.mode || 'plugin';
  if (!['plugin', 'fallback'].includes(mode)) throw new Error(`Unknown Codex projection mode: ${mode}`);
  const ownedPaths = new Set(options.ownedPaths || []);
  const configReview = unknownFileProposal(
    'codex', 'config.toml', target, '.codex/config.toml',
    'No safe structural TOML writer or Citadel-owned config member is established',
  );
  if (mode === 'plugin') {
    const localHooks = path.join(target, '.codex', 'hooks.json');
    const legacyHooks = !ownedPaths.has('.codex/hooks.json') && fs.existsSync(localHooks)
      && fs.readFileSync(localHooks, 'utf8').includes('codex-adapter');
    return {
      runtime: 'codex',
      status: 'plugin_registration_required',
      proposed_effects: [
        ...(legacyHooks ? [unknownFileProposal('codex', 'legacy-local-hooks', target, '.codex/hooks.json',
          'Project-local Citadel hooks may duplicate plugin hooks; inspect receipt and preserve user hooks')] : []),
        ...codexSkillEffects(target, source, mode, ownedPaths),
        configReview,
        unknownProposal('codex', 'plugin-registration',
          'Codex plugin UI and CLI registration cannot be enumerated and unregistered by exact project scope here'),
      ],
    };
  }
  const hooksTemplate = JSON.parse(
    fs.readFileSync(path.join(source, 'hooks', 'hooks-template.json'), 'utf8')
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, source.replace(/\\/g, '/')),
  );
  const hookRelative = '.codex/hooks.json';
  const existingHooks = readJson(path.join(target, ...hookRelative.split('/')), {}).hooks || {};
  const translated = translateCodexHooks(
    hooksTemplate,
    path.join(source, 'hooks_src', 'codex-adapter.js'),
  );
  const mergedHooks = mergeHookMaps({
    existingHooks,
    generatedHooks: translated.hooks,
    preserveMarker: 'codex-adapter',
  });
  const hookContent = Buffer.from(`${JSON.stringify({ hooks: mergedHooks }, null, 2)}\n`);
  return {
    runtime: 'codex',
    status: 'project_fallback_without_plugin_registration',
    proposed_effects: [
      fileProposal('codex', 'shared-hooks', target, hookRelative, hookContent),
      ...codexSkillEffects(target, source, mode, ownedPaths),
      configReview,
    ],
  };
}

function plannableProjectionEffects(projections) {
  return projections.flatMap((projection) => projection.proposed_effects)
    .filter((effect) => ['create', 'replace'].includes(effect.action));
}

module.exports = Object.freeze({
  plannableProjectionEffects, proposeClaudeProjection, proposeCodexProjection,
});
