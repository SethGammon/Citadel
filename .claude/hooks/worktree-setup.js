#!/usr/bin/env node

/**
 * worktree-setup.js — WorktreeCreate hook
 *
 * Auto-initializes new git worktrees for parallel agent execution.
 * Runs package install and copies environment files so sub-agents
 * can run typecheck, tests, and builds immediately.
 *
 * Receives stdin JSON: { "name": "agent-abc123", "path": "/path/to/worktree" }
 *
 * Exit codes:
 *   0 = setup complete (or skipped gracefully)
 *   2 = setup failed (blocks worktree creation)
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const health = require('./harness-health-util');

const MAIN_ROOT = health.PROJECT_ROOT;

function main(input) {
  const worktreePath = input.path;
  if (!worktreePath) return;

  const pathCheck = health.validatePath(worktreePath);
  if (!pathCheck.safe) {
    health.securityWarning('worktree-setup', `Possible injection in worktree path — ${pathCheck.violation}. Skipping setup.`);
    return;
  }

  // Verify the worktree has a package.json (Node project)
  if (fs.existsSync(path.join(worktreePath, 'package.json'))) {
    // Skip if node_modules already exists (resuming a worktree)
    if (!fs.existsSync(path.join(worktreePath, 'node_modules'))) {
      const config = health.readConfig();
      const pm = config.packageManager || 'npm';
      const [cmd, args] = pm === 'pnpm' ? ['pnpm', ['install', '--frozen-lockfile']]
        : pm === 'yarn' ? ['yarn', ['install', '--frozen-lockfile']]
        : pm === 'bun' ? ['bun', ['install', '--frozen-lockfile']]
        : ['npm', ['ci', '--prefer-offline']];

      try {
        execFileSync(cmd, args, {
          cwd: worktreePath,
          timeout: 120000,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        process.stderr.write(`[worktree-setup] Install failed in ${worktreePath}: ${err.message}\n`);
        // Don't block worktree creation — typecheck will gracefully skip
      }
    }
  }

  // For Python: create venv if requirements.txt exists
  if (fs.existsSync(path.join(worktreePath, 'requirements.txt'))) {
    if (!fs.existsSync(path.join(worktreePath, '.venv'))) {
      try {
        execFileSync('python', ['-m', 'venv', '.venv'], {
          cwd: worktreePath,
          timeout: 60000,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const pipPath = process.platform === 'win32'
          ? path.join('.venv', 'Scripts', 'pip')
          : path.join('.venv', 'bin', 'pip');
        execFileSync(pipPath, ['install', '-r', 'requirements.txt'], {
          cwd: worktreePath,
          timeout: 120000,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch { /* non-critical */ }
    }
  }

  // Copy .env.local if it exists in the main repo
  for (const envFile of ['.env.local', '.env']) {
    const src = path.join(MAIN_ROOT, envFile);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, path.join(worktreePath, envFile));
      } catch { /* non-critical */ }
    }
  }
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { data += chunk; });
process.stdin.on('end', () => {
  try { main(JSON.parse(data)); } catch { /* silent */ }
  process.stdout.write('ok\n');
});
