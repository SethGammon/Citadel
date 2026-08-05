#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const cli = require('../core/cli/package-cli');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'citadel.js');

function invoke(args, cwd = ROOT) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function invokeInstalled(packageRoot, args, cwd) {
  return spawnSync(process.execPath, [path.join(packageRoot, 'bin', 'citadel.js'), ...args], {
    cwd, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
}

function installedRuntimeSmoke(packageRoot, scratchRoot) {
  const installedManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const run = (args) => invokeInstalled(packageRoot, args, scratchRoot);
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert(help.stdout.includes('Citadel'));

  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), installedManifest.version);

  const packList = run(['pack', 'list', '--root', packageRoot, '--json']);
  assert.equal(packList.status, 0, packList.stderr);
  assert.deepEqual(
    JSON.parse(packList.stdout).packs.map((pack) => pack.id).sort(),
    ['citadel/ci-recovery', 'citadel/migration-campaign', 'citadel/release-steward'],
  );

  const configRoot = path.join(scratchRoot, 'config-smoke');
  fs.mkdirSync(configRoot, { recursive: true });
  const config = run(['config', 'show', '--project-root', configRoot, '--runtime', 'codex', '--json']);
  assert.equal(config.status, 0, config.stderr);
  const configReport = JSON.parse(config.stdout);
  assert.equal(configReport.status, 'ready');
  assert.equal(configReport.package.version, installedManifest.version);

  const operation = run([
    'operation', 'explain',
    '--request', path.join(packageRoot, 'examples', 'operation-control', 'request.json'),
    '--catalog', path.join(packageRoot, 'examples', 'operation-control', 'catalog.json'),
    '--json',
  ]);
  assert.equal(operation.status, 0, operation.stderr);
  assert.equal(JSON.parse(operation.stdout).selection_status, 'meets-quality-target');

  const controlPlane = run(['control-plane', 'conformance']);
  assert.equal(controlPlane.status, 0, controlPlane.stderr);
  const controlReport = JSON.parse(controlPlane.stdout);
  assert.equal(controlReport.status, 'passed');
  assert(controlReport.check_count >= 20, 'installed control-plane conformance must exercise the full offline contract');

  return {
    surfaces: ['root-help', 'version', 'pack-list', 'config-show', 'operation-explain', 'control-plane-conformance'],
    controlPlaneChecks: controlReport.check_count,
  };
}

