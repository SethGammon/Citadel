#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../core/config');
const codexRuntime = require('../runtimes/codex/runtime');

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  PASS ${name}\n`);
}

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-config-activation-'));
}

function writeHarness(root, value) {
  const directory = path.join(root, '.claude');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'harness.json');
  const bytes = typeof value === 'string'
    ? value
    : `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(file, bytes, 'utf8');
  return file;
}

function harness(bundles = ['core'], onDemand = 'prompt', allowDegradedRuntime = false) {
  const value = config.createDefaultConfig();
  value.activation = {
    bundles: config.dependencyClosure(bundles),
    onDemand,
    allowDegradedRuntime,
  };
  return value;
}

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

function reconcile(root, value, options = {}) {
  writeHarness(root, value);
  return config.reconcileEffectiveConfig(root, {
    runtime: fullRuntime,
    reconciledAt: '2026-07-30T18:00:00.000Z',
    ...options,
  });
}

test('reconciliation atomically writes a current derived receipt', () => {
  const root = tempProject();
  const result = reconcile(root, harness(['core', 'persistence']));
  const receiptPath = path.join(root, '.citadel', 'effective-config.json');
  assert.equal(result.usable, true);
  assert.equal(result.receiptPath, receiptPath);
  assert.equal(result.receipt.receiptKind, config.EFFECTIVE_RECEIPT_KIND);
  assert.equal(result.receipt.sourceDigest, config.readConfigFile(root).sourceDigest);
  assert.deepEqual(config.validateEffectiveReceipt(result.receipt).errors, []);
  assert.equal(
    fs.readdirSync(path.dirname(receiptPath)).some((name) => name.endsWith('.tmp')),
    false,
  );
  writeHarness(root, harness(['core']));
  const replaced = config.reconcileEffectiveConfig(root, {
    runtime: fullRuntime,
    reconciledAt: '2026-07-30T18:01:00.000Z',
  });
  assert.equal(replaced.usable, true);
  assert.deepEqual(replaced.receipt.bundles.requested, ['core']);
  assert.equal(
    fs.readdirSync(path.dirname(receiptPath)).some((name) => name.endsWith('.tmp')),
    false,
  );
});

test('stale effective receipts are rejected and preflight fails closed', () => {
  const root = tempProject();
  reconcile(root, harness(['core']));
  writeHarness(root, harness(['core', 'persistence']));
  const read = config.readEffectiveConfig(root);
  assert.equal(read.usable, false);
  assert.equal(read.status, 'stale');
  assert.equal(read.reasonCode, config.EFFECTIVE_RECEIPT_REASONS.STALE);
  const decision = config.preflightSkill(read, 'fleet');
  assert.equal(decision.status, 'blocked');
  assert.equal(decision.reasonCode, config.EFFECTIVE_RECEIPT_REASONS.STALE);
  assert.equal(decision.plan.action, 'reconcile-effective-config');
  assert.equal(decision.plan.requiresExplicitApply, true);
  assert.equal(
    decision.plan.applyCommand,
    'node .citadel/scripts/citadel-config.js reconcile --apply --json',
  );
});

test('malformed and future effective receipts are rejected distinctly', () => {
  const root = tempProject();
  reconcile(root, harness(['core']));
  const receiptPath = config.effectiveConfigPath(root);
  fs.writeFileSync(receiptPath, '{bad json', 'utf8');
  const malformed = config.readEffectiveConfig(root);
  assert.equal(malformed.status, 'malformed');
  assert.equal(malformed.reasonCode, config.EFFECTIVE_RECEIPT_REASONS.MALFORMED);

  fs.writeFileSync(receiptPath, JSON.stringify({ contractVersion: 2 }), 'utf8');
  const future = config.readEffectiveConfig(root);
  assert.equal(future.status, 'future');
  assert.equal(future.reasonCode, config.EFFECTIVE_RECEIPT_REASONS.FUTURE);
  assert.equal(config.preflightHook(future, 'protect-files').status, 'blocked');
});

