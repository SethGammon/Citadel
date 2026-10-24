'use strict';

const path = require('path');
const fs = require('fs');
const {
  ensureDir,
  getCoordinationPaths,
  listJsonFiles,
  removeFileIfExists,
  writeJsonAtomic,
} = require('./io');

function normalizeScopeEntry(entry) {
  const value = String(entry || '').trim().replace(/\(read-only\)$/u, '').trim()
    .replace(/\\/g, '/').toLowerCase();
  if (!value) return null;

  // Match Fleet's conservative, case-insensitive path contract on every host.
  // Widen globs to their fixed prefix; this is deliberately not a glob engine.
  const glob = value.search(/[*?[{]/u);
  const prefix = glob === -1 ? value : value.slice(0, glob);
  const normalized = path.posix.normalize(prefix || '.').replace(/\/+$/u, '');
  return {
    path: normalized === '.' ? '' : normalized,
    partialSegment: glob !== -1 && Boolean(prefix) && !prefix.endsWith('/'),
  };
}

function isReadOnlyScope(entry) {
  return String(entry || '').trim().endsWith('(read-only)');
}

function scopesOverlap(scopeA, scopeB) {
  const contains = (parent, child) => parent.path === ''
    || child.path === parent.path || child.path.startsWith(`${parent.path}/`)
    || parent.partialSegment && child.path.startsWith(parent.path);

  for (const left of scopeA) {
    if (isReadOnlyScope(left)) continue;
    const cleanLeft = normalizeScopeEntry(left);
    if (!cleanLeft) continue;

    for (const right of scopeB) {
      if (isReadOnlyScope(right)) continue;
      const cleanRight = normalizeScopeEntry(right);
      if (!cleanRight) continue;
      if (contains(cleanLeft, cleanRight) || contains(cleanRight, cleanLeft)) {
        return true;
      }
    }
  }

  return false;
}

function listClaims(options = {}) {
  const paths = getCoordinationPaths(options.projectRoot);
  return listJsonFiles(paths.claimsDir);
}

function findOverlap(scope, options = {}) {
  for (const existing of listClaims(options)) {
    if (options.excludeInstanceId && existing.data.instanceId === options.excludeInstanceId) continue;
    if (scopesOverlap(scope, existing.data.scope || [])) return existing.data;
  }
  return null;
}

// The overlap check and claim write are one cross-process critical section.
// Directory creation is atomic on local filesystems. An abandoned lock blocks
// new ownership instead of being silently stolen and risking dual writers.
const CLAIM_WAIT_MS = 20;
const CLAIM_TIMEOUT_MS = 2000;
const claimWaitArray = new Int32Array(new SharedArrayBuffer(4));

function withClaimTransaction(projectRoot, operation) {
  const paths = getCoordinationPaths(projectRoot);
  ensureDir(paths.claimsDir);
  const lockPath = path.join(paths.claimsDir, '.transaction.lock');
  const deadline = Date.now() + CLAIM_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        const blocked = new Error('Scope claim registry is busy or has an abandoned lock; inspect before retry');
        blocked.code = 'CLAIM_BUSY';
        throw blocked;
      }
      Atomics.wait(claimWaitArray, 0, 0, CLAIM_WAIT_MS);
    }
  }

  try {
    return operation(paths);
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function claimScope(id, scope, type, description, options = {}) {
  return withClaimTransaction(options.projectRoot, paths => {
    const overlap = findOverlap(scope, { ...options, excludeInstanceId: id });
    if (overlap) {
      const error = new Error(`Scope overlap with ${overlap.instanceId}: ${(overlap.scope || []).join(', ')}`);
      error.code = 'SCOPE_OVERLAP';
      error.overlap = overlap;
      throw error;
    }

    const now = options.now ? new Date(options.now) : new Date();
    const data = {
      instanceId: id,
      type: type || 'unknown',
      scope,
      description: description || '',
      claimedAt: now.toISOString(),
    };
    writeJsonAtomic(path.join(paths.claimsDir, `${id}.json`), data);
    return data;
  });
}

function releaseClaim(id, options = {}) {
  return withClaimTransaction(options.projectRoot, paths => {
    const file = path.join(paths.claimsDir, `${id}.json`);
    const existed = require('./io').readJson(file);
    removeFileIfExists(file);
    return existed;
  });
}

function getClaimStatus(options = {}) {
  return {
    claims: listClaims(options).map(entry => entry.data),
  };
}

module.exports = {
  claimScope,
  findOverlap,
  getClaimStatus,
  listClaims,
  releaseClaim,
  scopesOverlap,
};
