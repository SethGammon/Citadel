#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CITADEL_ROOT = path.resolve(__dirname, '..');

function tempProject(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runJson(args, cwd = CITADEL_ROOT) {
  const output = execFileSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30000,
  });
  return JSON.parse(output);
}

function testClaudeDryRun() {
  const tmp = tempProject('citadel-claude-install-');
  try {
    const report = runJson([
      path.join(CITADEL_ROOT, 'scripts', 'claude-install.js'),
      '--project-root',
      tmp,
      '--install',
      '--scope',
      'local',
      '--dry-run',
      '--json',
    ]);
    assert(report.pass, JSON.stringify(report, null, 2));
    assert.equal(report.scope, 'local');
    assert(report.steps.some((step) => step.name === 'Validate Claude Code plugin marketplace'));
    assert(report.steps.some((step) => step.name === 'Register Citadel marketplace with Claude Code'));
    assert(report.steps.some((step) => step.name === 'Install Citadel Harness plugin'));
    assert(report.steps.some((step) => step.name === 'Install resolved Citadel hooks'));
    assert(report.steps.every((step) => step.skipped));
    assert(report.nextSteps.claudeCode.some((step) => step.includes('/do --list')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testUnifiedDispatcherDryRun() {
  const tmp = tempProject('citadel-unified-install-');
  try {
    const codex = runJson([
      path.join(CITADEL_ROOT, 'scripts', 'install.js'),
      '--runtime',
      'codex',
      '--project-root',
      tmp,
      '--plugin-only',
      '--dry-run',
      '--json',
    ]);
    assert.equal(codex.mode, 'plugin-only');
    assert(codex.pass, JSON.stringify(codex, null, 2));

    const claude = runJson([
      path.join(CITADEL_ROOT, 'scripts', 'install.js'),
      '--runtime',
      'claude',
      '--project-root',
      tmp,
      '--install',
      '--dry-run',
      '--json',
    ]);
    assert.equal(claude.scope, 'local');
    assert(claude.pass, JSON.stringify(claude, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testClaudeMarketplaceManifest() {
  const marketplacePath = path.join(CITADEL_ROOT, '.claude-plugin', 'marketplace.json');
  const pluginPath = path.join(CITADEL_ROOT, '.claude-plugin', 'plugin.json');
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
  assert.equal(marketplace.plugins[0].version, plugin.version, 'Claude marketplace version should match plugin.json');
  assert(!marketplace.plugins[0].description.includes('â'), 'Claude marketplace description should not contain mojibake');
}

testClaudeDryRun();
testUnifiedDispatcherDryRun();
testClaudeMarketplaceManifest();

console.log('installer tests passed');
