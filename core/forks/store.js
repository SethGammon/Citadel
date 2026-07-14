'use strict';

const fs = require('fs');
const path = require('path');
const { resolveExistingFile, resolveTarget, realDirectory } = require('../distribution/fs-safety');
const { assertValidFork } = require('./contracts');

const SAFE_ID = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = fs.openSync(temporary, 'wx', mode);
  try {
    fs.writeFileSync(handle, content, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, file);
}

function safeForkId(forkId) {
  if (typeof forkId !== 'string' || !SAFE_ID.test(forkId)) throw new TypeError('Invalid fork_id');
  return forkId;
}

function forksRoot(projectRoot, create = false) {
  const project = realDirectory(projectRoot, 'project root');
  const target = resolveTarget(project, '.planning/operation-forks', 'operation fork root');
  if (create) fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) return null;
  return realDirectory(target, 'operation fork root');
}

function forkDirectory(projectRoot, forkId, create = false) {
  const root = forksRoot(projectRoot, create);
  if (!root) return null;
  const target = resolveTarget(root, safeForkId(forkId), 'operation fork');
  if (create) fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) return null;
  return realDirectory(target, 'operation fork');
}

function manifestPath(projectRoot, forkId, create = false) {
  const directory = forkDirectory(projectRoot, forkId, create);
  return directory ? path.join(directory, 'fork.json') : null;
}

function createForkRecord(projectRoot, fork, privateState = {}) {
  assertValidFork(fork);
  const file = manifestPath(projectRoot, fork.fork_id, true);
  if (fs.existsSync(file)) throw Object.assign(new Error(`Fork already exists: ${fork.fork_id}`), { code: 'FORK_EXISTS' });
  atomicWrite(file, `${JSON.stringify(fork, null, 2)}\n`);
  const directory = path.dirname(file);
  if (typeof privateState.objective === 'string') {
    const privateDir = resolveTarget(directory, 'private', 'fork private state');
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    atomicWrite(path.join(privateDir, 'objective.txt'), `${privateState.objective.trim()}\n`);
  }
  if (typeof privateState.signingKey === 'string') {
    const privateDir = resolveTarget(directory, 'private', 'fork private state');
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    atomicWrite(path.join(privateDir, 'signing-key.pem'), privateState.signingKey);
  }
  if (privateState.workflow && typeof privateState.workflow === 'object') {
    const privateDir = resolveTarget(directory, 'private', 'fork private state');
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    atomicWrite(path.join(privateDir, 'workflow.json'), `${JSON.stringify(privateState.workflow, null, 2)}\n`);
  }
  return fork;
}

function loadFork(projectRoot, forkId) {
  const file = manifestPath(projectRoot, forkId, false);
  if (!file || !fs.existsSync(file)) throw Object.assign(new Error(`Fork not found: ${forkId}`), { code: 'FORK_NOT_FOUND' });
  const safeFile = resolveExistingFile(path.dirname(file), 'fork.json', 'fork manifest');
  let value;
  try { value = JSON.parse(fs.readFileSync(safeFile, 'utf8')); } catch (_error) {
    throw Object.assign(new Error(`Fork manifest is unreadable: ${forkId}`), { code: 'FORK_UNREADABLE' });
  }
  try { return assertValidFork(value); } catch (error) {
    throw Object.assign(new Error(`Fork manifest is invalid: ${error.message}`), { code: 'FORK_INVALID' });
  }
}

function saveFork(projectRoot, fork, expectedRevision) {
  assertValidFork(fork);
  const current = loadFork(projectRoot, fork.fork_id);
  if (current.revision !== expectedRevision) {
    throw Object.assign(new Error(`Fork revision conflict: expected ${expectedRevision}, found ${current.revision}`), {
      code: 'FORK_REVISION_CONFLICT', current_revision: current.revision,
    });
  }
  if (fork.revision !== expectedRevision + 1) throw new TypeError('Fork revision must increment exactly once');
  const file = manifestPath(projectRoot, fork.fork_id, false);
  atomicWrite(file, `${JSON.stringify(fork, null, 2)}\n`);
  return fork;
}

function privateFile(projectRoot, forkId, filename) {
  if (!/^[a-z][a-z0-9-]*\.(?:txt|pem|json)$/.test(filename)) throw new TypeError('Invalid private filename');
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory) throw Object.assign(new Error(`Fork not found: ${forkId}`), { code: 'FORK_NOT_FOUND' });
  return resolveExistingFile(directory, `private/${filename}`, 'fork private file');
}

function readPrivate(projectRoot, forkId, filename) {
  return fs.readFileSync(privateFile(projectRoot, forkId, filename), 'utf8');
}

function receiptDirectory(projectRoot, forkId) {
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory) throw Object.assign(new Error(`Fork not found: ${forkId}`), { code: 'FORK_NOT_FOUND' });
  const target = resolveTarget(directory, 'receipts', 'fork receipt directory');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return realDirectory(target, 'fork receipt directory');
}

function writeReceipt(projectRoot, forkId, branchId, envelope) {
  safeForkId(branchId);
  const directory = receiptDirectory(projectRoot, forkId);
  const file = resolveTarget(directory, `${branchId}.json`, 'fork receipt');
  atomicWrite(file, `${JSON.stringify(envelope, null, 2)}\n`);
  return file;
}

