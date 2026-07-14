'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const operations = require('../operations');
const { isWithin, realDirectory, resolveTarget } = require('../distribution/fs-safety');

function git(args, options = {}) {
  const result = (options.spawn || spawnSync)('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const error = new Error((result.stderr || result.error?.message || 'git command failed').trim());
    error.code = options.code || 'FORK_GIT_FAILED';
    throw error;
  }
  return String(result.stdout || '').trim();
}

function normalizedPath(value) {
  const resolved = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function registeredWorktrees(cwd, spawn) {
  const output = git(['worktree', 'list', '--porcelain'], { cwd, spawn });
  const entries = new Map();
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), head: null, branch: null };
      entries.set(normalizedPath(current.path), current);
    } else if (current && line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    else if (current && line.startsWith('branch ')) current.branch = line.slice('branch '.length);
  }
  return entries;
}

function defaultWorktreeRoot(projectRoot) {
  const project = realDirectory(projectRoot, 'project root');
  return path.join(path.dirname(project), '.citadel-worktrees');
}

function prepareWorktreeRoot(projectRoot, configuredRoot) {
  const requested = path.resolve(configuredRoot || defaultWorktreeRoot(projectRoot));
  const lexicalProject = path.resolve(projectRoot);
  const project = realDirectory(projectRoot, 'project root');
  if (isWithin(lexicalProject, requested) || isWithin(project, requested)) {
    throw Object.assign(new Error('Operation Fork worktrees must be outside the project root'), { code: 'FORK_WORKTREE_ROOT_UNSAFE' });
  }
  fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
  const root = realDirectory(requested, 'operation fork worktree root');
  if (isWithin(project, root)) throw Object.assign(new Error('Operation Fork worktrees must be outside the project root'), { code: 'FORK_WORKTREE_ROOT_UNSAFE' });
  return root;
}

function worktreePath(projectRoot, worktreeRoot, forkId, branchId) {
  const root = prepareWorktreeRoot(projectRoot, worktreeRoot);
  const forkDirectory = resolveTarget(root, forkId, 'fork worktree directory');
  fs.mkdirSync(forkDirectory, { recursive: true, mode: 0o700 });
  const realForkDirectory = realDirectory(forkDirectory, 'fork worktree directory');
  return resolveTarget(realForkDirectory, branchId, 'branch worktree');
}

