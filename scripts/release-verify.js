#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { MANIFEST_NAME, sha256 } = require('./release-package');

function arg(name, fallback = null) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function parseOctal(buffer, offset, length) {
  const text = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function parseTar(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const expected = parseOctal(header, 148, 8);
    const check = Buffer.from(header);
    check.fill(0x20, 148, 156);
    let actual = 0;
    for (const byte of check) actual += byte;
    if (actual !== expected) throw new Error(`Invalid tar header checksum at byte ${offset}`);
    const leaf = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const name = prefix ? `${prefix}/${leaf}` : leaf;
    const size = parseOctal(header, 124, 12);
    if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Unsafe archive path: ${name}`);
    if (files.has(name)) throw new Error(`Duplicate archive path: ${name}`);
    const start = offset + 512;
    const end = start + size;
    if (end > buffer.length) throw new Error(`Truncated archive entry: ${name}`);
    files.set(name, Buffer.from(buffer.subarray(start, end)));
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (files.size === 0) throw new Error('Release archive contains no files');
  return files;
}

function readJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function verifyRelease(archiveInput, options = {}) {
  const archivePath = path.resolve(archiveInput);
  const manifestPath = path.resolve(options.manifestPath || `${archivePath}.manifest.json`);
  const checksumPath = path.resolve(options.checksumPath || `${archivePath}.sha256`);
  for (const required of [archivePath, manifestPath, checksumPath]) {
    if (!fs.existsSync(required)) throw new Error(`Missing release file: ${required}`);
  }
  const archive = fs.readFileSync(archivePath);
  const archiveHash = sha256(archive);
  const checksum = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(checksum) || checksum !== archiveHash) throw new Error('Archive SHA-256 sidecar mismatch');
  const external = readJson(fs.readFileSync(manifestPath), 'external release manifest');
  if (external.artifact?.sha256 !== archiveHash || external.artifact?.bytes !== archive.length) {
    throw new Error('External release manifest artifact mismatch');
  }
  if (external.artifact?.file !== path.basename(archivePath)) throw new Error('External release manifest filename mismatch');

  let tar;
  try {
    tar = zlib.gunzipSync(archive);
  } catch (error) {
    throw new Error(`Invalid gzip archive: ${error.message}`);
  }
  const files = parseTar(tar);
  const roots = new Set([...files.keys()].map((name) => name.split('/')[0]));
  if (roots.size !== 1) throw new Error('Release archive must contain exactly one root directory');
  const root = [...roots][0];
  const internalPath = `${root}/${MANIFEST_NAME}`;
  if (!files.has(internalPath)) throw new Error(`Release archive is missing ${MANIFEST_NAME}`);
  const internal = readJson(files.get(internalPath), 'internal release manifest');
  for (const field of ['schema', 'version', 'ref', 'commit', 'createdAt', 'nodeRange', 'runtimeMatrix', 'files', 'rollbackCommand']) {
    if (JSON.stringify(internal[field]) !== JSON.stringify(external[field])) throw new Error(`Internal/external manifest mismatch: ${field}`);
  }
  if (options.version && internal.version !== options.version) throw new Error(`Expected version ${options.version}, received ${internal.version}`);
  if (options.ref && internal.ref !== options.ref) throw new Error(`Expected ref ${options.ref}, received ${internal.ref}`);

  const declared = new Map();
  for (const file of internal.files || []) {
    if (!file.path || declared.has(file.path)) throw new Error(`Invalid or duplicate manifest path: ${file.path}`);
    declared.set(file.path, file);
    const archived = files.get(`${root}/${file.path}`);
    if (!archived) throw new Error(`Manifest file is missing from archive: ${file.path}`);
    if (archived.length !== file.bytes || sha256(archived) !== file.sha256) throw new Error(`Manifest checksum mismatch: ${file.path}`);
  }
  const payloadNames = [...files.keys()].filter((name) => name !== internalPath).map((name) => name.slice(root.length + 1));
  if (payloadNames.some((name) => !declared.has(name)) || declared.size !== payloadNames.length) {
    throw new Error('Archive payload and manifest file list differ');
  }
  const packageJson = readJson(files.get(`${root}/package.json`) || Buffer.alloc(0), 'package.json');
  const claude = readJson(files.get(`${root}/.claude-plugin/plugin.json`) || Buffer.alloc(0), 'Claude plugin manifest');
  const marketplace = readJson(files.get(`${root}/.claude-plugin/marketplace.json`) || Buffer.alloc(0), 'Claude marketplace manifest');
  const codex = readJson(files.get(`${root}/.codex-plugin/plugin.json`) || Buffer.alloc(0), 'Codex plugin manifest');
  const versions = [packageJson.version, claude.version, marketplace.plugins?.[0]?.version, codex.version];
  if (versions.some((version) => version !== internal.version)) throw new Error(`Packaged version drift: ${versions.join(', ')}`);
  return { archivePath, version: internal.version, ref: internal.ref, commit: internal.commit, sha256: archiveHash, files: payloadNames.length, root };
}

function defaultArchive() {
  const directory = path.resolve(__dirname, '..', 'dist', 'release');
  const archives = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.tar.gz')) : [];
  if (archives.length !== 1) throw new Error('Pass an archive path, or leave exactly one .tar.gz in dist/release');
  return path.join(directory, archives[0]);
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/release-verify.js [archive.tar.gz] [--ref v1.1.0] [--version 1.1.0]');
    return;
  }
  const positional = process.argv.slice(2).find((value, index, values) => !value.startsWith('-') && (index === 0 || !values[index - 1].startsWith('--')));
  const result = verifyRelease(positional || defaultArchive(), { ref: arg('--ref'), version: arg('--version') });
  console.log(JSON.stringify({ pass: true, ...result }, null, 2));
}

module.exports = { parseTar, verifyRelease };
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`release verification failed: ${error.message}`);
    process.exit(1);
  }
}
