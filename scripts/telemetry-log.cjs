#!/usr/bin/env node

/**
 * telemetry-log.cjs — Log agent run events to JSONL.
 *
 * Usage:
 *   node scripts/telemetry-log.cjs --event <type> --agent <name> [--session <id>] [--meta <json>]
 *
 * Events: agent-start, agent-complete, agent-fail, campaign-start, campaign-complete,
 *         wave-start, wave-complete, agent-timeout
 */

const { logAgentRunEvent } = require('../core/telemetry/log');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--event') { args.event = val; i++; }
    else if (key === '--agent') { args.agent = val; i++; }
    else if (key === '--session') { args.session = val; i++; }
    else if (key === '--run-id') { args.run_id = val; i++; }
    else if (key === '--agent-id') { args.agent_id = val; i++; }
    else if (key === '--task-id') { args.task_id = val; i++; }
    else if (key === '--parent-id') { args.parent_id = val; i++; }
    else if (key === '--source-event-id') { args.source_event_id = val; i++; }
    else if (key === '--duration') { args.duration = parseInt(val, 10); i++; }
    else if (key === '--status') { args.status = val; i++; }
    else if (key === '--meta') {
      try { args.meta = JSON.parse(val); } catch { args.meta = val; }
      i++;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.event) {
    console.error('Usage: node scripts/telemetry-log.cjs --event <type> --agent <name>');
    process.exit(1);
  }

  const result = logAgentRunEvent(args);

  if (!result.validation.valid) {
    process.stderr.write(`[telemetry-log] WARNING: invalid event schema — ${result.validation.errors.join('; ')}\n`);
  }

  if (args.event === 'agent-complete' || args.event === 'campaign-complete') {
    console.log(`Logged: ${args.event} for ${args.agent}`);
  }
}

main();