test('tampered receipt bodies fail digest validation', () => {
  const root = tempProject();
  const current = reconcile(root, harness(['core']));
  const raw = JSON.parse(fs.readFileSync(current.receiptPath, 'utf8'));
  raw.activation.onDemand = 'deny';
  fs.writeFileSync(current.receiptPath, JSON.stringify(raw), 'utf8');
  const read = config.readEffectiveConfig(root);
  assert.equal(read.status, 'malformed');
  assert(read.errors.some((error) => error.includes('receiptDigest')));
});

test('future and malformed source configs reconcile only a fail-closed receipt', () => {
  const futureRoot = tempProject();
  const future = reconcile(futureRoot, {
    schemaVersion: 99,
    activation: { bundles: ['core', 'persistence'] },
  });
  assert.equal(future.usable, true);
  assert.equal(future.receipt.authority.valid, false);
  assert.deepEqual(future.receipt.bundles.effective, ['core']);
  const safety = config.preflightHook(future, 'protect-files');
  assert.equal(safety.status, 'enabled');
  assert.equal(safety.reasonCode, config.ACTIVATION_REASON_CODES.CORE_SAFETY_FAIL_CLOSED);
  assert.equal(config.preflightSkill(future, 'review').status, 'blocked');

  const malformedRoot = tempProject();
  writeHarness(malformedRoot, '{ "schemaVersion":');
  const malformed = config.reconcileEffectiveConfig(malformedRoot, {
    runtime: fullRuntime,
    reconciledAt: '2026-07-30T18:00:00.000Z',
  });
  assert.equal(malformed.receipt.authority.valid, false);
  assert.equal(malformed.receipt.configKind, 'invalid');
  assert.match(malformed.receipt.sourceDigest, /^sha256:[a-f0-9]{64}$/);
});

test('skill, route, and hook ownership resolve from one catalog', () => {
  assert.equal(config.bundleForSkill('/fleet'), 'parallel');
  assert.equal(config.bundleForSkill('cost'), 'persistence');
  assert.equal(config.bundleForRoute('deploy-steward'), 'delivery');
  assert.equal(config.bundleForTarget('route', 'deploy-steward'), 'delivery');
  assert.equal(config.bundleForHook('protect-files.js'), 'core');
  assert.equal(config.bundleForHook('subagent-start'), 'parallel');
  assert.equal(config.bundleForSkill('not-a-skill'), null);
});

test('central ownership covers every packaged skill and current hook mapping', () => {
  const skillRoot = path.join(__dirname, '..', 'skills');
  const packagedSkills = fs.readdirSync(skillRoot)
    .filter((name) => fs.existsSync(path.join(skillRoot, name, 'SKILL.md')))
    .sort();
  assert.deepEqual(Object.keys(config.SKILL_BUNDLE_OWNERSHIP).sort(), packagedSkills);

  const hookMap = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'hooks', 'bundle-map.json'),
    'utf8',
  ));
  assert.deepEqual(config.HOOK_BUNDLE_OWNERSHIP, hookMap.hooks);
});

test('enabled targets and disabled prompt plans have exact outcomes', () => {
  const root = tempProject();
  const current = reconcile(root, harness(['core']));
  const enabled = config.preflightSkill(current, 'review');
  assert.equal(enabled.status, 'enabled');
  assert.equal(enabled.reasonCode, config.ACTIVATION_REASON_CODES.ENABLED);

  const disabled = config.preflightRoute(current, 'fleet');
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.reasonCode, config.ACTIVATION_REASON_CODES.PROMPT_REQUIRED);
  assert.deepEqual(disabled.plan.addedBundles, ['persistence', 'parallel']);
  assert.equal(disabled.plan.requiresExplicitApply, true);
  assert.equal(disabled.plan.mutatesConfig, false);
  assert(disabled.plan.resources.some((entry) => entry.bundleId === 'parallel'));
});

