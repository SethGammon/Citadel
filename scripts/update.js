#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { parseTar, verifyRelease } = require('./release-verify');

const ROOT = path.resolve(__dirname, '..');
const PRESERVE = new Set(['.git', '.planning']);

function arg(name, fallback = null) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function readVersion(directory) {
  try {
    return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).version;
  } catch {
    return 'unknown';
  }
}

function safeTarget(input) {
  const target = path.resolve(input);
  const parsed = path.parse(target);
  if (target === parsed.root || target === os.homedir()) throw new Error(`Refusing unsafe update target: ${target}`);
  const packagePath = path.join(target, 'package.json');
  if (!fs.existsSync(packagePath)) throw new Error(`Update target has no package.json: ${target}`);
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, ''));
  if (pkg.name !== 'citadel') throw new Error(`Update target is not a Citadel installation: ${target}`);
  return target;
}

function copyTree(source, target, exclusions = new Set()) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (exclusions.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function clearCode(target) {
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (PRESERVE.has(entry.name)) continue;
    fs.rmSync(path.join(target, entry.name), { recursive: true, force: true });
  }
}

function extractArchive(archivePath, destination) {
  const files = parseTar(zlib.gunzipSync(fs.readFileSync(archivePath)));
  const root = [...new Set([...files.keys()].map((name) => name.split('/')[0]))];
  if (root.length !== 1) throw new Error('Update archive must contain one root directory');
  for (const [name, data] of files) {
    const relative = name.slice(root[0].length + 1);
    if (!relative || relative === '.citadel-release.json') continue;
    const output = path.resolve(destination, ...relative.split('/'));
    if (!output.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error(`Unsafe update path: ${relative}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, data);
  }
}

function updatePlan({ target, archivePath, rollbackPath }) {
  const currentVersion = readVersion(target);
  if (rollbackPath) {
    const rollback = path.resolve(rollbackPath);
    if (!fs.existsSync(rollback)) throw new Error(`Rollback target does not exist: ${rollback}`);
    return {
      action: 'rollback',
      target,
      currentVersion,
      rollbackTarget: rollback,
      rollbackVersion: readVersion(rollback),
      applyRequired: true,
    };
  }
  if (!archivePath) throw new Error('Pass --archive <release.tar.gz> for an update, or --rollback <backup-path>');
  const verified = verifyRelease(path.resolve(archivePath));
  const backupRoot = path.join(path.dirname(target), '.citadel-backups');
  const backupName = `${path.basename(target)}-${currentVersion}-before-${verified.version}-${verified.commit.slice(0, 12)}`;
  const backupPath = path.join(backupRoot, backupName);
  return {
    action: 'update',
    target,
    currentVersion,
    targetVersion: verified.version,
    archive: verified.archivePath,
    archiveSha256: verified.sha256,
    backupPath,
    rollbackCommand: `node scripts/update.js --rollback "${backupPath}" --target "${target}" --apply`,
    applyRequired: true,
  };
}

function applyPlan(plan) {
  if (plan.action === 'rollback') {
    clearCode(plan.target);
    copyTree(plan.rollbackTarget, plan.target);
    return;
  }
  if (fs.existsSync(plan.backupPath)) throw new Error(`Backup already exists: ${plan.backupPath}`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-update-'));
  try {
    extractArchive(plan.archive, stage);
    fs.mkdirSync(path.dirname(plan.backupPath), { recursive: true });
    copyTree(plan.target, plan.backupPath, PRESERVE);
    try {
      clearCode(plan.target);
      copyTree(stage, plan.target);
    } catch (error) {
      clearCode(plan.target);
      copyTree(plan.backupPath, plan.target);
      throw error;
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage:
  node scripts/update.js --archive <release.tar.gz> [--target PATH] [--apply]
  node scripts/update.js --rollback <backup-path> --target PATH [--apply]

The default is a read-only plan. Nothing changes unless --apply is present.`);
    return;
  }
  const target = safeTarget(arg('--target', ROOT));
  const plan = updatePlan({ target, archivePath: arg('--archive'), rollbackPath: arg('--rollback') });
  const apply = process.argv.includes('--apply');
  if (apply) applyPlan(plan);
  console.log(JSON.stringify({ ...plan, applied: apply }, null, 2));
}

module.exports = { applyPlan, updatePlan };
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`update failed: ${error.message}`);
    process.exit(1);
  }
}