const installedPackageFlag = process.argv.indexOf('--installed-package-root');
if (installedPackageFlag >= 0) {
  try {
    const packageRoot = path.resolve(process.argv[installedPackageFlag + 1] || '');
    const scratchRoot = path.resolve(process.argv[installedPackageFlag + 2] || process.cwd());
    const report = installedRuntimeSmoke(packageRoot, scratchRoot);
    process.stdout.write(`${JSON.stringify({ status: 'passed', ...report })}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Installed CLI package smoke failed: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}

function tarEntries(buffer) {
  const result = [];
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join('/');
    const mode = Number.parseInt(text(100, 8).trim() || '0', 8);
    const size = Number.parseInt(text(124, 12).trim() || '0', 8);
    result.push({ name, mode, size });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}

function captureIo() {
  const output = { stdout: '', stderr: '' };
  return {
    output,
    io: {
      stdout: { write: (value) => { output.stdout += value; } },
      stderr: { write: (value) => { output.stderr += value; } },
    },
  };
}

const manifest = require('../package.json');
assert.deepEqual(manifest.bin, { citadel: 'bin/citadel.js' });
assert(manifest.files.includes('bin/'));
assert(manifest.files.includes('core/'));
assert(manifest.files.includes('.planning/_templates/'));
assert(!manifest.files.includes('.planning/'), 'operational planning state must not be published wholesale');
for (const ignoreFile of ['docs/.npmignore', 'skills/.npmignore', 'packages/.npmignore']) {
  assert(fs.existsSync(path.join(ROOT, ignoreFile)), `package profile missing ${ignoreFile}`);
}

const markerFreeFs = { existsSync: () => false };
assert.deepEqual(cli.detectRuntime(['--runtime', 'claude']), { runtime: 'claude', source: 'argument' });
assert.deepEqual(cli.detectRuntime([], { env: { CITADEL_RUNTIME: 'codex' } }), { runtime: 'codex', source: 'environment' });
assert.deepEqual(cli.detectRuntime([], { env: {}, fsImpl: markerFreeFs, probe: (command) => command === 'claude' }), { runtime: 'claude', source: 'command' });
assert.throws(() => cli.detectRuntime([], { env: {}, fsImpl: markerFreeFs, probe: () => true }), (error) => error.code === cli.CODE.RUNTIME_AMBIGUOUS);
assert.throws(() => cli.detectRuntime([], { env: {}, fsImpl: markerFreeFs, probe: () => false }), (error) => error.code === cli.CODE.RUNTIME_NOT_FOUND);

const markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-cli-marker-'));
fs.mkdirSync(path.join(markerRoot, '.codex'));
assert.deepEqual(cli.detectRuntime(['--project-root', markerRoot], { env: {}, probe: () => false }), { runtime: 'codex', source: 'project-marker' });

const help = invoke(['--help']);
assert.equal(help.status, 0, help.stderr);
for (const command of [
  'install', 'doctor', 'update', 'rollback', 'uninstall', 'pack', 'journey',
  'receipt', 'fork', 'adopt', 'config', 'governance',
  'control-plane', 'trial',
  'memory', 'operation',
]) {
  assert(help.stdout.includes(command), `root help missing ${command}`);
}

const packList = invoke(['pack', 'list', '--json']);
assert.equal(packList.status, 0, packList.stderr);
assert.equal(JSON.parse(packList.stdout).packs.length, 3);
assert.equal(invoke(['receipt', '--help']).status, 0);
assert.equal(invoke(['journey', '--help']).status, 0);
assert.equal(invoke(['fork', '--help']).status, 0);
assert.equal(invoke(['adopt', '--help']).status, 0);
assert.equal(invoke(['config', '--help']).status, 0);
assert.equal(invoke(['governance', '--help']).status, 0);
assert.equal(invoke(['control-plane', '--help']).status, 0);
assert.equal(invoke(['trial', '--help']).status, 0);
assert.equal(invoke(['memory', '--help']).status, 0);
assert.equal(invoke(['operation', '--help']).status, 0);

const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-cli-install & literal-'));
const install = invoke(['install', '--runtime', 'codex', '--project-root', installRoot, '--plugin-only', '--dry-run', '--json']);
assert.equal(install.status, 0, install.stderr);
const installReport = JSON.parse(install.stdout);
assert.equal(path.resolve(installReport.projectRoot), path.resolve(installRoot));
assert.equal(installReport.mode, 'plugin-only');
assert(installReport.steps.every((step) => step.skipped), 'dry-run installer must not execute a step');

const autoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-cli-auto-'));
fs.mkdirSync(path.join(autoRoot, '.codex'));
const automatic = invoke(['install', '--project-root', autoRoot, '--plugin-only', '--dry-run', '--json']);
assert.equal(automatic.status, 0, automatic.stderr);
assert.equal(JSON.parse(automatic.stdout).mode, 'plugin-only');

const uninstallRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-cli-uninstall-'));
fs.mkdirSync(path.join(uninstallRoot, '.planning'));
const uninstallPlan = invoke(['uninstall', uninstallRoot, '--dry-run', '--json']);
assert.equal(uninstallPlan.status, 2, uninstallPlan.stderr);
const leavePlan = JSON.parse(uninstallPlan.stdout);
assert.equal(leavePlan.operation, 'leave');
assert.equal(leavePlan.status, 'blocked');
assert(leavePlan.blockers.some((entry) => entry.code === 'NOT_ADOPTED'));
assert(fs.existsSync(path.join(uninstallRoot, '.planning')), 'dry-run uninstall must not mutate project');
const legacyUpdate = invoke([
  'update', '--archive', path.join(uninstallRoot, 'legacy-release.tar.gz'),
  '--target', uninstallRoot, '--apply', '--json',
]);
assert.equal(legacyUpdate.status, 64);
assert.match(JSON.parse(legacyUpdate.stdout).message, /receipt-owned/);
const legacyRollback = invoke([
  'rollback', path.join(uninstallRoot, 'legacy-backup'),
  '--target', uninstallRoot, '--apply', '--json',
]);
assert.equal(legacyRollback.status, 64);
assert.match(JSON.parse(legacyRollback.stdout).message, /receipt-owned/);

const doctorCapture = captureIo();
const doctor = cli.doctorReport(['--runtime', 'codex'], { env: {}, probe: () => false });
assert(doctor.checks.some((check) => check.name === 'runtime-selection' && check.pass && check.runtime === 'codex'));
assert(doctor.checks.some((check) => check.name === 'runtime-command' && !check.pass));
assert.equal(doctor.pass, false);
assert.equal(cli.main(['pack', 'list', '--json'], { io: doctorCapture.io, cwd: ROOT }), cli.EXIT.OK);
assert.equal(JSON.parse(doctorCapture.output.stdout).packs.length, 3);

const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-npm-pack-'));
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmEnvironment = { ...process.env, npm_config_cache: path.join(packRoot, 'npm-cache') };
const packed = fs.existsSync(npmCli)
  ? spawnSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', packRoot], {
    cwd: ROOT, env: npmEnvironment, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
  : spawnSync('npm', ['pack', '--json', '--pack-destination', packRoot], {
    cwd: ROOT, env: npmEnvironment, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
assert.equal(packed.status, 0, packed.stderr);
const packedInfo = JSON.parse(packed.stdout);
const archive = path.join(packRoot, packedInfo[0].filename);
const entries = tarEntries(zlib.gunzipSync(fs.readFileSync(archive)));
const names = new Set(entries.map((entry) => entry.name));
for (const required of [
  'package/bin/citadel.js', 'package/core/cli/package-cli.js', 'package/scripts/install.js',
  'package/core/forks/index.js', 'package/scripts/operation-fork.js',
  'package/core/adoption/index.js', 'package/scripts/adopt.js',
  'package/core/config/index.js', 'package/scripts/citadel-config.js',
  'package/core/governance/index.js', 'package/scripts/governance-gate.js',
  'package/core/control-plane/index.js', 'package/scripts/control-plane-stdio.js',
  'package/core/memory/repository-store.js', 'package/scripts/repository-memory.js',
  'package/core/product-proof/index.js', 'package/scripts/product-proof-trial.js',
  'package/core/operation-controller/index.js', 'package/scripts/operation.js',
  'package/scripts/operation-runtime-adapter.js',
  'package/examples/operation-control/request.json',
  'package/schemas/harness-config-v2.schema.json',
  'package/skills/unharness/SKILL.md',
  'package/skills/do/SKILL.md', 'package/.planning/_templates/campaign.md',
]) assert(names.has(required), `packed archive missing ${required}`);
for (const forbidden of [
  'package/.github/workflows/release.yml',
  'package/.planning/campaigns/citadel-product-proof.md',
  'package/.planning/research/twelve-month-unlocks/product-growth-audit.md',
]) assert(!names.has(forbidden), `packed archive leaked ${forbidden}`);
for (const entry of entries) {
  const packedPath = entry.name.replace(/^package\//, '');
  assert(!packedPath.startsWith('docs/images/'), `packed archive leaked site screenshot ${packedPath}`);
  assert(!/^skills\/[^/]+\/__benchmarks__\//.test(packedPath), `packed archive leaked skill benchmark ${packedPath}`);
  assert(!packedPath.startsWith('packages/client/'), `packed archive leaked private client workspace ${packedPath}`);
  assert(!packedPath.startsWith('packages/runtime-openai/'), `packed archive leaked private OpenAI runtime workspace ${packedPath}`);
  assert(!packedPath.startsWith('packages/runtime-claude-code/'), `packed archive leaked private Claude runtime workspace ${packedPath}`);
  assert(!packedPath.endsWith('.npmignore'), `packed archive leaked ignore control ${packedPath}`);
}
for (const requiredTest of [
  'test-experiment-contracts.js',
  'test-experiment-operation-recovery.js',
  'test-experiment-safety-gates.js',
  'test-experiment-judge-eval.js',
  'test-experiment-fleet-ablation.js',
  'test-experiment-deploy-steward.js',
  'test-experiment-package-bloat.js',
]) {
  assert(names.has(`package/scripts/${requiredTest}`), `packed archive lost experiment regression test ${requiredTest}`);
}
const binEntry = entries.find((entry) => entry.name === 'package/bin/citadel.js');
assert(binEntry.size > 0, 'npm tarball CLI entrypoint must contain executable code');

const installedRoot = path.join(packRoot, 'installed');
const installPacked = fs.existsSync(npmCli)
  ? spawnSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', installedRoot, archive], {
    cwd: packRoot, env: npmEnvironment, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
  : spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', installedRoot, archive], {
    cwd: packRoot, env: npmEnvironment, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
assert.equal(installPacked.status, 0, installPacked.stderr);
const installedBin = path.join(installedRoot, 'node_modules', 'citadel', 'bin', 'citadel.js');
const shim = path.join(installedRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'citadel.cmd' : 'citadel');
assert(fs.existsSync(shim), 'package install must create the citadel executable shim');
if (process.platform !== 'win32') assert(fs.statSync(shim).mode & 0o111, 'installed citadel shim must be executable');
assert(fs.existsSync(installedBin), 'installed Citadel package root must contain the CLI entrypoint');
const installedSmoke = installedRuntimeSmoke(path.dirname(path.dirname(installedBin)), packRoot);
assert.equal(installedSmoke.surfaces.length, 6);

for (const directory of [markerRoot, installRoot, autoRoot, uninstallRoot, packRoot]) {
  fs.rmSync(directory, { recursive: true, force: true });
}

process.stdout.write('CLI package tests passed.\n');
