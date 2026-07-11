#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildRelease, sha256 } = require('./release-package');
const { verifyRelease } = require('./release-verify');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeSource(root, version = '1.1.0') {
  writeJson(path.join(root, 'package.json'), { name: 'citadel', version, engines: { node: '>=18' } });
  writeJson(path.join(root, '.claude-plugin', 'plugin.json'), { name: 'citadel', version });
  writeJson(path.join(root, '.claude-plugin', 'marketplace.json'), { plugins: [{ name: 'citadel', version }] });
  writeJson(path.join(root, '.codex-plugin', 'plugin.json'), { name: 'citadel', version });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'hello.js'), "console.log('citadel');\n");
}

function expectFailure(fn, pattern) {
  assert.throws(fn, pattern);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-release-integrity-'));
try {
  const source = path.join(temp, 'source');
  makeSource(source);
  fs.mkdirSync(path.join(source, '.planning', '_templates'), { recursive: true });
  fs.mkdirSync(path.join(source, '.planning', 'campaigns'), { recursive: true });
  fs.writeFileSync(path.join(source, '.planning', '_templates', 'campaign.md'), 'distributable\n');
  fs.writeFileSync(path.join(source, '.planning', 'campaigns', 'private.md'), 'operational state\n');
  execFileSync('git', ['init'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Citadel Release Test'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'release fixture'], {
    cwd: source,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
  });
  execFileSync('git', ['tag', 'v1.1.0'], { cwd: source, stdio: 'pipe' });
  const first = buildRelease({ sourceDir: source, outputDir: path.join(temp, 'one') });
  const second = buildRelease({ sourceDir: source, outputDir: path.join(temp, 'two') });
  assert.equal(first.sha256, second.sha256, 'same source must produce identical archives');
  assert.equal(fs.readFileSync(first.manifestPath, 'utf8'), fs.readFileSync(second.manifestPath, 'utf8'));

  const verified = verifyRelease(first.archivePath, { version: '1.1.0', ref: first.manifest.ref });
  assert.equal(verified.version, '1.1.0');
  assert(verified.files >= 5);
  assert(first.manifest.files.some((file) => file.path === '.planning/_templates/campaign.md'));
  assert(!first.manifest.files.some((file) => file.path === '.planning/campaigns/private.md'));
  const tagged = buildRelease({ sourceDir: source, ref: 'v1.1.0', outputDir: path.join(temp, 'tagged') });
  assert.equal(verifyRelease(tagged.archivePath, { version: '1.1.0', ref: 'v1.1.0' }).ref, 'v1.1.0');
  execFileSync('git', ['tag', 'v9.9.9'], { cwd: source, stdio: 'pipe' });
  expectFailure(() => buildRelease({ sourceDir: source, ref: 'v9.9.9', outputDir: path.join(temp, 'bad-tag') }), /does not match manifest version/);
  expectFailure(() => verifyRelease(first.archivePath, { version: '9.9.9' }), /Expected version/);
  expectFailure(() => verifyRelease(first.archivePath, { ref: 'v9.9.9' }), /Expected ref/);

  const originalChecksum = fs.readFileSync(first.checksumPath);
  fs.writeFileSync(first.checksumPath, `${'0'.repeat(64)}  ${path.basename(first.archivePath)}\n`);
  expectFailure(() => verifyRelease(first.archivePath), /sidecar mismatch/);
  fs.writeFileSync(first.checksumPath, originalChecksum);

  const originalArchive = fs.readFileSync(first.archivePath);
  const corrupted = Buffer.from(originalArchive);
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  fs.writeFileSync(first.archivePath, corrupted);
  const corruptHash = sha256(corrupted);
  fs.writeFileSync(first.checksumPath, `${corruptHash}  ${path.basename(first.archivePath)}\n`);
  const external = JSON.parse(fs.readFileSync(first.manifestPath, 'utf8'));
  external.artifact.sha256 = corruptHash;
  external.artifact.bytes = corrupted.length;
  fs.writeFileSync(first.manifestPath, `${JSON.stringify(external, null, 2)}\n`);
  expectFailure(() => verifyRelease(first.archivePath), /Invalid gzip|tar header|checksum mismatch|Truncated/);

  const updateRelease = buildRelease({ sourceDir: source, outputDir: path.join(temp, 'update-release') });
  const target = path.join(temp, 'installed-citadel');
  makeSource(target, '1.0.0');
  fs.writeFileSync(path.join(target, 'old-only.txt'), 'old\n');
  const updateScript = path.resolve(__dirname, 'update.js');
  const plan = JSON.parse(execFileSync(process.execPath, [updateScript, '--archive', updateRelease.archivePath, '--target', target], { encoding: 'utf8' }));
  assert.equal(plan.applied, false);
  assert.equal(readVersion(target), '1.0.0');
  assert(fs.existsSync(path.join(target, 'old-only.txt')), 'plan-only update must not mutate target');

  const applied = JSON.parse(execFileSync(process.execPath, [updateScript, '--archive', updateRelease.archivePath, '--target', target, '--apply'], { encoding: 'utf8' }));
  assert.equal(applied.applied, true);
  assert.equal(readVersion(target), '1.1.0');
  assert(!fs.existsSync(path.join(target, 'old-only.txt')), 'apply should replace stale release files');
  assert(fs.existsSync(applied.backupPath));

  const rollbackPlan = JSON.parse(execFileSync(process.execPath, [updateScript, '--rollback', applied.backupPath, '--target', target], { encoding: 'utf8' }));
  assert.equal(rollbackPlan.applied, false);
  assert.equal(readVersion(target), '1.1.0');
  execFileSync(process.execPath, [updateScript, '--rollback', applied.backupPath, '--target', target, '--apply'], { stdio: 'pipe' });
  assert.equal(readVersion(target), '1.0.0');
  assert(fs.existsSync(path.join(target, 'old-only.txt')), 'rollback should restore prior release files');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('release integrity tests passed');

function readVersion(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
}
