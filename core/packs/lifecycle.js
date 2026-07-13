'use strict';

const fs = require('fs');
const path = require('path');
const { contentDigest, packFiles } = require('./digest');
const { assertDependencyGraph, inspectPack, verifyPack } = require('./index');
const { validateManifest } = require('./manifest');
const { realDirectory, resolveTarget } = require('../distribution/fs-safety');

const INDEX_RELATIVE = '.citadel/packs/index.json';

function readInstallIndex(projectRoot) {
  const file = path.join(projectRoot, INDEX_RELATIVE);
  if (!fs.existsSync(file)) return { schema_version: 1, packs: [] };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schema_version !== 1 || !Array.isArray(value.packs)) throw new Error('Invalid installed Pack index');
  return value;
}

function writeInstallIndex(projectRoot, value) {
  const file = resolveTarget(projectRoot, INDEX_RELATIVE, 'installed Pack index');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temp, file);
}

function cleanEmptyParents(start, stop) {
  let current = start;
  while (current !== stop && !path.relative(stop, current).startsWith('..') &&
      fs.existsSync(current) && fs.readdirSync(current).length === 0) {
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function installedDependencyEntries(projectRoot, index) {
  return index.packs.map((entry) => {
    const installedRoot = resolveTarget(projectRoot, entry.path, 'installed Pack dependency source');
    const manifestPath = resolveTarget(installedRoot, 'citadel.pack.json', 'installed Pack manifest');
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
      throw new Error(`Installed Pack manifest is missing: ${entry.id}@${entry.version}`);
    }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (error) { throw new Error(`Installed Pack manifest is invalid: ${entry.id}@${entry.version}: ${error.message}`); }
    const errors = validateManifest(manifest);
    if (errors.length) throw new Error(`Installed Pack manifest is invalid: ${entry.id}@${entry.version}: ${errors.join('; ')}`);
    if (manifest.id !== entry.id || manifest.version !== entry.version) {
      throw new Error(`Installed Pack identity does not match its index: ${entry.id}@${entry.version}`);
    }
    return { id: manifest.id, dependencies: [...manifest.dependencies] };
  });
}

function assertDestinationDependencies(projectRoot, index, pack) {
  const entries = installedDependencyEntries(projectRoot, index);
  entries.push({ id: pack.id, dependencies: [...pack.dependencies] });
  assertDependencyGraph(entries);
  return entries;
}

function installPack(packRoot, projectRoot, options = {}) {
  const root = realDirectory(projectRoot);
  const verification = verifyPack(packRoot, { projectRoot: options.sourceProjectRoot, runtime: options.runtime,
    expectedDigest: options.expectedDigest });
  if (verification.status !== 'passed') throw new Error(`Pack verification failed: ${verification.errors.join('; ')}`);
  const pack = verification.pack;
  const index = readInstallIndex(root);
  if (index.packs.some((entry) => entry.id === pack.id && entry.version === pack.version)) {
    throw new Error(`Installed Pack index already contains: ${pack.id}@${pack.version}`);
  }
  assertDestinationDependencies(root, index, pack);
  const relative = `.citadel/packs/${pack.publisher.id}/${pack.name}/${pack.version}`;
  const target = resolveTarget(root, relative, 'Pack install target');
  if (fs.existsSync(target)) throw new Error(`Pack is already installed: ${pack.id}@${pack.version}`);

  const { root: source, files } = packFiles(packRoot);
  fs.mkdirSync(target, { recursive: true });
  try {
    for (const file of files) {
      const rel = path.relative(source, file);
      const destination = resolveTarget(target, rel, 'Pack content target');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
    }
    const installedDigest = contentDigest(target).digest;
    if (installedDigest !== pack.digest.digest) throw new Error('Installed Pack digest mismatch');
    index.packs.push({ id: pack.id, version: pack.version, runtime: options.runtime || null,
      digest: pack.digest.digest, path: relative, dependencies: [...pack.dependencies] });
    index.packs.sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
    writeInstallIndex(root, index);
    return index.packs.find((entry) => entry.id === pack.id && entry.version === pack.version);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    cleanEmptyParents(path.dirname(target), root);
    throw error;
  }
}

function uninstallPack(projectRoot, id, options = {}) {
  const root = realDirectory(projectRoot);
  const index = readInstallIndex(root);
  const matches = index.packs.filter((entry) => entry.id === id && (!options.version || entry.version === options.version));
  if (matches.length === 0) throw new Error(`Pack is not installed: ${id}${options.version ? `@${options.version}` : ''}`);
  if (matches.length > 1) throw new Error(`Multiple Pack versions installed; specify --version for ${id}`);
  const entry = matches[0];
  const target = resolveTarget(root, entry.path, 'installed Pack');
  if (!fs.existsSync(target)) throw new Error(`Installed Pack path is missing: ${entry.path}`);
  const actual = contentDigest(target).digest;
  if (actual !== entry.digest && !options.force) throw new Error('Installed Pack was modified; refusing uninstall without force');
  fs.rmSync(target, { recursive: true });
  index.packs = index.packs.filter((candidate) => candidate !== entry);
  if (index.packs.length) writeInstallIndex(root, index);
  else {
    const indexPath = resolveTarget(root, INDEX_RELATIVE, 'installed Pack index');
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
    cleanEmptyParents(path.dirname(indexPath), root);
  }
  cleanEmptyParents(path.dirname(target), root);
  return entry;
}

module.exports = Object.freeze({
  INDEX_RELATIVE, assertDestinationDependencies, installPack, installedDependencyEntries,
  readInstallIndex, uninstallPack,
});
