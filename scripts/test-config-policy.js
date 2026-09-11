#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../core/config');
const codexRuntime = require('../runtimes/codex/runtime');
const claudeRuntime = require('../runtimes/claude-code/runtime');

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  process.stdout.write(`  PASS ${name}\n`);
}

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-config-policy-'));
}

function writeHarness(root, value) {
  const directory = path.join(root, '.claude');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'harness.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [
    path.join(__dirname, 'citadel-config.js'),
    ...args,
    '--project-root',
    root,
  ], {
    encoding: 'utf8',
    cwd: root,
  });
}

function v2WithBundles(bundles, allowDegradedRuntime = false) {
  const value = config.createDefaultConfig();
  value.activation = {
    ...value.activation,
    bundles: config.dependencyClosure(bundles),
    allowDegradedRuntime,
  };
  return value;
}

test('published JSON Schema is valid JSON and identifies config v2', () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'schemas', 'harness-config-v2.schema.json'),
    'utf8',
  ));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.equal(schema.additionalProperties, false);
});

test('new config defaults to Standard with Core and Persistence', () => {
  const value = config.createDefaultConfig();
  assert.deepEqual(config.validateConfigV2(value), []);
  assert.deepEqual(value.execution.profile, { id: 'standard', version: '1.0.0' });
  assert.deepEqual(value.activation.bundles, ['core', 'persistence']);
});

test('profile catalog definitions are deeply immutable and digest-bound', () => {
  const first = config.getProfile('standard@1.0.0');
  const second = config.getProfile({ id: 'standard', version: '1.0.0' });
  assert.strictEqual(first, second);
  assert(Object.isFrozen(first));
  assert(Object.isFrozen(first.policy));
  assert.equal(
    first.digest,
    'sha256:b0957be6fb656a7822420fec545a3ba2f8140baed15b831a81c10030f2ac5a9d',
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(config.PROFILE_CATALOG)
      .map(([key, profile]) => [key, profile.digest])),
    config.RELEASED_PROFILE_DIGESTS,
  );
  assert(Object.isFrozen(config.listProfiles()));
  for (const profile of Object.values(config.PROFILE_CATALOG)) {
    assert(Object.values(profile.invariants).every((value) => value === true));
  }
  assert.throws(() => config.getProfile('legacy@1.0.0'), /compatibility-only/);
});

test('bundle dependency closure is deterministic', () => {
  assert.deepEqual(
    config.dependencyClosure(['delivery', 'parallel']),
    ['core', 'persistence', 'parallel', 'operations', 'delivery'],
  );
  assert.deepEqual(config.dependentsOf('persistence'), [
    'persistence', 'parallel', 'operations', 'delivery',
  ]);
  for (let mask = 0; mask < 2 ** config.BUNDLE_IDS.length; mask++) {
    const requested = config.BUNDLE_IDS.filter((_, index) => mask & (1 << index));
    const closed = config.dependencyClosure(requested);
    assert.equal(closed[0], 'core');
    assert.equal(new Set(closed).size, closed.length);
    for (const id of requested) assert(closed.includes(id));
    for (const id of closed) {
      for (const dependency of config.BUNDLE_CATALOG[id].dependencies) {
        assert(closed.includes(dependency));
      }
    }
  }
});

test('legacy config resolves as legacy with all bundles and no write', () => {
  const root = tempProject();
  const legacy = {
    language: 'javascript',
    consent: { externalActions: 'always-ask' },
    trust: { sessionCount: 7, campaigns_completed: 2 },
  };
  const file = writeHarness(root, legacy);
  const before = fs.readFileSync(file, 'utf8');
  const beforeMtime = fs.statSync(file).mtimeMs;
  const loaded = config.loadResolvedConfig(root, {
    runtime: codexRuntime,
    reconciledAt: '2026-07-30T12:00:00.000Z',
  });
  assert.equal(loaded.receipt.configKind, 'legacy');
  assert.equal(loaded.receipt.profile.id, 'legacy');
  assert.deepEqual(loaded.receipt.bundles.effective, [
    'core', 'persistence', 'parallel', 'operations', 'delivery',
  ]);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.statSync(file).mtimeMs, beforeMtime);
});

