#!/usr/bin/env node

/**
 * cwd-changed.js — CwdChanged hook
 *
 * Fires when the working directory changes mid-session. Relevant for
 * fleet agents that change into worktree directories, or for scripts
 * that cd into project subdirectories.
 *
 * Key behaviors:
 *   - Log old/new cwd pair to telemetry for session reconstruction
 *   - Crossing outside the project root → security advisory in audit log
 *
 * Design:
 *   - Observer only: always exit 0
 *
 * Exit codes:
 *   0 = always
 */

'use strict';

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

    const newCwd = event.cwd || event.new_cwd || null;
    const oldCwd = event.old_cwd || event.previous_cwd || null;
    const sessionId = event.session_id || null;
    const agentId = event.agent_id || null;

    health.increment('cwd-changed', 'count');

    health.logTiming('cwd-changed', 0, {
      event: 'cwd-changed',
      old_cwd: oldCwd,
      new_cwd: newCwd,
      session_id: sessionId,
      agent_id: agentId,
    });

    // Flag if the new cwd is outside the project root (potentially a drift/mistake)
    if (newCwd && PROJECT_ROOT) {
      const normalizedNew = String(newCwd).replace(/\\/g, '/');
      const normalizedRoot = String(PROJECT_ROOT).replace(/\\/g, '/');
      const outsideProject = !normalizedNew.startsWith(normalizedRoot);

      if (outsideProject) {
        health.writeAuditLog('cwd-outside-project', {
          new_cwd: newCwd,
          project_root: PROJECT_ROOT,
          agent_id: agentId,
          advisory: 'Working directory moved outside project root',
          severity: 'low',
        });
      }
    }

    process.exit(0);
  });
}

main();