function createGitWorktreeProvider(options = {}) {
  const spawn = options.spawn || spawnSync;
  return Object.freeze({
    currentRevision(projectRoot) {
      return git(['rev-parse', 'HEAD'], { cwd: projectRoot, spawn, code: 'FORK_REVISION_READ_FAILED' });
    },
    isClean(projectRoot) {
      return git(['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: projectRoot, spawn }) === '';
    },
    resolve(projectRoot, root, forkId, branchId) {
      return worktreePath(projectRoot, root, forkId, branchId);
    },
    captureContainment(optionsForRun) {
      const entries = registeredWorktrees(optionsForRun.projectRoot, spawn);
      const expectedPaths = [optionsForRun.projectRoot];
      for (const branch of optionsForRun.fork.branches) {
        if (branch.branch_ref) {
          expectedPaths.push(worktreePath(optionsForRun.projectRoot, optionsForRun.worktreeRoot,
            optionsForRun.fork.fork_id, branch.branch_id));
        }
      }
      const expected = expectedPaths.map((entryPath) => {
        const registered = entries.get(normalizedPath(entryPath));
        if (!registered) throw Object.assign(new Error(`Required worktree is not registered: ${entryPath}`), {
          code: 'FORK_CONTAINMENT_BASELINE_INVALID',
        });
        return { path: path.resolve(entryPath), head: registered.head, branch: registered.branch };
      });
      return Object.freeze({ expected: Object.freeze(expected) });
    },
    assertContainment(snapshot) {
      const survivor = snapshot.expected.find((entry) => fs.existsSync(entry.path));
      if (!survivor) throw Object.assign(new Error('All required worktrees were removed'), {
        code: 'FORK_WORKTREE_CONTAINMENT_VIOLATION',
      });
      const entries = registeredWorktrees(survivor.path, spawn);
      for (const expected of snapshot.expected) {
        if (!fs.existsSync(expected.path)) throw Object.assign(new Error(`Required worktree was removed: ${expected.path}`), {
          code: 'FORK_WORKTREE_CONTAINMENT_VIOLATION',
        });
        const actual = entries.get(normalizedPath(expected.path));
        if (!actual || actual.branch !== expected.branch || actual.head !== expected.head) {
          throw Object.assign(new Error(`Worktree ownership changed: ${expected.path}`), {
            code: 'FORK_WORKTREE_CONTAINMENT_VIOLATION',
          });
        }
      }
      return true;
    },
    ensure(optionsForBranch) {
      const target = worktreePath(optionsForBranch.projectRoot, optionsForBranch.worktreeRoot,
        optionsForBranch.forkId, optionsForBranch.branch.branch_id);
      // Executor profiles, not runtimes, name the branch. Legacy profile IDs are
      // the runtime name, so schema 1 refs are unchanged, while two profiles on
      // one runtime can no longer collide on a single ref.
      const profileId = optionsForBranch.branch.branch_id.replace(/^branch-/, '');
      const branchRef = `citadel/${optionsForBranch.forkId}/${profileId}`;
      if (fs.existsSync(target)) {
        const targetRoot = realDirectory(target, 'branch worktree');
        const actualBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: targetRoot, spawn });
        if (actualBranch !== branchRef) throw Object.assign(new Error('Existing worktree belongs to another branch'), { code: 'FORK_WORKTREE_MISMATCH' });
        return { path: targetRoot, worktreeRef: `${optionsForBranch.forkId}/${optionsForBranch.branch.branch_id}`, branchRef, recovered: true };
      }
      const branchExists = (spawn('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchRef}`], {
        cwd: optionsForBranch.projectRoot, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      }).status === 0);
      const args = branchExists
        ? ['worktree', 'add', target, branchRef]
        : ['worktree', 'add', '-b', branchRef, target, optionsForBranch.baseRevision];
      git(args, { cwd: optionsForBranch.projectRoot, spawn, code: 'FORK_WORKTREE_CREATE_FAILED' });
      return { path: realDirectory(target, 'branch worktree'),
        worktreeRef: `${optionsForBranch.forkId}/${optionsForBranch.branch.branch_id}`, branchRef, recovered: false };
    },
    diffSummary(worktree, baseRevision) {
      const output = git(['diff', '--numstat', baseRevision, '--'], { cwd: worktree, spawn });
      const files = output ? output.split(/\r?\n/).filter(Boolean).map((line) => {
        const [insertions, deletions, ...name] = line.split('\t');
        return { insertions: /^\d+$/.test(insertions) ? Number(insertions) : 0,
          deletions: /^\d+$/.test(deletions) ? Number(deletions) : 0, name_digest: operations.sha256Digest({ path: name.join('\t') }) };
      }) : [];
      return {
        files_changed: files.length,
        insertions: files.reduce((total, file) => total + file.insertions, 0),
        deletions: files.reduce((total, file) => total + file.deletions, 0),
        digest: operations.sha256Digest(files),
      };
    },
    merge(projectRoot, branchRef, expectedRevision) {
      const current = this.currentRevision(projectRoot);
      if (current !== expectedRevision) throw Object.assign(new Error('Target revision changed before landing'), { code: 'FORK_TARGET_REVISION_CHANGED' });
      if (!this.isClean(projectRoot)) throw Object.assign(new Error('Target worktree is not clean'), { code: 'FORK_TARGET_DIRTY' });
      git(['merge', '--no-ff', '--no-edit', branchRef], { cwd: projectRoot, spawn, code: 'FORK_LANDING_MERGE_FAILED' });
      return this.currentRevision(projectRoot);
    },
  });
}

module.exports = Object.freeze({ createGitWorktreeProvider, defaultWorktreeRoot, prepareWorktreeRoot, worktreePath });
