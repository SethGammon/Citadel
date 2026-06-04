'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  checkWorktreeReadiness,
  listReadinessReports,
  matchReadiness,
} = require('../worktree/readiness');

const OPERATIONS = ['create', 'start', 'attach', 'status', 'exec', 'snapshot', 'fork', 'stop', 'cleanup'];

function unsupported(providerId, operation) {
  const error = new Error(`${providerId} provider does not support ${operation} in Citadel v1.`);
  error.code = 'UNSUPPORTED_SANDBOX_OPERATION';
  return error;
}

function capability(supported, note) {
  return { supported: Boolean(supported), note };
}

function validateWorktreePath(worktreePath) {
  if (!worktreePath) throw new Error('worktree provider requires worktreePath');
  const resolved = path.resolve(worktreePath);
  if (!fs.existsSync(resolved)) throw new Error(`worktree path not found: ${resolved}`);
  return resolved;
}

function gitStatus(worktreePath) {
  try {
    return execFileSync('git', ['status', '--short'], {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
  } catch (error) {
    return `git status unavailable: ${error.message}`;
  }
}

function createWorktreeProvider(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  return {
    id: 'worktree',
    label: 'Git worktree',
    capabilities: {
      create: capability(false, 'Creation remains owned by the Codex/Claude WorktreeCreate lifecycle hook.'),
      start: capability(false, 'No separate start action; worktrees are filesystem sandboxes.'),
      attach: capability(true, 'Validate and bind to an existing worktree path.'),
      status: capability(true, 'Report readiness and basic path state.'),
      exec: capability(false, 'Command execution stays with the runtime shell, not the provider.'),
      snapshot: capability(true, 'Read-only git status snapshot.'),
      fork: capability(false, 'Forking is deferred to future provider work.'),
      stop: capability(false, 'No running process to stop in filesystem-only worktree mode.'),
      cleanup: capability(false, 'Cleanup is still handled by WorktreeRemove hooks/manual git worktree commands.'),
    },
    async create() { throw unsupported('worktree', 'create'); },
    async start() { throw unsupported('worktree', 'start'); },
    async exec() { throw unsupported('worktree', 'exec'); },
    async fork() { throw unsupported('worktree', 'fork'); },
    async stop() { throw unsupported('worktree', 'stop'); },
    async cleanup() { throw unsupported('worktree', 'cleanup'); },
    async attach(args = {}) {
      const worktreePath = validateWorktreePath(args.worktreePath || projectRoot);
      return {
        provider: 'worktree',
        projectRoot,
        worktreePath,
        branch: args.branch || null,
        attached: true,
      };
    },
    async status(args = {}) {
      const worktreePath = validateWorktreePath(args.worktreePath || projectRoot);
      const reports = listReadinessReports(projectRoot);
      const readiness = matchReadiness({ branch: args.branch, agent: path.basename(worktreePath) }, reports);
      return {
        provider: 'worktree',
        projectRoot,
        worktreePath,
        exists: true,
        branch: args.branch || null,
        readiness: readiness ? {
          status: readiness.status,
          blockFleet: readiness.blockFleet,
          file: readiness.file,
        } : null,
      };
    },
    async snapshot(args = {}) {
      const worktreePath = validateWorktreePath(args.worktreePath || projectRoot);
      return {
        provider: 'worktree',
        projectRoot,
        worktreePath,
        status: gitStatus(worktreePath),
      };
    },
    async readiness(args = {}) {
      return checkWorktreeReadiness({
        projectRoot,
        worktreePath: args.worktreePath || projectRoot,
        branch: args.branch || null,
        write: Boolean(args.write),
      });
    },
  };
}

function createUnsupportedProvider(id) {
  return {
    id,
    label: id,
    capabilities: Object.fromEntries(OPERATIONS.map((operation) => [
      operation,
      capability(false, `${id} provider is reserved for future integration and is not implemented yet.`),
    ])),
    async create() { throw unsupported(id, 'create'); },
    async start() { throw unsupported(id, 'start'); },
    async attach() { throw unsupported(id, 'attach'); },
    async status() { throw unsupported(id, 'status'); },
    async exec() { throw unsupported(id, 'exec'); },
    async snapshot() { throw unsupported(id, 'snapshot'); },
    async fork() { throw unsupported(id, 'fork'); },
    async stop() { throw unsupported(id, 'stop'); },
    async cleanup() { throw unsupported(id, 'cleanup'); },
  };
}

function getSandboxProvider(id = 'worktree', options = {}) {
  if (id === 'worktree') return createWorktreeProvider(options);
  if (id === 'docker' || id === 'remote') return createUnsupportedProvider(id);
  throw new Error(`Unknown sandbox provider: ${id}`);
}

function capabilityMatrix(options = {}) {
  return ['worktree', 'docker', 'remote'].map((id) => {
    const provider = getSandboxProvider(id, options);
    return {
      provider: id,
      label: provider.label,
      capabilities: provider.capabilities,
    };
  });
}

module.exports = {
  OPERATIONS,
  capabilityMatrix,
  createUnsupportedProvider,
  createWorktreeProvider,
  getSandboxProvider,
  unsupported,
};
