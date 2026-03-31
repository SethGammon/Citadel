#!/usr/bin/env node

/**
 * test-compat-fixtures.js - Compatibility fixture tests
 *
 * Regenerates all fixture outputs and compares against checked-in baselines.
 * Fails if any generated output differs from its fixture, which means a
 * generator changed behavior without updating the baseline.
 *
 * To update baselines after intentional changes:
 *   node scripts/generate-fixtures.js --write
 *
 * This test is included in `node scripts/test-all.js --strict`.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CITADEL_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const { installClaudeHooks } = require('../runtimes/claude-code/generators/install-hooks');
const { translateCodexHooks } = require('../runtimes/codex/generators/install-hooks');
const { renderClaudeGuidance } = require('../core/project/render-claude-guidance');
const { renderCodexGuidance } = require('../core/project/render-codex-guidance');
const { parseProjectSpec } = require('../core/project/load-project-spec');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${label}`);
    console.error(`    ${err.message}`);
  }
}

function normalizePaths(str) {
  const forward = CITADEL_ROOT.replace(/\\/g, '/');
  return str.split(forward).join('${CITADEL_ROOT}');
}

function readFixture(name) {
  const p = path.join(FIXTURES_DIR, name);
  if (!fs.existsSync(p)) {
    throw new Error(`Fixture not found: scripts/fixtures/${name}. Run: node scripts/generate-fixtures.js --write`);
  }
  return fs.readFileSync(p, 'utf8');
}

function compareFixture(label, fixtureName, generated) {
  check(label, () => {
    const expected = readFixture(fixtureName);
    if (generated !== expected) {
      const genLines = generated.split('\n');
      const expLines = expected.split('\n');
      let firstDiff = -1;
      for (let i = 0; i < Math.max(genLines.length, expLines.length); i++) {
        if (genLines[i] !== expLines[i]) {
          firstDiff = i + 1;
          break;
        }
      }
      throw new Error(
        `${fixtureName} drift at line ${firstDiff}.\n` +
        `    Expected: ${(expLines[firstDiff - 1] || '(missing)').slice(0, 120)}\n` +
        `    Got:      ${(genLines[firstDiff - 1] || '(missing)').slice(0, 120)}\n` +
        `    Run: node scripts/generate-fixtures.js --write`
      );
    }
  });
}

// --- Snapshot: Claude Code settings.json ---

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fixture-test-'));
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
  const normalized = normalizePaths(raw);
  compareFixture('Claude settings.json matches fixture', 'claude-settings.json', normalized);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// --- Snapshot: Codex hooks.json ---

const hooksTemplate = JSON.parse(fs.readFileSync(path.join(CITADEL_ROOT, 'hooks', 'hooks-template.json'), 'utf8'));
const translated = translateCodexHooks(hooksTemplate, '${CITADEL_ROOT}/codex-adapter.js');
const codexHooksStr = JSON.stringify({ hooks: translated.hooks }, null, 2);
compareFixture('Codex hooks.json matches fixture', 'codex-hooks.json', codexHooksStr);

// --- Snapshot: Codex translation metadata ---

const metaStr = JSON.stringify({
  installedCount: translated.installed.length,
  skippedCount: translated.skipped.length,
  installed: translated.installed.map((h) => `${h.event}:${h.hook}`).sort(),
  skipped: translated.skipped.map((h) => `${h.event}:${h.hook}`).sort(),
  events: Object.keys(translated.hooks).sort(),
}, null, 2);
compareFixture('Codex translation metadata matches fixture', 'codex-translation-meta.json', metaStr);

// --- Snapshot: Claude guidance projection ---

const specContent = fs.readFileSync(path.join(CITADEL_ROOT, '.citadel', 'project.md'), 'utf8');
const spec = parseProjectSpec(specContent);
compareFixture('Claude guidance projection matches fixture', 'claude-guidance.md', renderClaudeGuidance(spec));

// --- Snapshot: Codex guidance projection ---

compareFixture('Codex guidance projection matches fixture', 'codex-guidance.md', renderCodexGuidance(spec));

// --- Structural assertions (not snapshot-dependent) ---

check('Claude settings has env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', () => {
  const settings = JSON.parse(readFixture('claude-settings.json'));
  assert.equal(settings.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1');
});

check('Claude settings has all expected hook events', () => {
  const settings = JSON.parse(readFixture('claude-settings.json'));
  const events = Object.keys(settings.hooks);
  for (const expected of ['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop']) {
    assert(events.includes(expected), `missing event: ${expected}`);
  }
});

check('Codex hooks only include supported events', () => {
  const codex = JSON.parse(readFixture('codex-hooks.json'));
  const supported = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']);
  for (const event of Object.keys(codex.hooks)) {
    assert(supported.has(event), `unsupported Codex event: ${event}`);
  }
});

check('Codex translation installs at least 10 hooks', () => {
  const meta = JSON.parse(readFixture('codex-translation-meta.json'));
  assert(meta.installedCount >= 10, `only ${meta.installedCount} hooks installed`);
});

check('Claude guidance contains required sections', () => {
  const guidance = readFixture('claude-guidance.md');
  for (const section of ['Key Conventions', 'Workflows', 'Constraints', 'Handoff Summary']) {
    assert(guidance.includes(`## ${section}`), `missing section: ${section}`);
  }
});

check('Codex guidance contains required sections', () => {
  const guidance = readFixture('codex-guidance.md');
  for (const section of ['Conventions', 'Workflows', 'Constraints', 'Handoff Summary']) {
    assert(guidance.includes(`## ${section}`), `missing section: ${section}`);
  }
});

// --- Summary ---

console.log(`compatibility fixture tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);