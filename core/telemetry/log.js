'use strict';

const path = require('path');
const { appendJsonl } = require('./io');
const { SCHEMA_VERSION, validateAgentRunEvent } = require('./schema');
const { createIntegrityRecord } = require('./integrity');

function resolveTelemetryPaths(projectRoot) {
  const telemetryDir = path.join(projectRoot, '.planning', 'telemetry');
  return {
    telemetryDir,
    agentRuns: path.join(telemetryDir, 'agent-runs.jsonl'),
    hookTiming: path.join(telemetryDir, 'hook-timing.jsonl'),
    compression: path.join(telemetryDir, 'compression-stats.jsonl'),
    sessionCosts: path.join(telemetryDir, 'session-costs.jsonl'),
  };
}

function createAgentRunEntry(args, options = {}) {
  return createIntegrityRecord({
    schema: SCHEMA_VERSION,
    timestamp: options.timestamp || new Date().toISOString(),
    event: args.event,
    agent: args.agent || 'unknown',
    session: args.session || null,
    duration_ms: Number.isFinite(args.duration) ? args.duration : null,
    status: args.status || null,
    meta: args.meta || null,
    campaign_slug: args.campaign_slug || null,
  }, {
    run_id: args.run_id || options.run_id,
    agent_id: args.agent_id || options.agent_id,
    task_id: args.task_id || options.task_id,
    parent_id: args.parent_id || options.parent_id,
    source_event_id: args.source_event_id || options.source_event_id,
    hmacKey: options.hmacKey,
    hmacKeyId: options.hmacKeyId,
  });
}

function logAgentRunEvent(args, options = {}) {
  const projectRoot = options.projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const entry = createAgentRunEntry(args, options);
  const validation = validateAgentRunEvent(entry);
  const paths = resolveTelemetryPaths(projectRoot);

  appendJsonl(paths.agentRuns, entry);

  return {
    entry,
    validation,
    file: paths.agentRuns,
  };
}

module.exports = {
  createAgentRunEntry,
  logAgentRunEvent,
  resolveTelemetryPaths,
};
