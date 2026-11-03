'use strict';

// Machine-local approvals for repository-controlled commands.
//
// Some Citadel features execute commands that come from files inside the
// project (harness.json typecheck settings, .planning/loops/*.json). A cloned
// repository controls those files, so it must not be able to approve them
// either. Approvals therefore live outside every project, are keyed by the
// project's real path plus the exact command, and can only be added from an
// interactive terminal (scripts/approve-command.js).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activeShell, shellQuote } = require('../utils/config-command');

const STORE_VERSION = 1;
const KINDS = Object.freeze(['typecheck', 'loop']);

function defaultStorePath(options = {}) {
  const env = options.env || process.env;
  if (env.CITADEL_COMMAND_APPROVALS) return path.resolve(env.CITADEL_COMMAND_APPROVALS);
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(local, 'Citadel', 'command-approvals.json');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Citadel', 'command-approvals.json');
  }
  const state = env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  return path.join(state, 'citadel', 'command-approvals.json');
}

function realProjectRoot(projectRoot) {
  const resolved = path.resolve(projectRoot || process.cwd());
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}

function realOrResolved(target) {
  // Resolve the deepest existing ancestor so a not-yet-created store file is
  // still compared by its real location.
  let current = path.resolve(target);
  const suffix = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  let real;
  try { real = fs.realpathSync(current); } catch { real = current; }
  return path.join(real, ...suffix);
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Store path for a project, or an error when the store would sit inside the
 * project (a repository must never hold its own approvals).
 */
function resolveStore(projectRoot, options = {}) {
  const storePath = realOrResolved(options.storePath || defaultStorePath(options));
  const root = realProjectRoot(projectRoot);
  if (isInside(root, storePath)) {
    return { error: `command approval store ${storePath} is inside the project; approvals must be machine-local` };
  }
  return { storePath, root };
}

function approvalKey(root, kind, command) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([STORE_VERSION, root, kind, command]))
    .digest('hex');
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw new TypeError(`Unknown command approval kind: ${kind}`);
}

function readStore(storePath) {
  try {
    const stat = fs.lstatSync(storePath);
    if (!stat.isFile()) return { version: STORE_VERSION, approvals: {} };
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (parsed && parsed.version === STORE_VERSION && parsed.approvals && typeof parsed.approvals === 'object') {
      return parsed;
    }
  } catch { /* missing or unreadable store means nothing is approved */ }
  return { version: STORE_VERSION, approvals: {} };
}

function writeStore(storePath, store) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, storePath);
}

/** Returns { approved, storePath, reason }. Never throws. */
function checkApproval(projectRoot, kind, command, options = {}) {
  try {
    assertKind(kind);
    if (typeof command !== 'string' || !command.trim()) return { approved: false, reason: 'empty command' };
    const store = resolveStore(projectRoot, options);
    if (store.error) return { approved: false, reason: store.error };
    const entry = readStore(store.storePath).approvals[approvalKey(store.root, kind, command)];
    const approved = Boolean(entry && entry.root === store.root && entry.kind === kind && entry.command === command);
    return { approved, storePath: store.storePath, reason: approved ? null : 'not approved' };
  } catch (error) {
    return { approved: false, reason: error.message };
  }
}

function approve(projectRoot, kind, command, options = {}) {
  assertKind(kind);
  if (typeof command !== 'string' || !command.trim()) throw new TypeError('Command must be a non-empty string');
  const store = resolveStore(projectRoot, options);
  if (store.error) throw new Error(store.error);
  const data = readStore(store.storePath);
  data.approvals[approvalKey(store.root, kind, command)] = {
    root: store.root, kind, command, approvedAt: new Date().toISOString(),
  };
  writeStore(store.storePath, data);
  return { storePath: store.storePath, root: store.root };
}

function revoke(projectRoot, kind, command, options = {}) {
  assertKind(kind);
  const store = resolveStore(projectRoot, options);
  if (store.error) throw new Error(store.error);
  const data = readStore(store.storePath);
  const key = approvalKey(store.root, kind, command);
  const existed = Boolean(data.approvals[key]);
  delete data.approvals[key];
  if (existed) writeStore(store.storePath, data);
  return { removed: existed, storePath: store.storePath };
}

function listApprovals(projectRoot, options = {}) {
  const store = resolveStore(projectRoot, options);
  if (store.error) throw new Error(store.error);
  return Object.values(readStore(store.storePath).approvals).filter((entry) => entry.root === store.root);
}

/**
 * The exact process post-edit would run for a language, as the string a user
 * approves. Returns null when post-edit runs nothing for that language.
 */
function typecheckIdentity(language, typecheckConfig = {}) {
  const command = typeof typecheckConfig.command === 'string' ? typecheckConfig.command.trim() : '';
  if (!command) return null;
  if (language === 'typescript') {
    return typecheckConfig.tscPath ? `typescript: ${command} [tscPath=${typecheckConfig.tscPath}]` : `typescript: ${command}`;
  }
  if (language === 'python') return `python: ${command}`;
  if (language === 'go') return 'go: go vet ./...';
  if (language === 'rust') return 'rust: cargo check --message-format=short';
  return null;
}

function approvalHint(kind, command, projectRoot, options = {}) {
  const script = path.join(__dirname, '..', '..', 'scripts', 'approve-command.js');
  const shell = options.shell || activeShell(options.platform, options.env);
  return ['node', script, 'approve', kind, '--project-root', realProjectRoot(projectRoot), '--command', command]
    .map((part) => shellQuote(part, shell))
    .join(' ');
}

module.exports = Object.freeze({
  KINDS,
  approvalHint,
  approve,
  checkApproval,
  defaultStorePath,
  listApprovals,
  revoke,
  typecheckIdentity,
});
