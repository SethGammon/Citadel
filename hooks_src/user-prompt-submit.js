#!/usr/bin/env node

/**
 * user-prompt-submit.js — UserPromptSubmit hook
 *
 * Fires before Claude processes each user prompt. This is the earliest
 * interception point in the turn lifecycle — hooks here can block or
 * modify the prompt before Claude sees it.
 *
 * Current behavior: observe-only logging. Records the session boundary
 * for turn attribution in telemetry. Future extension point for
 * semantic prompt screening (type: "prompt" gate) if needed.
 *
 * Design:
 *   - Observer only: always exit 0 (never blocks prompts)
 *   - Privacy: logs session_id and turn count, not prompt content
 *   - Lightweight: <5ms budget (fires on every user turn)
 *
 * Exit codes:
 *   0 = always (observer)
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

    const sessionId = event.session_id || null;
    const agentId = event.agent_id || null;

    health.increment('user-prompt-submit', 'count');

    health.logTiming('user-prompt-submit', 0, {
      event: 'prompt-submitted',
      session_id: sessionId,
      agent_id: agentId,
    });

    process.exit(0);
  });
}

main();
