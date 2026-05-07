#!/usr/bin/env node

/**
 * elicitation.js — Elicitation + ElicitationResult hook
 *
 * Fires when an MCP server requests user input (Elicitation) or after
 * the user responds to that request (ElicitationResult).
 *
 * Citadel does not currently ship MCP servers that use elicitation, so
 * the default behavior is to observe and log. The hook never auto-responds
 * to avoid accidentally filling forms for unknown MCP servers.
 *
 * If a Citadel MCP server is added that uses elicitation, add its server
 * name to the KNOWN_SERVERS allowlist and implement auto-fill logic.
 *
 * Design:
 *   - Observer only: always exit 0
 *   - Logs server name and event type to telemetry
 *   - Never auto-responds (no hookSpecificOutput emitted)
 *
 * Exit codes:
 *   0 = always (defer to user for all elicitations)
 */

'use strict';

const health = require('./harness-health-util');

// MCP server names for which Citadel might auto-respond in the future.
// Currently empty — add entries when Citadel ships elicitation-using servers.
const KNOWN_SERVERS = new Set([]);

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const hookEventName = event.hook_event_name || '';
    const isResult = hookEventName === 'ElicitationResult' ||
      event.accepted !== undefined;

    const serverName = event.server_name || event.mcp_server || null;
    const accepted = event.accepted !== undefined ? event.accepted : null;
    const sessionId = event.session_id || null;

    const eventLabel = isResult ? 'elicitation-result' : 'elicitation';

    health.increment('elicitation', 'count');

    health.logTiming('elicitation', 0, {
      event: eventLabel,
      server: serverName,
      accepted: accepted,
      known_server: serverName ? KNOWN_SERVERS.has(serverName) : false,
      session_id: sessionId,
    });

    // No auto-response: exit 0 with no stdout = defer to user
    process.exit(0);
  });
}

main();
