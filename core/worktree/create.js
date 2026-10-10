'use strict';

/**
 * Git worktree lifecycle for the Claude Code WorktreeCreate/WorktreeRemove hooks.
 *
 * Registering a WorktreeCreate hook replaces Claude Code's built-in
 * `git worktree add`, so the hook must create the checkout itself and print
 * its absolute path. This module mirrors the native layout:
 *   <projectRoot>/.claude/worktrees/<name>  on branch  worktree-<name>
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function branchExists(projectRoot, branch) {
  try {
    git(projectRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute, symlink-free roots of every worktree registered with the
 * repository that contains `projectRoot` (main checkout included).
 * Returns [] when git is unavailable or the root is not a repository.
 */
function listWorktreeRoots(projectRoot) {
  let out;
  try {
    out = git(projectRoot, ['worktree', 'list', '--porcelain']);
  } catch {
    return [];
  }
  return out.split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length)));
}

/**
 * Create (or reuse) the worktree for `name`. Returns { path, branch, created }.
 * Throws on invalid names or git failure so the hook can exit non-zero.
 */
function createWorktree({ projectRoot, name }) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..')) {
    throw new Error(`invalid worktree name: ${JSON.stringify(name)}`);
  }
  const topLevel = path.resolve(git(projectRoot, ['rev-parse', '--show-toplevel']));
  const worktreePath = path.join(topLevel, '.claude', 'worktrees', name);
  const branch = `worktree-${name}`;

  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const registered = listWorktreeRoots(topLevel).some((root) => fold(root) === fold(worktreePath));
  if (registered && fs.existsSync(worktreePath)) {
    return { path: worktreePath, branch, created: false };
  }
  if (registered) git(topLevel, ['worktree', 'prune']);

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const args = branchExists(topLevel, branch)
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'];
  git(topLevel, args);
  return { path: worktreePath, branch, created: true };
}

/** Branch checked out in `worktreePath`, or null (detached / not git). */
function worktreeBranch(worktreePath) {
  try {
    const branch = git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return branch === 'HEAD' ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Remove a linked worktree via git. Refuses the main checkout and paths git
 * does not list as worktrees of this repository. The branch is kept so its
 * commits remain available for merge review. Returns true when the directory
 * is gone afterwards.
 */
function removeWorktree({ projectRoot, worktreePath }) {
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const target = fold(path.resolve(worktreePath));
  const [mainRoot, ...linked] = listWorktreeRoots(projectRoot);
  if (!mainRoot || fold(mainRoot) === target) return false;
  if (!linked.some((root) => fold(root) === target)) return false;
  git(mainRoot, ['worktree', 'remove', '--force', path.resolve(worktreePath)]);
  return !fs.existsSync(worktreePath);
}

module.exports = { createWorktree, removeWorktree, worktreeBranch, listWorktreeRoots };
