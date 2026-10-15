'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { performance } = require('perf_hooks');

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const WINDOWS_REPLACE_TIMEOUT_MS = 5000;

function persistenceError(code, message, details = {}) {
  return Object.assign(new Error(message), { code }, details);
}

function validateLoopId(id) {
  // Portable filenames: exclude separators, ADS, trailing dots and DOS devices.
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,199}$/i.test(id)
    || id.endsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(id)) {
    throw persistenceError('LOOP_UNSAFE_PATH', `Unsafe loop id: ${String(id)}`);
  }
  return id;
}

function statIfExists(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertDirectory(target) {
  const stat = statIfExists(target);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw persistenceError('LOOP_UNSAFE_PATH', `Loop directory must be a real directory: ${target}`);
  }
  return stat;
}

function registryDirectory(projectRoot, create = false) {
  const root = path.resolve(projectRoot || process.cwd());
  // The project root is the caller's trust boundary. Never follow registry
  // symlinks/junctions beneath it. Recheck before each read and replacement.
  if (!assertDirectory(root)) {
    if (!create) return path.join(root, '.planning', 'loops');
    throw persistenceError('LOOP_UNSAFE_PATH', `Project root does not exist: ${root}`);
  }
  let target = root;
  for (const part of ['.planning', 'loops']) {
    target = path.join(target, part);
    if (!assertDirectory(target) && create) {
      try { fs.mkdirSync(target); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      assertDirectory(target);
    }
  }
  return target;
}

function registryPath(projectRoot, id) {
  return path.join(registryDirectory(projectRoot), `${validateLoopId(id)}.json`);
}

function assertRegularFile(target) {
  const stat = statIfExists(target);
  if (stat && (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1)) {
    throw persistenceError('LOOP_UNSAFE_PATH', `Loop state must be a regular file without multiple links: ${target}`);
  }
  return stat;
}

function readStateFile(target) {
  if (!assertRegularFile(target)) return null;
  // O_NOFOLLOW adds a leaf guard where supported; directory guards above are
  // not a sandbox against an adversary concurrently replacing parent paths.
  let descriptor;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    // Windows may report zero links for an open file concurrently replaced or
    // unlinked. That is not a hard link; its descriptor still reads one version.
    if (!stat.isFile() || stat.nlink > 1) {
      throw persistenceError('LOOP_UNSAFE_PATH', `Unsafe loop state: ${target}`);
    }
    const text = fs.readFileSync(descriptor, 'utf8');
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
      return value;
    } catch (cause) {
      throw persistenceError('LOOP_INVALID_STATE', `Malformed loop JSON; preserve and inspect ${target}`, { cause });
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function lockTimeout(options) {
  const timeout = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 30000) {
    throw persistenceError('LOOP_INVALID_OPTIONS', 'lockTimeoutMs must be between 0 and 30000');
  }
  return timeout;
}

function withStateLock(projectRoot, id, options, operation) {
  validateLoopId(id);
  const timeout = lockTimeout(options);
  const dir = registryDirectory(projectRoot, true);
  const target = path.join(dir, `${id}.json`);
  const lockPath = `${target}.lock`;
  const owner = { pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString(), token: crypto.randomUUID() };
  const started = performance.now();
  let descriptor;
  while (descriptor === undefined) {
    registryDirectory(projectRoot);
    assertRegularFile(target);
    assertRegularFile(lockPath);
    try { descriptor = fs.openSync(lockPath, 'wx', 0o600); } catch (error) {
      // Windows can deny an exclusive create while the prior lock's deletion
      // is pending. Treat sharing/permission contention as bounded waiting,
      // never as permission to remove the existing lock.
      const sharingContention = process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (error.code !== 'EEXIST' && !sharingContention) throw error;
      if (performance.now() - started >= timeout) {
        let lockOwner = null;
        try { lockOwner = readStateFile(lockPath); } catch (readError) {
          if (readError.code === 'LOOP_UNSAFE_PATH') throw readError;
        }
        throw persistenceError('LOOP_LOCK_TIMEOUT',
          `Timed out waiting for loop lock ${lockPath}. Owner: ${JSON.stringify(lockOwner)}. `
          + 'The owner may be active or interrupted, or the OS may deny lock acquisition; no lock was stolen. Stop all writers, inspect the record and temporary files, '
          + 'and verify the owner is no longer running before manually removing this exact lock.',
          { lockPath, owner: lockOwner });
      }
      Atomics.wait(sleepBuffer, 0, 0, Math.min(10, Math.max(1, timeout - (performance.now() - started))));
    }
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    return operation(target);
  } finally {
    fs.closeSync(descriptor);
    // Only our lock is released. A crash leaves it for explicit inspection.
    registryDirectory(projectRoot);
    const savedOwner = readStateFile(lockPath);
    if (savedOwner?.token !== owner.token) {
      throw persistenceError('LOOP_LOCK_CHANGED', `Loop lock ownership changed; inspect ${lockPath}`, { lockPath });
    }
    fs.unlinkSync(lockPath);
  }
}

function atomicWriteState(projectRoot, target, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const dir = registryDirectory(projectRoot);
  if (path.dirname(target) !== dir) throw persistenceError('LOOP_UNSAFE_PATH', 'State target is outside loop registry');
  const temporary = path.join(dir, `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const started = performance.now();
    while (true) {
      registryDirectory(projectRoot);
      assertRegularFile(target);
      try { fs.renameSync(temporary, target); break; } catch (error) {
        // An ordinary Node reader can prevent Windows replacement until its
        // descriptor closes, even though writers hold the registry lock. Allow
        // the same bounded contention window as lock acquisition. Never unlink
        // the destination: replacement failure must leave the old record intact.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)
          || performance.now() - started >= WINDOWS_REPLACE_TIMEOUT_MS) throw error;
        Atomics.wait(sleepBuffer, 0, 0, 10);
      }
    }
    // File fsync + same-directory rename protects process-interruption reads.
    // This does not promise directory durability through host/power failure,
    // or lock semantics on a network filesystem.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (statIfExists(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = Object.freeze({
  atomicWriteState,
  persistenceError,
  readStateFile,
  registryDirectory,
  registryPath,
  validateLoopId,
  withStateLock,
});
