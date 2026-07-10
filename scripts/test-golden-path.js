#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { RECOVERIES } = require('../core/golden-path/contract');
const { assertNotSymlink, digestDirectory } = require('../core/golden-path/fixture');
const { evidenceFor, parseJson, runNode, sanitize } = require('../core/golden-path/process');
const { cleanup, isSafeStageEntry, runGoldenPath, shouldStagePluginPath } = require('../core/golden-path/runner');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'golden-path');
const FIXTURE = path.join(FIXTURE_ROOT, 'minimal-node.json');
const TOP_LEVEL = [
  'schema', 'mode', 'runtime', 'fixture_id', 'platform', 'status', 'failure', 'steps',
  'metrics', 'artifacts', 'resume', 'rollback', 'limitations',
].sort();
const STEP_IDS = ['pristine', 'install', 'setup', 'campaign', 'route', 'operator', 'verified-handoff', 'resume', 'rollback'];

function tempFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-golden-path-test-'));
  const fixtureRoot = path.join(root, 'fixture');
  fs.cpSync(FIXTURE_ROOT, fixtureRoot, { recursive: true });
  return { root, fixtureRoot, fixture: path.join(fixtureRoot, 'minimal-node.json') };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function run(runtime, fixture = FIXTURE, keepTemp = false) {
  return runGoldenPath({ runtime, fixture, keepTemp, pluginRoot: ROOT });
}

function assertSuccess(result, runtime, beforeDigest) {
  assert.deepEqual(Object.keys(result).sort(), TOP_LEVEL);
  assert.equal(result.schema, 1);
  assert.equal(result.mode, 'fixture-automation');
  assert.equal(result.runtime, runtime);
  assert.equal(result.fixture_id, 'minimal-node');
  assert.equal(result.status, 'passed');
  assert.equal(result.failure, null);
  assert.deepEqual(result.steps.map((step) => step.id), STEP_IDS);
  for (const step of result.steps) {
    assert.equal(step.status, 'passed');
    assert.equal(typeof step.duration_ms, 'number');
    assert(Array.isArray(step.evidence));
  }
  assert(result.metrics.install_to_route_ms >= 0);
  assert(result.metrics.install_to_verified_handoff_ms >= result.metrics.install_to_route_ms);
  assert(result.metrics.total_ms >= result.metrics.install_to_verified_handoff_ms);
  assert.equal(result.artifacts.usefulness_decision, 'ready-for-dogfood');
  assert.equal(result.artifacts.usefulness_score, '5/5');
  assert.equal(result.artifacts.handoff_present, true);
  assert.equal(result.resume.status, 'passed');
  assert.equal(result.resume.command, '/archon continue');
  assert.equal(result.rollback.status, 'exact');
  assert.equal(result.rollback.before_digest, beforeDigest);
  assert.equal(result.rollback.after_digest, beforeDigest);
  assert.equal(result.rollback.workspace_removed, true);
  assert.equal(result.artifacts.workspace, null);
  const limitations = result.limitations.join(' ');
  for (const phrase of ['not real plugin registration', '/do setup --express', 'does not execute an LLM task', 'not a multi-OS matrix', 'not human timing proof']) {
    assert(limitations.includes(phrase), `missing limitation: ${phrase}`);
  }
  const install = result.steps.find((step) => step.id === 'install').evidence.join(' ');
  assert(install.includes('registration_requested=false'));
  if (runtime === 'codex') assert(install.includes('plugin_refresh=skipped'));
}

function assertFailure(result, code) {
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failure, { code, recovery: RECOVERIES[code] });
  assert(Number.isFinite(result.metrics.total_ms) && result.metrics.total_ms >= 0);
  for (const key of ['install_to_route_ms', 'install_to_verified_handoff_ms']) {
    assert(result.metrics[key] === null || (Number.isFinite(result.metrics[key]) && result.metrics[key] >= 0));
  }
  assert.equal(result.rollback.status, 'exact');
  assert.equal(result.rollback.workspace_removed, true);
}

