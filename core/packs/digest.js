'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function packFiles(packRoot) {
  const requestedRoot = path.resolve(packRoot);
  if (fs.lstatSync(requestedRoot).isSymbolicLink()) throw new Error(`Pack root must not be a symlink: ${requestedRoot}`);
  const root = fs.realpathSync(requestedRoot);
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Pack content must not contain symlinks: ${path.relative(root, full)}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
      else throw new Error(`Pack content must contain only files and directories: ${path.relative(root, full)}`);
    }
  }
  walk(root);
  return { root, files };
}

function contentDigest(packRoot) {
  const { root, files } = packFiles(packRoot);
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const content = fs.readFileSync(file);
    hash.update(`${Buffer.byteLength(relative)}:${relative}:${content.length}:`);
    hash.update(content);
  }
  return { algorithm: 'sha256', digest: hash.digest('hex'), files: files.map((file) => path.relative(root, file).split(path.sep).join('/')) };
}

module.exports = Object.freeze({ contentDigest, packFiles });
