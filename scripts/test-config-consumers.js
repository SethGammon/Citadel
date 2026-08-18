#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../core/config');
const { buildPreview } = require('./route-preview');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-config-consumers-'));
const fullRuntime = Object.freeze({
  id: 'full-test-runtime',
  capabilities: Object.freeze({
    workspace: { support: 'full', notes: '' },
    agents: { support: 'full', notes: '' },
    worktrees: { support: 'full', notes: '' },
    approvals: { support: 'full', notes: '' },
    history: { support: 'full', notes: '' },
    surfaces: { support: 'full', notes: '' },
  }),
  degradations: [],
});

function writeHarness(value) {
  const directory = path.join(root, '.claude');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'harness.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function run(script, args = [], input = null, env = {}) {
  return spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, ...env },
  });
}

const bootstrapReview = buildPreview('review auth module', {
  projectRoot: root,
  runtime: fullRuntime,
  gitDirty: false,
  routeOverride: '/review',
  now: '2026-07-30T20:00:00.000Z',
});
assert.equal(bootstrapReview.activation.context.status, 'bootstrap');
assert.equal(bootstrapReview.activation.context.persisted, false);
assert.equal(bootstrapReview.activation.decision.status, 'enabled');
assert.equal(bootstrapReview.canRunNow, true);
assert.equal(fs.existsSync(path.join(root, '.citadel')), false);

const bootstrapMarshal = buildPreview('research competitors and write implementation phases', {
  projectRoot: root,
  runtime: fullRuntime,
  gitDirty: false,
  routeOverride: '/marshal',
});
assert.equal(bootstrapMarshal.selected, '/marshal');
assert.equal(bootstrapMarshal.activation.decision.bundleId, 'operations');
assert.equal(bootstrapMarshal.activation.decision.status, 'disabled');
assert.equal(bootstrapMarshal.boundary, 'product-bundle-activation');
assert.equal(bootstrapMarshal.canRunNow, false);
assert.match(bootstrapMarshal.approval, /\.citadel\/scripts\/citadel-config\.js enable operations .*--apply/);

const value = config.createDefaultConfig();
writeHarness(value);
config.reconcileEffectiveConfig(root, {
  runtime: fullRuntime,
  reconciledAt: '2026-07-30T20:00:00.000Z',
});

const disabledCheck = run('citadel-config.js', [
  'check', 'route', 'marshal', '--runtime', 'claude-code', '--json',
]);
assert.equal(disabledCheck.status, 2, disabledCheck.stderr);
const disabledPayload = JSON.parse(disabledCheck.stdout);
assert.equal(disabledPayload.decision.status, 'disabled');
assert.equal(disabledPayload.decision.bundleId, 'operations');
assert.equal(disabledPayload.decision.plan.requiresExplicitApply, true);

const directBlocked = run(
  '../hooks_src/user-prompt-submit.js',
  [],
  JSON.stringify({ prompt: '/marshal perform the campaign' }),
  { CLAUDE_PROJECT_DIR: root, CITADEL_RUNTIME: 'claude-code' },
);
assert.equal(directBlocked.status, 2);
assert.match(directBlocked.stderr, /Citadel activation/);

const customAllowed = run(
  '../hooks_src/user-prompt-submit.js',
  [],
  JSON.stringify({ prompt: '/my-project-skill run it' }),
  { CLAUDE_PROJECT_DIR: root, CITADEL_RUNTIME: 'claude-code' },
);
assert.equal(customAllowed.status, 0, customAllowed.stderr);

const codexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-config-codex-fleet-'));
fs.mkdirSync(path.join(codexRoot, '.claude'), { recursive: true });
fs.writeFileSync(
  path.join(codexRoot, '.claude', 'harness.json'),
  `${JSON.stringify(config.createDefaultConfig(), null, 2)}\n`,
);
config.reconcileEffectiveConfig(codexRoot, {
  runtime: require('../runtimes/codex/runtime'),
  reconciledAt: '2026-07-30T20:00:30.000Z',
});
const codexInit = spawnSync(
  process.execPath,
  [path.join(__dirname, '..', 'hooks_src', 'init-project.js')],
  {
    cwd: codexRoot,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: codexRoot, CITADEL_RUNTIME: 'codex' },
  },
);
assert.equal(codexInit.status, 0, codexInit.stderr);
const codexFleetBlocked = spawnSync(
  process.execPath,
  [path.join(__dirname, '..', 'hooks_src', 'user-prompt-submit.js')],
  {
    cwd: codexRoot,
    encoding: 'utf8',
    input: JSON.stringify({ prompt: '$fleet coordinate these tasks' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: codexRoot, CITADEL_RUNTIME: 'codex' },
  },
);
assert.equal(codexFleetBlocked.status, 2);
assert.match(codexFleetBlocked.stderr, /\$fleet is disabled \(ACTIVATION_PROMPT_REQUIRED\)/);
assert.match(
  codexFleetBlocked.stderr,
  /enable parallel --runtime codex --allow-degraded-runtime --apply --json/,
);

const displayedApply = codexFleetBlocked.stderr.match(/Review and explicitly apply: (.+)\r?\n$/)?.[1];
assert(displayedApply, 'Codex Fleet block must contain one apply command');
const displayedArgs = displayedApply.split(/\s+/);
assert.equal(displayedArgs.shift(), 'node');
const displayedScript = displayedArgs.shift();
const codexFleetApply = spawnSync(
  process.execPath,
  [displayedScript, ...displayedArgs],
  { cwd: codexRoot, encoding: 'utf8', env: { ...process.env } },
);
assert.equal(codexFleetApply.status, 0, codexFleetApply.stderr || codexFleetApply.stdout);
const codexFleetEnabled = spawnSync(
  process.execPath,
  [path.join(__dirname, '..', 'hooks_src', 'user-prompt-submit.js')],
  {
    cwd: codexRoot,
    encoding: 'utf8',
    input: JSON.stringify({ prompt: '$fleet coordinate these tasks' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: codexRoot, CITADEL_RUNTIME: 'codex' },
  },
);
assert.equal(codexFleetEnabled.status, 0, codexFleetEnabled.stderr);

value.activation = {
  ...value.activation,
  bundles: config.dependencyClosure(['operations']),
  allowDegradedRuntime: true,
};
writeHarness(value);
config.reconcileEffectiveConfig(root, {
  runtime: require('../runtimes/claude-code/runtime'),
  reconciledAt: '2026-07-30T20:01:00.000Z',
});

const directEnabled = run(
  '../hooks_src/user-prompt-submit.js',
  [],
  JSON.stringify({ prompt: '/marshal perform the campaign' }),
  { CLAUDE_PROJECT_DIR: root, CITADEL_RUNTIME: 'claude-code' },
);
assert.equal(directEnabled.status, 0, directEnabled.stderr);

const scaffoldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-config-scaffold-'));
const defaultScaffold = run(
  '../hooks_src/init-project.js',
  [],
  null,
  { CLAUDE_PROJECT_DIR: scaffoldRoot },
);
assert.equal(defaultScaffold.status, 0, defaultScaffold.stderr);
assert(fs.existsSync(path.join(scaffoldRoot, '.planning', 'campaigns')));
assert(fs.existsSync(path.join(scaffoldRoot, '.planning', 'telemetry')));
assert.equal(fs.existsSync(path.join(scaffoldRoot, '.planning', 'coordination')), false);
assert.equal(fs.existsSync(path.join(scaffoldRoot, '.planning', 'intake')), false);

const expanded = config.createDefaultConfig();
expanded.activation = {
  ...expanded.activation,
  bundles: config.dependencyClosure(['parallel', 'operations']),
};
fs.mkdirSync(path.join(scaffoldRoot, '.claude'), { recursive: true });
fs.writeFileSync(
  path.join(scaffoldRoot, '.claude', 'harness.json'),
  `${JSON.stringify(expanded, null, 2)}\n`,
);
config.reconcileEffectiveConfig(scaffoldRoot, {
  runtime: fullRuntime,
  reconciledAt: '2026-07-30T20:02:00.000Z',
});
const expandedScaffold = run(
  '../hooks_src/init-project.js',
  [],
  null,
  { CLAUDE_PROJECT_DIR: scaffoldRoot },
);
assert.equal(expandedScaffold.status, 0, expandedScaffold.stderr);
assert(fs.existsSync(path.join(scaffoldRoot, '.planning', 'coordination')));
assert(fs.existsSync(path.join(scaffoldRoot, '.planning', 'intake')));

value.language = 'typescript';
writeHarness(value);
const stalePreview = buildPreview('review auth module', {
  projectRoot: root,
  runtime: fullRuntime,
  gitDirty: false,
  routeOverride: '/review',
});
assert.equal(stalePreview.activation.context.status, 'stale');
assert.equal(stalePreview.activation.decision.status, 'blocked');
assert.equal(stalePreview.boundary, 'product-bundle-activation');

const staleDirectBlocked = run(
  '../hooks_src/user-prompt-submit.js',
  [],
  JSON.stringify({ prompt: '/do diagnose the card-effect engine' }),
  { CLAUDE_PROJECT_DIR: root, CITADEL_RUNTIME: 'claude-code' },
);
assert.equal(staleDirectBlocked.status, 2);
assert.match(
  staleDirectBlocked.stderr,
  /EFFECTIVE_CONFIG_STALE.*reconcile --apply --json/,
);

const healthUtil = path.join(__dirname, '..', 'hooks_src', 'harness-health-util.js');
const health = spawnSync(
  process.execPath,
  [
    '-e',
    `const health=require(${JSON.stringify(healthUtil)});`
      + 'process.stdout.write(JSON.stringify(health.readConfig().__citadel));',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      CITADEL_RUNTIME: 'claude-code',
    },
  },
);
assert.equal(health.status, 0, health.stderr);
const healthStatus = JSON.parse(health.stdout);
assert.equal(healthStatus.authorityValid, false);
assert.equal(healthStatus.effectiveStatus, 'stale');
assert.equal(healthStatus.effectiveReasonCode, 'EFFECTIVE_CONFIG_STALE');

const consentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-config-consent-'));
const consentWrite = spawnSync(
  process.execPath,
  [
    '-e',
    `const health=require(${JSON.stringify(healthUtil)});`
      + "health.writeConsent('externalActions','always-ask');"
      + "health.writeConsent('daemonSpend','auto-allow');",
  ],
  {
    cwd: consentRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: consentRoot,
      CITADEL_RUNTIME: 'claude-code',
    },
  },
);
assert.equal(consentWrite.status, 0, consentWrite.stderr);
const consentConfig = JSON.parse(
  fs.readFileSync(path.join(consentRoot, '.claude', 'harness.json'), 'utf8'),
);
assert.equal(consentConfig.schemaVersion, 2);
assert.deepEqual(consentConfig.execution.profile, { id: 'standard', version: '1.0.0' });
assert.deepEqual(consentConfig.activation.bundles, ['core', 'persistence']);
assert.equal(consentConfig.consent.externalActions, 'always-ask');
assert.equal(consentConfig.consent.daemonSpend, 'auto-allow');
const consentEffective = config.loadActivationContext(consentRoot, {
  runtime: config.detectRuntimeContract(consentRoot),
});
assert.equal(consentEffective.usable, true);
assert.equal(consentEffective.receipt.configKind, 'v2');
assert.equal(consentEffective.receipt.profile.id, 'standard');
assert.deepEqual(consentEffective.receipt.bundles.effective, ['core', 'persistence']);

const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-config-consent-bad-'));
fs.mkdirSync(path.join(malformedRoot, '.claude'), { recursive: true });
const malformedPath = path.join(malformedRoot, '.claude', 'harness.json');
fs.writeFileSync(malformedPath, '{not-json');
const malformedConsent = spawnSync(
  process.execPath,
  [
    '-e',
    `require(${JSON.stringify(healthUtil)}).writeConsent('externalActions','always-ask');`,
  ],
  {
    cwd: malformedRoot,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: malformedRoot },
  },
);
assert.notEqual(malformedConsent.status, 0);
assert.equal(fs.readFileSync(malformedPath, 'utf8'), '{not-json');

process.stdout.write('config consumer integration tests passed\n');
