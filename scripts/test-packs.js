#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { contentDigest } = require('../core/packs/digest');
const { assertDependencyGraph, buildPackIndex, certifyPack, inspectPack, verifyPack } = require('../core/packs');
const { installPack, readInstallIndex, uninstallPack } = require('../core/packs/lifecycle');
const { validateManifest } = require('../core/packs/manifest');
const { parseArgs } = require('./packs');

const ROOT = path.resolve(__dirname, '..');
const CI_PACK = path.join(ROOT, 'packs', 'ci-recovery');
let passed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

function tempDir(prefix = 'citadel-pack-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTemp(fn) {
  const root = tempDir();
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function copyPack(targetRoot, source = CI_PACK) {
  const target = path.join(targetRoot, 'pack');
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

test('all three first-party Pack manifests and workflows verify', () => {
  const index = buildPackIndex(ROOT);
  assert.deepEqual(index.packs.map((pack) => pack.id), [
    'citadel/ci-recovery', 'citadel/migration-campaign', 'citadel/release-steward',
  ]);
  for (const pack of index.packs) {
    assert.match(pack.digest.digest, /^[a-f0-9]{64}$/);
    assert.equal(verifyPack(path.join(ROOT, pack.path), { projectRoot: ROOT, runtime: 'codex' }).status, 'passed');
  }
});

test('CLI argument parser supports subjectless and subject commands', () => {
  const listed = parseArgs(['node', 'packs.js', 'list', '--root', ROOT, '--json']);
  assert.equal(listed.subject, null);
  assert.equal(listed.root, ROOT);
  assert.equal(listed.json, true);
  const verified = parseArgs(['node', 'packs.js', 'verify', 'ci-recovery', '--runtime', 'codex']);
  assert.equal(verified.subject, 'ci-recovery');
  assert.equal(verified.runtime, 'codex');
});

test('manifest schema rejects unknown fields', () => {
  const manifest = readJson(path.join(CI_PACK, 'citadel.pack.json'));
  manifest.surprise = true;
  assert(validateManifest(manifest).some((error) => error.includes('unknown field: surprise')));
});

test('manifest schema rejects invalid permissions', () => {
  const manifest = readJson(path.join(CI_PACK, 'citadel.pack.json'));
  manifest.permissions.network = 'unrestricted';
  assert(validateManifest(manifest).some((error) => error.includes('permissions.network')));
});

test('entry workflow traversal is rejected', () => withTemp((temp) => {
  const pack = copyPack(temp);
  const file = path.join(pack, 'citadel.pack.json');
  const manifest = readJson(file);
  manifest.entry_workflow = '../outside.json';
  writeJson(file, manifest);
  assert.throws(() => inspectPack(pack, { projectRoot: ROOT }), /traversal|escapes/);
}));

test('missing composed skills are rejected', () => withTemp((temp) => {
  const pack = copyPack(temp);
  const file = path.join(pack, 'citadel.pack.json');
  const manifest = readJson(file);
  manifest.skills.push('missing-skill');
  writeJson(file, manifest);
  assert.throws(() => inspectPack(pack, { projectRoot: ROOT }), /Pack skill not found: missing-skill/);
}));

test('workflow cycles are rejected', () => withTemp((temp) => {
  const pack = copyPack(temp);
  const file = path.join(pack, 'workflows', 'ci-recovery.json');
  const workflow = readJson(file);
  workflow.steps[0].depends_on = ['handoff'];
  writeJson(file, workflow);
  assert.throws(() => inspectPack(pack, { projectRoot: ROOT }), /dependency cycle/);
}));

test('Pack dependency cycles and missing dependencies are rejected', () => {
  const one = { id: 'test/one', dependencies: ['test/two'] };
  const two = { id: 'test/two', dependencies: ['test/one'] };
  assert.throws(() => assertDependencyGraph([one, two]), /dependency cycle/);
  assert.throws(() => assertDependencyGraph([{ id: 'test/one', dependencies: ['test/missing'] }]), /missing dependency/);
});

test('content digest is deterministic and detects tampering', () => withTemp((temp) => {
  const pack = copyPack(temp);
  const before = contentDigest(pack);
  assert.deepEqual(before, contentDigest(pack));
  fs.appendFileSync(path.join(pack, 'workflows', 'ci-recovery.json'), '\n');
  const after = contentDigest(pack);
  assert.notEqual(after.digest, before.digest);
  const result = verifyPack(pack, { projectRoot: ROOT, expectedDigest: before.digest });
  assert.equal(result.status, 'failed');
  assert(result.errors.includes('Pack content digest mismatch'));
}));

test('runtime mismatch fails verification', () => {
  const result = verifyPack(CI_PACK, { projectRoot: ROOT, runtime: 'gemini-cli' });
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /does not support runtime/);
});

test('certification never upgrades unexecuted verification to passed', () => {
  const unknown = certifyPack(CI_PACK, { projectRoot: ROOT, runtime: 'codex' });
  assert.equal(unknown.status, 'unknown');
  assert(unknown.checks.filter((check) => check.id.startsWith('verification:'))
    .every((check) => check.checked === false && check.status === 'unknown'));
  const passedReceipt = certifyPack(CI_PACK, { projectRoot: ROOT, runtime: 'codex', verificationResults: {
    'focused-check': { status: 'passed' },
    'regression-check': { status: 'passed' },
  } });
  assert.equal(passedReceipt.status, 'passed');
  const failedReceipt = certifyPack(CI_PACK, { projectRoot: ROOT, runtime: 'codex', verificationResults: {
    'focused-check': { status: 'failed', detail: 'focused test failed' },
    'regression-check': { status: 'passed' },
  } });
  assert.equal(failedReceipt.status, 'failed');
});

test('install and uninstall preserve digest and leave no residue', () => withTemp((project) => {
  const installed = installPack(CI_PACK, project, { sourceProjectRoot: ROOT, runtime: 'codex' });
  assert.equal(installed.id, 'citadel/ci-recovery');
  assert.equal(readInstallIndex(project).packs.length, 1);
  const target = path.join(project, installed.path);
  assert.equal(contentDigest(target).digest, contentDigest(CI_PACK).digest);
  uninstallPack(project, installed.id);
  assert.equal(fs.existsSync(path.join(project, '.citadel')), false);
}));

test('install rejects missing destination dependencies before copying files', () => withTemp((temp) => {
  const project = path.join(temp, 'project');
  fs.mkdirSync(project);
  const pack = copyPack(temp);
  const manifestPath = path.join(pack, 'citadel.pack.json');
  const manifest = readJson(manifestPath);
  manifest.dependencies = ['test/missing'];
  writeJson(manifestPath, manifest);
  assert.throws(() => installPack(pack, project, { sourceProjectRoot: ROOT, runtime: 'codex' }),
    /missing dependency: test\/missing/);
  assert.equal(fs.existsSync(path.join(project, '.citadel')), false,
    'dependency rejection must happen before destination creation');
}));

test('install rejects destination dependency cycles before copying files', () => withTemp((temp) => {
  const project = path.join(temp, 'project');
  const installedPath = '.citadel/packs/test/base/0.1.0';
  const installedRoot = path.join(project, installedPath);
  fs.mkdirSync(installedRoot, { recursive: true });
  const installedManifest = readJson(path.join(CI_PACK, 'citadel.pack.json'));
  installedManifest.id = 'test/base';
  installedManifest.name = 'base';
  installedManifest.publisher = { id: 'test', name: 'Test Publisher' };
  installedManifest.dependencies = ['citadel/ci-recovery'];
  writeJson(path.join(installedRoot, 'citadel.pack.json'), installedManifest);
  const indexPath = path.join(project, '.citadel', 'packs', 'index.json');
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  writeJson(indexPath, { schema_version: 1, packs: [{
    id: 'test/base', version: '0.1.0', runtime: 'codex', digest: 'fixture', path: installedPath,
  }] });

  const pack = copyPack(temp);
  const candidateManifestPath = path.join(pack, 'citadel.pack.json');
  const candidateManifest = readJson(candidateManifestPath);
  candidateManifest.dependencies = ['test/base'];
  writeJson(candidateManifestPath, candidateManifest);
  assert.throws(() => installPack(pack, project, { sourceProjectRoot: ROOT, runtime: 'codex' }),
    /dependency cycle/);
  assert.equal(fs.existsSync(path.join(project, '.citadel', 'packs', 'citadel')), false,
    'cycle rejection must happen before candidate destination creation');
}));

test('uninstall refuses modified content unless forced', () => withTemp((project) => {
  const installed = installPack(CI_PACK, project, { sourceProjectRoot: ROOT, runtime: 'claude-code' });
  fs.appendFileSync(path.join(project, installed.path, 'workflows', 'ci-recovery.json'), '\n');
  assert.throws(() => uninstallPack(project, installed.id), /modified/);
  uninstallPack(project, installed.id, { force: true });
  assert.equal(fs.existsSync(path.join(project, '.citadel')), false);
}));

test('Pack source symlinks are rejected when the platform permits them', () => withTemp((temp) => {
  const pack = copyPack(temp);
  const link = path.join(pack, 'linked.json');
  try {
    fs.symlinkSync(path.join(pack, 'citadel.pack.json'), link, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      skipped += 1;
      process.stdout.write('SKIP symlink creation unavailable on this platform\n');
      return;
    }
    throw error;
  }
  assert.throws(() => contentDigest(pack), /symlink/);
}));

test('symlinked destination segments are rejected when the platform permits them', () => withTemp((temp) => {
  const project = path.join(temp, 'project');
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, path.join(project, '.citadel'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      skipped += 1;
      process.stdout.write('SKIP destination symlink creation unavailable on this platform\n');
      return;
    }
    throw error;
  }
  assert.throws(() => installPack(CI_PACK, project, { sourceProjectRoot: ROOT, runtime: 'codex' }), /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
}));

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`Pack foundation: ${passed} passed, ${skipped} skipped\n`);
