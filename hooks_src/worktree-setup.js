#!/usr/bin/env node

/**
 * worktree-setup.js — WorktreeCreate hook
 *
 * Registering a WorktreeCreate hook replaces Claude Code's built-in
 * `git worktree add`, so this hook creates the worktree itself at
 * .claude/worktrees/<name> on branch worktree-<name> (the native layout),
 * then records a readiness report. Reports missing dependencies and
 * environment files without installing packages or copying secrets.
 *
 * Receives stdin JSON: { "name": "bold-oak-a3f2", ... }
 * Legacy callers that already created the checkout may pass { "path": "..." }.
 *
 * Output: the absolute worktree path as the last stdout line. Claude Code
 * uses it as the isolated session's working directory; all other output
 * goes to stderr.
 *
 * Exit codes:
 *   0 = worktree ready (readiness failures are reported, not fatal)
 *   1 = no worktree could be created (Claude Code fails the creation)
 */

const path = require('path');
const health = require('./harness-health-util');
const { checkWorktreeReadiness } = require('../core/worktree/readiness');
const { createWorktree } = require('../core/worktree/create');

const MAIN_ROOT = health.PROJECT_ROOT;

/** Resolves the worktree path to report, or throws when none exists. */
async function main(input) {
  let worktreePath = input.path || null;
  let branch = input.branch || null;

  if (worktreePath) {
    // Only a caller-supplied path is untrusted. A path createWorktree builds
    // is never passed through a shell, and the project root may legally
    // contain characters such as '&' (e.g. a checkout under "R&D").
    const pathCheck = health.validatePath(worktreePath);
    if (!pathCheck.safe) {
      throw new Error(`possible injection in worktree path — ${pathCheck.violation}`);
    }
  } else {
    if (!input.name) throw new Error('hook input has neither "name" nor "path"');
    const created = createWorktree({ projectRoot: MAIN_ROOT, name: input.name });
    worktreePath = created.path;
    branch = branch || created.branch;
  }

  // Readiness only. Tracked manifests and ignored env files are not consent
  // to execute lifecycle scripts or distribute secrets to another checkout.

  try {
    const report = await checkWorktreeReadiness({
      projectRoot: MAIN_ROOT,
      worktreePath,
      branch,
      write: true,
    });
    health.logTiming('worktree-readiness', 0, {
      event: 'worktree-readiness',
      status: report.status,
      branch,
      worktree: path.basename(worktreePath),
    });
    health.writeAuditLog('worktree-readiness', {
      status: report.status,
      blockFleet: report.blockFleet,
      branch,
      worktree: path.basename(worktreePath),
      report: report.file,
    });
  } catch (err) {
    process.stderr.write(`[worktree-setup] Readiness check failed in ${worktreePath}: ${err.message}\n`);
  }

  return worktreePath;
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { data += chunk; });
process.stdin.on('end', async () => {
  try {
    const worktreePath = await main(JSON.parse(data));
    process.stdout.write(`${worktreePath}\n`);
  } catch (err) {
    process.stderr.write(`[worktree-setup] Worktree creation failed: ${err.message}\n`);
    process.exitCode = 1;
  }
});