test('deny and auto-safe return plans without mutating harness config', () => {
  const deniedRoot = tempProject();
  const denied = reconcile(deniedRoot, harness(['core'], 'deny'));
  const deniedDecision = config.preflightSkill(denied, 'cost');
  assert.equal(deniedDecision.status, 'disabled');
  assert.equal(deniedDecision.reasonCode, config.ACTIVATION_REASON_CODES.DENIED);

  const safeRoot = tempProject();
  const file = writeHarness(safeRoot, harness(['core'], 'auto-safe'));
  const safe = config.reconcileEffectiveConfig(safeRoot, {
    runtime: fullRuntime,
    reconciledAt: '2026-07-30T18:00:00.000Z',
  });
  const before = fs.readFileSync(file, 'utf8');
  const safeDecision = config.preflightSkill(safe, 'cost');
  assert.equal(safeDecision.status, 'disabled');
  assert.equal(
    safeDecision.reasonCode,
    config.ACTIVATION_REASON_CODES.AUTO_SAFE_PLAN_REQUIRED,
  );
  assert.equal(safeDecision.plan.autoSafeEligible, true);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  const unsafeDecision = config.preflightSkill(safe, 'fleet');
  assert.equal(unsafeDecision.status, 'blocked');
  assert.equal(
    unsafeDecision.reasonCode,
    config.ACTIVATION_REASON_CODES.AUTO_SAFE_NOT_ELIGIBLE,
  );
  assert.equal(unsafeDecision.plan.autoSafeEligible, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('runtime negotiation distinguishes degraded and unavailable activation', () => {
  const degradedRoot = tempProject();
  const degraded = reconcile(
    degradedRoot,
    harness(['parallel'], 'prompt', true),
    { runtime: codexRuntime },
  );
  const degradedDecision = config.preflightSkill(degraded, 'fleet');
  assert.equal(degradedDecision.status, 'degraded');
  assert.equal(degradedDecision.reasonCode, config.ACTIVATION_REASON_CODES.DEGRADED);
  assert(degradedDecision.degradation.adapter);

  const unavailableRoot = tempProject();
  const unavailable = reconcile(
    unavailableRoot,
    harness(['parallel'], 'prompt', false),
    { runtime: codexRuntime },
  );
  const unavailableDecision = config.preflightSkill(unavailable, 'fleet');
  assert.equal(unavailableDecision.status, 'unavailable');
  assert.equal(unavailableDecision.reasonCode, config.ACTIVATION_REASON_CODES.UNAVAILABLE);
  assert.equal(
    unavailableDecision.causeReasonCode,
    'DEGRADED_RUNTIME_REQUIRES_OPT_IN',
  );
  assert.equal(unavailableDecision.plan.degradedRuntimeOptInRequired, true);
  assert.equal(unavailableDecision.plan.prospective.unavailable.length, 0);
  assert(unavailableDecision.plan.prospective.degraded.some((entry) => (
    entry.id === 'parallel'
    && entry.adapter === 'citadel-managed-worktrees-and-approvals'
  )));
  assert.equal(
    unavailableDecision.plan.previewCommand,
    'node .citadel/scripts/citadel-config.js enable parallel --runtime codex --allow-degraded-runtime --json',
  );
  assert.equal(
    unavailableDecision.plan.applyCommand,
    'node .citadel/scripts/citadel-config.js enable parallel --runtime codex --allow-degraded-runtime --apply --json',
  );
});

test('repository policy overrides use a deterministic custom display identity', () => {
  const value = harness(['core', 'persistence']);
  value.policy = {
    operating: {
      maxParallelAgents: 2,
      allowAutoWorktreeIntegration: false,
    },
  };
  const first = config.resolveConfig(value, { runtime: fullRuntime });
  const second = config.resolveConfig(value, { runtime: fullRuntime });
  assert.match(first.profile.id, /^custom:sha256:[a-f0-9]{64}$/);
  assert.notEqual(first.profile.id, 'standard');
  assert.equal(first.profile.source, 'repository-policy');
  assert.equal(first.profile.base.id, 'standard');
  assert.equal(first.profile.id, second.profile.id);

  const builtIn = config.resolveConfig(harness(['core']), { runtime: fullRuntime });
  assert.equal(builtIn.profile.id, 'standard');
  assert.equal(builtIn.profile.base, null);
});

process.stdout.write(`\nConfig activation tests passed: ${passed}\n`);
