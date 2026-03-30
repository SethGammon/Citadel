#!/usr/bin/env node

/**
 * session-tokens.js -- Read real token usage from Claude Code session JSONL files.
 *
 * This script remains the public CLI entrypoint, but the Claude-specific logic now
 * lives under runtimes/claude-code/adapters/session-tokens.js.
 */

'use strict';

const sessionTokens = require('../runtimes/claude-code/adapters/session-tokens');

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function printSession(label, tokens, cost) {
  console.log(`\n  ${label}`);
  console.log(`  Input:          ${formatTokens(tokens.input_tokens)} tokens`);
  console.log(`  Output:         ${formatTokens(tokens.output_tokens)} tokens`);
  console.log(`  Cache creation: ${formatTokens(tokens.cache_creation_input_tokens)} tokens`);
  console.log(`  Cache read:     ${formatTokens(tokens.cache_read_input_tokens)} tokens`);
  console.log(`  Messages:       ${tokens.messages}`);
  console.log(`  Cost:           $${cost.toFixed(4)}`);
  if (tokens.models) {
    const models = Object.entries(tokens.models).map(([model, count]) => `${model} (${count})`).join(', ');
    console.log(`  Models:         ${models}`);
  }
}

function runCli(argv) {
  const args = argv.slice(2);

  if (args.includes('--all') || args.includes('--today')) {
    const opts = args.includes('--today')
      ? { since: `${new Date().toISOString().slice(0, 10)}T00:00:00Z` }
      : {};
    const label = args.includes('--today') ? "Today's" : 'All';

    console.log(`\n${label} Sessions (Claude Code Token Data)`);
    console.log('='.repeat(50));

    const { sessions, totals } = sessionTokens.readAllSessions(opts);
    if (sessions.length === 0) {
      console.log('\n  No session data found.');
      return 0;
    }

    const shown = sessions.slice(-10);
    if (sessions.length > 10) {
      console.log(`\n  (Showing last 10 of ${sessions.length} sessions)`);
    }

    for (const session of shown) {
      const date = session.first_timestamp ? new Date(session.first_timestamp).toLocaleString() : 'unknown';
      printSession(
        `${session.sessionId.slice(0, 8)}... (${date}, ${session.duration_minutes}min, ${session.subagent_count} agents)`,
        session,
        session.cost
      );
    }

    console.log('\n' + '-'.repeat(50));
    console.log(`  Total sessions: ${totals.session_count}`);
    console.log(`  Total agents:   ${totals.subagent_count}`);
    console.log(`  Total messages: ${totals.messages}`);
    console.log(`  Total tokens:   ${formatTokens(totals.input_tokens + totals.output_tokens + totals.cache_creation_input_tokens + totals.cache_read_input_tokens)}`);
    console.log(`  Total cost:     $${totals.total_cost.toFixed(2)}`);
    console.log('');
    return 0;
  }

  const sessionId = args[0] || sessionTokens.getCurrentSessionId();
  if (!sessionId) {
    console.error('No session found. Pass a session ID or run from a Claude Code project.');
    return 1;
  }

  console.log('\nSession Token Report');
  console.log('='.repeat(50));
  console.log(`  Session: ${sessionId}`);

  const result = sessionTokens.readSessionTokens(sessionId);
  if (!result) {
    console.error(`  No data found for session ${sessionId}`);
    return 1;
  }

  const cost = sessionTokens.computeCost(result.combined);
  printSession('Combined (main + subagents)', result.combined, cost);

  if (result.subagents.length > 0) {
    console.log(`\n  Subagents: ${result.subagents.length}`);
    for (const subagent of result.subagents) {
      const subCost = sessionTokens.computeCost(subagent);
      printSession(`  ${subagent.agentId}`, subagent, subCost);
    }
  }

  const duration = result.combined.first_timestamp && result.combined.last_timestamp
    ? (new Date(result.combined.last_timestamp) - new Date(result.combined.first_timestamp)) / 60000
    : 0;
  if (duration > 0) {
    console.log(`\n  Duration: ${Math.round(duration)} minutes`);
  }
  console.log('');
  return 0;
}

module.exports = sessionTokens;

if (require.main === module) {
  process.exit(runCli(process.argv));
}
