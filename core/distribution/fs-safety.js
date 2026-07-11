'use strict';

const fs = require('fs');
const path = require('path');

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function rejectSymlink(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${filePath}`);
  return stat;
}

function realDirectory(dirPath, label = 'directory') {
  const resolved = path.resolve(dirPath);
  const stat = rejectSymlink(resolved, label);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${resolved}`);
  return fs.realpathSync.native(resolved);
}

function assertSegmentsArePlain(root, candidate, label) {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) rejectSymlink(current, label);
  }
}

function resolveExistingFile(rootPath, relativePath, label = 'file') {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} path must be non-empty and relative`);
  }
  const root = realDirectory(rootPath, `${label} root`);
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate)) throw new Error(`${label} escapes its root`);
  assertSegmentsArePlain(root, candidate, label);
  const stat = rejectSymlink(candidate, label);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${candidate}`);
  const real = fs.realpathSync.native(candidate);
  if (!isWithin(root, real)) throw new Error(`${label} real path escapes its root`);
  return real;
}

function resolveTarget(rootPath, relativePath, label = 'target') {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} path must be non-empty and relative`);
  }
  const root = realDirectory(rootPath, `${label} root`);
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate)) throw new Error(`${label} escapes its root`);
  assertSegmentsArePlain(root, candidate, label);
  return candidate;
}

module.exports = Object.freeze({
  assertSegmentsArePlain,
  isWithin,
  realDirectory,
  rejectSymlink,
  resolveExistingFile,
  resolveTarget,
});
