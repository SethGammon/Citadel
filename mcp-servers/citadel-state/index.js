#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONTROL_ACTIONS,
  assertRequestRoot,
  fixedProjectRoot,
  listOperations,
  readOperation,
  submitIntent,
  validateControlResult,
} = require('../../core/operations');

const PROJECT_ROOT = fixedProjectRoot(process.env.CITADEL_PROJECT_ROOT || process.cwd());
const MUTATION_BASE_PROPERTIES = Object.freeze({
  project_root: { type: 'string' },
  operation_id: { type: 'string' },
  expected_revision: { type: 'integer', minimum: 0 },
  idempotency_key: { type: 'string' },
  actor: { type: 'string' },
  reason: { type: 'string' },
  capability: { type: 'string', enum: CONTROL_ACTIONS },
});
const MUTATION_REQUIRED = Object.freeze([
  'operation_id', 'expected_revision', 'idempotency_key', 'actor', 'reason', 'capability',
]);

function objectSchema(properties, required = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

function mutationSchema(includeAction) {
  const properties = { ...MUTATION_BASE_PROPERTIES };
  const required = [...MUTATION_REQUIRED];
  if (includeAction) {
    properties.action = { type: 'string', enum: CONTROL_ACTIONS };
    required.push('action');
  }
  return objectSchema(properties, required);
}

const TOOL_DEFS = Object.freeze([
  {
    name: 'citadel_status',
    description: 'Summarize Citadel planning, campaign, fleet, telemetry, and artifact state.',
    inputSchema: objectSchema({ includeFiles: { type: 'boolean' } }),
  },
  {
    name: 'citadel_workflow_prompt',
    description: 'Return a ready-to-run prompt for a bounded Citadel workflow.',
    inputSchema: objectSchema({ workflow: { type: 'string' }, target: { type: 'string' } }, ['workflow']),
  },
  {
    name: 'citadel_operation_list',
    description: 'List validated Operations Protocol control records in the fixed project.',
    inputSchema: objectSchema({ project_root: { type: 'string' } }),
  },
  {
    name: 'citadel_operation_get',
    description: 'Read one validated Operations Protocol control record.',
    inputSchema: objectSchema({ project_root: { type: 'string' }, operation_id: { type: 'string' } }, ['operation_id']),
  },
  {
    name: 'citadel_intent_submit',
    description: 'Submit a typed, immutable control intent. This tool cannot execute commands or edit campaigns.',
    inputSchema: mutationSchema(true),
  },
  ...CONTROL_ACTIONS.map((action) => ({
    name: `citadel_operation_${action}`,
    description: `Append a validated ${action} intent for an operation.`,
    inputSchema: mutationSchema(false),
  })),
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function validateArguments(args, schema) {
  const errors = [];
  if (!isPlainObject(args)) return ['arguments must be a plain object'];
  const allowed = Object.keys(schema.properties);
  for (const key of Object.keys(args)) if (!allowed.includes(key)) errors.push(`unknown argument: ${key}`);
  for (const key of schema.required || []) if (!(key in args)) errors.push(`missing argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) continue;
    if (property.type === 'string' && typeof value !== 'string') errors.push(`${key} must be a string`);
    if (property.type === 'boolean' && typeof value !== 'boolean') errors.push(`${key} must be boolean`);
    if (property.type === 'integer' && !Number.isInteger(value)) errors.push(`${key} must be an integer`);
    if (property.minimum !== undefined && Number.isInteger(value) && value < property.minimum) errors.push(`${key} is below its minimum`);
    if (property.enum && !property.enum.includes(value)) errors.push(`${key} is not an allowed value`);
  }
  return errors;
}

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
  if (includeFiles) value.files = { campaigns: listFiles(campaigns), fleet: listFiles(fleet), artifacts: listFiles(artifacts) };
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

function validateReadOutput(name, value) {
  if (name === 'citadel_operation_list') {
    return isPlainObject(value) && Object.keys(value).sort().join(',') === 'operations,outcome'
      && ['accepted', 'unknown'].includes(value.outcome) && Array.isArray(value.operations);
  }
  if (name === 'citadel_operation_get') {
    return isPlainObject(value) && Object.keys(value).sort().join(',') === 'operation,outcome,reason_code'
      && ['accepted', 'unknown'].includes(value.outcome) && typeof value.reason_code === 'string';
  }
  return true;
}

function toolResult(payload, isError = false) {
  if (!isPlainObject(payload) && typeof payload !== 'string') throw new TypeError('MCP tool output must be structured or text');
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function rejectedMutation(args, action) {
  const request = {
    operation_id: typeof args?.operation_id === 'string' && /^[a-z][a-z0-9_.:-]*$/.test(args.operation_id)
      ? args.operation_id : 'invalid-operation',
    action: CONTROL_ACTIONS.includes(action) ? action : 'pause',
    intent_id: null,
    expected_revision: Number.isInteger(args?.expected_revision) && args.expected_revision >= 0 ? args.expected_revision : 0,
    current_revision: null,
    outcome: 'rejected',
    reason_code: 'INVALID_ARGUMENTS',
  };
  if (validateControlResult(request).length) throw new TypeError('Could not construct rejected result');
  return request;
}

function handleTool(name, args) {
  const definition = TOOL_DEFS.find((entry) => entry.name === name);
  if (!definition) return { error: { code: -32601, message: `Unknown tool: ${name}` } };
  const errors = validateArguments(args, definition.inputSchema);
  const specificAction = name.startsWith('citadel_operation_')
    && !['citadel_operation_list', 'citadel_operation_get'].includes(name)
    ? name.slice('citadel_operation_'.length) : null;
  const isMutation = name === 'citadel_intent_submit' || specificAction !== null;
  const mutationAction = name === 'citadel_intent_submit' ? args?.action : specificAction;
  if (errors.length) {
    if (isMutation) return { result: toolResult(rejectedMutation(args, mutationAction), true) };
    return { error: { code: -32602, message: 'Invalid tool arguments' } };
  }

  try {
    if (name === 'citadel_status') return { result: toolResult(status(Boolean(args.includeFiles))) };
    if (name === 'citadel_workflow_prompt') return { result: toolResult(workflowPrompt(args.workflow, args.target)) };
    const root = assertRequestRoot(PROJECT_ROOT, args.project_root);
    if (name === 'citadel_operation_list') {
      const payload = listOperations(root);
      if (!validateReadOutput(name, payload)) throw new TypeError('Invalid operation list output');
      return { result: toolResult(payload) };
    }
    if (name === 'citadel_operation_get') {
      const payload = readOperation(root, args.operation_id);
      if (!validateReadOutput(name, payload)) throw new TypeError('Invalid operation get output');
      return { result: toolResult(payload) };
    }
    const request = {
      operation_id: args.operation_id,
      expected_revision: args.expected_revision,
      idempotency_key: args.idempotency_key,
      actor: args.actor,
      reason: args.reason,
      capability: args.capability,
      action: mutationAction,
    };
    const payload = submitIntent(root, request);
    if (validateControlResult(payload).length) throw new TypeError('Invalid control result output');
    return { result: toolResult(payload, payload.outcome === 'rejected') };
  } catch (_error) {
    if (mutationAction) return { result: toolResult(rejectedMutation(args, mutationAction), true) };
    return { error: { code: -32602, message: 'Request is outside the configured project boundary or state is invalid' } };
  }
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

function handleRequest(req) {
  if (!isPlainObject(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    respondError(req?.id ?? null, -32600, 'Invalid Request');
    return;
  }
  const { id, method, params } = req;
  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'citadel-state', version: '1.2.0' },
      instructions: 'Read operation state, then submit typed intents. This server never executes arbitrary commands or edits campaign files.',
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') { respond(id, { tools: TOOL_DEFS }); return; }
  if (method === 'tools/call') {
    if (!isPlainObject(params) || Object.keys(params).some((key) => !['name', 'arguments'].includes(key))
      || typeof params.name !== 'string') {
      respondError(id, -32602, 'Invalid tool call');
      return;
    }
    const handled = handleTool(params.name, params.arguments === undefined ? {} : params.arguments);
    if (handled.error) respondError(id, handled.error.code, handled.error.message);
    else respond(id, handled.result);
    return;
  }
  if (method === 'resources/list') {
    respond(id, { resources: [{ uri: 'citadel://status', name: 'Citadel Status', mimeType: 'application/json' }] });
    return;
  }
  if (method === 'resources/read' && isPlainObject(params) && params.uri === 'citadel://status') {
    respond(id, { contents: [{ uri: 'citadel://status', mimeType: 'application/json', text: JSON.stringify(status(true), null, 2) }] });
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
    if (!line.trim()) continue;
    try { handleRequest(JSON.parse(line)); } catch (_error) { respondError(null, -32700, 'Parse error'); }
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
