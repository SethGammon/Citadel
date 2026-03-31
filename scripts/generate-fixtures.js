#!/usr/bin/env node

/**
 * generate-fixtures.js - Generate snapshot fixtures for compatibility testing.
 *
 * Produces deterministic output from all generators so we can detect drift.
 * Run with --write to update checked-in fixtures.
 *
 * Usage:
 *   node scripts/generate-fixtures.js          # print to stdout
 *   node scripts/generate-fixtures.js --write  # update scripts/fixtures/
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CITADEL_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const WRITE = process.argv.includes('--write');

const { installClaudeHooks } = require('../runtimes/claude-code/generators/install-hooks');
const { translateCodexHooks } = require('../runtimes/codex/generators/install-hooks');
const { renderClaudeGuidance } = require('../core/project/render-claude-guidance');
const { renderCodexGuidance } = require('../core/project/render-codex-guidance');
const { parseProjectSpec } = require('../core/project/load-project-spec');

function normalizePaths(str) {
  const forward = CITADEL_ROOT.replace(/\\/g, '/');
  return str.split(forward).join('${CITADEL_ROOT}');
}

// 1. Claude Code settings.json
function generateClaudeSettings() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fixture-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    const hooksTemplatePath = path.join(CITADEL_ROOT, 'hooks', 'hooks-template.json');
    const result = installClaudeHooks({
      citadelRoot: CITADEL_ROOT,
      hooksTemplatePath,
      projectRoot: tmpDir,
      hookProfile: 'latest',
    });
    const raw = fs.readFileSync(result.settingsPath, 'utf8');
    return normalizePaths(raw);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 2. Codex hooks.json
function generateCodexHooks() {
  const hooksTemplate = JSON.parse(fs.readFileSync(path.join(CITADEL_ROOT, 'hooks', 'hooks-template.json'), 'utf8'));
  const translated = translateCodexHooks(hooksTemplate, '${CITADEL_ROOT}/codex-adapter.js');
  return JSON.stringify({ hooks: translated.hooks }, null, 2);
}

// 3. Claude guidance (CLAUDE.md projection)
function generateClaudeGuidance() {
  const specContent = fs.readFileSync(path.join(CITADEL_ROOT, '.citadel', 'project.md'), 'utf8');
  const spec = parseProjectSpec(specContent);
  return renderClaudeGuidance(spec);
}

// 4. Codex guidance (AGENTS.md projection)
function generateCodexGuidance() {
  const specContent = fs.readFileSync(path.join(CITADEL_ROOT, '.citadel', 'project.md'), 'utf8');
  const spec = parseProjectSpec(specContent);
  return renderCodexGuidance(spec);
}

// 5. Codex hook translation metadata
function generateCodexTranslationMeta() {
  const hooksTemplate = JSON.parse(fs.readFileSync(path.join(CITADEL_ROOT, 'hooks', 'hooks-template.json'), 'utf8'));
  const translated = translateCodexHooks(hooksTemplate, '${CITADEL_ROOT}/codex-adapter.js');
  return JSON.stringify({
    installedCount: translated.installed.length,
    skippedCount: translated.skipped.length,
    installed: translated.installed.map((h) => `${h.event}:${h.hook}`).sort(),
    skipped: translated.skipped.map((h) => `${h.event}:${h.hook}`).sort(),
    events: Object.keys(translated.hooks).sort(),
  }, null, 2);
}

const fixtures = [
  { name: 'claude-settings.json', generate: generateClaudeSettings },
  { name: 'codex-hooks.json', generate: generateCodexHooks },
  { name: 'claude-guidance.md', generate: generateClaudeGuidance },
  { name: 'codex-guidance.md', generate: generateCodexGuidance },
  { name: 'codex-translation-meta.json', generate: generateCodexTranslationMeta },
];

if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

for (const { name, generate } of fixtures) {
  const content = generate();
  if (WRITE) {
    fs.writeFileSync(path.join(FIXTURES_DIR, name), content, 'utf8');
    console.log(`wrote: scripts/fixtures/${name}`);
  } else {
    console.log(`--- ${name} ---`);
    console.log(content);
    console.log('');
  }
}

if (WRITE) {
  console.log('\nAll fixtures written. Commit them to lock in the baseline.');
}