'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { GoldenPathError } = require('./contract');

const FIELDS = Object.freeze([
  'schema',
  'id',
  'projectDir',
  'task',
  'expectedRoute',
  'verificationCommand',
  'campaignFile',
  'expectedResumeCommand',
]);

function safeRelative(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GoldenPathError('fixture_invalid', `${field} must be a non-empty string`);
  }
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(value) || normalized === '..' || normalized.startsWith('../')) {
    throw new GoldenPathError('fixture_invalid', `${field} must stay inside the fixture directory`);
  }
  return normalized;
}

function resolveInside(root, relative, field) {
  const resolved = path.resolve(root, safeRelative(relative, field));
  const lexical = path.relative(path.resolve(root), resolved);
  if (!lexical || lexical.startsWith('..') || path.isAbsolute(lexical)) {
    throw new GoldenPathError('fixture_invalid', `${field} escaped the fixture directory`);
  }
  assertNoSymlinkPath(root, resolved, field);
  let realRoot;
  let realResolved;
  try {
    realRoot = fs.realpathSync(root);
    realResolved = fs.realpathSync(resolved);
  } catch (error) {
    throw new GoldenPathError('fixture_invalid', `${field} could not be resolved: ${error.message}`);
  }
  const realRelative = path.relative(realRoot, realResolved);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new GoldenPathError('fixture_invalid', `${field} resolved outside the fixture directory`);
  }
  return resolved;
}

function assertNotSymlink(stat, field) {
  if (stat.isSymbolicLink()) {
    throw new GoldenPathError('fixture_invalid', `${field} must not contain symbolic links`);
  }
}

function assertNoSymlinkPath(root, target, field) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  let current = path.resolve(root);
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      assertNotSymlink(fs.lstatSync(current), field);
    } catch (error) {
      if (error instanceof GoldenPathError) throw error;
      throw new GoldenPathError('fixture_invalid', `${field} could not be inspected: ${error.message}`);
    }
  }
}

function loadFixture(filePath) {
  let value;
  const absolute = path.resolve(filePath);
  try {
    value = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new GoldenPathError('fixture_invalid', `fixture could not be read: ${error.message}`);
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new GoldenPathError('fixture_invalid', 'fixture must be a JSON object');
  }
  const unknown = Object.keys(value).filter((key) => !FIELDS.includes(key));
  const missing = FIELDS.filter((key) => !(key in value));
  if (unknown.length || missing.length) {
    throw new GoldenPathError(
      'fixture_invalid',
      `fixture fields differ from schema 1 (unknown=${unknown.join(',') || 'none'}; missing=${missing.join(',') || 'none'})`,
    );
  }
  if (value.schema !== 1) {
    throw new GoldenPathError('fixture_invalid', 'fixture schema must be 1');
  }
  for (const field of FIELDS.filter((field) => field !== 'schema')) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      throw new GoldenPathError('fixture_invalid', `${field} must be a non-empty string`);
    }
  }

  const fixtureRoot = path.dirname(absolute);
  const projectDir = resolveInside(fixtureRoot, value.projectDir, 'projectDir');
  const campaignFile = resolveInside(fixtureRoot, value.campaignFile, 'campaignFile');
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new GoldenPathError('fixture_invalid', 'projectDir must reference an existing directory');
  }
  if (!fs.existsSync(campaignFile) || !fs.statSync(campaignFile).isFile()) {
    throw new GoldenPathError('fixture_invalid', 'campaignFile must reference an existing file');
  }
  return { ...value, fixtureRoot, projectDir, campaignFile };
}

function listFiles(root, current = root) {
  const output = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(current, entry.name);
    assertNotSymlink(fs.lstatSync(full), path.relative(root, full).replace(/\\/g, '/'));
    if (entry.isDirectory()) output.push(...listFiles(root, full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function digestDirectory(root) {
  const hash = crypto.createHash('sha256');
  for (const file of listFiles(root)) {
    hash.update(path.relative(root, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

module.exports = { FIELDS, assertNotSymlink, digestDirectory, loadFixture, resolveInside, safeRelative };
