'use strict';

const fs = require('fs');
const path = require('path');

const PROOF_LINKS = Object.freeze([
  'README.md#see-it-run',
  'docs/GOLDEN_PATH.md',
  'docs/INTEROPERABILITY.md',
  'docs/RELEASES.md',
]);

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function countSkills(root) {
  const skills = path.join(root, 'skills');
  return fs.readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skills, entry.name, 'SKILL.md')))
    .length;
}

function buildMetadata(rootPath) {
  const root = path.resolve(rootPath);
  const pkg = readJson(root, 'package.json');
  return {
    schema_version: 1,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    source_repository: pkg.repository.url,
    runtime_support: {
      node: pkg.engines.node,
      claude_code: {
        manifest: '.claude-plugin/plugin.json',
        marketplace: '.claude-plugin/marketplace.json',
        install_command: 'node scripts/install.js --runtime claude --install --scope local',
      },
      codex: {
        manifest: '.codex-plugin/plugin.json',
        marketplace: '.agents/plugins/marketplace.json',
        install_command: 'node scripts/install.js --runtime codex --add-marketplace',
      },
    },
    skills: { path: 'skills/', count: countSkills(root) },
    proof_links: [...PROOF_LINKS],
    interoperability: {
      external_skill_fixture: 'scripts/fixtures/ecosystem/anthropics-template-skill',
      local_scanner_contracts: ['claude-local', 'codex-local'],
      immutable_source_verified: true,
      immutable_source_verification: 'anthropics/skills@9d2f1ae187231d8199c64b5b762e1bdf2244733d',
      remote_registry_verification: 'not-claimed',
    },
  };
}

function validateMetadata(rootPath, metadata) {
  const root = path.resolve(rootPath);
  const errors = [];
  const pkg = readJson(root, 'package.json');
  const claude = readJson(root, '.claude-plugin/plugin.json');
  const claudeMarketplace = readJson(root, '.claude-plugin/marketplace.json');
  const codex = readJson(root, '.codex-plugin/plugin.json');
  const marketplace = readJson(root, '.agents/plugins/marketplace.json');
  const localPlugin = marketplace.plugins?.find((plugin) => plugin.name === metadata.name);
  const claudePlugin = claudeMarketplace.plugins?.find((plugin) => plugin.name === metadata.name);
  for (const manifest of [pkg, claude, codex]) {
    if (manifest.name !== metadata.name) errors.push('package/plugin name mismatch');
    if (manifest.version !== metadata.version) errors.push('package/plugin version mismatch');
  }
  if (!localPlugin) errors.push('Codex local marketplace is missing Citadel');
  if (localPlugin?.version !== metadata.version) errors.push('Codex marketplace version mismatch');
  if (!claudePlugin) errors.push('Claude local marketplace is missing Citadel');
  if (claudePlugin?.version !== metadata.version) errors.push('Claude marketplace version mismatch');
  if (codex.skills !== './skills/') errors.push('Codex skills pointer mismatch');
  if (metadata.skills.count !== countSkills(root)) errors.push('skill count mismatch');
  if (metadata.runtime_support.node !== pkg.engines.node) errors.push('Node runtime support mismatch');
  for (const runtime of ['claude_code', 'codex']) {
    if (!metadata.runtime_support[runtime].install_command.startsWith('node scripts/install.js')) {
      errors.push(`${runtime} install command is not canonical`);
    }
  }
  for (const link of metadata.proof_links) {
    const file = link.split('#')[0];
    if (!fs.existsSync(path.join(root, file))) errors.push(`proof link missing: ${link}`);
  }
  if (metadata.interoperability.remote_registry_verification !== 'not-claimed') {
    errors.push('remote registry verification must remain explicitly unclaimed');
  }
  if (metadata.interoperability.immutable_source_verified !== true
    || !/^[^@]+\/[^@]+@[0-9a-f]{40}$/.test(metadata.interoperability.immutable_source_verification)) {
    errors.push('immutable external source verification is missing or malformed');
  }
  return errors;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

module.exports = Object.freeze({ buildMetadata, countSkills, stableJson, validateMetadata });