test('migration is deterministic, preserves policy, and normalizes trust aliases', () => {
  const legacy = {
    language: 'javascript',
    consent: { externalActions: 'always-ask' },
    trust: { sessionCount: 9, campaigns_completed: 3, improve_loops_accepted: 2 },
    policy: { externalActions: { protectedBranches: ['main'] } },
  };
  const first = config.createMigrationPlan(legacy);
  const second = config.createMigrationPlan(legacy);
  assert.deepEqual(first, second);
  assert.equal(first.blocked, false);
  assert.equal(first.candidateConfig.schemaVersion, 2);
  assert.deepEqual(first.candidateConfig.policy, legacy.policy);
  assert.equal(first.candidateConfig.trust.sessionsCompleted, 9);
  assert.equal(first.candidateConfig.trust.campaignsCompleted, 3);
  assert.equal(first.candidateConfig.trust.improveLoopsAccepted, 2);
});

test('all legacy trust aliases normalize once to the v2 shape', () => {
  assert.deepEqual(config.normalizeTrust({
    sessions_completed: 1,
    campaignCount: 2,
    campaigns_reverted: 3,
    fleet_clean_merges: 4,
    improve_loops_accepted: 5,
    daemon_runs: 6,
    override: 'trusted',
  }), {
    sessionsCompleted: 1,
    campaignsCompleted: 2,
    campaignsReverted: 3,
    fleetCleanMerges: 4,
    improveLoopsAccepted: 5,
    daemonRuns: 6,
    override: 'trusted',
  });
});

test('unknown v2 fields fail exact validation', () => {
  const value = { ...config.createDefaultConfig(), unexpected: true };
  assert(config.validateConfigV2(value).some((error) => error.includes('unknown fields')));
});

test('manual validation matches published compatibility field types', () => {
  const value = {
    ...config.createDefaultConfig(),
    language: 42,
    protectedFiles: ['one', 'one'],
    registeredSkills: ['do', 7],
    registeredSkillCount: -1,
    policy: 'permissive',
    allowEnvWrites: 'yes',
  };
  const errors = config.validateConfigV2(value);
  assert(errors.some((error) => error === 'language must be a string'));
  assert(errors.some((error) => error === 'protectedFiles must be unique'));
  assert(errors.some((error) => error === 'registeredSkills must be an array of strings'));
  assert(errors.some((error) => error.includes('registeredSkillCount')));
  assert(errors.some((error) => error === 'policy must be a plain object'));
  assert(errors.some((error) => error === 'allowEnvWrites must be boolean'));
});

test('every bundle catalog entry has immutable lifecycle and ownership metadata', () => {
  const skills = new Set();
  const hooks = new Set();
  for (const [id, bundle] of Object.entries(config.BUNDLE_CATALOG)) {
    assert.equal(bundle.id, id);
    assert.equal(bundle.stage, 'stable');
    assert.equal(bundle.since, '2.0.0');
    assert.equal(bundle.deprecatedSince, null);
    assert.equal(bundle.removedIn, null);
    assert(Array.isArray(bundle.owns.skills));
    assert(Array.isArray(bundle.owns.hooks));
    assert(Array.isArray(bundle.owns.state));
    assert(Object.isFrozen(bundle.owns));
    for (const skill of bundle.owns.skills) {
      assert(!skills.has(skill), `skill ${skill} has multiple bundle owners`);
      skills.add(skill);
    }
    for (const hook of bundle.owns.hooks) {
      assert(!hooks.has(hook), `hook ${hook} has multiple bundle owners`);
      hooks.add(hook);
    }
  }
});