function testSuccessPaths() {
  const before = digestDirectory(FIXTURE_ROOT);
  for (const runtime of ['claude', 'codex']) {
    const result = run(runtime);
    assertSuccess(result, runtime, before);
    assert.equal(digestDirectory(FIXTURE_ROOT), before);
  }
}

function testRouteMismatch() {
  const temp = tempFixture();
  try {
    const value = JSON.parse(fs.readFileSync(temp.fixture, 'utf8'));
    value.expectedRoute = '/review';
    writeJson(temp.fixture, value);
    const before = digestDirectory(temp.fixtureRoot);
    const result = run('claude', temp.fixture);
    assertFailure(result, 'route_mismatch');
    assert.equal(result.metrics.install_to_route_ms, null);
    assert.equal(result.metrics.install_to_verified_handoff_ms, null);
    assert.equal(result.rollback.after_digest, before);
    assert.equal(digestDirectory(temp.fixtureRoot), before);
  } finally {
    fs.rmSync(temp.root, { recursive: true, force: true });
  }
}

function testVerificationFailure() {
  const temp = tempFixture();
  try {
    fs.writeFileSync(path.join(temp.fixtureRoot, 'project', 'verify.js'), "'use strict';\nprocess.exit(9);\n", 'utf8');
    const before = digestDirectory(temp.fixtureRoot);
    const result = run('claude', temp.fixture);
    assertFailure(result, 'verification_failed');
    assert(Number.isFinite(result.metrics.install_to_route_ms));
    assert.equal(result.metrics.install_to_verified_handoff_ms, null);
    assert.equal(result.rollback.after_digest, before);
  } finally {
    fs.rmSync(temp.root, { recursive: true, force: true });
  }
}

function testStrictFixtureValidation() {
  for (const mutation of [
    (value) => { value.unknown = true; },
    (value) => { value.projectDir = '../outside'; },
    (value) => { value.schema = 2; },
  ]) {
    const temp = tempFixture();
    try {
      const value = JSON.parse(fs.readFileSync(temp.fixture, 'utf8'));
      mutation(value);
      writeJson(temp.fixture, value);
      const result = run('claude', temp.fixture);
      assertFailure(result, 'fixture_invalid');
      assert.equal(result.metrics.install_to_route_ms, null);
      assert.equal(result.metrics.install_to_verified_handoff_ms, null);
    } finally {
      fs.rmSync(temp.root, { recursive: true, force: true });
    }
  }
}

function testFixtureSymlinkRejection() {
  assert.throws(
    () => assertNotSymlink({ isSymbolicLink: () => true }, 'unit-link'),
    (error) => error.code === 'fixture_invalid' && /symbolic links/.test(error.message),
  );

  const temp = tempFixture();
  const outside = path.join(temp.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside fixture\n');
  const link = path.join(temp.fixtureRoot, 'project', 'nested-link');
  try {
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
      return;
    }
    assert.throws(
      () => digestDirectory(temp.fixtureRoot),
      (error) => error.code === 'fixture_invalid' && /symbolic links/.test(error.message),
    );
    assertFailure(run('claude', temp.fixture), 'fixture_invalid');
  } finally {
    fs.rmSync(temp.root, { recursive: true, force: true });
  }
}

function testSanitization() {
  const secrets = [
    ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_'),
    ['github', 'pat', '11AAabcdefghijklmnopqrstuvwxyz123456'].join('_'),
    ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
    ['AK', 'IAABCDEFGHIJKLMNOP'].join(''),
    ['xoxb', '1234567890', 'abcdefghijklmnop'].join('-'),
  ];
  const input = [
    'GH_TOKEN GITHUB_TOKEN remain ordinary labels',
    '"password": "correct-horse-battery-staple"',
    "'api_key': 'private-value'",
    'Authorization: Bearer bearer-credential-value',
    '"authorization": "Bearer json-credential-value"',
    ...secrets,
  ].join('\n');
  const clean = sanitize(input);
  assert(clean.includes('GH_TOKEN GITHUB_TOKEN remain ordinary labels'));
  assert(clean.includes('"password": "[redacted]"'));
  assert(clean.includes("'api_key': '[redacted]'"));
  assert(clean.includes('"authorization": "[redacted]"'));
  assert(clean.includes('Authorization: Bearer [redacted]'));
  for (const secret of secrets) assert(!clean.includes(secret));
}

