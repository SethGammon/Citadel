#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(process.env.CITADEL_PROJECT_ROOT || process.cwd());

const TOOL_DEFS = [
  {
    name: 'citadel_status',
    description: 'Summarize Citadel planning, campaign, fleet, telemetry, and artifact state for the current project.',
    inputSchema: {
      type: 'object',
      properties: {
        includeFiles: { type: 'boolean', description: 'Include representative file paths.' },
      },
    },
  },
  {
    name: 'citadel_workflow_prompt',
    description: 'Return a ready-to-run prompt for a Citadel workflow while preserving project state expectations.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Workflow name such as triage, pr-watch, daemon, schedule, or qa.' },
        target: { type: 'string', description: 'Optional target issue, PR, path, route, or command.' },
      },
      required: ['workflow'],
    },
  },
];

function countFiles(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(filter).length;
}

function readJsonlCount(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).length;
}

function listFiles(dir, limit = 10) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).slice(0, limit).map((name) => path.join(dir, name));
}

function status(includeFiles = false) {
  const planning = path.join(PROJECT_ROOT, '.planning');
  const campaigns = path.join(planning, 'campaigns');
  const fleet = path.join(planning, 'fleet');
  const telemetry = path.join(planning, 'telemetry');
  const artifacts = path.join(planning, 'artifacts');
  const value = {
    projectRoot: PROJECT_ROOT,
    planningExists: fs.existsSync(planning),
    campaigns: countFiles(campaigns, (name) => name.endsWith('.md') || name.endsWith('.json')),
    fleetSessions: countFiles(fleet),
    telemetry: {
      hookTiming: readJsonlCount(path.join(telemetry, 'hook-timing.jsonl')),
      audit: readJsonlCount(path.join(telemetry, 'audit.jsonl')),
      codexHookTrace: readJsonlCount(path.join(telemetry, 'codex-hook-trace.jsonl')),
    },
    codexAppArtifacts: readJsonlCount(path.join(artifacts, 'codex-app-evidence.jsonl')),
  };

  if (includeFiles) {
    value.files = {
      campaigns: listFiles(campaigns),
      fleet: listFiles(fleet),
      artifacts: listFiles(artifacts),
    };
  }
  return value;
}

function workflowPrompt(workflow, target) {
  const suffix = target ? ` Target: ${target}.` : '';
  const prompts = {
    triage: `Use Citadel triage on this GitHub item. Investigate code and PR context, decide what belongs, make safe edits when needed, and draft an appreciative direct response.${suffix}`,
    'pr-watch': `Use Citadel pr-watch for this PR. Read CI logs, fix only verified failures, rerun focused checks, and record progress in .planning/.${suffix}`,
    daemon: `Continue the active Citadel daemon. Read .planning/daemon.json, enforce budget/status gates, continue the campaign, and append a run summary.${suffix}`,
    schedule: `Create or inspect a Citadel schedule. Prefer Codex app automations for durable recurring work and record the plan in .planning/codex-automations/.${suffix}`,
    qa: `Run Citadel QA. Use the in-app browser or Playwright, save screenshots and reports, and record artifact paths with scripts/codex-app-artifacts.js.${suffix}`,
  };
  return prompts[workflow] || `Use Citadel /${workflow} with durable .planning state and verification evidence.${suffix}`;
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'citadel-state', version: '1.0.0' },
      instructions: 'Use citadel_status before long-running Citadel workflows, then preserve .planning state when invoking Citadel skills.',
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    respond(id, { tools: TOOL_DEFS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    if (name === 'citadel_status') {
      respond(id, { content: [{ type: 'text', text: JSON.stringify(status(Boolean(args.includeFiles)), null, 2) }] });
      return;
    }
    if (name === 'citadel_workflow_prompt') {
      respond(id, { content: [{ type: 'text', text: workflowPrompt(args.workflow, args.target) }] });
      return;
    }
    respondError(id, -32601, `Unknown tool: ${name}`);
    return;
  }

  if (method === 'resources/list') {
    respond(id, {
      resources: [
        { uri: 'citadel://status', name: 'Citadel Status', mimeType: 'application/json' },
      ],
    });
    return;
  }

  if (method === 'resources/read' && params && params.uri === 'citadel://status') {
    respond(id, {
      contents: [{ uri: 'citadel://status', mimeType: 'application/json', text: JSON.stringify(status(true), null, 2) }],
    });
    return;
  }

  if (id !== undefined) respondError(id, -32601, `Unknown method: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleRequest(JSON.parse(trimmed));
    } catch (err) {
      respondError(null, -32700, `Parse error: ${err.message}`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