test('future config versions fail closed with only Core effective', () => {
  const future = {
    schemaVersion: 99,
    activation: { bundles: ['core', 'persistence', 'parallel'] },
  };
  const receipt = config.resolveConfig(future, {
    runtime: codexRuntime,
    reconciledAt: '2026-07-30T12:00:00.000Z',
  });
  assert.equal(receipt.status, 'blocked');
  assert.deepEqual(receipt.bundles.effective, ['core']);
  assert(receipt.errors.some((error) => error.includes('Unsupported future schemaVersion')));
});

test('partial runtime support is unavailable without opt-in and degraded with opt-in', () => {
  const denied = config.resolveConfig(v2WithBundles(['parallel'], false), {
    runtime: codexRuntime,
  });
  assert.equal(denied.status, 'blocked');
  assert(!denied.bundles.effective.includes('parallel'));
  assert(denied.bundles.unavailable.some((entry) =>
    entry.id === 'parallel' && entry.reasonCode === 'DEGRADED_RUNTIME_REQUIRES_OPT_IN'));

  const allowed = config.resolveConfig(v2WithBundles(['parallel'], true), {
    runtime: codexRuntime,
  });
  assert.equal(allowed.status, 'degraded');
  assert(allowed.bundles.effective.includes('parallel'));
  assert(allowed.bundles.degraded.some((entry) => entry.adapter));
});

test('missing runtime capability makes a bundle unavailable', () => {
  const runtime = {
    id: 'test-runtime',
    capabilities: {
      workspace: { support: 'full', notes: '' },
      history: { support: 'full', notes: '' },
      approvals: { support: 'none', notes: '' },
      surfaces: { support: 'full', notes: '' },
    },
  };
  const receipt = config.resolveConfig(v2WithBundles(['delivery'], true), { runtime });
  assert.equal(receipt.status, 'blocked');
  assert(receipt.bundles.unavailable.some((entry) =>
    entry.reasonCode === 'RUNTIME_CAPABILITY_UNAVAILABLE'));
  assert(!receipt.bundles.effective.includes('operations'));
  assert(!receipt.bundles.effective.includes('delivery'));
});

test('policy precedence is monotonic and records provenance', () => {
  const value = config.createDefaultConfig();
  value.policy = {
    operating: {
      maxParallelAgents: 10,
      allowAutoWorktreeIntegration: true,
      checkpointMinimum: 'destructive-only',
    },
  };
  const receipt = config.resolveConfig(value, {
    runtime: codexRuntime,
    externalConstraints: {
      maxParallelAgents: 1,
      allowAutoWorktreeIntegration: false,
      checkpointMinimum: 'every-mutation',
    },
    sessionConstraints: {
      maxParallelAgents: 5,
      allowAutoWorktreeIntegration: true,
      checkpointMinimum: 'destructive-only',
    },
  });
  assert.equal(receipt.policy.values.maxParallelAgents, 1);
  assert.equal(receipt.policy.values.allowAutoWorktreeIntegration, false);
  assert.equal(receipt.policy.values.checkpointMinimum, 'every-mutation');
  assert.equal(receipt.policy.provenance.maxParallelAgents.source, 'external-policy');
  assert(receipt.policy.provenance.maxParallelAgents.layers.some((layer) =>
    layer.reasonCode === 'CANNOT_RAISE_CEILING'));
});

test('resolved receipts are deterministic for identical inputs', () => {
  const value = config.createDefaultConfig();
  const options = {
    runtime: codexRuntime,
    reconciledAt: '2026-07-30T12:00:00.000Z',
  };
  const first = config.resolveConfig(value, options);
  assert.deepEqual(first, config.resolveConfig(value, options));
  assert.equal(first.package.name, 'citadel');
  assert.match(first.package.version, /^\d+\.\d+\.\d+/);
  assert(Object.values(first.policy.provenance)
    .every((entry) => entry.enforcement === 'hard'));
});