function testBoundedJsonParsing() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-golden-path-json-'));
  const script = path.join(temp, 'large-json.js');
  const secret = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
  try {
    fs.writeFileSync(script, `process.stdout.write(JSON.stringify({ secret: '${secret}', payload: 'x'.repeat(120000) }));\n`);
    const raw = runNode(script, [], { cwd: temp });
    assert(raw.stdout.length > 100000);
    const parsed = parseJson(raw, 'setup_failed', 'large JSON child');
    assert.equal(parsed.payload.length, 120000);
    const evidence = evidenceFor(raw).join('\n');
    assert(!evidence.includes(secret));
    assert(evidence.length < 3000);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function testCleanupAfterDigestFailure() {
  let removed = false;
  const result = { status: 'passed', failure: null, steps: [], rollback: {} };
  cleanup(result, {
    fixture: { fixtureRoot: 'fixture' },
    beforeDigest: 'before',
    tempRoot: 'temporary-workspace',
  }, false, {
    digestDirectory: () => { throw new Error('digest exploded'); },
    removeTemp: () => { removed = true; },
    exists: () => !removed,
  });
  assert.equal(removed, true);
  assert.equal(result.rollback.status, 'failed');
  assert.equal(result.rollback.workspace_removed, true);
  assert.deepEqual(result.failure, { code: 'rollback_failed', recovery: RECOVERIES.rollback_failed });
}

function testPluginStagingFilter() {
  const source = path.resolve('plugin-source');
  const staged = (relative) => shouldStagePluginPath(source, path.join(source, ...relative.split('/')));
  for (const relative of [
    '.env', '.env.local', 'nested/.env.production', '.claude/settings.local.json', '.claude/harness.json',
    '.claude/compact-state.json', '.claude/consent-session-release.json', '.claude/consent-onetime-push.json',
    '.claude/remote-attachments/item.json', '.codex/auth.json', '.planning/campaigns/private.md', '.git/config',
    '.npmrc', '.netrc', '.git-credentials', '.pypirc', '.vault-token', 'id_rsa', 'private.pem',
    '.aws/credentials', '.azure/accessTokens.json', '.config/gcloud/application_default_credentials.json',
    '.docker/config.json', '.kube/config',
  ]) assert.equal(staged(relative), false, `should not stage ${relative}`);
  for (const relative of [
    '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json', 'scripts/installer.js',
  ]) assert.equal(staged(relative), true, `should stage ${relative}`);
  assert.equal(isSafeStageEntry(source, path.join(source, 'linked'), () => ({ isSymbolicLink: () => true })), false);
}

function testKeepTemp() {
  const before = digestDirectory(FIXTURE_ROOT);
  const result = run('claude', FIXTURE, true);
  const workspace = result.artifacts.workspace;
  try {
    assert.equal(result.status, 'passed');
    assert.equal(result.rollback.status, 'retained');
    assert.equal(result.rollback.before_digest, before);
    assert.equal(result.rollback.after_digest, before);
    assert.equal(result.rollback.workspace_removed, false);
    assert(fs.existsSync(workspace));
  } finally {
    fs.rmSync(path.dirname(workspace), { recursive: true, force: true });
  }
}

function testOutputFile() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-golden-path-output-'));
  try {
    const output = path.join(temp, 'nested', 'result.json');
    const child = spawnSync(process.execPath, [
      path.join(__dirname, 'golden-path.js'), '--runtime', 'claude', '--fixture', path.join(temp, 'missing.json'),
      '--output', output, '--json',
    ], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 1);
    assert(fs.existsSync(output));
    const written = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(written.failure.code, 'fixture_invalid');
    assert.deepEqual(JSON.parse(child.stdout), written);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

testSuccessPaths();
testRouteMismatch();
testVerificationFailure();
testStrictFixtureValidation();
testFixtureSymlinkRejection();
testSanitization();
testBoundedJsonParsing();
testCleanupAfterDigestFailure();
testPluginStagingFilter();
testKeepTemp();
testOutputFile();
process.stdout.write('golden path fixture tests passed\n');