function executorFilePath(projectRoot, forkId, create = false) {
  const directory = forkDirectory(projectRoot, forkId, create);
  if (!directory) throw Object.assign(new Error(`Fork not found: ${forkId}`), { code: 'FORK_NOT_FOUND' });
  return resolveTarget(directory, 'executors.json', 'fork executor file');
}

function writeExecutorFile(projectRoot, forkId, file) {
  const target = executorFilePath(projectRoot, forkId, true);
  atomicWrite(target, `${JSON.stringify(file, null, 2)}\n`);
  return target;
}

function readExecutorFile(projectRoot, forkId) {
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory || !fs.existsSync(path.join(directory, 'executors.json'))) return null;
  const file = resolveExistingFile(directory, 'executors.json', 'fork executor file');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) {
    throw Object.assign(new Error(`Fork executor file is unreadable: ${forkId}`), { code: 'FORK_EXECUTORS_UNREADABLE' });
  }
}

function writeForkReceiptWrapper(projectRoot, forkId, branchId, wrapper) {
  safeForkId(branchId);
  const directory = receiptDirectory(projectRoot, forkId);
  const file = resolveTarget(directory, `${branchId}.fork.json`, 'fork receipt wrapper');
  atomicWrite(file, `${JSON.stringify(wrapper, null, 2)}\n`);
  return file;
}

function readForkReceiptWrapper(projectRoot, forkId, branchId) {
  safeForkId(branchId);
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory) return null;
  const candidate = path.join(directory, 'receipts', `${branchId}.fork.json`);
  if (!fs.existsSync(candidate)) return null;
  const file = resolveExistingFile(directory, `receipts/${branchId}.fork.json`, 'fork receipt wrapper');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) {
    // A stored wrapper is untrusted input. Unreadable is treated as absent and
    // never as verified.
    return null;
  }
}

function telemetryDirectory(projectRoot, forkId) {
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory) throw Object.assign(new Error(`Fork not found: ${forkId}`), { code: 'FORK_NOT_FOUND' });
  const target = resolveTarget(directory, 'telemetry', 'fork telemetry directory');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return realDirectory(target, 'fork telemetry directory');
}

function writeExecutorTelemetry(projectRoot, forkId, branchId, observation) {
  safeForkId(branchId);
  const directory = telemetryDirectory(projectRoot, forkId);
  const file = resolveTarget(directory, `${branchId}.json`, 'fork telemetry');
  atomicWrite(file, `${JSON.stringify(observation, null, 2)}\n`);
  return file;
}

function readExecutorTelemetry(projectRoot, forkId, branchId) {
  safeForkId(branchId);
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory) return null;
  const candidate = path.join(directory, 'telemetry', `${branchId}.json`);
  if (!fs.existsSync(candidate)) return null;
  const file = resolveExistingFile(directory, `telemetry/${branchId}.json`, 'fork telemetry');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) {
    // Unparsable telemetry stays unknown rather than becoming a fabricated zero.
    return null;
  }
}

function appendEvent(projectRoot, forkId, event) {
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory) throw Object.assign(new Error(`Fork not found: ${forkId}`), { code: 'FORK_NOT_FOUND' });
  const allowed = ['schema_version', 'event_id', 'fork_id', 'fork_revision', 'type', 'branch_id', 'status', 'recorded_at', 'detail_digest'];
  if (!event || JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(allowed.sort())) throw new TypeError('Fork event fields are invalid');
  const events = resolveTarget(directory, 'events.jsonl', 'fork event journal');
  fs.appendFileSync(events, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function readEvents(projectRoot, forkId) {
  const directory = forkDirectory(projectRoot, forkId, false);
  if (!directory) throw Object.assign(new Error(`Fork not found: ${forkId}`), { code: 'FORK_NOT_FOUND' });
  const candidate = path.join(directory, 'events.jsonl');
  if (!fs.existsSync(candidate)) return [];
  const file = resolveExistingFile(directory, 'events.jsonl', 'fork event journal');
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_error) {
      throw Object.assign(new Error('Fork event journal is unreadable'), { code: 'FORK_EVENTS_UNREADABLE' });
    }
  });
}

function listForks(projectRoot) {
  let root;
  try { root = forksRoot(projectRoot, false); } catch (_error) { return []; }
  if (!root) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      try {
        const fork = loadFork(projectRoot, entry.name);
        return { fork_id: fork.fork_id, revision: fork.revision, status: fork.status,
          updated_at: fork.updated_at, branches: fork.branches.map((branch) => ({
            branch_id: branch.branch_id, runtime: branch.runtime, status: branch.status,
            evidence_summary: branch.evidence_summary, duration_ms: branch.duration_ms, cost: branch.cost,
          })), selection: fork.selection, landing: fork.landing };
      } catch (_error) {
        return { fork_id: entry.name, revision: null, status: 'unknown', updated_at: null,
          branches: [], selection: null, landing: null };
      }
    });
}

module.exports = Object.freeze({
  appendEvent,
  createForkRecord,
  forkDirectory,
  forksRoot,
  listForks,
  loadFork,
  readEvents,
  readExecutorFile,
  readExecutorTelemetry,
  readForkReceiptWrapper,
  readPrivate,
  saveFork,
  writeExecutorFile,
  writeExecutorTelemetry,
  writeForkReceiptWrapper,
  writeReceipt,
});
