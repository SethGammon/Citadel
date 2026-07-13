#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const activation = require('../core/telemetry/activation');
const installer = require('./install');

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

function testUnifiedDispatcherRecordsSuccessfulInstall() {
  const tmp = tempProject('citadel-unified-activation-');
  try {
    const times = [new Date('2026-07-13T12:00:00.000Z'), new Date('2026-07-13T12:00:00.250Z')];
    const result = installer.execute(['--runtime', 'codex', '--project-root', tmp], {
      cwd: CITADEL_ROOT,
      env: { CITADEL_ACQUISITION_SOURCE: 'github_trending' },
      clock: () => times.shift(),
      spawnSync: () => ({ status: 0 }),
    });
    assert.equal(result.status, 0);
    const events = activation.readEvents(tmp).events;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(({ stage, status }) => ({ stage, status })), [
      { stage: 'install_started', status: 'started' },
      { stage: 'install_completed', status: 'succeeded' },
    ]);
    assert.equal(events[1].duration_ms, 250);
    assert.equal(events[1].runtime, 'codex');
    assert.equal(events[1].acquisition_source, 'github_trending');
    assert.equal(events[1].citadel_version, require('../package.json').version);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testUnifiedDispatcherRecordsFailureWithoutChangingExit() {
  const tmp = tempProject('citadel-unified-failure-');
  try {
    const failed = installer.execute(['--runtime=claude', '--project-root', tmp], {
      cwd: CITADEL_ROOT,
      clock: () => new Date('2026-07-13T12:00:00.000Z'),
      spawnSync: () => ({ status: 7 }),
    });
    assert.equal(failed.status, 7);
    let event = activation.readEvents(tmp).events.at(-1);
    assert.equal(event.status, 'failed');
    assert.equal(event.failure_code, 'unknown_error');
    assert.equal(event.runtime, 'claude-code');

    fs.rmSync(activation.pathsFor(tmp).dir, { recursive: true, force: true });
    const missing = installer.execute(['--runtime=codex', '--project-root', tmp], {
      cwd: CITADEL_ROOT,
      clock: () => new Date('2026-07-13T12:00:00.000Z'),
      spawnSync: () => ({ error: new Error('missing') }),
    });
    assert.equal(missing.status, 1);
    event = activation.readEvents(tmp).events.at(-1);
    assert.equal(event.failure_code, 'dependency_missing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testUnifiedDispatcherRespectsNonInstallModesAndOptOut() {
  for (const flag of ['--dry-run', '--plugin-only']) {
    const tmp = tempProject('citadel-unified-no-activation-');
    try {
      installer.execute(['--runtime=codex', '--project-root', tmp, flag], {
        cwd: CITADEL_ROOT, spawnSync: () => ({ status: 0 }),
      });
      assert.equal(fs.existsSync(activation.pathsFor(tmp).events), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const tmp = tempProject('citadel-unified-opt-out-');
  try {
    activation.setOptOut(tmp, true);
    const result = installer.execute(['--runtime=codex', '--project-root', tmp], {
      cwd: CITADEL_ROOT, spawnSync: () => ({ status: 0 }),
    });
    assert(result.records.every((record) => record.reason === 'opted_out'));
    assert.equal(fs.existsSync(activation.pathsFor(tmp).events), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

testClaudeDryRun();
testUnifiedDispatcherDryRun();
testClaudeMarketplaceManifest();
testUnifiedDispatcherRecordsSuccessfulInstall();
testUnifiedDispatcherRecordsFailureWithoutChangingExit();
testUnifiedDispatcherRespectsNonInstallModesAndOptOut();

console.log('installer tests passed');