test('CLI migration plan does not mutate a legacy config', () => {
  const root = tempProject();
  const file = writeHarness(root, { language: 'javascript', trust: { sessionCount: 2 } });
  const before = fs.readFileSync(file, 'utf8');
  const result = runCli(root, ['migrate', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.blocked, false);
  assert.equal(plan.sourceKind, 'legacy');
});

test('CLI rejects incomplete options without guessing values', () => {
  const root = tempProject();
  const result = runCli(root, ['plan', '--enable']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--enable requires a value/);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
});

test('CLI refuses future configs without writing a backup or mutation', () => {
  const root = tempProject();
  const file = writeHarness(root, {
    schemaVersion: 99,
    activation: { bundles: ['core', 'persistence'] },
  });
  const before = fs.readFileSync(file, 'utf8');
  const result = runCli(root, ['migrate', '--apply', '--json']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Plan is blocked/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(`${file}.bak`), false);
});

test('CLI plan for a missing config creates no project state', () => {
  const root = tempProject();
  const result = runCli(root, ['plan', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
});

test('CLI applies only with --apply and validates the observed digest', () => {
  const root = tempProject();
  const file = writeHarness(root, { language: 'javascript', trust: { sessionCount: 2 } });
  const previousBytes = fs.readFileSync(file, 'utf8');
  const result = runCli(root, ['migrate', '--apply', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const applied = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(receipt.applied, true);
  assert.equal(receipt.backupPath, `${file}.bak`);
  assert.equal(fs.readFileSync(receipt.backupPath, 'utf8'), previousBytes);
  assert.equal(applied.schemaVersion, 2);
  assert.deepEqual(config.validateConfigV2(applied), []);
});

test('CLI profile and bundle changes remain plan-first', () => {
  const root = tempProject();
  const file = writeHarness(root, config.createDefaultConfig());
  const before = fs.readFileSync(file, 'utf8');
  const preview = runCli(root, ['set-profile', 'strict-supervised', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  const profileApply = runCli(root, ['set-profile', 'strict-supervised', '--apply', '--json']);
  assert.equal(profileApply.status, 0, profileApply.stderr);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).execution.profile.id, 'strict-supervised');

  const enable = runCli(root, [
    'enable', 'parallel', '--allow-degraded-runtime', '--apply', '--json',
  ]);
  assert.equal(enable.status, 0, enable.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).activation.bundles, [
    'core', 'persistence', 'parallel',
  ]);

  const disable = runCli(root, ['disable', 'persistence', '--apply', '--json']);
  assert.equal(disable.status, 0, disable.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).activation.bundles, ['core']);
});

test('CLI initialization accepts only compatibility fields and reconciles derived state', () => {
  const root = tempProject();
  const input = path.join(root, 'stack.json');
  fs.writeFileSync(input, `${JSON.stringify({
    language: 'typescript',
    framework: 'react',
    packageManager: 'npm',
    protectedFiles: ['.claude/harness.json', '.claude/settings.json'],
    registeredSkills: ['do', 'review'],
    registeredSkillCount: 2,
  })}\n`);
  const initializeArgs = ['initialize', '--input', input, '--runtime', 'claude-code'];
  const preview = runCli(root, [...initializeArgs, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(fs.existsSync(path.join(root, '.claude', 'harness.json')), false);

  const applied = runCli(root, [...initializeArgs, '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  const harness = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'harness.json'), 'utf8'));
  assert.equal(harness.schemaVersion, 2);
  assert.equal(harness.language, 'typescript');
  assert.equal(harness.framework, 'react');
  const effective = config.readEffectiveConfig(root, { runtime: claudeRuntime });
  assert.equal(effective.usable, true);
  assert.equal(effective.receipt.runtime.id, 'claude-code');
  assert.equal(effective.receipt.sourceDigest, config.readConfigFile(root).sourceDigest);

  fs.writeFileSync(input, '{"execution":{"profile":{"id":"experimental","version":"1.0.0"}}}\n');
  const rejected = runCli(root, ['initialize', '--input', input, '--json']);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /unsupported fields: execution/);
});

process.stdout.write(`\nConfig policy tests passed: ${passed}\n`);
