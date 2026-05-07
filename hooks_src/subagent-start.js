#!/usr/bin/env node

/**
 * subagent-start.js — SubagentStart hook
 *
 * Fires when any subagent spawns (Agent tool). Establishes fleet agent
 * identity in telemetry before the agent does any work, so every
 * subsequent tool call can be attributed to the correct agent_id.
 *
 * Design:
 *   - Observer only: always exit 0 (never blocks agent launch)
 *   - Identity binding: logs agent_id + agent_type at spawn time
 *   - Fleet tracking: increments active fleet count in telemetry
 *
 * Exit codes:
 *   0 = always
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

    const agentId = event.agent_id || event.subagent_id || null;
    const agentType = event.subagent_type || event.agent_type || null;
    const sessionId = event.session_id || null;
    const description = event.description || null;

    health.increment('subagent-start', 'count');

    // Log the agent spawn with full identity context
    health.logTiming('subagent-start', 0, {
      event: 'subagent-start',
      agent_id: agentId,
      agent_type: agentType,
      session_id: sessionId,
      description: description ? description.slice(0, 120) : null,
    });

    // Audit log for fleet campaigns — spawning an agent is a meaningful action
    if (agentType && agentType !== 'unknown') {
      health.writeAuditLog('subagent-spawn', {
        agent_id: agentId,
        agent_type: agentType,
        description: description ? description.slice(0, 120) : null,
        severity: 'low',
      });
    }

    process.exit(0);
  });
}

main();
