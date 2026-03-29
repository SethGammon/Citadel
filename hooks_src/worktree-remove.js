#!/usr/bin/env node

/**
 * worktree-remove.js — WorktreeRemove hook
 *
 * Fires when a git worktree is removed (fleet agent completes or is cleaned up).
 * Responsibilities:
 *   1. Check if branch maps to a persistent campaign (worktree_status: active) — if so, skip removal telemetry and exit
 *   2. Log the worktree removal to telemetry
 *   3. Update the fleet session file to mark the agent as complete
 *   4. Queue a merge conflict check if the worktree had changes (Tier 9 prep)
 *   5. Clean up any scope claims the worktree's agent held
 *
 * Fringe cases:
 * - Worktree removed without corresponding fleet session: log and skip
 * - Worktree had no commits: skip merge check, just clean up
 * - Multiple worktrees removed simultaneously: each runs independently, no coordination needed
 * - Scope claim file missing: skip cleanup (already released or never claimed)
 * - Persistent worktree (campaign worktree_status: active): log skip and exit 0 — do not clean up
 */

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const worktreePath = event.worktree_path || event.path || null;
    const worktreeName = worktreePath ? path.basename(worktreePath) : null;
    const branchName = event.branch || event.branch_name || null;

    health.increment('worktree-remove', 'count');

    // Skip cleanup for persistent worktrees (campaigns with worktree_status: active).
    // The campaign file is the source of truth — if the branch maps to an active
    // persistent campaign, this removal event is spurious (e.g., session end cleanup)
    // and the worktree should be left intact for the next session.
    if (branchName && isPersistentWorktree(branchName)) {
      process.stderr.write(`[worktree-remove] Branch "${branchName}" is a persistent worktree (worktree_status: active). Skipping cleanup.\n`);
      process.exit(0);
      return;
    }

    // Log to telemetry
    health.logTiming('worktree-remove', 0, {
      event: 'worktree-remove',
      worktree: worktreeName,
      branch: branchName,
    });

    // Write to audit log
    health.writeAuditLog('worktree-removed', {
      worktree: worktreeName,
      branch: branchName,
    });

    // Queue merge conflict check for this branch (processed by citadel:merge-review)
    if (branchName) {
      queueMergeCheck(branchName, worktreeName);
    }

    // Clean up scope claims for this worktree
    cleanupScopeClaims(worktreeName);

    // Update fleet session if this worktree was part of one
    updateFleetSession(worktreeName, branchName);

    process.exit(0);
  });
}

/**
 * Returns true if the given branch is owned by a persistent campaign
 * (campaign frontmatter has worktree_status: active).
 * Scans .planning/campaigns/ for a matching branch field.
 */
function isPersistentWorktree(branch) {
  try {
    const campaignsDir = path.join(PROJECT_ROOT, '.planning', 'campaigns');
    if (!fs.existsSync(campaignsDir)) return false;
    const files = fs.readdirSync(campaignsDir).filter(f => f.endsWith('.md') && !fs.statSync(path.join(campaignsDir, f)).isDirectory());
    for (const file of files) {
      const filePath = path.join(campaignsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      // Extract YAML frontmatter (between first --- and second ---)
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      // Check branch field matches
      const branchMatch = fm.match(/^branch:\s*(.+)$/m);
      if (!branchMatch) continue;
      const fileBranch = branchMatch[1].trim().replace(/^["']|["']$/g, '');
      if (fileBranch !== branch) continue;
      // Check worktree_status is active
      const statusMatch = fm.match(/^worktree_status:\s*(.+)$/m);
      if (!statusMatch) continue;
      const status = statusMatch[1].trim().replace(/^["']|["']$/g, '');
      if (status === 'active') return true;
    }
  } catch { /* non-critical — if we can't read, assume ephemeral */ }
  return false;
}

function queueMergeCheck(branch, worktree) {
  try {
    const queueFile = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'merge-check-queue.jsonl');
    const entry = JSON.stringify({
      event: 'worktree-removed',
      timestamp: new Date().toISOString(),
      branch,
      worktree,
      status: 'pending-merge-review',
    });
    fs.appendFileSync(queueFile, entry + '\n', 'utf8');
  } catch { /* non-critical */ }
}

function cleanupScopeClaims(worktreeName) {
  if (!worktreeName) return;
  try {
    const claimsDir = path.join(PROJECT_ROOT, '.planning', 'coordination', 'claims');
    if (!fs.existsSync(claimsDir)) return;
    const files = fs.readdirSync(claimsDir);
    for (const file of files) {
      // Claims named after the worktree or agent
      if (file.includes(worktreeName)) {
        fs.unlinkSync(path.join(claimsDir, file));
      }
    }
  } catch { /* non-critical */ }
}

function updateFleetSession(worktreeName, branch) {
  if (!worktreeName && !branch) return;
  try {
    const fleetDir = path.join(PROJECT_ROOT, '.planning', 'fleet');
    if (!fs.existsSync(fleetDir)) return;

    const files = fs.readdirSync(fleetDir).filter(f => f.startsWith('session-') && f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(fleetDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      if (!/status:\s*(active|needs-continue)/mi.test(content)) continue;

      // Mark the worktree's agent as cleaned up in the session file
      const marker = `\n<!-- worktree-removed: ${worktreeName || branch} at ${new Date().toISOString()} -->`;
      fs.appendFileSync(filePath, marker + '\n');
      break;
    }
  } catch { /* non-critical */ }
}

main();
