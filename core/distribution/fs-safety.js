'use strict';

const fs = require('fs');
const path = require('path');

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpath(fileSystem, filePath) {
  return fileSystem.realpathSync.native
    ? fileSystem.realpathSync.native(filePath)
    : fileSystem.realpathSync(filePath);
}

function rejectSymlink(filePath, label, fileSystem = fs) {
  const stat = fileSystem.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${filePath}`);
  return stat;
}

function realDirectory(dirPath, label = 'directory', fileSystem = fs) {
  const resolved = path.resolve(dirPath);
  const stat = rejectSymlink(resolved, label, fileSystem);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${resolved}`);
  return realpath(fileSystem, resolved);
}

function assertSegmentsArePlain(root, candidate, label, fileSystem = fs) {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fileSystem.existsSync(current)) rejectSymlink(current, label, fileSystem);
  }
}

function resolveExistingFile(rootPath, relativePath, label = 'file', fileSystem = fs) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} path must be non-empty and relative`);
  }
  const root = realDirectory(rootPath, `${label} root`, fileSystem);
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate)) throw new Error(`${label} escapes its root`);
  assertSegmentsArePlain(root, candidate, label, fileSystem);
  const stat = rejectSymlink(candidate, label, fileSystem);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${candidate}`);
  const real = realpath(fileSystem, candidate);
  if (!isWithin(root, real)) throw new Error(`${label} real path escapes its root`);
  return real;
}

function resolveTarget(rootPath, relativePath, label = 'target', fileSystem = fs) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} path must be non-empty and relative`);
  }
  const root = realDirectory(rootPath, `${label} root`, fileSystem);
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate)) throw new Error(`${label} escapes its root`);
  assertSegmentsArePlain(root, candidate, label, fileSystem);
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
