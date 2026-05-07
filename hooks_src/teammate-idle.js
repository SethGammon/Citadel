#!/usr/bin/env node

/**
 * teammate-idle.js — TeammateIdle hook
 *
 * Fires when a teammate (Claude Code session in a multi-agent team) is
 * about to go idle. In Citadel's fleet model, agents are spawned via
 * the Agent tool (SubagentStart/SubagentStop) rather than as separate
 * Claude Code sessions, so this event fires in multi-instance setups.
 *
 * Key behaviors:
 *   - Log which teammate went idle for diagnostic purposes
 *   - If the idle teammate has an associated fleet task, log for review
 *   - Observer only: Citadel does not auto-reassign fleet work on idle
 *
 * Design:
 *   - Observer only: always exit 0
 *   - Future extension: exit 2 to prevent idle if teammate has pending work
 *
 * Exit codes:
 *   0 = allow idle (always, currently)
 */

'use strict';

const health = require('./harness-health-util');

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const teammateId = event.teammate_id || event.agent_id || null;
    const reason = event.reason || event.idle_reason || 'unspecified';
    const sessionId = event.session_id || null;

    health.increment('teammate-idle', 'count');

    health.logTiming('teammate-idle', 0, {
      event: 'teammate-idle',
      teammate_id: teammateId,
      reason,
      session_id: sessionId,
    });

    process.exit(0);
  });
}

main();
