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
 *   - Append a rebalance signal to .planning/fleet/rebalance.jsonl so the
 *     fleet lead can reassign the next unblocked scope (teams mode pilot)
 *   - Observer only: the hook records the idle event; reassignment is the
 *     lead's decision, never the hook's
 *
 * Design:
 *   - Observer only: always exit 0
 *   - Future extension: exit 2 to prevent idle if teammate has pending work
 *
 * Exit codes:
 *   0 = allow idle (always, currently)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const health = require('./harness-health-util');

const REBALANCE_FILE = path.join(
  health.PROJECT_ROOT, '.planning', 'fleet', 'rebalance.jsonl'
);

/**
 * Append an idle signal for the fleet lead. Append-only JSONL, one line per
 * idle event. Lines without teammate identity are diagnostic only; the lead
 * skips them when rebalancing.
 */
function appendRebalanceSignal(teammateId, reason, sessionId) {
  try {
    fs.mkdirSync(path.dirname(REBALANCE_FILE), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      teammate_id: teammateId,
      reason,
      session_id: sessionId,
      event: 'idle',
    });
    fs.appendFileSync(REBALANCE_FILE, line + '\n', 'utf8');
  } catch { /* observer: never fail the hook on a telemetry write */ }
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
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

      appendRebalanceSignal(teammateId, reason, sessionId);
    } catch { /* observer: never block */ }
    process.exit(0);
  });
}

main();
